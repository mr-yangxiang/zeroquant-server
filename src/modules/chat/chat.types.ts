import type { PortfolioService } from '../portfolio/portfolio.service.js'
export interface ChatSendInput { stockCode: string; message: string; requestId?: string }
export interface ChatMessage { id: number; role: string; content: string; createdAt: string }
export interface TradeReply extends ChatMessage { requestId: string; tradeRecorded: boolean }
export interface ChatReceipt { requestHash: string; response: TradeReply }
export interface ChatTradeRepository {
  lockRequest(userId: string, requestId: string): Promise<void>
  receipt(userId: string, requestId: string): Promise<ChatReceipt | null>
  stockName(stockCode: string): Promise<string | null>
  append(userId: string, stockCode: string, role: 'user' | 'assistant', content: string): Promise<ChatMessage>
  saveReceipt(userId: string, requestId: string, stockCode: string, requestHash: string, response: TradeReply): Promise<void>
}
export interface ChatTradeWork {
  run<T>(operation: (chat: ChatTradeRepository, portfolio: Pick<PortfolioService, 'record'>) => Promise<T>): Promise<T>
}

export interface ResearchReplyPort { generate(userId: string, stockCode: string, message: string): Promise<string> }
