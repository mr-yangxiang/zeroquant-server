import { AppError } from '../../shared/errors.js'
import { record, stockCode } from '../portfolio/portfolio.schema.js'
import type { ChatSendInput } from './chat.types.js'
export function chatSendSchema(value: unknown): ChatSendInput {
  const body = record(value)
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 8000) throw new AppError('VALIDATION', '消息须为 1～8000 个字符')
  if (body.requestId !== undefined && (typeof body.requestId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId))) {
    throw new AppError('VALIDATION', '请求编号须为 UUID v4')
  }
  return { stockCode: stockCode(body.stockCode), message: body.message.trim(), requestId: (body.requestId as string | undefined)?.toLowerCase() }
}
