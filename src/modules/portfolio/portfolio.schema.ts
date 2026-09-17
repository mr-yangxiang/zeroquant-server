/** 持仓输入契约：拒绝空值、隐式布尔数值和超出 PostgreSQL INTEGER 的股数。 */
import { AppError } from '../../shared/errors.js'
export function stockCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) throw new AppError('VALIDATION', '股票代码须为 6 位数字')
  return value
}
export function quantity(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) throw new AppError('VALIDATION', '股数必须为整数')
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1) || n > 2147483647) throw new AppError('VALIDATION', '股数超出允许范围')
  return n
}
export function price(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) throw new AppError('VALIDATION', '价格格式错误')
  const n = Number(value)
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0) || n > 100000000) throw new AppError('VALIDATION', '价格超出允许范围')
  return n
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('VALIDATION')
  return value as Record<string, unknown>
}
