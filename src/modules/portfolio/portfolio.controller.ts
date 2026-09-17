/** 持仓 HTTP 适配器；所有事务和成本计算交给 Service。 */
import type { Request, Response } from 'express'
import type { PortfolioService } from './portfolio.service.js'
import { record, stockCode, quantity, price } from './portfolio.schema.js'
import { AppError } from '../../shared/errors.js'
export class PortfolioController {
  constructor(private readonly service: PortfolioService) {}
  position = async (req: Request, res: Response) => {
    const body = record(req.body as unknown)
    await this.service.record(req.principal!.userId, stockCode(body.stockCode), 'SET_POSITION', price(body.costPrice, true), quantity(body.holdingShares, true))
    res.json({ code: 0, message: '个人持仓保存成功', data: null })
  }
  trade = async (req: Request, res: Response) => {
    const body = record(req.body as unknown)
    const action = typeof body.actionType === 'string' ? body.actionType.toUpperCase() : ''
    if (action !== 'BUY' && action !== 'SELL') throw new AppError('VALIDATION', '成交方向无效')
    const result = await this.service.record(req.principal!.userId, stockCode(body.stockCode), action, price(body.tradePrice), quantity(body.tradeShares))
    const t = result.trade!
    res.json({ code: 0, message: '用户陈述的成交记录已保存（未向券商下单）',
      data: { id: t.id, actionType: t.actionType, tradePrice: t.tradePrice, tradeShares: t.tradeShares, tradeTime: t.tradeTime,
        position: { previousShares: result.previousShares, previousCost: result.previousCost, nextShares: result.nextShares, nextCost: result.nextCost } } })
  }
  undo = async (req: Request, res: Response) => {
    const result = await this.service.undo(req.principal!.userId, quantity(req.params.id))
    res.json({ code: 0, message: '最新成交记录已撤销，持仓和成本已恢复', data: result })
  }
}
