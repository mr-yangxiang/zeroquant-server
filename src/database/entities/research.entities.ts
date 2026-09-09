import { bigserialId, column, timestamptz, varchar, type TableEntity } from './types.js'

export const researchEntities: TableEntity[] = [
  {
    name: 'data_quality_incidents', description: '数据质量和未来函数事件', primaryKey: ['id'],
    columns: {
      id: bigserialId(), incident_time: timestamptz(false, 'now'), stock_code: varchar(20, true), incident_type: varchar(80),
      severity: varchar(20), description: column('text', false), details: column('jsonb', false, { default: '{}' }),
      resolved: column('boolean', false, { default: false }),
    },
  },
  {
    name: 'feature_snapshots', description: '时间点一致特征快照', primaryKey: ['id'], unique: [['stock_code', 'as_of', 'feature_version']],
    columns: {
      id: bigserialId(), stock_code: varchar(20), as_of: timestamptz(false), feature_version: varchar(50),
      features: column('jsonb', false), input_hash: varchar(64), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'training_labels', description: '监督学习未来收益标签', primaryKey: ['id'], unique: [['stock_code', 'decision_time', 'horizon_minutes']],
    columns: {
      id: bigserialId(), stock_code: varchar(20), decision_time: timestamptz(false), horizon_minutes: column('integer', false),
      target_return_pct: column('double precision', false), direction_label: varchar(10),
      max_favorable_excursion: column('double precision', true), max_adverse_excursion: column('double precision', true),
      created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'model_artifacts', description: '不可变模型工件元数据', primaryKey: ['model_id'],
    columns: {
      model_id: varchar(100), algorithm: varchar(50), version: varchar(50), train_start_date: column('date', false), train_end_date: column('date', false),
      features_list: column('jsonb', false), hyperparameters: column('jsonb', false), file_hash: varchar(64), state: varchar(50),
      created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'model_evaluations', description: '模型样本外和校准评估', primaryKey: ['id'],
    foreignKeys: [{ columns: ['model_id'], referencesTable: 'model_artifacts', referencesColumns: ['model_id'], onDelete: 'CASCADE' }],
    columns: {
      id: bigserialId(), model_id: varchar(100), eval_window_start: column('date', false), eval_window_end: column('date', false),
      brier_score: column('double precision', true), log_loss: column('double precision', true), ece: column('double precision', true),
      net_return_pct: column('double precision', true), sharpe: column('double precision', true), max_drawdown_pct: column('double precision', true),
      sample_count: column('integer', false), metrics: column('jsonb', false), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'shadow_orders', description: '影子交易订单', primaryKey: ['id'], unique: [['order_id']],
    columns: {
      id: bigserialId(), order_id: column('uuid', false), stock_code: varchar(20), signal_time: timestamptz(false), order_time: timestamptz(false),
      action_type: varchar(10), target_price: column('double precision', false), target_shares: column('integer', false),
      model_id: varchar(100, true), status: varchar(20, false, 'PENDING'), reason: column('text', true), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'shadow_fills', description: '影子交易模拟成交与成本', primaryKey: ['id'],
    foreignKeys: [{ columns: ['order_id'], referencesTable: 'shadow_orders', referencesColumns: ['order_id'], onDelete: 'CASCADE' }],
    columns: {
      id: bigserialId(), order_id: column('uuid', false), fill_time: timestamptz(false), fill_price: column('double precision', false),
      fill_shares: column('integer', false), commission: column('double precision', false, { default: 0 }),
      stamp_duty: column('double precision', false, { default: 0 }), transfer_fee: column('double precision', false, { default: 0 }),
      slippage: column('double precision', false, { default: 0 }), impact_cost: column('double precision', false, { default: 0 }),
      created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'review_candidates', description: '复盘发现的待验证假设', primaryKey: ['id'],
    columns: {
      id: bigserialId(), discovered_at: timestamptz(false, 'now'), stock_code: varchar(20), phenomenon: column('text', false),
      hypothesized_cause: column('text', false), testable_hypothesis: column('text', false), candidate_feature: column('text', true),
      status: varchar(50, false, 'PROPOSED'), notes: column('text', true),
    },
  },
]
