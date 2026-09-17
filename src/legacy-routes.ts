import { PgUnitOfWork } from './shared/transaction.js'
import { MarketSyncController } from './modules/market-sync/market-sync.controller.js'
import { MarketSyncService } from './modules/market-sync/market-sync.service.js'
import { MarketSyncRepository } from './modules/market-sync/market-sync.repository.js'
/** 待逐域迁出的行情兼容适配器。
 * 行情写入已迁出，本文件保留兼容路由，不能宣称全站分层完成；认证与持仓写入已迁出且不得重新混入。
 */
import type express from 'express'
import { pool } from './db.js'
import { quantInternalOnly } from './quant-routes.js'
import { asyncHandler } from './shared/http.js'

export function registerLegacyRoutes(app: express.Express) {
app.post('/api/v1/stocks/sync-point',quantInternalOnly,asyncHandler(
  new MarketSyncController(new MarketSyncService(new MarketSyncRepository(new PgUnitOfWork(pool)))).ingest))

// 旧接口曾允许前端提交随机正弦曲线。保留明确的退役响应，防止旧客户端静默写入伪预测。
app.post('/api/v1/stocks/re-predict', (_req, res) => {
  return res.status(410).json({
    code: 410,
    message: '任意曲线重模拟接口已退役；请使用版本化概率模型生成新的预测运行',
    data: null,
  })
})


}
