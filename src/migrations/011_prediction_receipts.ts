/** 不伪造旧运行的请求摘要；只有新接口完整事务可创建回执。 */
import type { Migration } from './types.js'
export const migration011: Migration = {
  version:'011',name:'prediction_ingestion_receipts',
  async up(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS prediction_ingestion_receipts (
      run_id UUID PRIMARY KEY REFERENCES quant_prediction_runs(run_id) ON DELETE RESTRICT,
      request_hash VARCHAR(64) NOT NULL, response JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  },
  async down() {throw new Error('011含预测幂等证据，请使用向前修复迁移')},
}
