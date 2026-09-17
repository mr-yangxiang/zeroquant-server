import { AppError } from '../../shared/errors.js'
import { record,stockCode,price } from '../portfolio/portfolio.schema.js'
import { date,timestamp,number,text } from '../profile-evidence/evidence.schema.js'
export function syncSchema(value:unknown) {
  const row=record(value),code=stockCode(row.stockCode),tradeDate=date(row.tradeDate)
  const forecastAt=timestamp(row.timestampStr),observedAt=timestamp(row.observedAt===undefined?row.timestampStr:row.observedAt)
  const localDate=new Date(Date.parse(observedAt)+8*3600000).toISOString().slice(0,10)
  if(localDate!==tradeDate || Date.parse(observedAt)>Date.parse(forecastAt)) throw new AppError('VALIDATION','行情日期或观测时序不一致')
  const realPrice=price(row.realPrice),predictedPrice=row.predictedPrice===undefined?realPrice:price(row.predictedPrice)
  const currentPrice=row.currentPrice===undefined?realPrice:price(row.currentPrice)
  if(currentPrice!==realPrice) throw new AppError('VALIDATION','现价与实盘价不一致')
  const highPrice=row.highPrice===undefined?realPrice:price(row.highPrice),lowPrice=row.lowPrice===undefined?realPrice:price(row.lowPrice)
  if(highPrice<realPrice||lowPrice>realPrice) throw new AppError('VALIDATION','高低价与现价矛盾')
  const pct=row.pct===undefined?null:number(row.pct,-100,1000000)
  const runId=row.runId===undefined?null:text(row.runId,36).toLowerCase()
  if(runId!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId)) throw new AppError('VALIDATION','运行编号无效')
  const time=(value:unknown)=>{const result=text(value,5);if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result))throw new AppError('VALIDATION','预测时刻无效');return result}
  if(row.rollingPredictions!==undefined&&(!Array.isArray(row.rollingPredictions)||row.rollingPredictions.length>242)) throw new AppError('VALIDATION','滚动预测最多242条')
  const seen=new Set<string>()
  const rolling=((row.rollingPredictions??[]) as unknown[]).map(value=>{
    const point=record(value),targetTime=time(point.targetTime)
    if(seen.has(targetTime))throw new AppError('VALIDATION','预测时刻重复')
    seen.add(targetTime)
    const leadMinutes=point.leadMinutes===undefined?null:number(point.leadMinutes,0,2147483647)
    if(leadMinutes!==null&&!Number.isInteger(leadMinutes))throw new AppError('VALIDATION','前瞻分钟须为整数')
    return {targetTime,predictedPrice:price(point.predictedPrice),leadMinutes}
  })
  if(row.targetTime!==undefined) {
    const targetTime=time(row.targetTime)
    if(!rolling.length)rolling.push({targetTime,predictedPrice,leadMinutes:5})
  }
  return {stockCode:code,tradeDate,forecastAt,observedAt,realPrice,predictedPrice,highPrice,lowPrice,pct,runId,rolling}
}
export type SyncInput=ReturnType<typeof syncSchema>
