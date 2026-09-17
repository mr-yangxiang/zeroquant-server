import { date } from '../profile-evidence/evidence.schema.js'
import { record, stockCode } from '../portfolio/portfolio.schema.js'
export function predictionQuery(code:unknown,query:unknown) {
  const input=record(query)
  return {stockCode:stockCode(code),asOfDate:input.asOf===undefined?null:date(input.asOf)}
}
