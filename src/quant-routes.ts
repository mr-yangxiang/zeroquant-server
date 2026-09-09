import { Router, type Request, type Response, type NextFunction } from 'express'
import { createHash } from 'node:crypto'
import { pool } from './db.js'
import { getStockEntityProfiles, refreshEntityProfiles } from './profiles/entity-profile-engine.js'

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

function localizeModelState(value: unknown) {
  const state = String(value || '')
  if (state === 'untrained_bootstrap') {
    return {
      label: '尚未完成训练，仅供观察',
      explanation: '当前只是验证数据管道和页面的初始规则权重，尚未用多年历史样本训练，也未通过样本外回测和概率校准，不能据此证明预测准确率。',
    }
  }
  if (state === 'shadow') return { label: '影子验证中', explanation: '模型已训练，正在模拟成交中验证滑点、延迟和成本后的表现。' }
  if (state === 'champion') return { label: '已通过生产门槛', explanation: '模型已通过既定样本外、校准和影子交易门槛，仍受实时数据质量与风控约束。' }
  return { label: '状态待确认', explanation: '当前模型状态没有对应的中文说明。' }
}

export function createQuantRouter() {
  const router = Router()

  router.get('/stocks/:code/entity-profiles', async (req, res) => {
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
      console.error('Fetch entity profiles error:', error)
      return res.status(500).json({ code: 500, message: 'entity profile query failed', data: null })
    }
  })

  router.post('/entity-profiles/refresh', quantInternalOnly, async (req, res) => {
    const raw = String(req.body?.asOf || '')
    const asOf = raw ? new Date(raw) : new Date()
    if (Number.isNaN(asOf.getTime())) {
      return res.status(400).json({ code: 400, message: 'invalid as-of timestamp', data: null })
    }
    try {
      const data = await refreshEntityProfiles(asOf)
      return res.json({ code: 0, message: 'entity profiles refreshed', data })
    } catch (error) {
      console.error('Refresh entity profiles error:', error)
      return res.status(500).json({ code: 500, message: 'entity profile refresh failed', data: null })
    }
  })

  router.post('/profile-evidence/dragon-tiger/batch', quantInternalOnly, async (req, res) => {
    const records: unknown[] = Array.isArray(req.body?.records) ? req.body.records : []
    if (records.length === 0 || records.length > 1000) {
      return res.status(400).json({ code: 400, message: 'records must contain 1 to 1000 items', data: null })
    }
    const parsed = records.map((record: unknown) => {
      if (!isRecord(record)) return null
      const stockCode = String(record.stockCode || '')
      const tradeDate = String(record.tradeDate || '')
      const side = String(record.side || '').toUpperCase()
      const rank = finiteNumber(record.rank)
      const seatName = String(record.seatName || '').trim()
      const buyAmount = finiteNumber(record.buyAmount) ?? 0
      const sellAmount = finiteNumber(record.sellAmount) ?? 0
      const netAmount = finiteNumber(record.netAmount) ?? buyAmount - sellAmount
      const source = String(record.source || '').trim()
      const disclosedAt = new Date(String(record.disclosedAt || ''))
      const tradeDateStart = new Date(`${tradeDate}T00:00:00+08:00`)
      if (!/^\d{6}$/.test(stockCode) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)
        || !['BUY', 'SELL'].includes(side) || rank === null || !Number.isInteger(rank) || rank < 1 || rank > 100
        || !seatName || seatName.length > 255 || !source || source.length > 100
        || Number.isNaN(disclosedAt.getTime()) || disclosedAt < tradeDateStart || buyAmount < 0 || sellAmount < 0) return null
      const seatType = String(record.seatType || '').trim() || null
      if (seatType && seatType.length > 50) return null
      return { stockCode, tradeDate, side, rank, seatName, buyAmount, sellAmount, netAmount,
        seatType, source, disclosedAt: disclosedAt.toISOString() }
    })
    if (parsed.some((item) => item === null)) {
      return res.status(400).json({ code: 400, message: 'invalid dragon-tiger evidence item; batch rejected atomically', data: null })
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const item of parsed) {
        if (!item) continue
        await client.query(
          `INSERT INTO dragon_tiger_seats
            (stock_code, trade_date, side, rank, seat_name, buy_amount, sell_amount, net_amount, seat_type, source, disclosed_at)
           VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
           ON CONFLICT (stock_code, trade_date, side, rank) DO UPDATE SET
             seat_name = EXCLUDED.seat_name, buy_amount = EXCLUDED.buy_amount,
             sell_amount = EXCLUDED.sell_amount, net_amount = EXCLUDED.net_amount,
             seat_type = EXCLUDED.seat_type, source = EXCLUDED.source,
             disclosed_at = EXCLUDED.disclosed_at, ingested_at = NOW()`,
          [item.stockCode, item.tradeDate, item.side, item.rank, item.seatName, item.buyAmount,
            item.sellAmount, item.netAmount, item.seatType, item.source, item.disclosedAt]
        )
      }
      await client.query('COMMIT')
      return res.json({ code: 0, message: 'dragon-tiger evidence persisted', data: { accepted: parsed.length } })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('Persist dragon-tiger evidence error:', error)
      return res.status(500).json({ code: 500, message: 'dragon-tiger evidence persistence failed', data: null })
    } finally {
      client.release()
    }
  })

  router.post('/profile-evidence/news/batch', quantInternalOnly, async (req, res) => {
    const records: unknown[] = Array.isArray(req.body?.records) ? req.body.records : []
    if (records.length === 0 || records.length > 500) {
      return res.status(400).json({ code: 400, message: 'records must contain 1 to 500 items', data: null })
    }
    const parsed = records.map((record: unknown) => {
      if (!isRecord(record)) return null
      const title = String(record.title || '').trim()
      const content = String(record.content || '').trim()
      const source = String(record.source || '').trim()
      const publishedAt = new Date(String(record.publishedAt || ''))
      const rawStocks = Array.isArray(record.stocks) ? record.stocks.map((item) => String(item)) : []
      const stocks = rawStocks.filter((item) => /^\d{6}$/.test(item))
      const sentimentScore = finiteNumber(record.sentimentScore)
      const sentimentLabel = String(record.sentimentLabel || '').trim() || null
      const trustLevel = String(record.trustLevel || 'NORMAL').trim()
      if (!title || title.length > 500 || !source || source.length > 100
        || Number.isNaN(publishedAt.getTime()) || stocks.length === 0 || stocks.length !== rawStocks.length
        || (sentimentScore !== null && (sentimentScore < -1 || sentimentScore > 1))) return null
      const fingerprint = String(record.fingerprint || '').trim()
        || createHash('sha256').update(`${source}|${publishedAt.toISOString()}|${title}|${String(record.url || '')}`).digest('hex')
      const url = String(record.url || '').trim() || null
      if (!/^[0-9a-f]{64}$/i.test(fingerprint) || (url && url.length > 1000)
        || (sentimentLabel && !['BULLISH', 'BEARISH', 'NEUTRAL'].includes(sentimentLabel))
        || !['LOW', 'NORMAL', 'HIGH'].includes(trustLevel)) return null
      return { title, content, source, publishedAt: publishedAt.toISOString(), stocks: [...new Set(stocks)], fingerprint,
        url, sentimentLabel, sentimentScore, trustLevel }
    })
    if (parsed.some((item) => item === null)) {
      return res.status(400).json({ code: 400, message: 'invalid news evidence item; batch rejected atomically', data: null })
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const item of parsed) {
        if (!item) continue
        const { rows } = await client.query(
          `INSERT INTO news_articles
            (title, content, url, source, published_at, fingerprint, sentiment_label, sentiment_score, trust_level)
           VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9)
           ON CONFLICT (fingerprint) DO UPDATE SET
             title = EXCLUDED.title, content = EXCLUDED.content, url = EXCLUDED.url,
             sentiment_label = EXCLUDED.sentiment_label, sentiment_score = EXCLUDED.sentiment_score,
             trust_level = EXCLUDED.trust_level
           RETURNING id`,
          [item.title, item.content, item.url, item.source, item.publishedAt, item.fingerprint,
            item.sentimentLabel, item.sentimentScore, item.trustLevel]
        )
        for (const stockCode of item.stocks) {
          await client.query(
            `INSERT INTO news_stock_relations (news_id, stock_code, relevance_score, impact_level)
             VALUES ($1, $2, 1, 'MEDIUM')
             ON CONFLICT (news_id, stock_code) DO NOTHING`,
            [rows[0].id, stockCode]
          )
        }
      }
      await client.query('COMMIT')
      return res.json({ code: 0, message: 'news evidence persisted', data: { accepted: parsed.length } })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('Persist news evidence error:', error)
      return res.status(500).json({ code: 500, message: 'news evidence persistence failed', data: null })
    } finally {
      client.release()
    }
  })

  router.post('/profile-evidence/daily-bars/batch', quantInternalOnly, async (req, res) => {
    const records: unknown[] = Array.isArray(req.body?.records) ? req.body.records : []
    if (records.length === 0 || records.length > 1000) {
      return res.status(400).json({ code: 400, message: 'records must contain 1 to 1000 items', data: null })
    }
    const parsed = records.map((record: unknown) => {
      if (!isRecord(record)) return null
      const stockCode = String(record.stockCode || '')
      const tradeDate = String(record.tradeDate || '')
      const open = finiteNumber(record.open)
      const high = finiteNumber(record.high)
      const low = finiteNumber(record.low)
      const close = finiteNumber(record.close)
      const prevClose = finiteNumber(record.prevClose)
      const volume = finiteNumber(record.volume)
      const amount = finiteNumber(record.amount)
      const source = String(record.source || '').trim()
      if (!/^\d{6}$/.test(stockCode) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)
        || [open, high, low, close, prevClose, volume, amount].some((item) => item === null)
        || !source || source.length > 50 || Math.min(open!, high!, low!, close!, prevClose!) <= 0 || volume! < 0 || amount! < 0
        || high! < Math.max(open!, close!, low!) || low! > Math.min(open!, close!, high!)) return null
      return { stockCode, tradeDate, open: open!, high: high!, low: low!, close: close!, prevClose: prevClose!,
        volume: volume!, amount: amount!, source }
    })
    if (parsed.some((item) => item === null)) {
      return res.status(400).json({ code: 400, message: 'invalid daily bar item; batch rejected atomically', data: null })
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const item of parsed) {
        if (!item) continue
        await client.query(
          `INSERT INTO daily_bars
            (stock_code, trade_date, open, high, low, close, volume, amount, prev_close, source)
           VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (stock_code, trade_date) DO UPDATE SET
             open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
             close = EXCLUDED.close, volume = EXCLUDED.volume, amount = EXCLUDED.amount,
             prev_close = EXCLUDED.prev_close, source = EXCLUDED.source, ingested_at = NOW()`,
          [item.stockCode, item.tradeDate, item.open, item.high, item.low, item.close,
            item.volume, item.amount, item.prevClose, item.source]
        )
      }
      await client.query('COMMIT')
      return res.json({ code: 0, message: 'daily bars persisted', data: { accepted: parsed.length } })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error('Persist daily bars error:', error)
      return res.status(500).json({ code: 500, message: 'daily bar persistence failed', data: null })
    } finally {
      client.release()
    }
  })

  router.post('/prediction-runs', quantInternalOnly, async (req, res) => {
    const body = req.body as UnknownRecord
    const runId = String(body.runId || '')
    const stockCode = String(body.stockCode || '')
    const tradeDate = String(body.tradeDate || '')
    const asOf = String(body.asOf || '')
    const mode = String(body.mode || '')
    const modelState = String(body.modelState || '')
    const modelCalibrated = body.modelCalibrated === true
    const horizons = Array.isArray(body.horizons) ? body.horizons : []
    const referencePrice = finiteNumber(body.referencePrice)
    const previousClose = finiteNumber(body.previousClose)
    const features = isRecord(body.features) ? body.features : {}
    const qualityFlags = Array.isArray(features.qualityFlags) ? features.qualityFlags.map(String) : []
    const warnings = Array.isArray(body.warnings) ? body.warnings.map(String) : []
    const hasHardRisk = qualityFlags.some((flag) =>
      flag.startsWith('stale_') ||
      flag.includes('source_unavailable') ||
      flag.includes('leakage')
    ) || warnings.some((warning) => warning.includes('硬风控'))
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
          (run_id, stock_code, trade_date, as_of, mode, reference_price, previous_close, model_version, model_state, model_calibrated, regime, features, news_events, input_hash, warnings)
         VALUES ($1::uuid, $2, $3::date, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15::jsonb)`,
          [runId, stockCode, tradeDate, asOf, mode, referencePrice, previousClose, String(body.modelVersion || ''), modelState, modelCalibrated, JSON.stringify(body.regime || {}), JSON.stringify(features), JSON.stringify(body.newsEvents || []), String(body.inputHash || ''), JSON.stringify(warnings)]
      )
      for (const item of parsedHorizons) {
        await client.query(
          `INSERT INTO quant_horizon_forecasts
            (run_id, horizon_minutes, p_up, p_flat, p_down, expected_return_pct, q10_return_pct, q50_return_pct, q90_return_pct, confidence, actionable, reasons)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
          [runId, finiteNumber(item.horizonMinutes), validateProbability(item.pUp), validateProbability(item.pFlat), validateProbability(item.pDown), finiteNumber(item.expectedReturnPct), finiteNumber(item.q10ReturnPct), finiteNumber(item.q50ReturnPct), finiteNumber(item.q90ReturnPct), validateProbability(item.confidence), modelState === 'champion' && modelCalibrated && !hasHardRisk && Boolean(item.actionable), JSON.stringify(item.reasons || [])]
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
      } else if (mode === 'realtime' && legacyCurve.length > 0) {
        for (const point of legacyCurve) {
          if (isRecord(point) && point.time && finiteNumber(point.price) !== null) {
            await client.query(
              `INSERT INTO stock_rolling_predictions
                (stock_code, predict_date, target_time, predicted_price, run_id, forecast_at, target_at, lead_minutes)
               VALUES ($1, $2::date, $3::text, $4, $5::uuid, $6::timestamptz,
                       (($2::date::text || ' ' || $3::text || ':00')::timestamp AT TIME ZONE 'Asia/Shanghai'), $7)`,
              [stockCode, tradeDate, String(point.time), finiteNumber(point.price), runId, asOf, finiteNumber(point.leadMinutes)]
            )
          }
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
      const asOfDate = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf)
        ? req.query.asOf
        : null
      const { rows: runRows } = await pool.query(
        `SELECT run_id as "runId", stock_code as "stockCode", trade_date as "tradeDate", as_of as "asOf",
                mode, reference_price as "referencePrice", previous_close as "previousClose",
                model_version as "modelVersion", model_state as "modelState", model_calibrated as "modelCalibrated", regime, features,
                news_events as "newsEvents", input_hash as "inputHash", warnings
         FROM quant_prediction_runs
         WHERE stock_code = $1
           AND ($2::date IS NULL OR as_of < $2::date + INTERVAL '1 day')
         ORDER BY as_of DESC LIMIT 1`,
        [req.params.code, asOfDate]
      )
      if (runRows.length === 0) return res.json({ code: 0, message: 'forecast not found', data: null })
      const { rows: forecasts } = await pool.query(
        `SELECT horizon_minutes as "horizonMinutes", p_up as "pUp", p_flat as "pFlat", p_down as "pDown",
                expected_return_pct as "expectedReturnPct", q10_return_pct as "q10ReturnPct",
                q50_return_pct as "q50ReturnPct", q90_return_pct as "q90ReturnPct", confidence, actionable, reasons
         FROM quant_horizon_forecasts WHERE run_id = $1::uuid ORDER BY horizon_minutes`,
        [runRows[0].runId]
      )
      const localized = localizeModelState(runRows[0].modelState)
      return res.json({
        code: 0,
        message: 'ok',
        data: {
          ...runRows[0],
          modelStateLabel: localized.label,
          modelStateExplanation: localized.explanation,
          horizons: forecasts,
        },
      })
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
