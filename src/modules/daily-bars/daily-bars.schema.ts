/** 日线导入先整批验证；不把布尔值、空白、数组或坏日期转换成行情。 */
import { AppError } from '../../shared/errors.js'
import { record, stockCode, price } from '../portfolio/portfolio.schema.js'
import { marketDate } from '../market/market.service.js'
export interface DailyBar {
  stockCode: string; tradeDate: string; open: number; high: number; low: number; close: number
  prevClose: number; volume: number; amount: number; source: string
}
function nonNegative(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) throw new AppError('VALIDATION', '成交量和成交额须为非负数')
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) throw new AppError('VALIDATION', '成交量或成交额超出允许范围')
  return number
}
export function dailyBarsSchema(input: unknown): DailyBar[] {
  const body = record(input)
  if (!Array.isArray(body.records) || !body.records.length || body.records.length > 1000) throw new AppError('VALIDATION', 'records 须含 1～1000 条日线')
  const seen = new Set<string>()
  return body.records.map(value => {
    const row = record(value)
    const code = stockCode(row.stockCode)
    if (typeof row.tradeDate !== 'string' || row.tradeDate.startsWith('0000-')) throw new AppError('VALIDATION', '日线日期无效')
    const date = marketDate(row.tradeDate)
    const key = code + '|' + date
    if (seen.has(key)) throw new AppError('VALIDATION', '同批股票和日期不能重复')
    seen.add(key)
    if (typeof row.source !== 'string' || !row.source.trim() || row.source.length > 50) throw new AppError('VALIDATION', '来源须为 1～50 个字符')
    const open = price(row.open), high = price(row.high), low = price(row.low), close = price(row.close), prevClose = price(row.prevClose)
    if (high < Math.max(open,close,low) || low > Math.min(open,close,high)) throw new AppError('VALIDATION', '日线高低价与开收盘价矛盾')
    return { stockCode:code, tradeDate:date, open,high,low,close,prevClose,
      volume:nonNegative(row.volume), amount:nonNegative(row.amount), source:row.source.trim() }
  })
}
