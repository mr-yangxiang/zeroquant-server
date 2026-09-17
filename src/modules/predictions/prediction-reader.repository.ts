import type { UnitOfWork } from '../../shared/transaction.js'
export interface ForecastRow {
  horizonMinutes:number;pUp:number;pFlat:number;pDown:number;expectedReturnPct:number
  q10ReturnPct:number;q50ReturnPct:number;q90ReturnPct:number;confidence:number;actionable:boolean;reasons:unknown
}
export interface PredictionSnapshot {
  runId:string;stockCode:string;tradeDate:Date|string;asOf:Date|string;mode:string;referencePrice:number;previousClose:number
  modelVersion:string;modelState:string;modelCalibrated:boolean;regime:unknown;features:{observedAt?:string}|null
  newsEvents:unknown;inputHash:string;warnings:unknown;horizons:ForecastRow[]
}
export interface PredictionReader {latest(code:string,asOfDate:string|null):Promise<PredictionSnapshot|null>}
export class PgPredictionReader implements PredictionReader {
  constructor(private readonly work:UnitOfWork) {}
  async latest(code:string,asOfDate:string|null):Promise<PredictionSnapshot|null> {
    return this.work.run(async db=>{
      const {rows}=await db.query<Omit<PredictionSnapshot,'horizons'>>(`SELECT run_id AS "runId",stock_code AS "stockCode",trade_date AS "tradeDate",as_of AS "asOf",
        mode,reference_price AS "referencePrice",previous_close AS "previousClose",model_version AS "modelVersion",model_state AS "modelState",
        model_calibrated AS "modelCalibrated",regime,features,news_events AS "newsEvents",input_hash AS "inputHash",warnings
        FROM quant_prediction_runs WHERE stock_code=$1
          AND ($2::date IS NULL OR as_of < (($2::date+INTERVAL '1 day') AT TIME ZONE 'Asia/Shanghai'))
        ORDER BY as_of DESC,created_at DESC,run_id DESC LIMIT 1`,[code,asOfDate])
      const run=rows[0]
      if(!run) return null
      const {rows:horizons}=await db.query<ForecastRow>(`SELECT horizon_minutes AS "horizonMinutes",p_up AS "pUp",p_flat AS "pFlat",p_down AS "pDown",
        expected_return_pct AS "expectedReturnPct",q10_return_pct AS "q10ReturnPct",q50_return_pct AS "q50ReturnPct",q90_return_pct AS "q90ReturnPct",
        confidence,actionable,reasons FROM quant_horizon_forecasts WHERE run_id=$1::uuid ORDER BY horizon_minutes`,[run.runId])
      return {...run,horizons}
    })
  }
}
