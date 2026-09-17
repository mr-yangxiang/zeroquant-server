/** 成交聊天工作单元：消息、持仓、成交与回执同生共死。事务内不调用 LLM 或外部数据源。 */
import { createHash } from 'node:crypto'
import { AppError } from '../../shared/errors.js'
import { parseTradingIntent } from '../../voice-cleaner.js'
import type { ChatTradeWork, TradeReply } from './chat.types.js'
import { chatSendSchema } from './chat.schema.js'
export class ChatTradeService {
  constructor(private readonly work: ChatTradeWork) {}
  async send(userId: string, value: unknown): Promise<TradeReply | null> {
    const input = chatSendSchema(value)
    const intent = parseTradingIntent(input.message)
    if (!input.requestId) {
      if (intent.isTradeAction) throw new AppError('VALIDATION', '记录成交需要请求编号，请更新页面后重试')
      return null // 交给普通问答服务；它同样要求请求编号。
    }
    const requestId = input.requestId
    const hash = createHash('sha256').update(JSON.stringify([input.stockCode,input.message])).digest('hex')
    return this.work.run(async (chat, portfolio) => {
      await chat.lockRequest(userId, requestId)
      const existing = await chat.receipt(userId, requestId)
      if (existing) {
        if (existing.requestHash !== hash) throw new AppError('CONFLICT', '请求编号已用于其他消息，请勿更改重试内容')
        return existing.response // 不重新计算价格、不重新成交；即使之后撤销过该笔成交也只回放。
      }
      if (!intent.isTradeAction || !intent.actionType || intent.price === null || intent.shares === null) return null
      const name = await chat.stockName(input.stockCode)
      if (!name) throw new AppError('NOT_FOUND', '标的不存在')
      await chat.append(userId,input.stockCode,'user',input.message)
      const result = await portfolio.record(userId,input.stockCode,intent.actionType,intent.price,intent.shares)
      const label = intent.actionType === 'BUY' ? '买入' : intent.actionType === 'SELL' ? '卖出' : '设置持仓'
      const content = `### 用户陈述的${label}已记录——${name} (${input.stockCode})\n\n`
        + `- 本次记录：${intent.shares} 股，价格/成本 ¥${intent.price.toFixed(4)}。\n`
        + `- 记录持仓：${result.previousShares} → ${result.nextShares} 股；成本：¥${result.previousCost.toFixed(4)} → ¥${result.nextCost.toFixed(4)}。\n\n`
        + '系统没有向券商下单；该回执只确认本次记录，不构成当前行情、交易信号或收益承诺。'
      const message = await chat.append(userId,input.stockCode,'assistant',content)
      const response: TradeReply = { ...message, requestId, tradeRecorded: true }
      await chat.saveReceipt(userId,requestId,input.stockCode,hash,response)
      return response
    })
  }
}
