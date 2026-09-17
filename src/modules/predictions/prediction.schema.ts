import { AppError } from '../../shared/errors.js'
import { record, stockCode, price } from '../portfolio/portfolio.schema.js'
import { date, timestamp, text, number } from '../profile-evidence/evidence.schema.js'
function strings(value:unknown):string[] {
  if(!Array.isArray(value)||value.length>100) throw new AppError('VALIDATION','说明列表无效')
  return value.map(item=>text(item,2000,true))
}
function boolean(value:unknown):boolean {
  if(typeof value!=='boolean') throw new AppError('VALIDATION','状态标志须为布尔值')
  return value
}
export function predictionSchema(input:unknown) {
  const body=record(input)
  const runId=text(body.runId,36).toLowerCase()
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId)) throw new AppError('VALIDATION','运行编号无效')
  const mode=text(body.mode,20)
  if(!['daily','realtime'].includes(mode)) throw new AppError('VALIDATION','运行模式无效')
  const modelState=text(body.modelState,80), modelVersion=text(body.modelVersion,120)
  const inputHash=text(body.inputHash,64)
  if(!/^[0-9a-f]{64}$/i.test(inputHash)) throw new AppError('VALIDATION','输入摘要无效')
  const features=record(body.features)
  const normalizedFeatures={...features,qualityFlags:strings(features.qualityFlags),qualityScore:number(features.qualityScore,0,1),observedAt:timestamp(features.observedAt)}
  const values=record(features.values)
  if(Object.keys(values).length>1000 || Object.values(values).some(value=>typeof value!=='number'||!Number.isFinite(value))) throw new AppError('VALIDATION','特征值须为有限数值')
  const regime=record(body.regime)
  if(!Array.isArray(body.newsEvents)||body.newsEvents.length>500) throw new AppError('VALIDATION','新闻快照数量无效')
  const newsEvents=body.newsEvents.map(record)
  if(!Array.isArray(body.horizons)||!body.horizons.length||body.horizons.length>100) throw new AppError('VALIDATION','预测周期数量无效')
  const seen=new Set<number>()
  const horizons=body.horizons.map(value=>{
    const row=record(value), horizonMinutes=number(row.horizonMinutes,1,2147483647)
    if(!Number.isInteger(horizonMinutes)||seen.has(horizonMinutes)) throw new AppError('VALIDATION','周期须为不重复的正整数')
    seen.add(horizonMinutes)
    const pUp=number(row.pUp,0,1),pFlat=number(row.pFlat,0,1),pDown=number(row.pDown,0,1)
    if(Math.abs(pUp+pFlat+pDown-1)>0.00001) throw new AppError('VALIDATION','概率之和须为1')
    const expectedReturnPct=number(row.expectedReturnPct,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)
    const q10ReturnPct=number(row.q10ReturnPct,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),q50ReturnPct=number(row.q50ReturnPct,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER),q90ReturnPct=number(row.q90ReturnPct,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)
    if(q10ReturnPct>q50ReturnPct||q50ReturnPct>q90ReturnPct) throw new AppError('VALIDATION','分位数必须递增')
    return {horizonMinutes,pUp,pFlat,pDown,expectedReturnPct,q10ReturnPct,q50ReturnPct,q90ReturnPct,confidence:number(row.confidence,0,1),actionable:boolean(row.actionable),reasons:strings(row.reasons)}
  }).sort((a,b)=>a.horizonMinutes-b.horizonMinutes)
  if(body.legacyCurve!==undefined && (!Array.isArray(body.legacyCurve)||body.legacyCurve.length>1000)) throw new AppError('VALIDATION','曲线数量无效')
  const times=new Set<string>()
  const legacyCurve=((body.legacyCurve ?? []) as unknown[]).map(value=>{
    const row=record(value), time=text(row.time,5)
    if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)||times.has(time)) throw new AppError('VALIDATION','曲线时刻无效或重复')
    times.add(time)
    const median=price(row.price)
    const lower=row.lower===undefined ? median : price(row.lower),upper=row.upper===undefined ? median : price(row.upper)
    if(lower>median||upper<median) throw new AppError('VALIDATION','曲线区间与价格矛盾')
    const leadMinutes=row.leadMinutes===undefined ? null : number(row.leadMinutes,0,2147483647)
    if(leadMinutes!==null&&!Number.isInteger(leadMinutes)) throw new AppError('VALIDATION','前瞻分钟须为整数')
    return {time,price:median,lower,upper,leadMinutes}
  }).sort((a,b)=>a.time.localeCompare(b.time))
  return {runId,stockCode:stockCode(body.stockCode),tradeDate:date(body.tradeDate),asOf:timestamp(body.asOf),mode,
    modelState,modelVersion,modelCalibrated:boolean(body.modelCalibrated),referencePrice:price(body.referencePrice),previousClose:price(body.previousClose),
    inputHash,features:normalizedFeatures,regime,newsEvents,warnings:strings(body.warnings),horizons,legacyCurve}
}
export type PredictionInput=ReturnType<typeof predictionSchema>
