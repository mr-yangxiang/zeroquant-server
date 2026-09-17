/** 同批全部提交或回滚；按自然键顺序 upsert，避免相反顺序获取行锁。 */
import type { UnitOfWork } from '../../shared/transaction.js'
import type { DailyBar } from './daily-bars.schema.js'
import type { DailyBarsWriter } from './daily-bars.service.js'
export class DailyBarsRepository implements DailyBarsWriter {
  constructor(private readonly work: UnitOfWork) {}
  async upsert(rows: DailyBar[]) {
    const ordered = [...rows].sort((a,b) => (a.stockCode+'|'+a.tradeDate).localeCompare(b.stockCode+'|'+b.tradeDate))
    await this.work.run(async db => {
      for (const row of ordered) await db.query(`INSERT INTO daily_bars
        (stock_code,trade_date,open,high,low,close,volume,amount,prev_close,source)
        VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(stock_code,trade_date) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,
        close=EXCLUDED.close,volume=EXCLUDED.volume,amount=EXCLUDED.amount,prev_close=EXCLUDED.prev_close,
        source=EXCLUDED.source,ingested_at=NOW()`,
        [row.stockCode,row.tradeDate,row.open,row.high,row.low,row.close,row.volume,row.amount,row.prevClose,row.source])
    })
  }
}
