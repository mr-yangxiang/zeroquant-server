import { PgPredictionReader } from './modules/predictions/prediction-reader.repository.js'
import { PredictionQueryService } from './modules/predictions/prediction-query.service.js'
import { PredictionQueryController } from './modules/predictions/prediction-query.controller.js'
import { PredictionController } from './modules/predictions/prediction.controller.js'
import { PredictionService } from './modules/predictions/prediction.service.js'
import { PredictionRepository } from './modules/predictions/prediction.repository.js'
import { EvidenceController } from './modules/profile-evidence/evidence.controller.js'
import { EvidenceService } from './modules/profile-evidence/evidence.service.js'
import { EvidenceRepository } from './modules/profile-evidence/evidence.repository.js'
import { DailyBarsController } from './modules/daily-bars/daily-bars.controller.js'
import { DailyBarsService } from './modules/daily-bars/daily-bars.service.js'
import { DailyBarsRepository } from './modules/daily-bars/daily-bars.repository.js'
import { PgUnitOfWork } from './shared/transaction.js'
import { PublicTradesRepository } from './modules/public-trades/public-trades.repository.js'
import { PublicTradesService } from './modules/public-trades/public-trades.service.js'
import { PublicTradesController } from './modules/public-trades/public-trades.controller.js'
import { asyncHandler } from './shared/http.js'
import { logError } from './shared/logger.js'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import { pool } from './db.js'
import { getStockEntityProfiles, refreshEntityProfiles } from './profiles/entity-profile-engine.js'
import { forecastSignalEligible, localizeModelState, productionApproved, SIGNAL_MAX_AGE_MS } from './research-production.js'

export function quantInternalOnly(req: Request, res: Response, next: NextFunction) {
  const configuredToken = process.env.ZEROQUANT_INTERNAL_TOKEN
  if (configuredToken) {
    const supplied = createHash('sha256').update(req.header('X-ZeroQuant-Internal-Token') ?? '').digest()
    const expected = createHash('sha256').update(configuredToken).digest()
    if (!timingSafeEqual(supplied, expected)) {
      return res.status(401).json({ code: 401, message: 'invalid internal token', data: null })
    }
    return next()
  }
  const address = req.socket.remoteAddress || ''
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) {
    return res.status(403).json({
      code: 403,
      message: 'ZEROQUANT_INTERNAL_TOKEN is required for non-loopback ingestion',
      data: null,
    })
  }
  return next()
}

export function createQuantRouter() {
  const router = Router()

  router.get('/stocks/:code/entity-profiles', asyncHandler(async (req, res) => {
    const stockCode = String(req.params.code || '')
    const rawAsOf = typeof req.query.asOf === 'string' ? req.query.asOf : new Date().toISOString()
    const asOf = new Date(/^\d{4}-\d{2}-\d{2}$/.test(rawAsOf) ? `${rawAsOf}T23:59:59+08:00` : rawAsOf)
    if (!/^\d{6}$/.test(stockCode) || Number.isNaN(asOf.getTime())) {
      return res.status(400).json({ code: 400, message: 'invalid stock code or as-of date', data: null })
    }
    try {
      const data = await getStockEntityProfiles(stockCode, asOf)
      return res.json({ code: 0, message: 'ok', data })
    } catch (error) {
      logError('Fetch entity profiles error:', error)
      return res.status(500).json({ code: 500, message: 'entity profile query failed', data: null })
    }
  }))

  router.post('/entity-profiles/refresh', quantInternalOnly, asyncHandler(async (req, res) => {
    const raw = String(req.body?.asOf || '')
    const asOf = raw ? new Date(raw) : new Date()
    if (Number.isNaN(asOf.getTime())) {
      return res.status(400).json({ code: 400, message: 'invalid as-of timestamp', data: null })
    }
    try {
      const data = await refreshEntityProfiles(asOf)
      return res.json({ code: 0, message: 'entity profiles refreshed', data })
    } catch (error) {
      logError('Refresh entity profiles error:', error)
      return res.status(500).json({ code: 500, message: 'entity profile refresh failed', data: null })
    }
  }))

  const evidence=new EvidenceController(new EvidenceService(new EvidenceRepository(new PgUnitOfWork(pool))))
  router.post('/profile-evidence/dragon-tiger/batch',quantInternalOnly,asyncHandler(evidence.dragonTiger))
  router.post('/profile-evidence/news/batch',quantInternalOnly,asyncHandler(evidence.news))

  router.post('/profile-evidence/daily-bars/batch', quantInternalOnly, asyncHandler(
    new DailyBarsController(new DailyBarsService(new DailyBarsRepository(new PgUnitOfWork(pool)))).ingest))

  const predictions=new PredictionController(new PredictionService(new PredictionRepository(new PgUnitOfWork(pool)),
    async input=>forecastSignalEligible(input) && await productionApproved(input.modelVersion,input.asOf)))
  router.post('/prediction-runs',quantInternalOnly,asyncHandler(predictions.ingest))

  const predictionQuery=new PredictionQueryController(new PredictionQueryService(new PgPredictionReader(new PgUnitOfWork(pool)),async run=>{
    const approved=forecastSignalEligible(run) && await productionApproved(run.modelVersion,run.asOf) && forecastSignalEligible(run)
    const localized=localizeModelState(run.modelState,approved)
    return {productionApproved:approved,
      signalExpiresAt:approved?new Date(Math.min(new Date(run.asOf).getTime(),new Date(run.features!.observedAt!).getTime())+SIGNAL_MAX_AGE_MS).toISOString():null,
      modelStateLabel:localized.label,modelStateExplanation:localized.explanation}
  }))
  router.get('/stocks/:code/latest-forecast',asyncHandler(predictionQuery.latest))

  const publicTrades = new PublicTradesController(new PublicTradesService(new PublicTradesRepository(new PgUnitOfWork(pool))))
  router.post('/public-trades/batch', quantInternalOnly, asyncHandler(publicTrades.replace))

  return router
}
