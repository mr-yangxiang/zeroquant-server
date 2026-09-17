/** 认证组合根：基础设施依赖集中装配，方便替换仓储、密码服务或令牌实现。 */
import type { Pool } from 'pg'
import type { AuthConfig } from '../../config/auth.config.js'
import { PgUnitOfWork } from '../../shared/transaction.js'
import { AuthService } from './auth.service.js'
import { UserRepository } from './user.repository.js'
import { PasswordService } from './password.service.js'
import { TokenService } from './token.service.js'
import { AuthRateLimiter } from './rate-limit.repository.js'
import { authRouter } from './auth.routes.js'
export function createAuthModule(pool: Pool, config: AuthConfig) {
  const transaction = new PgUnitOfWork(pool)
  const service = new AuthService({ run: operation => transaction.run(db => operation(new UserRepository(db))) },
    new PasswordService(config.bcryptRounds), new TokenService(config), config)
  return { service, router: authRouter(service, new AuthRateLimiter(pool, config.secret), config) }
}
