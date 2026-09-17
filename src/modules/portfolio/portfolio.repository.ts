/** 持仓 SQL 仓储：每次写入统一先锁 userId/stockCode，再锁明细，避免锁序倒置。 */
import type { Queryable } from '../../shared/transaction.js'
import { AppError } from '../../shared/errors.js'
import type { PortfolioRepository, Position, Trade } from './portfolio.types.js'
const tradeFields = `id,stock_code AS "stockCode",action_type AS "actionType",trade_price AS "tradePrice",
 trade_shares AS "tradeShares",TO_CHAR(trade_time AT TIME ZONE 'Asia/Shanghai','HH24:MI:SS') AS "tradeTime",
 previous_holding_shares AS "previousShares",previous_cost_price AS "previousCost",
 resulting_holding_shares AS "resultingShares",resulting_cost_price AS "resultingCost"`
export class PgPortfolioRepository implements PortfolioRepository {
  constructor(private readonly db: Queryable) {}
  async lockStock(userId: string, stockCode: string) {
    await this.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId + '|' + stockCode])
  }
  async position(userId: string, stockCode: string): Promise<Position> {
    const { rows } = await this.db.query<Position>('SELECT holding_shares AS "holdingShares",cost_price AS "costPrice" FROM user_positions WHERE user_id=$1 AND stock_code=$2 FOR UPDATE', [userId, stockCode])
    return rows[0] ?? { holdingShares: 0, costPrice: 0 }
  }
  async save(userId: string, stockCode: string, position: Position) {
    await this.db.query(`INSERT INTO user_positions(user_id,stock_code,holding_shares,cost_price) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,stock_code) DO UPDATE SET holding_shares=EXCLUDED.holding_shares,cost_price=EXCLUDED.cost_price,updated_at=NOW()`,
      [userId, stockCode, position.holdingShares, position.costPrice])
  }
  async insert(userId: string, stockCode: string, action: 'BUY' | 'SELL', price: number, shares: number, before: Position, after: Position): Promise<Trade> {
    const { rows } = await this.db.query<Trade>(`INSERT INTO user_trade_actions(user_id,stock_code,action_type,trade_price,trade_shares,trade_time,
      previous_holding_shares,previous_cost_price,resulting_holding_shares,resulting_cost_price)
      VALUES($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9) RETURNING ` + tradeFields,
      [userId,stockCode,action,price,shares,before.holdingShares,before.costPrice,after.holdingShares,after.costPrice])
    if (!rows[0]) throw new AppError('INTERNAL')
    return rows[0]
  }
  async findTrade(userId: string, id: number, lock = false): Promise<Trade | null> {
    const { rows } = await this.db.query<Trade>('SELECT ' + tradeFields + ' FROM user_trade_actions WHERE id=$1 AND user_id=$2' + (lock ? ' FOR UPDATE' : ''), [id,userId])
    return rows[0] ?? null
  }
  async latestId(userId: string, stockCode: string) {
    // 同一持仓的 INSERT 被 advisory lock 串行化；事务 NOW() 不一定反映实际锁后写入顺序。
    const { rows } = await this.db.query<{ id: number }>('SELECT id FROM user_trade_actions WHERE user_id=$1 AND stock_code=$2 ORDER BY id DESC LIMIT 1', [userId,stockCode])
    return rows[0]?.id ?? null
  }
  async remove(userId: string, id: number) { await this.db.query('DELETE FROM user_trade_actions WHERE id=$1 AND user_id=$2', [id,userId]) }
}
