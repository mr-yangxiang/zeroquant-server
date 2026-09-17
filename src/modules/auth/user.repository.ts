/** 用户及认证会话仓储：SQL、实体映射和 PostgreSQL 冲突转换集中在此。 */
import type { Queryable } from '../../shared/transaction.js'
import { AppError, errorCode } from '../../shared/errors.js'
import type { AuthRepository, User, CredentialUser, Session, RefreshRecord } from './auth.types.js'
const userFields = 'id, phone, username, avatar'
export class UserRepository implements AuthRepository {
  constructor(private readonly db: Queryable) {}
  async findUser(phone: string): Promise<CredentialUser | null> {
    const { rows } = await this.db.query<CredentialUser>('SELECT ' + userFields + ', password FROM users WHERE phone = $1', [phone])
    return rows[0] ?? null
  }
  async getUser(id: string): Promise<User | null> {
    const { rows } = await this.db.query<User>('SELECT ' + userFields + ' FROM users WHERE id = $1', [id])
    return rows[0] ?? null
  }
  async createUser(phone: string, username: string, hash: string): Promise<User> {
    try {
      // 以数据库唯一索引裁决并发；不执行先 SELECT 再 INSERT。
      const { rows } = await this.db.query<User>(
        'INSERT INTO users(phone, username, password) VALUES ($1,$2,$3) ON CONFLICT(phone) DO NOTHING RETURNING ' + userFields,
        [phone, username, hash])
      if (!rows[0]) throw new AppError('REGISTRATION_CONFLICT')
      return rows[0]
    } catch (error: unknown) {
      // 只转换已知手机号约束，其他完整性异常不能误报为手机号冲突。
      if (errorCode(error) === '23505' && typeof error === 'object' && error !== null
        && 'constraint' in error && error.constraint === 'users_phone_key') throw new AppError('REGISTRATION_CONFLICT')
      throw error
    }
  }
  async createSession(id: string, userId: string, expiresAt: Date): Promise<void> {
    await this.db.query('INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [id, userId, expiresAt])
  }
  async getSession(id: string, lock = false): Promise<Session | null> {
    const { rows } = await this.db.query<Session>(
      'SELECT id,user_id AS "userId",created_at AS "createdAt",expires_at AS "expiresAt",revoked_at AS "revokedAt" FROM auth_sessions WHERE id=$1' + (lock ? ' FOR UPDATE' : ''), [id])
    return rows[0] ?? null
  }
  async findRefresh(hash: string): Promise<RefreshRecord | null> {
    const { rows } = await this.db.query<RefreshRecord>('SELECT token_hash AS "tokenHash",session_id AS "sessionId",used_at AS "usedAt" FROM auth_refresh_tokens WHERE token_hash=$1', [hash])
    return rows[0] ?? null
  }
  async insertRefresh(hash: string, sessionId: string): Promise<void> {
    await this.db.query('INSERT INTO auth_refresh_tokens(token_hash,session_id) VALUES($1,$2)', [hash, sessionId])
  }
  async consumeRefresh(hash: string): Promise<void> {
    await this.db.query('UPDATE auth_refresh_tokens SET used_at=NOW() WHERE token_hash=$1', [hash])
  }
  async revokeSession(id: string, userId: string): Promise<void> {
    await this.db.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()) WHERE id=$1 AND user_id=$2', [id,userId])
  }
  async listSessions(userId: string): Promise<Session[]> {
    const { rows } = await this.db.query<Session>('SELECT id,user_id AS "userId",created_at AS "createdAt",expires_at AS "expiresAt",revoked_at AS "revokedAt" FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY created_at DESC LIMIT 100', [userId])
    return rows
  }
}
