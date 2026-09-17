import type { Request, Response } from 'express'
import type { PublicTradesService } from './public-trades.service.js'
export class PublicTradesController {
  constructor(private readonly service: PublicTradesService) {}
  replace = async (req: Request, res: Response) => res.json({ code: 0, message: 'public trades persisted', data: await this.service.replace(req.body as unknown) })
}
