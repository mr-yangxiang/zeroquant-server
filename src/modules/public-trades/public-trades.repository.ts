/** 相同股票/交易日的替换操作串行化；全部锁按固定顺序取得，避免批次反向死锁。 */
import type { UnitOfWork } from '../../shared/transaction.js'
import type { PublicTrade } from './public-trades.schema.js'
import type { PublicTradesWriter } from './public-trades.service.js'
export class PublicTradesRepository implements PublicTradesWriter {
  constructor(private readonly work: UnitOfWork) {}
  async replace(records: PublicTrade[]) {
    const keys = [...new Set(records.map(row => row.stockCode + '|' + row.tradeDate))].sort()
    await this.work.run(async db => {
      for (const key of keys) await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['public-trades|' + key])
      for (const key of keys) {
        const [code, date] = key.split('|')
        await db.query('DELETE FROM stock_l2_orders WHERE stock_code=$1 AND trade_date=$2::date', [code, date])
      }
      for (const row of records) await db.query(
        'INSERT INTO stock_l2_orders(stock_code,trade_date,time_str,type,price,volume_lots,note) VALUES($1,$2::date,$3,$4,$5,$6,$7)',
        [row.stockCode,row.tradeDate,row.timeStr,row.type,row.price,row.volumeLots,row.note])
    })
  }
}
