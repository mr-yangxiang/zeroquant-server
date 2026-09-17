/** 行情 HTTP 适配器；校验查询 DTO 后委托服务，禁止直接访问数据库。 */
import type { Request, Response } from 'express'
import { MarketService, marketDate } from './market.service.js'
import { stockCode } from '../portfolio/portfolio.schema.js'
import { AppError } from '../../shared/errors.js'
export class MarketController {
  constructor(private readonly service: MarketService) {}
  stocks = async (_req: Request, res: Response) => res.json({code:0,message:'ok',data:await this.service.stocks()})
  history = async (req: Request, res: Response) => {
    const limit = req.query.limit === undefined ? 100 : typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new AppError('VALIDATION', '查询条数须为 1～1000')
    res.json({code:0,message:'ok',data:await this.service.history(stockCode(req.params.code),limit)})
  }
  advanced = async (req: Request, res: Response) => {
    const date = marketDate(req.query.date ?? req.query.startDate)
    if (req.query.endDate !== undefined && marketDate(req.query.endDate) !== date) throw new AppError('VALIDATION', '分时复盘每次只查询一天')
    res.json({code:0,message:'ok',data:await this.service.advanced(stockCode(req.params.code),date,req.principal?.userId ?? null)})
  }
  ownership = async (req: Request, res: Response) => res.json({code:0,message:'ok',data:
    await this.service.ownershipProfile(stockCode(req.params.code),marketDate(req.query.asOf))})
}
