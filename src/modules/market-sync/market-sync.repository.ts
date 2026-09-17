import type { UnitOfWork } from '../../shared/transaction.js'
import { AppError } from '../../shared/errors.js'
import type { SyncInput } from './market-sync.schema.js'
import type { SyncWriter } from './market-sync.service.js'
export class MarketSyncRepository implements SyncWriter {
  constructor(private readonly work:UnitOfWork) {}
  async persist(input:SyncInput) {
    return this.work.run(async db=>{
      // 与日基线投影统一股票级锁顺序，再取stocks行锁。
      await db.query('SELECT pg_advisory_xact_lock(741003,hashtext($1))',[input.stockCode])
      const {rows:stocks}=await db.query('SELECT code FROM stocks WHERE code=$1 FOR UPDATE',[input.stockCode])
      if(!stocks.length)throw new AppError('NOT_FOUND','标的不存在')
      const {rows:duplicates}=await db.query('SELECT id FROM stock_price_histories WHERE stock_code=$1 AND timestamp=$2::timestamptz LIMIT 1',[input.stockCode,input.observedAt])
      if(duplicates.length)throw new AppError('CONFLICT','该观测时刻已存在，请核对原记录')
      const {rows:latest}=await db.query<{at:Date|string;day:string}>(`SELECT timestamp AS at,TO_CHAR(timestamp AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS day
        FROM stock_price_histories WHERE stock_code=$1 AND timestamp IS NOT NULL ORDER BY timestamp DESC LIMIT 1`,[input.stockCode])
      const summaryApplied=!latest.length||Date.parse(input.observedAt)>new Date(latest[0].at).getTime()
      const reset=!latest.length||latest[0].day!==input.tradeDate
      if(summaryApplied)await db.query(`UPDATE stocks SET current_price=$1,pct=$2,
        high_price=CASE WHEN $5 THEN $3 ELSE GREATEST(COALESCE(high_price,$3),$3) END,
        low_price=CASE WHEN $5 OR COALESCE(low_price,0)<=0 THEN $4 ELSE LEAST(low_price,$4) END,
        updated_at=($6::timestamptz AT TIME ZONE 'Asia/Shanghai') WHERE code=$7`,
        [input.realPrice,input.pct,input.highPrice,input.lowPrice,reset,input.observedAt,input.stockCode])
      const deviation=Math.round(Math.abs(input.realPrice-input.predictedPrice)/input.realPrice*10000)/100
      const {rows}=await db.query(`INSERT INTO stock_price_histories(stock_code,timestamp,real_price,predicted_price,deviation_pct,trade_date)
        VALUES($1,$2::timestamptz,$3,$4,$5,$6::date) RETURNING id,stock_code AS "stockCode",timestamp,real_price AS "realPrice",predicted_price AS "predictedPrice",deviation_pct AS "deviationPct"`,
        [input.stockCode,input.observedAt,input.realPrice,input.predictedPrice,deviation,input.tradeDate])
      if(!rows[0])throw new AppError('INTERNAL')
      for(const point of input.rolling)await db.query(`INSERT INTO stock_rolling_predictions
        (stock_code,predict_date,target_time,predicted_price,run_id,forecast_at,target_at,lead_minutes)
        VALUES($1,$2::date,$3,$4,$5::uuid,$6::timestamptz,(($2::date::text||' '||$3::text||':00')::timestamp AT TIME ZONE 'Asia/Shanghai'),$7)`,
        [input.stockCode,input.tradeDate,point.targetTime,point.predictedPrice,input.runId,input.forecastAt,point.leadMinutes])
      return {...rows[0],summaryApplied}
    })
  }
}
