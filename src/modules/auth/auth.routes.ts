/** 认证路由只装配 HTTP 中间件，控制器不负责鉴权和流量控制。 */
import { Router } from 'express'
import type { AuthConfig } from '../../config/auth.config.js'
import type { AuthService } from './auth.service.js'
import { AuthController } from './auth.controller.js'
import { optionalAuthentication, requireUser } from './auth.middleware.js'
import { AuthRateLimiter } from './rate-limit.repository.js'
import { asyncHandler } from '../../shared/http.js'
import { AppError } from '../../shared/errors.js'
export function authRouter(service: AuthService, limiter: AuthRateLimiter, config: AuthConfig) {
  const router = Router()
  const controller = new AuthController(service, config)
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    // Cookie 刷新要求前端显式自定义头；跨站简单请求无法添加，Origin 再做精确匹配。
    if (req.method !== 'GET' && req.get('X-ZeroQuant-Client') !== 'web') return next(new AppError('FORBIDDEN'))
    const origin = req.get('Origin')
    if (origin && (config.publicOrigin ? origin !== config.publicOrigin : !/^http:\/\/localhost(?::\d+)?$/.test(origin))) return next(new AppError('FORBIDDEN'))
    next()
  })
  router.use(asyncHandler(async (req, _res, next) => {
    await limiter.consume('ip:' + (req.ip ?? 'unknown'), 120)
    next()
  }))
  // 挂在实际路由上，使用 Express 相同的匹配规则；大小写和尾斜杠变体不能绕过。
  const credentialLimit = asyncHandler(async (req, _res, next) => {
    await limiter.consume('auth-ip:' + (req.ip ?? 'unknown'), 20)
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim().normalize('NFKC').replace(/^\+86/, '') : ''
    if (/^1[3-9]\d{9}$/.test(phone)) await limiter.consume('phone:' + phone, 20)
    next()
  })
  router.post('/register', credentialLimit, asyncHandler(controller.register))
  router.post('/login', credentialLimit, asyncHandler(controller.login))
  router.post('/refresh', asyncHandler(controller.refresh))
  router.use(optionalAuthentication(service), requireUser)
  router.post('/logout', asyncHandler(controller.logout))
  router.get('/sessions', asyncHandler(controller.sessions))
  router.delete('/sessions/:id', asyncHandler(controller.revoke))
  return router
}
