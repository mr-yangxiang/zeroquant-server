import type { PoolClient } from 'pg'
import type { Migration } from './types.js'

export const migration005: Migration = {
  version: '005',
  name: 'evidence_based_entity_behavior_profiles',
  up: async (client: PoolClient) => {
    await client.query(`
      ALTER TABLE dragon_tiger_seats
        ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE news_stock_relations
        ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE stock_l2_orders
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      CREATE TABLE IF NOT EXISTS market_entities (
        entity_key VARCHAR(64) PRIMARY KEY,
        canonical_name VARCHAR(255) NOT NULL,
        normalized_name VARCHAR(255) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        first_seen_date DATE NOT NULL,
        last_seen_date DATE NOT NULL,
        source_count INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(normalized_name, entity_type)
      );

      CREATE TABLE IF NOT EXISTS entity_behavior_profiles (
        id BIGSERIAL PRIMARY KEY,
        entity_key VARCHAR(64) NOT NULL REFERENCES market_entities(entity_key) ON DELETE CASCADE,
        as_of_date DATE NOT NULL,
        as_of_at TIMESTAMPTZ NOT NULL,
        profile_version VARCHAR(50) NOT NULL,
        sample_count INTEGER NOT NULL,
        labeled_sample_count INTEGER NOT NULL,
        confidence DOUBLE PRECISION NOT NULL,
        evidence_grade VARCHAR(10) NOT NULL,
        status VARCHAR(30) NOT NULL,
        metrics JSONB NOT NULL,
        traits JSONB NOT NULL,
        evidence_summary JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK(sample_count >= 0 AND labeled_sample_count >= 0 AND labeled_sample_count <= sample_count),
        CHECK(confidence >= 0 AND confidence <= 1),
        CHECK(status IN ('INSUFFICIENT', 'RESEARCH_READY')),
        UNIQUE(entity_key, as_of_at, profile_version)
      );
      CREATE INDEX IF NOT EXISTS idx_entity_profiles_latest
        ON entity_behavior_profiles(entity_key, as_of_at DESC);

      CREATE TABLE IF NOT EXISTS stock_entity_profile_links (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        entity_key VARCHAR(64) NOT NULL REFERENCES market_entities(entity_key) ON DELETE CASCADE,
        as_of_date DATE NOT NULL,
        as_of_at TIMESTAMPTZ NOT NULL,
        profile_version VARCHAR(50) NOT NULL,
        last_event_date DATE NOT NULL,
        last_side VARCHAR(10) NOT NULL,
        appearance_count INTEGER NOT NULL,
        weighted_signal DOUBLE PRECISION NOT NULL,
        confidence DOUBLE PRECISION NOT NULL,
        evidence JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK(last_side IN ('BUY', 'SELL')),
        CHECK(appearance_count >= 1),
        CHECK(weighted_signal >= -1 AND weighted_signal <= 1),
        CHECK(confidence >= 0 AND confidence <= 1),
        UNIQUE(stock_code, entity_key, as_of_at, profile_version)
      );
      CREATE INDEX IF NOT EXISTS idx_stock_entity_profiles_latest
        ON stock_entity_profile_links(stock_code, as_of_at DESC, confidence DESC);

      CREATE TABLE IF NOT EXISTS entity_profile_refresh_runs (
        id BIGSERIAL PRIMARY KEY,
        run_at TIMESTAMPTZ NOT NULL,
        as_of_date DATE NOT NULL,
        profile_version VARCHAR(50) NOT NULL,
        entity_count INTEGER NOT NULL,
        evidence_count INTEGER NOT NULL,
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)
  },
  down: async (client: PoolClient) => {
    await client.query(`
      DROP TABLE IF EXISTS entity_profile_refresh_runs CASCADE;
      DROP TABLE IF EXISTS stock_entity_profile_links CASCADE;
      DROP TABLE IF EXISTS entity_behavior_profiles CASCADE;
      DROP TABLE IF EXISTS market_entities CASCADE;
      ALTER TABLE stock_l2_orders DROP COLUMN IF EXISTS created_at;
      ALTER TABLE news_stock_relations DROP COLUMN IF EXISTS ingested_at;
      ALTER TABLE dragon_tiger_seats DROP COLUMN IF EXISTS ingested_at;
    `)
  },
}
