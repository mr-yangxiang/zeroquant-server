import { replayPrediction, type PredictionReceipt } from './prediction-receipt.js'
import type { UnitOfWork } from '../../shared/transaction.js'
import type { PredictionInput } from './prediction.schema.js'
import type { PredictionWriter } from './prediction.service.js'
import { AppError } from '../../shared/errors.js'
export class PredictionRepository implements PredictionWriter {
  constructor(private readonly work:UnitOfWork) {}
  async receipt(runId:string):Promise<PredictionReceipt|null> {
    return this.work.run(async db=>{
      const {rows}=await db.query<PredictionReceipt>('SELECT request_hash AS "requestHash",response FROM prediction_ingestion_receipts WHERE run_id=$1::uuid',[runId])
      return rows[0]??null
    })
  }
  async persist(body:PredictionInput,verifiedProduction:boolean,hash:string) {
    const {runId,stockCode,tradeDate,asOf,mode,referencePrice,previousClose,modelState,modelCalibrated,features,warnings}=body
    const parsedHorizons=body.horizons
    const hasHardRisk=features.qualityFlags.some(flag=>/stale_|source_unavailable|leakage/.test(flag))||warnings.some(warning=>warning.includes('硬风控'))
    return this.work.run(async db=>{
      // 所有写入与回执同事务；预读取后仍须在锁内再次裁决。
      await db.query('SELECT pg_advisory_xact_lock(741002,hashtext($1))',[runId])
      const {rows:receipts}=await db.query<PredictionReceipt>('SELECT request_hash AS "requestHash",response FROM prediction_ingestion_receipts WHERE run_id=$1::uuid',[runId])
      const cached=replayPrediction(receipts[0]??null,hash)
      if(cached) return cached
      const existing=await db.query('SELECT run_id FROM quant_prediction_runs WHERE run_id=$1::uuid',[runId])
      if(existing.rows.length) throw new AppError('CONFLICT','旧运行没有完整请求回执，不能确认相同内容，请核对原记录')
      // 同一股票跨日期串行，防止较早交易日覆盖股票级摘要。
      if(mode==='daily') await db.query('SELECT pg_advisory_xact_lock(741003,hashtext($1))',[stockCode])
      await db.query(
        `INSERT INTO quant_prediction_runs
          (run_id, stock_code, trade_date, as_of, mode, reference_price, previous_close, model_version, model_state, model_calibrated, regime, features, news_events, input_hash, warnings)
         VALUES ($1::uuid, $2, $3::date, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15::jsonb)`,
          [runId, stockCode, tradeDate, asOf, mode, referencePrice, previousClose, String(body.modelVersion || ''), modelState, modelCalibrated, JSON.stringify(body.regime || {}), JSON.stringify(features), JSON.stringify(body.newsEvents || []), String(body.inputHash || ''), JSON.stringify(warnings)]
      )
      for (const item of parsedHorizons) {
        await db.query(
          `INSERT INTO quant_horizon_forecasts
            (run_id, horizon_minutes, p_up, p_flat, p_down, expected_return_pct, q10_return_pct, q50_return_pct, q90_return_pct, confidence, actionable, reasons)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
          [runId, item.horizonMinutes, item.pUp, item.pFlat, item.pDown, item.expectedReturnPct, item.q10ReturnPct, item.q50ReturnPct, item.q90ReturnPct, item.confidence, verifiedProduction && modelState === 'champion' && modelCalibrated && !hasHardRisk && item.actionable, JSON.stringify(item.reasons || [])]
        )
      }

      let baselineApplied=false
      const legacyCurve = body.legacyCurve
      if (mode === 'daily' && legacyCurve.length > 0) {
        const {rows:current}=await db.query<{asOf:Date|string|null}>(`SELECT r.as_of AS "asOf"
          FROM stock_day_predictions p LEFT JOIN quant_prediction_runs r
            ON r.run_id::text=p.metadata->>'runId' AND r.stock_code=p.stock_code AND r.trade_date=p.predict_date
          WHERE p.stock_code=$1 AND p.predict_date=$2::date AND p.is_base=TRUE`,[stockCode,tradeDate])
        // 无来源的旧基线或同时间修订不自动覆盖；旧运行照常归档。
        const replace=current.length===0 || current.every(row=>row.asOf!==null && new Date(row.asOf).getTime()<Date.parse(asOf))
        if(replace) {
        baselineApplied=true
        const prices = legacyCurve.map(point => point.price)
        const lowerPrices = legacyCurve.map(point => point.lower)
        const upperPrices = legacyCurve.map(point => point.upper)
        const primary = parsedHorizons.find((item) => item.horizonMinutes === 15) || parsedHorizons[0]
        const terminal = parsedHorizons[parsedHorizons.length - 1]
        const direction = (primary.pUp || 0) > (primary.pDown || 0) ? '概率偏多' : '概率偏空'
        await db.query(`DELETE FROM stock_day_predictions WHERE stock_code = $1 AND predict_date = $2::date AND is_base = TRUE`, [stockCode, tradeDate])
        await db.query(
          `INSERT INTO stock_day_predictions
            (stock_code, predict_date, version, is_base, time_points, direction, target_pct, metadata, probability_bands)
           VALUES ($1, $2::date, 1, TRUE, $3::jsonb, $4, $5, $6::jsonb, $7::jsonb)`,
          [stockCode, tradeDate, JSON.stringify(legacyCurve), direction, terminal.q50ReturnPct, JSON.stringify({ runId, modelVersion: body.modelVersion, modelState: body.modelState }), JSON.stringify(legacyCurve.map(point => ({time:point.time,lower:point.lower,upper:point.upper})))]
        )
        const {rows:later}=await db.query(`SELECT 1 FROM stock_day_predictions WHERE stock_code=$1 AND is_base=TRUE AND predict_date>$2::date LIMIT 1`,[stockCode,tradeDate])
        if (prices.length > 0 && later.length===0) {
          const riskLow = lowerPrices.length > 0 ? Math.min(...lowerPrices) : Math.min(...prices)
          const riskHigh = upperPrices.length > 0 ? Math.max(...upperPrices) : Math.max(...prices)
          await db.query(`UPDATE stocks SET predicted_low = $1, predicted_high = $2, updated_at = NOW() WHERE code = $3`, [riskLow, riskHigh, stockCode])
        }
        }
      } else if (mode === 'realtime' && legacyCurve.length > 0) {
        for (const point of legacyCurve) {
          {
            await db.query(
              `INSERT INTO stock_rolling_predictions
                (stock_code, predict_date, target_time, predicted_price, run_id, forecast_at, target_at, lead_minutes)
               VALUES ($1, $2::date, $3::text, $4, $5::uuid, $6::timestamptz,
                       (($2::date::text || ' ' || $3::text || ':00')::timestamp AT TIME ZONE 'Asia/Shanghai'), $7)`,
              [stockCode, tradeDate, String(point.time), point.price, runId, asOf, point.leadMinutes]
            )
          }
        }
      }
      const response={runId,baselineApplied}
      await db.query('INSERT INTO prediction_ingestion_receipts(run_id,request_hash,response) VALUES($1::uuid,$2,$3::jsonb)',[runId,hash,JSON.stringify(response)])
      return response
    })
  }
}
