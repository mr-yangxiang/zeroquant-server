import type { Request,Response } from 'express'
import type { MarketSyncService } from './market-sync.service.js'
export class MarketSyncController {
  constructor(private readonly service:MarketSyncService) {}
  ingest=async(req:Request,res:Response)=>res.json({code:0,message:'数据点同步成功',data:await this.service.ingest(req.body as unknown)})
}
