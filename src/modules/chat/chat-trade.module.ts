/** 组合根复用同一事务客户端，不在持仓服务内开启嵌套或独立事务。 */
import type { Pool } from 'pg'
import { PgUnitOfWork } from '../../shared/transaction.js'
import type { UnitOfWork } from '../../shared/transaction.js'
import { PgPortfolioRepository } from '../portfolio/portfolio.repository.js'
import { PortfolioService } from '../portfolio/portfolio.service.js'
import { PgChatTradeRepository } from './chat-trade.repository.js'
import { ChatTradeService } from './chat-trade.service.js'
import { chatTradeRouter } from './chat-trade.routes.js'
export function chatWork(work: UnitOfWork): ChatTradeWork {
  return { run: operation => work.run(db => operation(new PgChatTradeRepository(db),
    new PortfolioService({ run: change => change(new PgPortfolioRepository(db)) }))) }
}
export function createChatTradeService(work: UnitOfWork) { return new ChatTradeService(chatWork(work)) }
export function createChatTradeModule(pool: Pool) {
  const service = createChatTradeService(new PgUnitOfWork(pool))
  return { service, router: chatTradeRouter(service, new ResearchChatService(chatWork(new PgUnitOfWork(pool)), { generate: generateResearchReply }),
    new ChatHistoryService(new ChatHistoryRepository(pool))) }
}

import type { ChatTradeWork } from './chat.types.js'
import { ResearchChatService } from './research-chat.service.js'
import { generateResearchReply } from './research-reply.adapter.js'
import { ChatHistoryService } from './chat-history.service.js'
import { ChatHistoryRepository } from './chat-history.repository.js'
