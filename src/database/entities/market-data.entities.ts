import { bigserialId, column, timestamptz, varchar, type TableEntity } from './types.js'

export const marketDataEntities: TableEntity[] = [
  {
    name: 'trading_calendar', description: '交易日历', primaryKey: ['trade_date'],
    columns: {
      trade_date: column('date', false), is_trading_day: column('boolean', false, { default: true }),
      is_half_day: column('boolean', false, { default: false }),
      market_open_time: column('time without time zone', false, { default: '09:30:00' }),
      market_close_time: column('time without time zone', false, { default: '15:00:00' }),
      notes: column('text', true), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'universe_membership', description: '股票池历史成员与上市状态', primaryKey: ['id'], unique: [['stock_code', 'trade_date']],
    columns: {
      id: bigserialId(), stock_code: varchar(20), trade_date: column('date', false), is_st: column('boolean', false, { default: false }),
      is_suspended: column('boolean', false, { default: false }), is_listed: column('boolean', false, { default: true }),
      list_date: column('date', true), delist_date: column('date', true), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'raw_market_events', description: '不可变原始市场事件', primaryKey: ['id'],
    indexes: [{ name: 'idx_raw_events_stock_time', columns: ['stock_code', 'event_time'] }],
    columns: {
      id: bigserialId(), source: varchar(50), stock_code: varchar(20), event_time: timestamptz(false),
      received_at: timestamptz(false, 'now'), raw_payload: column('jsonb', false), payload_hash: varchar(64),
    },
  },
  {
    name: 'minute_bars', description: '清洗后分钟行情', primaryKey: ['id'], unique: [['stock_code', 'bar_time']],
    indexes: [{ name: 'idx_minute_bars_stock_date', columns: ['stock_code', 'trade_date', 'bar_time'] }],
    columns: {
      id: bigserialId(), stock_code: varchar(20), trade_date: column('date', false), bar_time: timestamptz(false),
      open: column('double precision', false), high: column('double precision', false), low: column('double precision', false), close: column('double precision', false),
      volume: column('double precision', false), amount: column('double precision', false), adj_factor: column('double precision', false, { default: 1 }),
      upper_limit: column('double precision', true), lower_limit: column('double precision', true), source: varchar(50), ingested_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'daily_bars', description: '清洗后日线行情', primaryKey: ['id'], unique: [['stock_code', 'trade_date']],
    columns: {
      id: bigserialId(), stock_code: varchar(20), trade_date: column('date', false), open: column('double precision', false),
      high: column('double precision', false), low: column('double precision', false), close: column('double precision', false),
      volume: column('double precision', false), amount: column('double precision', false), prev_close: column('double precision', false),
      adj_factor: column('double precision', false, { default: 1 }), upper_limit: column('double precision', true), lower_limit: column('double precision', true),
      is_suspended: column('boolean', false, { default: false }), source: varchar(50), ingested_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'order_book_snapshots', description: '多档委托簿快照', primaryKey: ['id'],
    indexes: [{ name: 'idx_ob_snapshots_stock_time', columns: ['stock_code', 'snapshot_time'] }],
    columns: {
      id: bigserialId(), stock_code: varchar(20), snapshot_time: timestamptz(false), bids: column('jsonb', false), asks: column('jsonb', false),
      received_at: timestamptz(false, 'now'), source: varchar(50),
    },
  },
  {
    name: 'order_events', description: '委托新增、撤单与成交事件', primaryKey: ['id'],
    columns: {
      id: bigserialId(), stock_code: varchar(20), event_time: timestamptz(false), event_type: varchar(20),
      price: column('double precision', false), volume: column('double precision', false), direction: varchar(10),
      order_seq: column('bigint', true), source: varchar(50),
    },
  },
  {
    name: 'trade_ticks', description: '逐笔成交', primaryKey: ['id'],
    indexes: [{ name: 'idx_trade_ticks_stock_time', columns: ['stock_code', 'trade_time'] }],
    columns: {
      id: bigserialId(), stock_code: varchar(20), trade_time: timestamptz(false), price: column('double precision', false),
      volume: column('double precision', false), amount: column('double precision', true), direction: varchar(10),
      trade_seq: column('bigint', true), source: varchar(50),
    },
  },
  {
    name: 'news_articles', description: '新闻与公告正文', primaryKey: ['id'], unique: [['fingerprint']],
    indexes: [{ name: 'idx_news_published', columns: ['published_at'] }],
    columns: {
      id: bigserialId(), title: varchar(500), content: column('text', false), url: varchar(1000, true), source: varchar(100),
      published_at: timestamptz(false), ingested_at: timestamptz(false, 'now'), fingerprint: varchar(64),
      sentiment_label: varchar(20, true), sentiment_score: column('double precision', true), trust_level: varchar(20, false, 'NORMAL'),
    },
  },
  {
    name: 'news_stock_relations', description: '新闻与股票多对多关系', primaryKey: ['id'], unique: [['news_id', 'stock_code']],
    foreignKeys: [{ columns: ['news_id'], referencesTable: 'news_articles', referencesColumns: ['id'], onDelete: 'CASCADE' }],
    columns: {
      id: bigserialId(), news_id: column('bigint', false), stock_code: varchar(20),
      relevance_score: column('double precision', false, { default: 1 }), impact_level: varchar(20, true, 'MEDIUM'),
      ingested_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'corporate_announcements', description: '上市公司公告', primaryKey: ['id'], unique: [['fingerprint']],
    columns: {
      id: bigserialId(), stock_code: varchar(20), title: varchar(500), content: column('text', true), category: varchar(100, true),
      notice_date: column('date', false), published_at: timestamptz(false), ingested_at: timestamptz(false, 'now'),
      source_url: varchar(1000, true), fingerprint: varchar(64),
    },
  },
  {
    name: 'shareholder_disclosures', description: '公开股东持股披露', primaryKey: ['id'], unique: [['stock_code', 'end_date', 'rank']],
    columns: {
      id: bigserialId(), stock_code: varchar(20), end_date: column('date', false), notice_date: column('date', false), rank: column('integer', false),
      holder_name: varchar(255), holder_nature: varchar(100, true), holding_shares: column('double precision', false),
      holding_ratio_pct: column('double precision', false), change_shares: column('double precision', true), direction: varchar(50, true),
      source: varchar(100), ingested_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'dragon_tiger_seats', description: '龙虎榜公开交易席位证据', primaryKey: ['id'], unique: [['stock_code', 'trade_date', 'side', 'rank']],
    columns: {
      id: bigserialId(), stock_code: varchar(20), trade_date: column('date', false), side: varchar(10), rank: column('integer', false),
      seat_name: varchar(255), buy_amount: column('double precision', false, { default: 0 }), sell_amount: column('double precision', false, { default: 0 }),
      net_amount: column('double precision', false, { default: 0 }), seat_type: varchar(50, true), source: varchar(100),
      disclosed_at: timestamptz(false, 'now'), ingested_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'block_trades', description: '大宗交易', primaryKey: ['id'],
    columns: {
      id: bigserialId(), stock_code: varchar(20), trade_date: column('date', false), trade_price: column('double precision', false),
      trade_volume: column('double precision', false), trade_amount: column('double precision', false), buyer_seat: varchar(255, true),
      seller_seat: varchar(255, true), premium_rate: column('double precision', true), source: varchar(100), created_at: timestamptz(false, 'now'),
    },
  },
  {
    name: 'corporate_actions', description: '复权与公司行动', primaryKey: ['id'], unique: [['stock_code', 'action_date', 'action_type']],
    columns: {
      id: bigserialId(), stock_code: varchar(20), action_date: column('date', false), action_type: varchar(50),
      adj_factor: column('double precision', false), details: column('jsonb', true), created_at: timestamptz(false, 'now'),
    },
  },
]
