/** PostgreSQL 共享限流：多进程共用原子计数；不保存明文 IP、手机号。故障时禁止放行。 */
import { createHmac } from 'node:crypto'
import type { Queryable } from '../../shared/transaction.js'
import { AppError } from '../../shared/errors.js'
export class AuthRateLimiter {
  constructor(private readonly db: Queryable, private readonly secret: string) {}
  async consume(identity: string, limit: number) {
    const key = createHmac('sha256', this.secret).update(identity).digest('hex')
    // 固定身份行跨窗口复用，窗口 15 分钟；按小批清理长期无人访问的旧桶。
    await this.db.query('DELETE FROM auth_rate_limits WHERE bucket_key IN (SELECT bucket_key FROM auth_rate_limits WHERE expires_at<NOW()-INTERVAL \'1 day\' LIMIT 100)')
    const { rows } = await this.db.query<{ attempts: number }>(
      `INSERT INTO auth_rate_limits(bucket_key,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '15 minutes')
       ON CONFLICT(bucket_key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.expires_at<=NOW() THEN 1 ELSE LEAST(auth_rate_limits.attempts+1,1000000) END,
       expires_at=CASE WHEN auth_rate_limits.expires_at<=NOW() THEN NOW()+INTERVAL '15 minutes' ELSE auth_rate_limits.expires_at END
       RETURNING attempts`, [key])
    if (!rows[0] || rows[0].attempts > limit) throw new AppError('RATE_LIMITED')
  }
}
