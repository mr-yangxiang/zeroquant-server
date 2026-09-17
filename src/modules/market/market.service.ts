/** 行情业务：对外字段映射和预测偏差计算；统计偏差不是胜率或可交易性证明。 */
import { AppError } from '../../shared/errors.js'
import type { MarketReader } from './market.repository.js'
export class MarketService {
  constructor(private readonly repository: MarketReader,
    private readonly ownership: (code: string, asOf: string) => Promise<unknown>) {}
  async stocks() {
    return (await this.repository.stocks()).map(stock => ({
      code: stock.code, full_code: stock.full_code, name: stock.name, current_price: stock.current_price,
      yesterday_price: stock.yesterday_price, high_price: stock.high_price, low_price: stock.low_price,
      pct: stock.pct, predicted_high: stock.predicted_high, predicted_low: stock.predicted_low,
      is_hot: stock.is_hot, updated_at: stock.updated_at, analyses: [],
      currentPrice: stock.current_price, yesterdayPrice: stock.yesterday_price,
      highPrice: stock.high_price, lowPrice: stock.low_price,
      predictedHigh: stock.predicted_high, predictedLow: stock.predicted_low, winRate: null,
    }))
  }
  history(code: string, limit: number) { return this.repository.history(code, limit) }
  async ownershipProfile(code: string, asOf: string) {
    return this.ownership(code, asOf)
  }
  async advanced(code: string, targetDate: string, userId: string | null) {
    const { realHistories,predictions,rollingPredictions,rollingArchiveRows,l2Orders,positionRows,tradeRows } =
      await this.repository.snapshot(code,targetDate,userId)
    const actuals = new Map(realHistories.map(row => [String(row.timestamp).slice(11,16), Number(row.realPrice)]))
    const deviations = rollingPredictions.flatMap(row => {
      const actual = actuals.get(row.targetTime)
      const predicted = Number(row.predictedPrice)
      return actual !== undefined && Number.isFinite(actual) && actual > 0 && Number.isFinite(predicted)
        ? [Math.abs(predicted-actual)/actual*100] : []
    })
    return { stockCode: code,date: targetDate,realHistories,predictions,rollingPredictions,l2Orders,
      rollingEvaluation: { snapshotCount: Number(rollingArchiveRows[0]?.snapshotCount ?? 0),
        storedPointCount: Number(rollingArchiveRows[0]?.storedPointCount ?? 0), comparablePointCount: deviations.length,
        meanAbsoluteDeviationPct: deviations.length ? Number((deviations.reduce((sum,x) => sum+x,0)/deviations.length).toFixed(4)) : null,
        evaluationLeadMinutes: 5 },
      backtestStats: [],dailyReview: null,position: positionRows[0] ?? { holdingShares: 0,costPrice: 0,tShares: 0 },userTrades: tradeRows }
  }
}
/** 日期必须是真实存在的日历日期；缺省按北京时间，不接受数组或隐式对象转换。 */
export function marketDate(value: unknown): string {
  if (value === undefined) return new Date(Date.now()+8*3600000).toISOString().slice(0,10)
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError('VALIDATION', '日期格式须为 YYYY-MM-DD')
  const date = new Date(value+'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new AppError('VALIDATION', '日历日期不存在')
  return value
}
