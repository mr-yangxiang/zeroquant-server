/** HTTP 公共边界：关联 ID、Express 4 异步异常转发和脱敏错误响应。 */
import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express'
import { AppError, errors } from './errors.js'
import { logError } from './logger.js'
export const requestContext: RequestHandler = (_req, res, next) => {
  // 始终由服务端生成，避免用户伪造或注入日志关联字段。
  res.locals.requestId = randomUUID()
  res.setHeader('X-Request-Id', res.locals.requestId)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  next()
}
export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => { Promise.resolve().then(() => handler(req, res, next)).catch(next) }
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) return next(error)
  const parserType = typeof error === 'object' && error !== null && 'type' in error ? error.type : null
  const known = error instanceof AppError ? error
    : parserType === 'entity.parse.failed' ? new AppError('VALIDATION', 'JSON 格式无效')
    : parserType === 'entity.too.large' ? new AppError('VALIDATION', '请求体超过允许大小') : new AppError('INTERNAL')
  const [status, code] = errors[known.key]
  if (status >= 500) logError('http.request.failed', error, res.locals.requestId)
  if (status === 429) res.setHeader('Retry-After', '60')
  res.status(parserType === 'entity.too.large' ? 413 : status).json({
    code, message: known.message, data: null, requestId: res.locals.requestId,
  })
}
