/** 隔离 PostgreSQL/WASM + 真实 HTTP 测试；不加载 .env、不连接线上数据库。
 * 单连接工作单元串行化用于测试确定性，不代替真实多连接 PostgreSQL 压力/锁等待验收。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import { PGlite } from '@electric-sql/pglite'
import type { PoolClient } from 'pg'
import { ALL_MIGRATIONS } from '../src/migrations/catalog.js'
import { loadAuthConfig } from '../src/config/auth.config.js'
import { registerSchema, loginSchema } from '../src/modules/auth/register.schema.js'
import { AuthService } from '../src/modules/auth/auth.service.js'
import { UserRepository } from '../src/modules/auth/user.repository.js'
import { PasswordService } from '../src/modules/auth/password.service.js'
import { TokenService } from '../src/modules/auth/token.service.js'
import { AuthRateLimiter } from '../src/modules/auth/rate-limit.repository.js'
import { authRouter } from '../src/modules/auth/auth.routes.js'
import { optionalAuthentication } from '../src/modules/auth/auth.middleware.js'
import { PortfolioService } from '../src/modules/portfolio/portfolio.service.js'
import { PgPortfolioRepository } from '../src/modules/portfolio/portfolio.repository.js'
import { portfolioRouter } from '../src/modules/portfolio/portfolio.routes.js'
import { AppError } from '../src/shared/errors.js'
import { requestContext, errorHandler } from '../src/shared/http.js'
import { verifySchema } from '../src/database/schema-verifier.js'
const config = loadAuthConfig({ JWT_SECRET: 'test-only-secret-not-for-deployment-0123456789',
  NODE_ENV: 'test', ZEROQUANT_REGISTRATION_ENABLED: 'true', BCRYPT_ROUNDS: '10',
  ZEROQUANT_AUTH_COOKIE_PATH: '/api/v1/auth', ZEROQUANT_PUBLIC_ORIGIN: 'http://localhost' })
const password = 'a long unique test passphrase 123!'
const input = (phone = '13800000001') => registerSchema({ phone, username: '测试用户', password })
const codeIs = (key: string) => (error: unknown) => error instanceof AppError && error.key === key

test('认证 Schema、配置和密码边界', async t => {
  await t.test('账号规范化；昵称允许重复但禁止空白；密码不 trim', () => {
    assert.equal(input(' +8613800000001 ').phone, '13800000001')
    assert.equal(registerSchema({ ...input(), password: ' ' + password }).password, ' ' + password)
    for (const body of [null, [], { ...input(), phone: {} }, { ...input(), username: 'a b' },
      { ...input(), password: 'a'.repeat(73) }, { ...input(), password: '汉'.repeat(25) },
      { ...input(), password: 'short' }, { ...input(), password: password + '\0' }]) assert.throws(() => registerSchema(body), codeIs('VALIDATION'))
    assert.equal(loginSchema({ phone: '13800000001', password: 'old123' }).password, 'old123')
  })
  await t.test('缺少密钥、非 HTTPS 生产 Origin、非法 TTL 和邀请码拒绝启动', () => {
    for (const env of [{}, { JWT_SECRET: 'short' }, { JWT_SECRET: 'a'.repeat(64) },
      { JWT_SECRET: 'replace-with-a-long-random-secret' }, { JWT_SECRET: ' ' + config.secret },
      { JWT_SECRET: config.secret, JWT_ACCESS_SECONDS: '30d' },
      { JWT_SECRET: config.secret, NODE_ENV: 'production', ZEROQUANT_PUBLIC_ORIGIN: 'http://example.com' },
      { JWT_SECRET: config.secret, NODE_ENV: 'production', ZEROQUANT_PUBLIC_ORIGIN: 'https://example.com', ZEROQUANT_REGISTRATION_ENABLED: 'true' }]) {
      assert.throws(() => loadAuthConfig(env))
    }
  })
  await t.test('真实 bcrypt 比较与虚拟账号失败路径', async () => {
    const passwords = new PasswordService(10)
    const hash = await passwords.hash(password)
    assert.equal(await passwords.verify(password, hash), true)
    assert.equal(await passwords.verify('incorrect', hash), false)
    assert.equal(await passwords.verify(password), false)
  })
  await t.test('23505 仅映射已知 phone 约束，其他数据库错误原样向上转交', async () => {
    const known = new UserRepository({ query: async () => { throw { code: '23505', constraint: 'users_phone_key' } } } as unknown as PoolClient)
    await assert.rejects(() => known.createUser('x','x','x'), codeIs('REGISTRATION_CONFLICT'))
    const foreign = { code: '23505', constraint: 'unrelated_key' }
    const other = new UserRepository({ query: async () => { throw foreign } } as unknown as PoolClient)
    await assert.rejects(() => other.createUser('x','x','x'), e => e === foreign)
  })
})

test('认证与持仓 PostgreSQL 契约、事务及 HTTP 链路', async t => {
  const db = new PGlite()
  const client = { query: async (sql: string, params?: unknown[]) => params ? db.query(sql, params) :
    /^(SELECT|WITH)\b/i.test(sql.trim()) ? db.query(sql) : db.exec(sql), release() {} } as unknown as PoolClient
  // PGlite 只有一个会话；用队列隔离测试事务，避免不同测试命令交叉 BEGIN。
  let queue = Promise.resolve()
  const transaction = <T>(operation: () => Promise<T>): Promise<T> => {
    const task = queue.then(async () => {
      await db.exec('BEGIN')
      try { const result = await operation(); await db.exec('COMMIT'); return result }
      catch (error) { await db.exec('ROLLBACK'); throw error }
    })
    queue = task.then(() => {}, () => {})
    return task
  }
  const work = { run: <T>(operation: (repo: UserRepository) => Promise<T>) => transaction(() => operation(new UserRepository(client))) }
  const tokens = new TokenService(config)
  const passwords = new PasswordService(10)
  const auth = new AuthService(work, passwords, tokens, config)
  const portfolio = new PortfolioService({ run: operation => transaction(() => operation(new PgPortfolioRepository(client))) })
  try {
    await db.exec('CREATE TABLE schema_migrations(version VARCHAR(50) PRIMARY KEY,name VARCHAR(255) NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
    for (const migration of ALL_MIGRATIONS) await transaction(async () => {
      await migration.up(client)
      await db.query('INSERT INTO schema_migrations(version,name) VALUES($1,$2)', [migration.version,migration.name])
    })
    await t.test('全部迁移含认证三张表与权威字段目录一致', async () => {
      const differences = await verifySchema({ connect: async () => client })
      assert.deepEqual(differences.filter(d => d.severity === 'ERROR'), [])
    })
    let registered: Awaited<ReturnType<AuthService['register']>>
    await t.test('注册返回 DTO 不含密码；仅登记刷新摘要；JWT 无手机号昵称', async () => {
      registered = await auth.register(input())
      assert.equal('password' in registered.user, false)
      const payload = JSON.parse(Buffer.from(registered.token.split('.')[1], 'base64url').toString())
      assert.equal(payload.phone, undefined); assert.equal(payload.username, undefined)
      assert.equal(payload.exp - payload.iat, 900)
      const rows = (await db.query('SELECT token_hash FROM auth_refresh_tokens')).rows
      assert.equal(rows[0].token_hash, tokens.digest(registered.refreshToken))
      assert.notEqual(rows[0].token_hash, registered.refreshToken)
    })
    await t.test('并发同号注册只能一次成功，不按 SELECT 结果裁决', async () => {
      const results = await Promise.allSettled([auth.register(input('13800000002')), auth.register(input('13800000002'))])
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
      assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE phone='13800000002'")).rows[0].n, 1)
    })
    await t.test('会话签发失败时用户与会话全部回滚', async () => {
      const broken = new AuthService(work, passwords, {
        access() { throw new Error('simulated signer failure') }, verify: tokens.verify.bind(tokens),
        refresh: tokens.refresh.bind(tokens), digest: tokens.digest.bind(tokens), id: tokens.id.bind(tokens),
      }, config)
      await assert.rejects(() => broken.register(input('13800000003')))
      assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE phone='13800000003'")).rows[0].n, 0)
    })
    await t.test('错误密码与不存在账号使用相同业务异常', async () => {
      await assert.rejects(() => auth.login({ phone: '13800000001', password: 'wrong' }), codeIs('INVALID_CREDENTIALS'))
      await assert.rejects(() => auth.login({ phone: '13900000000', password: 'wrong' }), codeIs('INVALID_CREDENTIALS'))
    })
    await t.test('刷新轮换；旧令牌重放使同会话的新访问令牌也立即失效', async () => {
      const result = await auth.refresh(registered.refreshToken)
      assert.notEqual(result.refreshToken, registered.refreshToken)
      await auth.authenticate(result.token)
      await assert.rejects(() => auth.refresh(registered.refreshToken), codeIs('UNAUTHENTICATED'))
      await assert.rejects(() => auth.authenticate(result.token), codeIs('UNAUTHENTICATED'))
    })
    await t.test('多设备独立；其他用户不能撤销他人会话；退出立即撤销', async () => {
      const first = await auth.login(input())
      const second = await auth.login(input())
      const principal = await auth.authenticate(first.token)
      const stranger = await auth.login(input('13800000002'))
      await auth.logout(await auth.authenticate(stranger.token), principal.sessionId)
      await auth.authenticate(first.token)
      assert.equal((await auth.sessions(principal)).length, 2)
      await auth.logout(principal)
      await assert.rejects(() => auth.authenticate(first.token), codeIs('UNAUTHENTICATED'))
      await auth.authenticate(second.token)
    })
    await t.test('伪造签名、旧格式 token、过期会话均不能使用', async () => {
      await assert.rejects(() => auth.authenticate('invalid'), codeIs('UNAUTHENTICATED'))
      const result = await auth.login(input())
      const p = await auth.authenticate(result.token)
      await db.query('UPDATE auth_sessions SET expires_at=NOW()-INTERVAL \'1 second\' WHERE id=$1', [p.sessionId])
      await assert.rejects(() => auth.authenticate(result.token), codeIs('UNAUTHENTICATED'))
      await assert.rejects(() => auth.refresh(result.refreshToken), codeIs('UNAUTHENTICATED'))
    })
    await t.test('共享限流原子计数、回源故障不放行', async () => {
      const limiter = new AuthRateLimiter(client, config.secret)
      await limiter.consume('isolated-limit', 2); await limiter.consume('isolated-limit', 2)
      await assert.rejects(() => limiter.consume('isolated-limit', 2), codeIs('RATE_LIMITED'))
      const broken = new AuthRateLimiter({ query: async () => { throw new Error('offline') } } as unknown as PoolClient, config.secret)
      await assert.rejects(() => broken.consume('x', 2))
    })
    const userId = registered.user.id
    await t.test('持仓设置、买入和超卖回滚；精确返回本次插入记录', async () => {
      await portfolio.record(userId, '000572', 'SET_POSITION', 10, 100)
      const trade = await portfolio.record(userId, '000572', 'BUY', 12, 100)
      assert.equal(trade.nextShares, 200); assert.equal(trade.nextCost, 11)
      assert.equal(trade.trade?.tradePrice, 12)
      await assert.rejects(() => portfolio.record(userId, '000572', 'SELL', 12, 201), codeIs('VALIDATION'))
      assert.equal((await db.query('SELECT holding_shares FROM user_positions WHERE user_id=$1', [userId])).rows[0].holding_shares, 200)
      await portfolio.undo(userId, trade.trade!.id)
      assert.equal((await db.query('SELECT holding_shares FROM user_positions WHERE user_id=$1', [userId])).rows[0].holding_shares, 100)
    })
    await t.test('仅撤销最新且快照一致的成交；拒绝覆盖更正持仓与跨租户撤销', async () => {
      const one = await portfolio.record(userId,'000572','BUY',10,10)
      const two = await portfolio.record(userId,'000572','BUY',10,10)
      await assert.rejects(() => portfolio.undo(userId, one.trade!.id), codeIs('CONFLICT'))
      await assert.rejects(() => portfolio.undo('someone-else',two.trade!.id), codeIs('NOT_FOUND'))
      await portfolio.record(userId,'000572','SET_POSITION',15,500)
      await assert.rejects(() => portfolio.undo(userId,two.trade!.id), codeIs('CONFLICT'))
      await assert.rejects(() => portfolio.record(userId,'000572','BUY',1,2147483647), codeIs('VALIDATION'))
    })
    await t.test('真实 HTTP：201、Cookie、CSRF、401、刷新、退出及 requestId', async () => {
      const app = express()
      app.use(requestContext, express.json({ limit: '10kb' }))
      app.use('/api/v1/auth', authRouter(auth, new AuthRateLimiter(client,config.secret), config))
      app.use(optionalAuthentication(auth))
      app.use('/api/v1/user', portfolioRouter(portfolio))
      app.use(errorHandler)
      const server = app.listen(0, '127.0.0.1')
      await new Promise<void>(resolve => server.once('listening', resolve))
      const address = server.address()
      assert.ok(address && typeof address !== 'string')
      const base = 'http://127.0.0.1:' + address.port
      const headers = { 'Content-Type': 'application/json', 'X-ZeroQuant-Client': 'web', Origin: 'http://localhost' }
      try {
        let response = await fetch(base+'/api/v1/auth/register', {method:'POST',headers,body:JSON.stringify(input('13800000009'))})
        assert.equal(response.status,201)
        const cookie = response.headers.get('set-cookie')!
        assert.match(cookie,/HttpOnly/); assert.match(cookie,/SameSite=Strict/)
        assert.match(response.headers.get('x-request-id')!,/^[0-9a-f-]{36}$/)
        const data = await response.json()
        assert.equal(data.data.refreshToken,undefined)
        response = await fetch(base+'/api/v1/auth/refresh',{method:'POST',headers:{...headers,Cookie:cookie.split(';')[0]},body:'{}'})
        assert.equal(response.status,200)
        const refreshed = await response.json()
        response = await fetch(base+'/api/v1/user/position',{method:'POST',headers,body:'{}'})
        assert.equal(response.status,401)
        response = await fetch(base+'/api/v1/auth/refresh',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:'{}'})
        assert.equal(response.status,403)
        response = await fetch(base+'/api/v1/auth/login',{method:'POST',headers,body:'{'})
        assert.equal(response.status,400); assert.equal((await response.json()).code,10001)
        response = await fetch(base+'/api/v1/auth/logout',{method:'POST',headers:{...headers,Authorization:'Bearer '+refreshed.data.token},body:'{}'})
        assert.equal(response.status,200)
        await assert.rejects(() => auth.authenticate(refreshed.data.token),codeIs('UNAUTHENTICATED'))
        // Express 默认允许大小写与尾斜杠变体；所有变体应共享严格的凭据限流。
        await db.exec('DELETE FROM auth_rate_limits')
        const variants = ['/LOGIN/', '/login', '/REGISTER/', '/register']
        for (let attempt = 0; attempt < 21; attempt++) {
          response = await fetch(base+'/api/v1/auth'+variants[attempt % variants.length], {method:'POST',headers,body:'{}'})
          assert.equal(response.status, attempt < 20 ? 400 : 429, 'credential attempt ' + attempt)
        }

      } finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())) }
    })
  } finally { await db.close() }
})
