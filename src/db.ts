import { logError } from './shared/logger.js'
import { loadDatabaseConfig } from './config/database.config.js'
import pg from 'pg'
import dotenv from 'dotenv'

// 系统环境变量优先于仓库旁的 .env，便于测试库隔离和容器安全注入。
dotenv.config()

const { Pool } = pg

export const pool = new Pool(loadDatabaseConfig())

if (!process.env.DATABASE_URL) {
  console.warn('[Database] DATABASE_URL is not set; using the local development database only.')
}

pool.on('error', (err) => {
  logError('Unexpected error on idle PostgreSQL client', err)
})
