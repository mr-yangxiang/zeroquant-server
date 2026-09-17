import { predictionQuery } from './prediction-query.schema.js'
import type { PredictionReader, PredictionSnapshot } from './prediction-reader.repository.js'
export interface PredictionPresentation {productionApproved:boolean;signalExpiresAt:string|null;modelStateLabel:string;modelStateExplanation:string}
export class PredictionQueryService {
  constructor(private readonly reader:PredictionReader,private readonly present:(run:PredictionSnapshot)=>Promise<PredictionPresentation>) {}
  async latest(code:unknown,query:unknown) {
    const input=predictionQuery(code,query)
    const run=await this.reader.latest(input.stockCode,input.asOfDate)
    if(!run) return null
    const presentation=await this.present(run)
    return {...run,...presentation,horizons:run.horizons.map(item=>({...item,actionable:presentation.productionApproved && item.actionable===true}))}
  }
}
