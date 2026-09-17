import { AppError } from '../../shared/errors.js'
import { stockCode, record } from '../portfolio/portfolio.schema.js'
import type { ChatHistoryRepository } from './chat-history.repository.js'
function integer(value: unknown, max: number): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max) throw new AppError('VALIDATION')
  return Number(value)
}
export class ChatHistoryService {
  constructor(private readonly repository: Pick<ChatHistoryRepository,'page'|'clear'>) {}
  async page(userId: string, query: unknown) {
    const input = record(query), code = stockCode(input.stockCode)
    const limit = input.limit === undefined ? 50 : integer(input.limit,100)
    const before = input.before === undefined ? undefined : integer(input.before,Number.MAX_SAFE_INTEGER)
    const rows = await this.repository.page(userId,code,before,limit)
    const hasMore = rows.length > limit
    const messages = rows.slice(0,limit).reverse()
    return { messages, nextCursor: hasMore ? String(messages[0]!.id) : null }
  }
  async clear(userId: string, query: unknown) {
    await this.repository.clear(userId,stockCode(record(query).stockCode))
  }
}
