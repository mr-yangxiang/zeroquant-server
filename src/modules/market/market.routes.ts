/** 行情路由只声明路径和控制器映射，保留既有前端接口契约。 */
import { Router } from 'express'
import { asyncHandler } from '../../shared/http.js'
import { MarketController } from './market.controller.js'
import type { MarketService } from './market.service.js'
export function marketRouter(service: MarketService) {
  const router = Router()
  const c = new MarketController(service)
  router.get('/', asyncHandler(c.stocks))
  router.get('/:code/history', asyncHandler(c.history))
  router.get('/:code/advanced-history', asyncHandler(c.advanced))
  router.get('/:code/ownership-profile', asyncHandler(c.ownership))
  return router
}
