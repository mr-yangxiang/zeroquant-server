import type { Queryable } from '../../shared/transaction.js'
import { AppError } from '../../shared/errors.js'
import type { ChatTradeRepository, ChatReceipt, ChatMessage, TradeReply } from './chat.types.js'
export class PgChatTradeRepository implements ChatTradeRepository {
  constructor(private readonly db: Queryable) {}
  async lockRequest(userId: string, requestId: string) {
    // 两参数锁命名空间与持仓的单参数锁隔离；固定顺序：请求锁 → 持仓锁。
    await this.db.query('SELECT pg_advisory_xact_lock(741001,hashtext($1))', [userId + '|' + requestId])
  }
  async receipt(userId: string, requestId: string): Promise<ChatReceipt | null> {
    const { rows } = await this.db.query<ChatReceipt>('SELECT request_hash AS "requestHash",response FROM chat_trade_requests WHERE user_id=$1 AND request_id=$2::uuid', [userId,requestId])
    return rows[0] ?? null
  }
  async stockName(code: string): Promise<string | null> {
    const { rows } = await this.db.query<{ name: string }>('SELECT name FROM stocks WHERE code=$1', [code])
    return rows[0]?.name ?? null
  }
  async append(userId: string, code: string, role: 'user' | 'assistant', content: string): Promise<ChatMessage> {
    const { rows } = await this.db.query<ChatMessage>(`INSERT INTO user_chat_messages(user_id,stock_code,role,content) VALUES($1,$2,$3,$4)
      RETURNING id,role,content,TO_CHAR(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS "createdAt"`, [userId,code,role,content])
    if (!rows[0]) throw new AppError('INTERNAL')
    return rows[0]
  }
  async saveReceipt(userId: string, requestId: string, code: string, hash: string, response: TradeReply) {
    await this.db.query('INSERT INTO chat_trade_requests(user_id,request_id,stock_code,request_hash,response) VALUES($1,$2::uuid,$3,$4,$5::jsonb)',
      [userId,requestId,code,hash,JSON.stringify(response)])
  }
}
