import { DailyBarsService } from '../src/modules/daily-bars/daily-bars.service.js'
import { DailyBarsRepository } from '../src/modules/daily-bars/daily-bars.repository.js'
import { ALL_MIGRATIONS } from '../src/migrations/catalog.js'
/** 全局复查发现的回归：纯解析与隔离数据库，不连接真实账号或云库。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import type { Pool, PoolClient } from 'pg'
import { parseTradingIntent } from '../src/voice-cleaner.js'
import { PublicTradesService } from '../src/modules/public-trades/public-trades.service.js'
import { PublicTradesRepository } from '../src/modules/public-trades/public-trades.repository.js'
import { PgUnitOfWork } from '../src/shared/transaction.js'
import jwt from 'jsonwebtoken'
import { TokenService } from '../src/modules/auth/token.service.js'
import { loadAuthConfig } from '../src/config/auth.config.js'
import { logError } from '../src/shared/logger.js'
import { AppError } from '../src/shared/errors.js'

const row = { stockCode: '000572', tradeDate: '2026-09-15', timeStr: '10:00:01', type: '买盘', price: 10, volumeLots: 2, note: '公开成交' }
test('聊天不把否定、计划、引用、缺失参数或多笔叙述当作成交', () => {
  for (const text of ['买了', '买了100股', '买了10元', '没买了100股10元', '打算买了100股10元',
    '明天买入100股10元', '他说买了100股10元', '如果买了100股10元', '买了100股10元吗',
    '买了-100股10元', '买了1.5股10元', '买了100股10元，卖了100股11元',
    '我有股票000572，买了100股', '买了2147483648股10元']) {
    assert.equal(parseTradingIntent(text, 99).isTradeAction, false, text)
  }
})
test('聊天只录入明确完整的单笔数值，不补现价或默认一千股', () => {
  const buy = parseTradingIntent('我买了100股，成交价10元', 99)
  assert.equal(buy.actionType, 'BUY'); assert.equal(buy.price, 10); assert.equal(buy.shares, 100)
  const sell = parseTradingIntent('我以10.50元已卖出2手')
  assert.equal(sell.actionType, 'SELL'); assert.equal(sell.price, 10.5); assert.equal(sell.shares, 200)
  const clear = parseTradingIntent('设置持仓为0股，成本0元')
  assert.equal(clear.actionType, 'SET_POSITION'); assert.equal(clear.isTradeAction, true); assert.equal(clear.shares, 0)
})
test('无效逐笔批次整体拒绝，在验证完成前不进入仓储；空批次不清空', async () => {
  let writes = 0
  const service = new PublicTradesService({ async replace() { writes++ } })
  for (const invalid of [null, true, { ...row, price: false }, { ...row, volumeLots: [] },
    { ...row, tradeDate: '2026-02-30' }, { ...row, stockCode: 'broken' },
    { ...row, timeStr: '25:70:00' }, { ...row, price: -1 }, { ...row, type: {} }]) {
    await assert.rejects(() => service.replace({ records: [row, invalid] }), e => e instanceof AppError && e.key === 'VALIDATION')
  }
  assert.deepEqual(await service.replace({ records: [] }), { inserted: 0 })
  assert.equal(writes, 0)
  assert.deepEqual(await service.replace({ records: [row] }), { inserted: 1 })
  assert.equal(writes, 1)
})
test('逐笔快照替换的插入失败回滚删除；锁顺序固定且只替换目标日期', async () => {
  const db = new PGlite()
  const locks: string[] = []
  let fail = false
  const client = { async query(sql: string, values?: unknown[]) {
    if (sql.includes('pg_advisory_xact_lock')) locks.push(String(values?.[0]))
    if (fail && sql.startsWith('INSERT')) throw new Error('isolated insert failure')
    return db.query(sql, values)
  }, release() {} } as unknown as PoolClient
  const work = new PgUnitOfWork({ connect: async () => client } as unknown as Pool)
  const service = new PublicTradesService(new PublicTradesRepository(work))
  try {
    await db.exec('CREATE TABLE stock_l2_orders(stock_code TEXT,trade_date DATE,time_str TEXT,type TEXT,price FLOAT8,volume_lots FLOAT8,note TEXT)')
    await service.replace({ records: [row, { ...row, tradeDate: '2026-09-14' }] })
    assert.deepEqual(locks, ['public-trades|000572|2026-09-14', 'public-trades|000572|2026-09-15'])
    fail = true
    await assert.rejects(() => service.replace({ records: [{ ...row, price: 12 }] }))
    assert.deepEqual((await db.query('SELECT price FROM stock_l2_orders ORDER BY trade_date')).rows.map(r => r.price), [10, 10])
    fail = false
    await service.replace({ records: [{ ...row, price: 12 }] })
    assert.deepEqual((await db.query('SELECT price FROM stock_l2_orders ORDER BY trade_date')).rows.map(r => r.price), [10, 12])
  } finally { await db.close() }
})

test('JWT 拒绝真实签名旧令牌、错误用途、错误算法、过期和篡改令牌', () => {
  const config = loadAuthConfig({ JWT_SECRET: 'isolated-jwt-test-only-secret-0123456789' })
  const service = new TokenService(config)
  const principal = { userId: 'test-user', sessionId: service.id() }
  const valid = service.access(principal)
  assert.deepEqual(service.verify(valid), principal)
  const options = { algorithm: 'HS256' as const, issuer: 'zeroquant', audience: 'zeroquant-web', subject: principal.userId, expiresIn: 900 }
  const invalid = [
    jwt.sign({ userId: principal.userId, phone: '13800000001' }, config.secret, { expiresIn: '30d' }),
    jwt.sign({ sid: principal.sessionId }, config.secret, { ...options, audience: 'other-app' }),
    jwt.sign({ sid: principal.sessionId }, config.secret, { ...options, issuer: 'other-issuer' }),
    jwt.sign({ sid: principal.sessionId }, config.secret, { ...options, algorithm: 'HS384' }),
    jwt.sign({ sid: principal.sessionId }, config.secret, { ...options, expiresIn: -1 }),
    valid.slice(0, valid.lastIndexOf('.') + 1) + 'not-the-signature',
  ]
  for (const token of invalid) assert.throws(() => service.verify(token), e => e instanceof AppError && e.key === 'UNAUTHENTICATED')
})
test('结构化错误日志不包含原始 SQL、密码或异常堆栈', () => {
  const original = console.error
  const captured: string[] = []
  console.error = value => captured.push(String(value))
  try {
    logError('test.failure', Object.assign(new Error('password=do-not-log SELECT secret'), { code: '23505', query: 'SELECT private', detail: 'private detail' }), 'request-test')
    const output = JSON.parse(captured[0])
    assert.equal(output.code, '23505'); assert.equal(output.requestId, 'request-test')
    assert.ok(!/do-not-log|SELECT|private|stack/.test(captured[0]))
  } finally { console.error = original }
})


test('日线整批校验拒绝隐式数值、坏日历、重复键和矛盾价格，错误不触及存储', async () => {
  let writes=0
  const service=new DailyBarsService({async upsert(){writes++}})
  const bar={stockCode:'000572',tradeDate:'2024-02-29',open:10,high:12,low:9,close:11,prevClose:10,volume:0,amount:0,source:'fixture'}
  for(const invalid of [null, {...bar,open:true},{...bar,volume:[]},{...bar,amount:' '},{...bar,prevClose:Infinity},
    {...bar,tradeDate:'2026-02-29'},{...bar,tradeDate:undefined},{...bar,tradeDate:'0000-01-01'},
    {...bar,high:10},{...bar,low:11},{...bar,source:{}},{...bar,source:'x'.repeat(51)},{...bar,volume:-1},{...bar,amount:1e100}]) {
    await assert.rejects(()=>service.ingest({records:[{...bar,stockCode:'600839'},invalid]}),e=>e instanceof AppError && e.key==='VALIDATION')
  }
  await assert.rejects(()=>service.ingest({records:[bar,bar]}))
  await assert.rejects(()=>service.ingest({records:[]}))
  await assert.rejects(()=>service.ingest({records:Array(1001).fill(bar)}))
  assert.equal(writes,0)
  assert.deepEqual(await service.ingest({records:[{...bar,open:'10.00',amount:'0',volume:'0'}]}),{accepted:1})
  assert.equal(writes,1)
})

test('日线真实迁移表：按键写入、重复导入不增行，第二行失败恢复先前更新，保留其他日期', async () => {
  const db=new PGlite();const order:string[]=[];let fail=false
  const client={async query(sql:string,values?:unknown[]){
    if(sql.startsWith('INSERT INTO daily_bars')) {
      order.push(String(values?.[1]))
      if(fail && values?.[1]==='2026-09-16') throw new Error('isolated second-row failure')
    }
    return values ? db.query(sql,values) : /^(SELECT|WITH)\b/.test(sql.trim()) ? db.query(sql) : db.exec(sql)
  },release(){}} as unknown as PoolClient
  const work=new PgUnitOfWork({connect:async()=>client} as unknown as Pool)
  const service=new DailyBarsService(new DailyBarsRepository(work))
  const bar={stockCode:'000572',tradeDate:'2026-09-15',open:10,high:12,low:9,close:11,prevClose:10,volume:10,amount:100,source:'fixture'}
  const snapshot=async()=>(await db.query('SELECT stock_code,trade_date,open,high,low,close,volume,amount,prev_close,source FROM daily_bars ORDER BY stock_code,trade_date')).rows
  try {
    for(const migration of ALL_MIGRATIONS) await migration.up(client)
    await service.ingest({records:[bar,{...bar,tradeDate:'2026-09-14'}]})
    assert.deepEqual(order,['2026-09-14','2026-09-15'])
    const before=await snapshot()
    await service.ingest({records:[bar]});assert.deepEqual(await snapshot(),before)
    fail=true
    await assert.rejects(()=>service.ingest({records:[{...bar,tradeDate:'2026-09-16'},{...bar,close:12}]}))
    assert.deepEqual(await snapshot(),before)
    fail=false
    await service.ingest({records:[{...bar,close:12}]})
    const after=await snapshot();assert.equal(after.length,2);assert.equal(after[0].close,11);assert.equal(after[1].close,12)
  } finally {await db.close()}
})
