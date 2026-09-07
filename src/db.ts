import pg from 'pg'
import dotenv from 'dotenv'

// 系统环境变量优先于仓库旁的 .env，便于测试库隔离和容器安全注入。
dotenv.config()

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/zeroquant_db',
})

if (!process.env.DATABASE_URL) {
  console.warn('[Database] DATABASE_URL is not set; using the local development database only.')
}

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err)
})
