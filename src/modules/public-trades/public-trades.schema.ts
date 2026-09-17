/** 公共逐笔成交批次 DTO；整批完成校验后才允许删除旧快照。 */
import { AppError } from '../../shared/errors.js'
import { marketDate } from '../market/market.service.js'
import { record, stockCode } from '../portfolio/portfolio.schema.js'
export interface PublicTrade {
  stockCode: string; tradeDate: string; timeStr: string; type: string
  price: number; volumeLots: number; note: string
}
function positive(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) throw new AppError('VALIDATION', '价格和成交量须为正数')
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new AppError('VALIDATION', '价格和成交量须为正数')
  return number
}
export function publicTradesSchema(input: unknown): PublicTrade[] {
  const body = record(input)
  if (!Array.isArray(body.records) || body.records.length > 1000) throw new AppError('VALIDATION', 'records 必须为最多 1000 条的数组')
  return body.records.map(value => {
    const row = record(value)
    if (typeof row.tradeDate !== 'string' || typeof row.timeStr !== 'string'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(row.timeStr)
      || typeof row.type !== 'string' || !row.type.trim() || row.type.length > 80
      || (row.note !== undefined && (typeof row.note !== 'string' || row.note.length > 8000))) {
      throw new AppError('VALIDATION', '逐笔成交日期、时间、方向或备注无效')
    }
    return { stockCode: stockCode(row.stockCode), tradeDate: marketDate(row.tradeDate), timeStr: row.timeStr,
      type: row.type.trim(), price: positive(row.price), volumeLots: positive(row.volumeLots), note: (row.note as string | undefined) ?? '' }
  })
}
