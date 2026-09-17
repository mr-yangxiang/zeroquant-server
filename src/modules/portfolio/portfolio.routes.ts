/** 持仓路由；用户身份来自已校验会话，永不从 body 接收 userId。 */
import { Router } from 'express'
import { requireUser } from '../auth/auth.middleware.js'
import { asyncHandler } from '../../shared/http.js'
import { PortfolioController } from './portfolio.controller.js'
import type { PortfolioService } from './portfolio.service.js'
export function portfolioRouter(service: PortfolioService) {
  const router = Router()
  const controller = new PortfolioController(service)
  router.use(requireUser)
  router.post('/position', asyncHandler(controller.position))
  router.post('/trade-action', asyncHandler(controller.trade))
  router.delete('/trade-action/:id', asyncHandler(controller.undo))
  return router
}
