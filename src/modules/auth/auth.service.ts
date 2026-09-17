/** 认证业务：注册自动登录、刷新重放检测、会话撤销；与 HTTP/SQL/密码算法解耦。 */
import { timingSafeEqual } from 'node:crypto'
import { AppError } from '../../shared/errors.js'
import type { AuthConfig } from '../../config/auth.config.js'
import type { AuthWork, AuthRepository, PasswordPort, TokenPort, Principal, User } from './auth.types.js'
import type { RegisterInput, LoginInput } from './register.schema.js'
export class AuthService {
  constructor(private readonly work: AuthWork, private readonly passwords: PasswordPort,
    private readonly tokens: TokenPort, private readonly config: AuthConfig) {}
  private async issue(repo: AuthRepository, user: User) {
    const sessionId = this.tokens.id()
    const refreshToken = this.tokens.refresh()
    const expiresAt = new Date(Date.now() + this.config.refreshSeconds * 1000)
    await repo.createSession(sessionId, user.id, expiresAt)
    await repo.insertRefresh(this.tokens.digest(refreshToken), sessionId)
    return this.response(user, sessionId, refreshToken, expiresAt)
  }
  private response(user: User, sessionId: string, refreshToken: string, expiresAt: Date) {
    // 显式 DTO 映射，不能因仓储新增字段而泄漏密码、内部状态等。
    return { token: this.tokens.access({ userId: user.id, sessionId }), refreshToken, expiresAt,
      expiresIn: this.config.accessSeconds,
      user: { id: String(user.id), phone: user.phone, username: user.username, avatar: user.avatar } }
  }
  async register(input: RegisterInput) {
    if (!this.config.registrationEnabled) throw new AppError('REGISTRATION_DISABLED')
    if (this.config.invitationCode) {
      const given = this.tokens.digest(input.invitationCode ?? '')
      const expected = this.tokens.digest(this.config.invitationCode)
      if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new AppError('FORBIDDEN')
    }
    const hash = await this.passwords.hash(input.password)
    // 创建用户、会话及刷新凭据同一事务；任何后续步骤失败都会回滚。
    return this.work.run(async repo => this.issue(repo, await repo.createUser(input.phone, input.username, hash)))
  }
  async login(input: LoginInput) {
    const user = await this.work.run(repo => repo.findUser(input.phone))
    if (!await this.passwords.verify(input.password, user?.password) || !user) throw new AppError('INVALID_CREDENTIALS')
    return this.work.run(repo => this.issue(repo, user))
  }
  async refresh(raw: string) {
    if (!/^[A-Za-z0-9_-]{64}$/.test(raw)) throw new AppError('UNAUTHENTICATED')
    const hash = this.tokens.digest(raw)
    const result = await this.work.run(async repo => {
      const initial = await repo.findRefresh(hash)
      if (!initial) return null
      const session = await repo.getSession(initial.sessionId, true)
      if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) return null
      // 锁定整个会话后重新读取令牌状态；防止并发请求均将同一令牌视为未使用。
      const token = await repo.findRefresh(hash)
      if (!token || token.usedAt) {
        await repo.revokeSession(session.id, session.userId)
        return null // 先提交撤销，再在事务外抛异常，不能随错误回滚撤销。
      }
      const user = await repo.getUser(session.userId)
      if (!user) { await repo.revokeSession(session.id, session.userId); return null }
      await repo.consumeRefresh(hash)
      const next = this.tokens.refresh()
      await repo.insertRefresh(this.tokens.digest(next), session.id)
      return this.response(user, session.id, next, new Date(session.expiresAt))
    })
    if (!result) throw new AppError('UNAUTHENTICATED')
    return result
  }
  async authenticate(raw: string): Promise<Principal> {
    const principal = this.tokens.verify(raw)
    const session = await this.work.run(repo => repo.getSession(principal.sessionId))
    if (!session || session.userId !== principal.userId || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new AppError('UNAUTHENTICATED')
    }
    return principal
  }
  async logout(principal: Principal, sessionId = principal.sessionId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) throw new AppError('VALIDATION')
    await this.work.run(repo => repo.revokeSession(sessionId, principal.userId))
  }
  async sessions(principal: Principal) {
    return this.work.run(async repo => (await repo.listSessions(principal.userId)).map(s => ({
      id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt, current: s.id === principal.sessionId,
    })))
  }
}
