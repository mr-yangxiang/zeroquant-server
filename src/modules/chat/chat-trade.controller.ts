import type { Request, Response, NextFunction } from 'express'
import type { ChatTradeService } from './chat-trade.service.js'
export class ChatTradeController {
  constructor(private readonly service: ChatTradeService) {}
  send = async (req: Request, res: Response, next: NextFunction) => {
    const response = await this.service.send(req.principal!.userId, req.body as unknown)
    if (!response) return next() // 普通研究问答交给后续幂等服务，无成交写入能力。
    res.setHeader('Cache-Control', 'no-store')
    res.json({ code: 0, message: response.tradeRecorded ? '成交记录已确认' : '消息已确认', data: response })
  }
}
