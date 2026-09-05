import { Router, type Request, type Response, type NextFunction } from 'express'
import { pool } from './db.js'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function quantInternalOnly(req: Request, res: Response, next: NextFunction) {
  const configuredToken = process.env.ZEROQUANT_INTERNAL_TOKEN
  if (configuredToken) {
    if (req.header('X-ZeroQuant-Internal-Token') !== configuredToken) {
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

function validateProbability(value: unknown): number | null {
  const parsed = finiteNumber(value)
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null
}

export function createQuantRouter() {
  const router = Router()

  router.post('/prediction-runs', quantInternalOnly, async (req, res) => {
    const body = req.body as UnknownRecord
    const runId = String(body.runId || '')
    const stockCode = String(body.stockCode || '')
    const tradeDate = String(body.tradeDate || '')
    const asOf = String(body.asOf || '')
    const mode = String(body.mode || '')
    const horizons = Array.isArray(body.horizons) ? body.horizons : []
    const referencePrice = finiteNumber(body.referencePrice)
    const previousClose = finiteNumber(body.previousClose)
    if (!/^[0-9a-f-]{36}$/i.test(runId) || !/^\d{6}$/.test(stockCode) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      return res.status(400).json({ code: 400, message: 'invalid run identity', data: null })
    }
    if (!['daily', 'realtime'].includes(mode) || Number.isNaN(Date.parse(asOf)) || horizons.length === 0 || referencePrice === null || referencePrice <= 0 || previousClose === null || previousClose <= 0) {
      return res.status(400).json({ code: 400, message: 'invalid forecast payload', data: null })
    }

    const parsedHorizons: UnknownRecord[] = []
    for (const item of horizons) {
      if (!isRecord(item)) return res.status(400).json({ code: 400, message: 'invalid horizon', data: null })
      const horizonMinutes = finiteNumber(item.horizonMinutes)
      const pUp = validateProbability(item.pUp)
      const pFlat = validateProbability(item.pFlat)
      const pDown = validateProbability(item.pDown)
      if (horizonMinutes === null || pUp === null || pFlat === null || pDown === null || Math.abs(pUp + pFlat + pDown - 1) > 0.00001) {
        return res.status(400).json({ code: 400, message: 'invalid probability distribution', data: null })
      }
      parsedHorizons.push(item)
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO quant_prediction_runs
          (run_id, stock_code, trade_date, as_of, mode, reference_price, previous_close, model_version, model_state, regime, features, news_events, input_hash, warnings)
         VALUES ($1::uuid, $2, $3::date, $4::timestamptz, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14::jsonb)`,
        [runId, stockCode, tradeDate, asOf, mode, referencePrice, previousClose, String(body.modelVersion || ''), String(body.modelState || ''), JSON.stringify(body.regime || {}), JSON.stringify(body.features || {}), JSON.stringify(body.newsEvents || []), String(body.inputHash || ''), JSON.stringify(body.warnings || [])]
      )
      for (const item of parsedHorizons) {
        await client.query(
          `INSERT INTO quant_horizon_forecasts
            (run_id, horizon_minutes, p_up, p_flat, p_down, expected_return_pct, q10_return_pct, q50_return_pct, q90_return_pct, confidence, actionable, reasons)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
          [runId, finiteNumber(item.horizonMinutes), validateProbability(item.pUp), validateProbability(item.pFlat), validateProbability(item.pDown), finiteNumber(item.expectedReturnPct), finiteNumber(item.q10ReturnPct), finiteNumber(item.q50ReturnPct), finiteNumber(item.q90ReturnPct), validateProbability(item.confidence), Boolean(item.actionable), JSON.stringify(item.reasons || [])]
        )
      }

      const legacyCurve = Array.isArray(body.legacyCurve) ? body.legacyCurve : []
      if (mode === 'daily' && legacyCurve.length > 0) {
        const prices = legacyCurve.map((point) => isRecord(point) ? finiteNumber(point.price) : null).filter((value): value is number => value !== null)
        const lowerPrices = legacyCurve.map((point) => isRecord(point) ? finiteNumber(point.lower) : null).filter((value): value is number => value !== null)
        const upperPrices = legacyCurve.map((point) => isRecord(point) ? finiteNumber(point.upper) : null).filter((value): value is number => value !== null)
        const primary = parsedHorizons.find((item) => finiteNumber(item.horizonMinutes) === 15) || parsedHorizons[0]
        const terminal = parsedHorizons[parsedHorizons.length - 1]
        const direction = (validateProbability(primary.pUp) || 0) > (validateProbability(primary.pDown) || 0) ? '概率偏多' : '概率偏空'
        await client.query(`DELETE FROM stock_day_predictions WHERE stock_code = $1 AND predict_date = $2::date AND is_base = TRUE`, [stockCode, tradeDate])
        await client.query(
          `INSERT INTO stock_day_predictions
            (stock_code, predict_date, version, is_base, time_points, direction, target_pct, metadata, probability_bands)
           VALUES ($1, $2::date, 1, TRUE, $3::jsonb, $4, $5, $6::jsonb, $7::jsonb)`,
          [stockCode, tradeDate, JSON.stringify(legacyCurve), direction, finiteNumber(terminal.q50ReturnPct), JSON.stringify({ runId, modelVersion: body.modelVersion, modelState: body.modelState }), JSON.stringify(legacyCurve.map((point) => isRecord(point) ? { time: point.time, lower: point.lower, upper: point.upper } : point))]
        )
        if (prices.length > 0) {
          const riskLow = lowerPrices.length > 0 ? Math.min(...lowerPrices) : Math.min(...prices)
          const riskHigh = upperPrices.length > 0 ? Math.max(...upperPrices) : Math.max(...prices)
          await client.query(`UPDATE stocks SET predicted_low = $1, predicted_high = $2, updated_at = NOW() WHERE code = $3`, [riskLow, riskHigh, stockCode])
        }
      }
      await client.query('COMMIT')
      return res.json({ code: 0, message: 'forecast run persisted', data: { runId } })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('Persist forecast run error:', error)
      return res.status(500).json({ code: 500, message: 'forecast persistence failed', data: null })
    } finally {
      client.release()
    }
  })

  router.get('/stocks/:code/latest-forecast', async (req, res) => {
    try {
      const { rows: runRows } = await pool.query(
        `SELECT run_id as "runId", stock_code as "stockCode", trade_date as "tradeDate", as_of as "asOf",
                mode, reference_price as "referencePrice", previous_close as "previousClose",
                model_version as "modelVersion", model_state as "modelState", regime, features,
                news_events as "newsEvents", input_hash as "inputHash", warnings
         FROM quant_prediction_runs WHERE stock_code = $1 ORDER BY as_of DESC LIMIT 1`,
        [req.params.code]
      )
      if (runRows.length === 0) return res.json({ code: 0, message: 'forecast not found', data: null })
      const { rows: forecasts } = await pool.query(
        `SELECT horizon_minutes as "horizonMinutes", p_up as "pUp", p_flat as "pFlat", p_down as "pDown",
                expected_return_pct as "expectedReturnPct", q10_return_pct as "q10ReturnPct",
                q50_return_pct as "q50ReturnPct", q90_return_pct as "q90ReturnPct", confidence, actionable, reasons
         FROM quant_horizon_forecasts WHERE run_id = $1::uuid ORDER BY horizon_minutes`,
        [runRows[0].runId]
      )
      return res.json({ code: 0, message: 'ok', data: { ...runRows[0], horizons: forecasts } })
    } catch (error) {
      console.error('Fetch latest forecast error:', error)
      return res.status(500).json({ code: 500, message: 'forecast query failed', data: null })
    }
  })

  router.post('/public-trades/batch', quantInternalOnly, async (req, res) => {
    const records = Array.isArray(req.body?.records) ? req.body.records : []
    if (records.length > 1000) return res.status(413).json({ code: 413, message: 'batch too large', data: null })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const keys = new Set<string>()
      for (const record of records) {
        if (!isRecord(record)) continue
        const stockCode = String(record.stockCode || '')
        const tradeDate = String(record.tradeDate || '')
        if (!/^\d{6}$/.test(stockCode) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) continue
        keys.add(`${stockCode}|${tradeDate}`)
      }
      for (const key of keys) {
        const [stockCode, tradeDate] = key.split('|')
        await client.query(`DELETE FROM stock_l2_orders WHERE stock_code = $1 AND trade_date = $2::date`, [stockCode, tradeDate])
      }
      let inserted = 0
      for (const record of records) {
        if (!isRecord(record)) continue
        const price = finiteNumber(record.price)
        const volumeLots = finiteNumber(record.volumeLots)
        if (price === null || volumeLots === null || price <= 0 || volumeLots <= 0) continue
        await client.query(
          `INSERT INTO stock_l2_orders (stock_code, trade_date, time_str, type, price, volume_lots, note)
           VALUES ($1, $2::date, $3, $4, $5, $6, $7)`,
          [String(record.stockCode), String(record.tradeDate), String(record.timeStr), String(record.type), price, volumeLots, String(record.note || '')]
        )
        inserted++
      }
      await client.query('COMMIT')
      return res.json({ code: 0, message: 'public trades persisted', data: { inserted } })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('Persist public trades error:', error)
      return res.status(500).json({ code: 500, message: 'public trade persistence failed', data: null })
    } finally {
      client.release()
    }
  })

  return router
}
