import { createHash } from 'node:crypto'
import { AppError } from '../../shared/errors.js'
import { record, stockCode } from '../portfolio/portfolio.schema.js'
import { marketDate } from '../market/market.service.js'
export function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new AppError('VALIDATION', '文本字段格式或长度无效')
  return value.trim()
}
export function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value))) throw new AppError('VALIDATION', '数值格式无效')
  const result=Number(value)
  if (!Number.isFinite(result) || result<min || result>max) throw new AppError('VALIDATION', '数值超出范围')
  return result
}
export function date(value: unknown): string {
  if(typeof value!=='string' || value.startsWith('0000-')) throw new AppError('VALIDATION', '日期无效')
  return marketDate(value)
}
export function timestamp(value: unknown): string {
  const raw=text(value,40)
  if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(raw)) throw new AppError('VALIDATION', '时间须包含有效时刻和时区')
  date(raw.slice(0,10))
  const parsed=new Date(raw)
  if(!Number.isFinite(parsed.getTime())) throw new AppError('VALIDATION', '时间无效')
  return parsed.toISOString()
}
function batch(input:unknown,max:number): unknown[] {
  const body=record(input)
  if(!Array.isArray(body.records)||!body.records.length||body.records.length>max) throw new AppError('VALIDATION','批次数量无效')
  return body.records
}
function choice(value:unknown,allowed:string[]):string {
  const result=text(value,30)
  if(!allowed.includes(result)) throw new AppError('VALIDATION','枚举字段无效')
  return result
}
export function dragonTigerSchema(input:unknown) {
  const keys=new Set<string>()
  return batch(input,1000).map(value=>{
    const row=record(value), code=stockCode(row.stockCode), tradeDate=date(row.tradeDate)
    const side=choice(typeof row.side==='string' ? row.side.toUpperCase() : row.side,['BUY','SELL'])
    const rank=number(row.rank,1,100)
    if(!Number.isInteger(rank)) throw new AppError('VALIDATION','排名须为整数')
    const key=[code,tradeDate,side,rank].join('|')
    if(keys.has(key)) throw new AppError('VALIDATION','同批席位排名重复')
    keys.add(key)
    const buyAmount=number(row.buyAmount===undefined ? 0 : row.buyAmount,0,Number.MAX_SAFE_INTEGER)
    const sellAmount=number(row.sellAmount===undefined ? 0 : row.sellAmount,0,Number.MAX_SAFE_INTEGER)
    const netAmount=number(row.netAmount===undefined ? buyAmount-sellAmount : row.netAmount,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER)
    const disclosedAt=timestamp(row.disclosedAt)
    if(Date.parse(disclosedAt)<Date.parse(tradeDate+'T00:00:00+08:00')) throw new AppError('VALIDATION','披露时间早于交易日')
    return {stockCode:code,tradeDate,side,rank,buyAmount,sellAmount,netAmount,disclosedAt,
      seatName:text(row.seatName,255),source:text(row.source,100),seatType:row.seatType===undefined||row.seatType===null ? null : text(row.seatType,50,true)||null}
  })
}
export function newsSchema(input:unknown) {
  const keys=new Set<string>()
  return batch(input,500).map(value=>{
    const row=record(value),title=text(row.title,500),source=text(row.source,100),publishedAt=timestamp(row.publishedAt)
    const content=row.content===undefined ? '' : text(row.content,50000,true)
    const url=row.url===undefined||row.url===null ? null : text(row.url,1000,true)||null
    if(url) { let parsed:URL;try {parsed=new URL(url)} catch {throw new AppError('VALIDATION','新闻URL无效')}
      if(!['https:','http:'].includes(parsed.protocol)) throw new AppError('VALIDATION','新闻URL须为HTTP或HTTPS') }
    if(!Array.isArray(row.stocks)||!row.stocks.length||row.stocks.length>1000) throw new AppError('VALIDATION','关联股票数量无效')
    const stocks=[...new Set(row.stocks.map(stockCode))].sort()
    const fingerprint=row.fingerprint===undefined||row.fingerprint==='' ? createHash('sha256').update(`${source}|${publishedAt}|${title}|${url||''}`).digest('hex') : text(row.fingerprint,64).toLowerCase()
    if(!/^[0-9a-f]{64}$/.test(fingerprint)||keys.has(fingerprint)) throw new AppError('VALIDATION','新闻指纹无效或同批重复')
    keys.add(fingerprint)
    return {title,content,source,publishedAt,url,stocks,fingerprint,
      sentimentScore:row.sentimentScore===undefined||row.sentimentScore===null ? null : number(row.sentimentScore,-1,1),
      sentimentLabel:row.sentimentLabel===undefined||row.sentimentLabel===null ? null : choice(row.sentimentLabel,['BULLISH','BEARISH','NEUTRAL']),
      trustLevel:choice(row.trustLevel===undefined?'NORMAL':row.trustLevel,['LOW','NORMAL','HIGH']),
      relevanceScore:number(row.relevanceScore===undefined?1:row.relevanceScore,0,1),
      impactLevel:choice(row.impactLevel===undefined?'MEDIUM':row.impactLevel,['LOW','MEDIUM','HIGH'])}
  })
}
export type DragonTiger = ReturnType<typeof dragonTigerSchema>[number]
export type NewsEvidence = ReturnType<typeof newsSchema>[number]
