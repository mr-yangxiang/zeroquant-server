import type { Request, Response } from 'express'
import type { EvidenceService } from './evidence.service.js'
export class EvidenceController {
  constructor(private readonly service:EvidenceService) {}
  dragonTiger=async(req:Request,res:Response)=>res.json({code:0,data:await this.service.dragonTiger(req.body as unknown)})
  news=async(req:Request,res:Response)=>res.json({code:0,data:await this.service.news(req.body as unknown)})
}
