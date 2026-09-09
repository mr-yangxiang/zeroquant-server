import { bigserialId, column, timestamptz, varchar, type TableEntity } from './types.js'

export const profileEntities: TableEntity[] = [
  {
    name: 'market_entities', description: '标准化机构与活跃席位身份', primaryKey: ['entity_key'], unique: [['normalized_name', 'entity_type']],
    columns: {
      entity_key: varchar(64), canonical_name: varchar(255), normalized_name: varchar(255), entity_type: varchar(50),
      first_seen_date: column('date', false), last_seen_date: column('date', false), source_count: column('integer', false, { default: 1 }),
      created_at: timestamptz(false, 'now'), updated_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'entity_behavior_profiles', description: '按精确时间追加的席位行为画像', primaryKey: ['id'], unique: [['entity_key', 'as_of_at', 'profile_version']],
    foreignKeys: [{ columns: ['entity_key'], referencesTable: 'market_entities', referencesColumns: ['entity_key'], onDelete: 'CASCADE' }],
    indexes: [{ name: 'idx_entity_profiles_latest', columns: ['entity_key', 'as_of_at'] }],
    columns: {
      id: bigserialId(), entity_key: varchar(64), as_of_date: column('date', false), as_of_at: timestamptz(false), profile_version: varchar(50),
      sample_count: column('integer', false), labeled_sample_count: column('integer', false), confidence: column('double precision', false),
      evidence_grade: varchar(10), status: varchar(30), metrics: column('jsonb', false), traits: column('jsonb', false),
      evidence_summary: column('jsonb', false), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'stock_entity_profile_links', description: '股票与席位画像的时间点关联信号', primaryKey: ['id'],
    unique: [['stock_code', 'entity_key', 'as_of_at', 'profile_version']],
    foreignKeys: [{ columns: ['entity_key'], referencesTable: 'market_entities', referencesColumns: ['entity_key'], onDelete: 'CASCADE' }],
    indexes: [{ name: 'idx_stock_entity_profiles_latest', columns: ['stock_code', 'as_of_at', 'confidence'] }],
    columns: {
      id: bigserialId(), stock_code: varchar(20), entity_key: varchar(64), as_of_date: column('date', false), as_of_at: timestamptz(false),
      profile_version: varchar(50), last_event_date: column('date', false), last_side: varchar(10), appearance_count: column('integer', false),
      weighted_signal: column('double precision', false), confidence: column('double precision', false), evidence: column('jsonb', false),
      created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'entity_profile_refresh_runs', description: '每次画像刷新审计', primaryKey: ['id'],
    columns: {
      id: bigserialId(), run_at: timestamptz(false), as_of_date: column('date', false), profile_version: varchar(50),
      entity_count: column('integer', false), evidence_count: column('integer', false), warnings: column('jsonb', false, { default: '[]' }),
      created_at: timestamptz(false, 'now'),
    },
  },
]
