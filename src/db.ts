import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://truecost:yang.19960525@truecost-postgres:5432/zeroquant_db',
})

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err)
})
