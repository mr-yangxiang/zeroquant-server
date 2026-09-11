import type { Migration } from './types.js'

export const migration006: Migration = {
  version: '006', name: 'research_pipeline_evidence',
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS research_raw_records (
        record_hash VARCHAR(64) PRIMARY KEY,
        kind VARCHAR(30) NOT NULL,
        stock_code VARCHAR(20) NOT NULL,
        source VARCHAR(100) NOT NULL,
        event_at TIMESTAMPTZ NOT NULL,
        available_at TIMESTAMPTZ NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        pit_certified BOOLEAN NOT NULL DEFAULT FALSE,
        payload JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_raw_lookup ON research_raw_records(kind, stock_code, event_at);
      CREATE TABLE IF NOT EXISTS research_datasets (
        dataset_id VARCHAR(100) PRIMARY KEY,
        feature_version VARCHAR(50) NOT NULL,
        horizon_minutes INTEGER NOT NULL,
        row_count INTEGER NOT NULL,
        content_hash VARCHAR(64) NOT NULL,
        manifest JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS research_runs (
        run_id UUID PRIMARY KEY,
        dataset_id VARCHAR(100) REFERENCES research_datasets(dataset_id),
        status VARCHAR(30) NOT NULL,
        report JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS research_shadow_state (
        model_id VARCHAR(100) PRIMARY KEY REFERENCES model_artifacts(model_id),
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS model_promotions (
        model_id VARCHAR(100) PRIMARY KEY REFERENCES model_artifacts(model_id),
        evidence JSONB NOT NULL,
        approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );
    `)
  },
  async down() {
    throw new Error('研究证据表不支持自动删除；请备份并使用单独审核的迁移。')
  },
}
