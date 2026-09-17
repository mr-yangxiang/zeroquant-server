import { createHash } from 'node:crypto'
import { AppError } from '../../shared/errors.js'
export interface PredictionReply {runId:string;baselineApplied:boolean}
export interface PredictionReceipt {requestHash:string;response:PredictionReply}
/** 键排序消除JSON对象属性顺序差异；数组顺序由各DTO决定是否有意义。 */
function canonical(value:unknown,depth=0):string {
  if(depth>50) throw new AppError('VALIDATION','预测正文嵌套过深')
  if(value===null||typeof value==='string'||typeof value==='boolean') return JSON.stringify(value)
  if(typeof value==='number'&&Number.isFinite(value)) return JSON.stringify(value)
  if(Array.isArray(value)) return '['+value.map(item=>canonical(item,depth+1)).join(',')+']'
  if(typeof value==='object'&&value!==null && (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null)) {
    const item=value as Record<string,unknown>
    return '{'+Object.keys(item).sort().map(key=>JSON.stringify(key)+':'+canonical(item[key],depth+1)).join(',')+'}'
  }
  throw new AppError('VALIDATION','预测正文须为有效JSON值')
}
export function predictionHash(value:unknown):string {return createHash('sha256').update('prediction-v1:'+canonical(value)).digest('hex')}
export function replayPrediction(receipt:PredictionReceipt|null,hash:string):PredictionReply|null {
  if(!receipt) return null
  if(receipt.requestHash!==hash) throw new AppError('CONFLICT','运行编号已用于不同预测内容')
  return receipt.response
}
