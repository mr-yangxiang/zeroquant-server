/** 添加可撤销会话、刷新令牌历史及共享限流；不修改现有用户身份或密码。 */
import type { Migration } from './types.js'
export const migration009: Migration = {
  version: '009', name: 'auth_sessions_refresh_rotation_rate_limits',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id UUID PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id,created_at);
      CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
        token_hash VARCHAR(64) PRIMARY KEY, session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), used_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_auth_refresh_session ON auth_refresh_tokens(session_id);
      CREATE TABLE IF NOT EXISTS auth_rate_limits (
        bucket_key VARCHAR(64) PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_rate_expiry ON auth_rate_limits(expires_at);
    `)
  },
  async down() { throw new Error('009 包含认证撤销证据，不自动删除；请使用向前修复迁移') },
}
