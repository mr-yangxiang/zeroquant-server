/** JWT/随机令牌基础设施：载荷仅含用户 ID、会话 ID 与标准时间/用途声明。 */
import jwt from 'jsonwebtoken'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Principal, TokenPort } from './auth.types.js'
import type { AuthConfig } from '../../config/auth.config.js'
import { AppError } from '../../shared/errors.js'
export class TokenService implements TokenPort {
  constructor(private readonly config: AuthConfig) {}
  access(principal: Principal): string {
    return jwt.sign({ sid: principal.sessionId }, this.config.secret, { algorithm: 'HS256',
      subject: principal.userId, issuer: 'zeroquant', audience: 'zeroquant-web', jwtid: this.id(),
      expiresIn: this.config.accessSeconds })
  }
  verify(token: string): Principal {
    try {
      const payload = jwt.verify(token, this.config.secret, { algorithms: ['HS256'], issuer: 'zeroquant', audience: 'zeroquant-web' })
      if (typeof payload === 'string' || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 100
        || typeof payload.sid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.sid)
        || typeof payload.exp !== 'number') throw new Error('invalid claims')
      return { userId: payload.sub, sessionId: payload.sid }
    } catch { throw new AppError('UNAUTHENTICATED') }
  }
  refresh() { return randomBytes(48).toString('base64url') }
  digest(token: string) { return createHash('sha256').update(token).digest('hex') }
  id() { return randomUUID() }
}
