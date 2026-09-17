import type { Request, Response } from 'express'
import type { PredictionService } from './prediction.service.js'
export class PredictionController {
  constructor(private readonly service:PredictionService) {}
  ingest=async(req:Request,res:Response)=>res.json({code:0,message:'forecast run persisted',data:await this.service.ingest(req.body as unknown)})
}
