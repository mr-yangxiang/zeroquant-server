import type { Request, Response } from 'express'
export function readiness(check: () => Promise<unknown>) {
  return async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store')
    try { await check(); res.json({ status: 'ready' }) }
    catch { res.status(503).json({ status: 'unavailable' }) }
  }
}
