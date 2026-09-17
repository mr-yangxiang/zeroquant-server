/** 持仓组合根；提供同一 Service 给 HTTP 与旧聊天适配器，避免两套成交算法。 */
import type { Pool } from 'pg'
import { PgUnitOfWork } from '../../shared/transaction.js'
import { PgPortfolioRepository } from './portfolio.repository.js'
import { PortfolioService } from './portfolio.service.js'
import { portfolioRouter } from './portfolio.routes.js'
export function createPortfolioModule(pool: Pool) {
  const work = new PgUnitOfWork(pool)
  const service = new PortfolioService({ run: operation => work.run(db => operation(new PgPortfolioRepository(db))) })
  return { service, router: portfolioRouter(service) }
}
