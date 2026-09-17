import type { Migration } from './types.js'
export const migration012: Migration = {
  version: '012', name: 'market_sync_receipts_and_watermarks',
  async up(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS market_sync_receipts (
      stock_code VARCHAR(10) NOT NULL REFERENCES stocks(code) ON DELETE RESTRICT,
      observed_at TIMESTAMPTZ NOT NULL, request_hash VARCHAR(64) NOT NULL,
      response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(stock_code, observed_at)
    )`)
    await client.query(`CREATE TABLE IF NOT EXISTS market_sync_watermarks (
      stock_code VARCHAR(10) PRIMARY KEY REFERENCES stocks(code) ON DELETE RESTRICT,
      observed_at TIMESTAMPTZ NOT NULL
    )`)
    // Preserve ordering even if historical observations are later archived.
    await client.query(`INSERT INTO market_sync_watermarks(stock_code,observed_at)
      SELECT h.stock_code,MAX(h.timestamp) FROM stock_price_histories h JOIN stocks s ON s.code=h.stock_code
      WHERE h.timestamp IS NOT NULL GROUP BY h.stock_code
      ON CONFLICT(stock_code) DO UPDATE SET observed_at=GREATEST(market_sync_watermarks.observed_at,EXCLUDED.observed_at)`)
  },
  async down() { throw new Error('012包含行情回执与水位证据，请使用向前修复迁移') },
}
