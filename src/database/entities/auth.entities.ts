/** 认证持久化实体目录；令牌仅保存 SHA-256 摘要，刷新历史用于检测重放。 */
import { column, timestamptz, varchar, type TableEntity } from './types.js'
export const authEntities: TableEntity[] = [
  { name: 'auth_sessions', description: '可撤销登录会话；每次登录独立一个会话', primaryKey: ['id'],
    columns: { id: column('uuid', false), user_id: column('text', false), created_at: timestamptz(false, 'now'), expires_at: timestamptz(false), revoked_at: timestamptz(true) },
    foreignKeys: [{ columns: ['user_id'], referencesTable: 'users', referencesColumns: ['id'], onDelete: 'CASCADE' }],
    indexes: [{ name: 'idx_auth_sessions_user', columns: ['user_id', 'created_at'] }] },
  { name: 'auth_refresh_tokens', description: '刷新令牌摘要与使用历史；重放触发会话撤销', primaryKey: ['token_hash'],
    columns: { token_hash: varchar(64), session_id: column('uuid', false), created_at: timestamptz(false, 'now'), used_at: timestamptz(true) },
    foreignKeys: [{ columns: ['session_id'], referencesTable: 'auth_sessions', referencesColumns: ['id'], onDelete: 'CASCADE' }],
    indexes: [{ name: 'idx_auth_refresh_session', columns: ['session_id'] }] },
  { name: 'auth_rate_limits', description: '跨实例共享认证速率桶；身份经 HMAC 处理', primaryKey: ['bucket_key'],
    columns: { bucket_key: varchar(64), attempts: column('integer', false), expires_at: timestamptz(false) },
    indexes: [{ name: 'idx_auth_rate_expiry', columns: ['expires_at'] }] },
]
