/** PostgreSQL 工作单元：服务决定原子边界，仓储借用同一客户端，不自行提交。 */
import type { Pool, PoolClient } from 'pg'
import { logError } from './logger.js'
export type Queryable = Pick<PoolClient, 'query'>
export interface UnitOfWork {
  run<T>(operation: (client: Queryable) => Promise<T>): Promise<T>
}
export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}
  async run<T>(operation: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(client)
      await client.query('COMMIT')
      return result
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(rollback => logError('transaction.rollback.failed', rollback))
      throw error
    } finally { client.release() }
  }
}
