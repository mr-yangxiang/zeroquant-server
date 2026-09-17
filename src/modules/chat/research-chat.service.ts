/** 先在事务外生成，后持请求锁原子提交；重复计算允许，重复持久化不允许。 */
import { createHash } from 'node:crypto'
import { AppError } from '../../shared/errors.js'
import { chatSendSchema } from './chat.schema.js'
import type { ChatTradeWork, ResearchReplyPort, TradeReply, ChatTradeRepository } from './chat.types.js'
export class ResearchChatService {
  constructor(private readonly work: ChatTradeWork, private readonly replies: ResearchReplyPort) {}
  async send(userId: string, value: unknown): Promise<TradeReply> {
    const input = chatSendSchema(value)
    if (!input.requestId) throw new AppError('VALIDATION', '发送消息需要请求编号，请更新页面后重试')
    const requestId = input.requestId
    const hash = createHash('sha256').update(JSON.stringify([input.stockCode,input.message])).digest('hex')
    const replay = async (chat: ChatTradeRepository) => {
      await chat.lockRequest(userId,requestId)
      const existing = await chat.receipt(userId,requestId)
      if (existing && existing.requestHash !== hash) throw new AppError('CONFLICT', '请求编号已用于其他消息，请勿更改重试内容')
      return existing?.response
    }
    const cached = await this.work.run(replay)
    if (cached) return cached
    const content = await this.replies.generate(userId,input.stockCode,input.message)
    if (typeof content !== 'string' || !content.trim() || content.length > 64000) throw new AppError('INTERNAL')
    return this.work.run(async chat => {
      const existing = await replay(chat)
      if (existing) return existing
      if (!await chat.stockName(input.stockCode)) throw new AppError('NOT_FOUND', '标的不存在')
      await chat.append(userId,input.stockCode,'user',input.message)
      const reply = await chat.append(userId,input.stockCode,'assistant',content)
      const response: TradeReply = { ...reply, requestId, tradeRecorded: false }
      await chat.saveReceipt(userId,requestId,input.stockCode,hash,response)
      return response
    })
  }
}
