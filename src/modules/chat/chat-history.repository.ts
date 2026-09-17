import type { Queryable } from '../../shared/transaction.js'
import type { ChatMessage } from './chat.types.js'
export class ChatHistoryRepository {
  constructor(private readonly db: Queryable) {}
  async page(userId: string, code: string, before: number | undefined, limit: number) {
    const { rows } = await this.db.query<ChatMessage>(`SELECT id,role,content,
      TO_CHAR(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS "createdAt"
      FROM user_chat_messages WHERE user_id=$1 AND stock_code=$2 AND ($3::bigint IS NULL OR id<$3)
      ORDER BY id DESC LIMIT $4`, [userId,code,before ?? null,limit + 1])
    return rows
  }
  async clear(userId: string, code: string) {
    await this.db.query('DELETE FROM user_chat_messages WHERE user_id=$1 AND stock_code=$2',[userId,code])
  }
}
