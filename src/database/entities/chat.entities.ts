import { column, timestamptz, varchar, type TableEntity } from './types.js'
export const chatEntities: TableEntity[] = [{
  name: 'chat_trade_requests', description: '聊天成交幂等回执，清空聊天与撤销成交不得清除', primaryKey: ['user_id','request_id'],
  columns: { user_id: column('text',false), request_id: column('uuid',false), stock_code: varchar(20),
    request_hash: varchar(64), response: column('jsonb',false), created_at: timestamptz(false,'now') },
  foreignKeys: [{ columns: ['user_id'], referencesTable: 'users', referencesColumns: ['id'], onDelete: 'CASCADE' }],
}]
