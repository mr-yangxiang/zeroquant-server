/** 成交请求回执独立于可清空的聊天记录；不能因清空对话或撤销成交删除幂等证据。 */
import type { Migration } from './types.js'
export const migration010: Migration = {
  version: '010', name: 'atomic_chat_trade_receipts',
  async up(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS chat_trade_requests (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id UUID NOT NULL, stock_code VARCHAR(20) NOT NULL,
      request_hash VARCHAR(64) NOT NULL, response JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,request_id)
    )`)
  },
  async down() { throw new Error('010 含成交幂等证据，不自动删除；请使用向前修复迁移') },
}
