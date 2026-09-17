/** 数据库连接配置；生产禁止隐式回退到本机库，连接与查询等待均设置上限。 */
import type { PoolConfig } from 'pg'
export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL) throw new Error('生产环境必须显式设置 DATABASE_URL')
  const max = Number(env.ZEROQUANT_DB_POOL_MAX ?? 10)
  if (!Number.isInteger(max) || max < 1 || max > 50) throw new Error('ZEROQUANT_DB_POOL_MAX 须为 1～50')
  return { connectionString: env.DATABASE_URL ?? 'postgresql://localhost:5432/zeroquant_db',
    max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 30000, lock_timeout: 5000, application_name: 'zeroquant_node_api' }
}
