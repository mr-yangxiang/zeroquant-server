import type { Request,Response } from 'express'
import type { PredictionQueryService } from './prediction-query.service.js'
export class PredictionQueryController {
  constructor(private readonly service:PredictionQueryService) {}
  latest=async(req:Request,res:Response)=>{
    const data=await this.service.latest(req.params.code,req.query)
    res.setHeader('Cache-Control','no-store, max-age=0')
    res.json({code:0,message:data?'ok':'forecast not found',data})
  }
}
