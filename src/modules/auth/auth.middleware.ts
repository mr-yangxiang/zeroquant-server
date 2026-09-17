/** HTTP 认证适配：只从已验证会话读取 userId，禁止旧 token 的 phone 回退身份。 */
import type { Request, RequestHandler } from 'express'
import { asyncHandler } from '../../shared/http.js'
import { AppError } from '../../shared/errors.js'
import type { AuthService } from './auth.service.js'
import type { Principal } from './auth.types.js'
declare global { namespace Express { interface Request { principal?: Principal } } }
export function optionalAuthentication(service: AuthService): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const header = req.headers.authorization
    if (header) {
      if (!header.startsWith('Bearer ') || header.length > 4096) throw new AppError('UNAUTHENTICATED')
      req.principal = await service.authenticate(header.slice(7))
    }
    next()
  })
}
export const requireUser: RequestHandler = (req, _res, next) =>
  req.principal ? next() : next(new AppError('UNAUTHENTICATED'))
export function getUserFromReq(req: Request): string | null { return req.principal?.userId ?? null }
