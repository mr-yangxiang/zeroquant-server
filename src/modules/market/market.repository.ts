/** 行情读取仓储：集中 SQL，并用同一只读快照读取复盘所需的多张表。 */
import type { Pool } from 'pg'
export interface StockRow {
  code: string; full_code: string; name: string; current_price: number | null; yesterday_price: number | null
  high_price: number | null; low_price: number | null; pct: number | null
  predicted_high: number | null; predicted_low: number | null; is_hot: boolean | null; updated_at: Date | null
}
export interface RealPoint { timestamp: string; realPrice: number }
export interface RollingPoint { targetTime: string; predictedPrice: number; forecastAt: Date | null; leadMinutes: number | null }
export interface ArchiveCount { storedPointCount: number; snapshotCount: number }
export interface MarketSnapshot {
  realHistories: RealPoint[]; predictions: Record<string, unknown>[]; rollingPredictions: RollingPoint[]
  rollingArchiveRows: ArchiveCount[]; l2Orders: Record<string, unknown>[]
  positionRows: Record<string, unknown>[]; tradeRows: Record<string, unknown>[]
}
export interface MarketReader {
  stocks(): Promise<StockRow[]>
  history(code: string, limit: number): Promise<Record<string, unknown>[]>
  snapshot(code: string, targetDate: string, userId: string | null): Promise<MarketSnapshot>
}
export class MarketRepository implements MarketReader {
  constructor(private readonly pool: Pool) {}
  async stocks() { return (await this.pool.query<StockRow>(STOCKS)).rows }
  async history(code: string, limit: number) { return (await this.pool.query(HISTORIES, [code,limit])).rows }
  async snapshot(code: string, targetDate: string, userId: string | null): Promise<MarketSnapshot> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const realHistories = (await client.query<RealPoint>(REALHISTORIES, [code,targetDate])).rows
      const predictions = (await client.query(PREDICTIONS, [code,targetDate])).rows
      const rollingPredictions = (await client.query<RollingPoint>(ROLLINGPREDICTIONS, [code,targetDate])).rows
      const rollingArchiveRows = (await client.query<ArchiveCount>(ROLLINGARCHIVEROWS, [code,targetDate])).rows
      const l2Orders = (await client.query(L2ORDERS, [code,targetDate])).rows
      const positionRows = userId ? (await client.query(POSITIONROWS, [code,userId])).rows : []
      const tradeRows = userId ? (await client.query(TRADEROWS, [code,userId,targetDate])).rows : []
      await client.query('COMMIT')
      return { realHistories,predictions,rollingPredictions,rollingArchiveRows,l2Orders,positionRows,tradeRows }
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error }
    finally { client.release() }
  }
}

// SQL 标识符固定；用户参数始终使用绑定值。历史曲线保持原有提前 5 分钟取样规则。
const STOCKS = 'SELECT code,full_code,name,current_price,yesterday_price,high_price,low_price,pct,predicted_high,predicted_low,is_hot,updated_at FROM stocks ORDER BY code ASC'
const HISTORIES = `SELECT id, stock_code as "stockCode", timestamp, real_price as "realPrice",
              predicted_price as "predictedPrice", deviation_pct as "deviationPct"
       FROM stock_price_histories
       WHERE stock_code = $1
       ORDER BY timestamp ASC
       LIMIT $2`
const REALHISTORIES = `SELECT TO_CHAR(timestamp AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD"T"HH24:MI:SS+08:00') as "timestamp", real_price as "realPrice"
       FROM stock_price_histories
       WHERE stock_code = $1
         AND (timestamp AT TIME ZONE 'Asia/Shanghai')::date = $2::date
       ORDER BY timestamp ASC`
const PREDICTIONS = `SELECT version, is_base as "isBase", time_points as "timePoints", direction, target_pct as "targetPct", created_at as "createdAt"
       FROM stock_day_predictions
       WHERE stock_code = $1
         AND predict_date = $2::date
       ORDER BY version ASC`
const ROLLINGPREDICTIONS = `WITH latest_observation AS (
         SELECT MAX(timestamp) AS latest_at
         FROM stock_price_histories
         WHERE stock_code = $1
           AND (timestamp AT TIME ZONE 'Asia/Shanghai')::date = $2::date
       ), ranked AS (
         SELECT rp.target_time, rp.predicted_price, rp.forecast_at, rp.lead_minutes,
                ROW_NUMBER() OVER (
                  PARTITION BY rp.target_time
                  ORDER BY
                    CASE WHEN lo.latest_at IS NOT NULL AND rp.target_at <= lo.latest_at THEN rp.lead_minutes END ASC NULLS LAST,
                    CASE WHEN lo.latest_at IS NULL OR rp.target_at > lo.latest_at THEN rp.forecast_at END DESC NULLS LAST,
                    rp.forecast_at DESC NULLS LAST,
                    rp.id DESC
                ) AS choice_rank
         FROM stock_rolling_predictions rp
         CROSS JOIN latest_observation lo
         WHERE rp.stock_code = $1
           AND rp.predict_date = $2::date
           AND (
             lo.latest_at IS NULL
             OR rp.target_at > lo.latest_at
             OR COALESCE(rp.lead_minutes, 0) >= 5
           )
       )
       SELECT target_time as "targetTime", predicted_price as "predictedPrice",
              forecast_at as "forecastAt", lead_minutes as "leadMinutes"
       FROM ranked
       WHERE choice_rank = 1
       ORDER BY target_time ASC`
const ROLLINGARCHIVEROWS = `SELECT COUNT(*)::int as "storedPointCount",
              COUNT(DISTINCT forecast_at)::int as "snapshotCount"
       FROM stock_rolling_predictions
       WHERE stock_code = $1 AND predict_date = $2::date`
const L2ORDERS = `SELECT time_str as "timeStr", type, price, volume_lots as "volumeLots", note
       FROM stock_l2_orders
       WHERE stock_code = $1
         AND trade_date = $2::date
       ORDER BY time_str ASC`
const POSITIONROWS = `SELECT holding_shares as "holdingShares", cost_price as "costPrice", t_shares as "tShares"
           FROM user_positions WHERE stock_code = $1 AND user_id = $2`
const TRADEROWS = `SELECT id, action_type as "actionType", trade_price as "tradePrice", trade_shares as "tradeShares",
                  TO_CHAR(trade_time AT TIME ZONE 'Asia/Shanghai', 'HH24:MI:SS') as "tradeTime", note
           FROM user_trade_actions WHERE stock_code = $1 AND user_id = $2 AND (trade_time AT TIME ZONE 'Asia/Shanghai')::date = $3::date
           ORDER BY trade_time DESC`
