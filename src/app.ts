import { createChatTradeModule } from './modules/chat/chat-trade.module.js'
/** HTTP 应用组合根：不监听端口、不执行迁移、不启动调度器。 */
import express from 'express'
import cors from 'cors'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { pool } from './db.js'
import { loadAuthConfig, type AuthConfig } from './config/auth.config.js'
import { requestContext, errorHandler } from './shared/http.js'
import { createAuthModule } from './modules/auth/auth.module.js'
import { optionalAuthentication } from './modules/auth/auth.middleware.js'
import { createPortfolioModule } from './modules/portfolio/portfolio.module.js'
import { createQuantRouter, quantInternalOnly } from './quant-routes.js'
import { getQuantSchedulerMetrics } from './scheduler/quant-scheduler.js'
import { MarketRepository } from './modules/market/market.repository.js'
import { MarketService } from './modules/market/market.service.js'
import { marketRouter } from './modules/market/market.routes.js'
import { fetchOwnershipProfile } from './ownership.js'
import { registerLegacyRoutes } from './legacy-routes.js'
dayjs.extend(utc)
dayjs.extend(timezone)

export function createApp(config: AuthConfig = loadAuthConfig()) {
  const app = express()
  app.disable('x-powered-by')
  // 默认不信任代理头；部署应填写明确的代理 IP/CIDR，禁止直接设 true。
  if (process.env.ZEROQUANT_TRUST_PROXY) app.set('trust proxy', process.env.ZEROQUANT_TRUST_PROXY.split(',').map(s => s.trim()))
  app.use(requestContext)
  app.use(cors({ origin: config.publicOrigin ?? false, credentials: true, exposedHeaders: ['X-Request-Id'] }))
  app.use(express.json({ limit: '100kb' }))
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'ZeroQuant Express Server', timestamp: new Date().toISOString() }))
  const auth = createAuthModule(pool, config)
  const portfolio = createPortfolioModule(pool)
  app.use('/api/v1/auth', auth.router)
  app.get('/api/v1/system/quant-status', quantInternalOnly, (_req, res) => res.json({ code: 0, message: 'success', data: getQuantSchedulerMetrics() }))
  app.use('/api/v1/quant', createQuantRouter())
  app.use('/api/v1', optionalAuthentication(auth.service))
  app.use('/api/v1/user', portfolio.router)
  app.use('/api/v1/stocks', marketRouter(new MarketService(new MarketRepository(pool), fetchOwnershipProfile)))
  app.use('/api/v1/chat', createChatTradeModule(pool).router)
  registerLegacyRoutes(app)
  app.use(errorHandler)
  return app
}
