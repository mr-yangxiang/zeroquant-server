import { predictionSchema, type PredictionInput } from './prediction.schema.js'
import { predictionHash, replayPrediction, type PredictionReply, type PredictionReceipt } from './prediction-receipt.js'
export interface PredictionWriter {
  receipt(runId:string):Promise<PredictionReceipt|null>
  persist(input:PredictionInput,approved:boolean,hash:string):Promise<PredictionReply>
}
export class PredictionService {
  constructor(private readonly repository:PredictionWriter,private readonly approve:(input:PredictionInput)=>Promise<boolean>) {}
  async ingest(value:unknown) {
    const input=predictionSchema(value),hash=predictionHash(input)
    const cached=replayPrediction(await this.repository.receipt(input.runId),hash)
    if(cached) return cached
    const approved=await this.approve(input)
    return this.repository.persist(input,approved,hash)
  }
}
