import { bigserialId, column, serialId, timestamp, timestamptz, varchar, type TableEntity } from './types.js'

export const applicationEntities: TableEntity[] = [
  {
    name: 'users', description: '登录用户', primaryKey: ['id'], unique: [['phone']],
    columns: {
      id: serialId(), username: varchar(100, false, '管理员'), phone: varchar(50), password: varchar(255),
      avatar: column('text', true), created_at: timestamp(true, 'now'),
    },
  },
  {
    name: 'stocks', description: '前端关注股票与最新行情摘要', primaryKey: ['code'],
    columns: {
      code: varchar(20), full_code: varchar(20), name: varchar(100),
      current_price: column('double precision', true, { default: 0 }),
      yesterday_price: column('double precision', true, { default: 0 }),
      high_price: column('double precision', true, { default: 0 }),
      low_price: column('double precision', true, { default: 0 }), pct: column('double precision', true, { default: 0 }),
      predicted_high: column('double precision', true, { default: 0 }), predicted_low: column('double precision', true, { default: 0 }),
      win_rate: column('double precision', true), is_hot: column('boolean', true, { default: true }), updated_at: timestamp(true, 'now'),
    },
  },
  {
    name: 'stock_price_histories', description: '实盘价格与当时预测点历史', primaryKey: ['id'],
    foreignKeys: [{ columns: ['stock_code'], referencesTable: 'stocks', referencesColumns: ['code'], onDelete: 'CASCADE' }],
    columns: {
      id: serialId(), stock_code: varchar(20, true), timestamp: timestamptz(true, 'now'),
      real_price: column('double precision', false), predicted_price: column('double precision', false),
      deviation_pct: column('double precision', true, { default: 0 }),
    },
  },
  {
    name: 'stock_t_analyses', description: '旧版股票做T分析文本', primaryKey: ['id'],
    foreignKeys: [{ columns: ['stock_code'], referencesTable: 'stocks', referencesColumns: ['code'], onDelete: 'CASCADE' }],
    columns: {
      id: serialId(), stock_code: varchar(20, true), chip_analysis: column('text', false), host_style: column('text', false),
      scenario_1: column('text', false), scenario_2: column('text', false), scenario_3: column('text', false), scenario_4: column('text', false),
      updated_at: timestamp(true, 'now'),
    },
  },
  {
    name: 'stock_backtest_stats', description: '旧版回测统计', primaryKey: ['id'], unique: [['stock_code', 'period']],
    foreignKeys: [{ columns: ['stock_code'], referencesTable: 'stocks', referencesColumns: ['code'], onDelete: 'CASCADE' }],
    columns: {
      id: serialId(), stock_code: varchar(20, true), period: varchar(20), win_rate: column('double precision', false),
      cum_roi: column('double precision', false), daily_roi_points: column('jsonb', false), updated_at: timestamp(true, 'now'),
    },
  },
  {
    name: 'stock_daily_reviews', description: '旧版每日复盘文本', primaryKey: ['id'], unique: [['stock_code', 'review_date']],
    foreignKeys: [{ columns: ['stock_code'], referencesTable: 'stocks', referencesColumns: ['code'], onDelete: 'CASCADE' }],
    columns: {
      id: serialId(), stock_code: varchar(20, true), review_date: column('date', false), block_trades: column('text', false),
      holding_ratio: column('text', false), institution_style: column('text', false), tomorrow_advice: column('text', false),
      updated_at: timestamp(true, 'now'), deviation_reason: column('text', true), key_lesson: column('text', true), future_action: column('text', true),
    },
  },
  {
    name: 'user_positions', description: '用户按股票隔离的持仓快照', primaryKey: ['id'], unique: [['user_id', 'stock_code']],
    columns: {
      id: serialId(), user_id: varchar(64, true, '1'), stock_code: varchar(20), holding_shares: column('integer', true, { default: 0 }),
      cost_price: column('double precision', true, { default: 0 }), t_shares: column('integer', true, { default: 0 }),
      created_at: timestamptz(true, 'now'), updated_at: timestamptz(true, 'now'),
    },
  },
  {
    name: 'user_trade_actions', description: '用户明确录入的成交与回滚快照', primaryKey: ['id'],
    columns: {
      id: serialId(), user_id: varchar(64, true, '1'), stock_code: varchar(20), action_type: varchar(20),
      trade_price: column('double precision', false), trade_shares: column('integer', false), trade_time: timestamptz(true, 'now'), note: column('text', true),
      previous_holding_shares: column('integer', true), previous_cost_price: column('double precision', true),
      resulting_holding_shares: column('integer', true), resulting_cost_price: column('double precision', true),
    },
  },
  {
    name: 'user_chat_messages', description: '按用户与股票隔离的分析师对话', primaryKey: ['id'],
    indexes: [{ name: 'idx_chat_user_stock', columns: ['user_id', 'stock_code', 'created_at'] }],
    columns: {
      id: serialId(), user_id: varchar(64), stock_code: varchar(16), role: varchar(16), content: column('text', false), created_at: timestamptz(true, 'now'),
    },
  },
  {
    name: 'stock_day_predictions', description: '盘前全天兼容曲线', primaryKey: ['id'],
    columns: {
      id: bigserialId(), stock_code: varchar(20), predict_date: column('date', false), version: column('integer', false, { default: 1 }),
      is_base: column('boolean', false, { default: false }), time_points: column('jsonb', false, { default: '[]' }), direction: varchar(40, true),
      target_pct: column('double precision', true), metadata: column('jsonb', false, { default: '{}' }),
      probability_bands: column('jsonb', false, { default: '[]' }), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'stock_rolling_predictions', description: '盘中追加式动态预测快照', primaryKey: ['id'],
    indexes: [
      { name: 'idx_rolling_forecast_replay', columns: ['stock_code', 'predict_date', 'target_time', 'forecast_at'] },
      { name: 'idx_rolling_forecast_snapshot', columns: ['stock_code', 'predict_date', 'forecast_at'] },
    ],
    columns: {
      id: bigserialId(), stock_code: varchar(20), predict_date: column('date', false), target_time: varchar(5),
      predicted_price: column('double precision', false), run_id: column('uuid', true), forecast_at: timestamptz(true),
      target_at: timestamptz(true), lead_minutes: column('integer', true), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'stock_l2_orders', description: '公开逐笔大额成交代理数据', primaryKey: ['id'],
    columns: {
      id: bigserialId(), stock_code: varchar(20), trade_date: column('date', false), time_str: varchar(8), type: varchar(80),
      price: column('double precision', false), volume_lots: column('double precision', false), note: column('text', true), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'quant_prediction_runs', description: '版本化量化预测运行', primaryKey: ['run_id'],
    indexes: [{ name: 'idx_quant_runs_stock_asof', columns: ['stock_code', 'as_of'] }],
    columns: {
      run_id: column('uuid', false), stock_code: varchar(20), trade_date: column('date', false), as_of: timestamptz(false), mode: varchar(20),
      reference_price: column('double precision', false), previous_close: column('double precision', false), model_version: varchar(120), model_state: varchar(80),
      model_calibrated: column('boolean', false, { default: false }), regime: column('jsonb', false), features: column('jsonb', false),
      news_events: column('jsonb', false, { default: '[]' }), input_hash: varchar(64), warnings: column('jsonb', false, { default: '[]' }), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'quant_horizon_forecasts', description: '各预测周期概率与分位数', primaryKey: ['id'], unique: [['run_id', 'horizon_minutes']],
    foreignKeys: [{ columns: ['run_id'], referencesTable: 'quant_prediction_runs', referencesColumns: ['run_id'], onDelete: 'CASCADE' }],
    indexes: [{ name: 'idx_quant_forecasts_run', columns: ['run_id', 'horizon_minutes'] }],
    columns: {
      id: bigserialId(), run_id: column('uuid', false), horizon_minutes: column('integer', false), p_up: column('double precision', false),
      p_flat: column('double precision', false), p_down: column('double precision', false), expected_return_pct: column('double precision', false),
      q10_return_pct: column('double precision', false), q50_return_pct: column('double precision', false), q90_return_pct: column('double precision', false),
      confidence: column('double precision', false), actionable: column('boolean', false, { default: false }), reasons: column('jsonb', false, { default: '[]' }),
    },
  },
]
