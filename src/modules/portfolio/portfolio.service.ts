/** 持仓业务：计算成本、拒绝超卖、验证撤销前置状态；HTTP 与聊天录入共用此服务。 */
import { AppError } from '../../shared/errors.js'
import { stockCode as validateCode, quantity, price as validatePrice } from './portfolio.schema.js'
import type { PortfolioWork, Position, Trade } from './portfolio.types.js'
export class InsufficientRecordedPositionError extends AppError {
  constructor(public readonly availableShares: number) {
    super('VALIDATION', '卖出数量超过当前持仓，当前可用 ' + availableShares + ' 股')
  }
}
export class PortfolioService {
  constructor(private readonly work: PortfolioWork) {}
  async record(userId: string, code: string, action: 'BUY' | 'SELL' | 'SET_POSITION', price: number, shares: number) {
    validateCode(code); quantity(shares, action === 'SET_POSITION'); validatePrice(price, action === 'SET_POSITION')
    if (!['BUY','SELL','SET_POSITION'].includes(action)) throw new AppError('VALIDATION')
    return this.work.run(async repo => {
      await repo.lockStock(userId, code)
      const before = await repo.position(userId, code)
      if (!Number.isSafeInteger(before.holdingShares) || before.holdingShares < 0 || !Number.isFinite(before.costPrice) || before.costPrice < 0) throw new AppError('CONFLICT', '原持仓异常，请核实后更正')
      let after: Position = { holdingShares: shares, costPrice: price }
      if (action === 'BUY') {
        const total = quantity(before.holdingShares + shares)
        after = { holdingShares: total, costPrice: Number(((before.holdingShares * before.costPrice + shares * price) / total).toFixed(4)) }
      } else if (action === 'SELL') {
        if (shares > before.holdingShares) throw new InsufficientRecordedPositionError(before.holdingShares)
        after = { holdingShares: before.holdingShares - shares, costPrice: before.costPrice }
      }
      let trade: Trade | undefined
      if (action !== 'SET_POSITION') trade = await repo.insert(userId, code, action, price, shares, before, after)
      await repo.save(userId, code, after)
      // 精确返回本事务 INSERT 的记录，不能在提交后 SELECT 最新一条。
      return { previousShares: before.holdingShares, previousCost: before.costPrice,
        nextShares: after.holdingShares, nextCost: after.costPrice, trade }
    })
  }
  async undo(userId: string, id: number) {
    quantity(id)
    return this.work.run(async repo => {
      const initial = await repo.findTrade(userId, id)
      if (!initial) throw new AppError('NOT_FOUND')
      await repo.lockStock(userId, initial.stockCode)
      const trade = await repo.findTrade(userId, id, true)
      if (!trade) throw new AppError('NOT_FOUND')
      if (await repo.latestId(userId, trade.stockCode) !== id) throw new AppError('CONFLICT', '只能撤销该股票最新一笔成交')
      const current = await repo.position(userId, trade.stockCode)
      if (trade.previousShares === null || trade.previousCost === null || trade.resultingShares === null || trade.resultingCost === null
        || current.holdingShares !== trade.resultingShares || Math.abs(current.costPrice - trade.resultingCost) > 0.00005) {
        throw new AppError('CONFLICT', '持仓已被更正或成交缺少快照，不能自动撤销')
      }
      const before = { holdingShares: quantity(trade.previousShares, true), costPrice: validatePrice(trade.previousCost, true) }
      await repo.remove(userId, id)
      await repo.save(userId, trade.stockCode, before)
      return before
    })
  }
}
