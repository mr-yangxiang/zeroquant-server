import type { Request, Response } from 'express'
import type { DailyBarsService } from './daily-bars.service.js'
export class DailyBarsController {
  constructor(private readonly service: DailyBarsService) {}
  ingest = async (req: Request, res: Response) => res.json({code:0,message:'daily bars persisted',data:await this.service.ingest(req.body as unknown)})
}
