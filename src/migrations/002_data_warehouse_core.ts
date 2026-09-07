import type { PoolClient } from 'pg'
import type { Migration } from './types.js'

export const migration002: Migration = {
  version: '002',
  name: 'data_warehouse_core_schema',
  up: async (client: PoolClient) => {
    await client.query(`
      -- 1. 交易日历
      CREATE TABLE IF NOT EXISTS trading_calendar (
        trade_date DATE PRIMARY KEY,
        is_trading_day BOOLEAN NOT NULL DEFAULT TRUE,
        is_half_day BOOLEAN NOT NULL DEFAULT FALSE,
        market_open_time TIME NOT NULL DEFAULT '09:30:00',
        market_close_time TIME NOT NULL DEFAULT '15:00:00',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- 2. 股票池生命周期成员（幸存者偏差防护）
      CREATE TABLE IF NOT EXISTS universe_membership (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        trade_date DATE NOT NULL,
        is_st BOOLEAN NOT NULL DEFAULT FALSE,
        is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
        is_listed BOOLEAN NOT NULL DEFAULT TRUE,
        list_date DATE,
        delist_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stock_code, trade_date)
      );

      -- 3. Raw 原始层市场事件（不可修改追加）
      CREATE TABLE IF NOT EXISTS raw_market_events (
        id BIGSERIAL PRIMARY KEY,
        source VARCHAR(50) NOT NULL,
        stock_code VARCHAR(20) NOT NULL,
        event_time TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        raw_payload JSONB NOT NULL,
        payload_hash VARCHAR(64) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_raw_events_stock_time ON raw_market_events(stock_code, event_time);

      -- 4. 分钟行情表 (Clean 层)
      CREATE TABLE IF NOT EXISTS minute_bars (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        trade_date DATE NOT NULL,
        bar_time TIMESTAMPTZ NOT NULL,
        open DOUBLE PRECISION NOT NULL,
        high DOUBLE PRECISION NOT NULL,
        low DOUBLE PRECISION NOT NULL,
        close DOUBLE PRECISION NOT NULL,
        volume DOUBLE PRECISION NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        adj_factor DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        upper_limit DOUBLE PRECISION,
        lower_limit DOUBLE PRECISION,
        source VARCHAR(50) NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stock_code, bar_time)
      );
      CREATE INDEX IF NOT EXISTS idx_minute_bars_stock_date ON minute_bars(stock_code, trade_date, bar_time);

      -- 5. 日线行情表
      CREATE TABLE IF NOT EXISTS daily_bars (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        trade_date DATE NOT NULL,
        open DOUBLE PRECISION NOT NULL,
        high DOUBLE PRECISION NOT NULL,
        low DOUBLE PRECISION NOT NULL,
        close DOUBLE PRECISION NOT NULL,
        volume DOUBLE PRECISION NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        prev_close DOUBLE PRECISION NOT NULL,
        adj_factor DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        upper_limit DOUBLE PRECISION,
        lower_limit DOUBLE PRECISION,
        is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
        source VARCHAR(50) NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stock_code, trade_date)
      );

      -- 6. Level-2 盘口快照与订单事件
      CREATE TABLE IF NOT EXISTS order_book_snapshots (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        snapshot_time TIMESTAMPTZ NOT NULL,
        bids JSONB NOT NULL, -- [{price, volume, orders_count}] 1-10档
        asks JSONB NOT NULL, -- [{price, volume, orders_count}] 1-10档
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source VARCHAR(50) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ob_snapshots_stock_time ON order_book_snapshots(stock_code, snapshot_time);

      CREATE TABLE IF NOT EXISTS order_events (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        event_time TIMESTAMPTZ NOT NULL,
        event_type VARCHAR(20) NOT NULL, -- 'ADD', 'CANCEL', 'TRADE'
        price DOUBLE PRECISION NOT NULL,
        volume DOUBLE PRECISION NOT NULL,
        direction VARCHAR(10) NOT NULL,
        order_seq BIGINT,
        source VARCHAR(50) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trade_ticks (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        trade_time TIMESTAMPTZ NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        volume DOUBLE PRECISION NOT NULL,
        amount DOUBLE PRECISION,
        direction VARCHAR(10) NOT NULL, -- 'BUY', 'SELL', 'NEUTRAL'
        trade_seq BIGINT,
        source VARCHAR(50) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trade_ticks_stock_time ON trade_ticks(stock_code, trade_time);

      -- 7. 新闻与公告数据
      CREATE TABLE IF NOT EXISTS news_articles (
        id BIGSERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        content TEXT NOT NULL,
        url VARCHAR(1000),
        source VARCHAR(100) NOT NULL,
        published_at TIMESTAMPTZ NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fingerprint VARCHAR(64) UNIQUE NOT NULL,
        sentiment_label VARCHAR(20), -- 'BULLISH', 'BEARISH', 'NEUTRAL'
        sentiment_score DOUBLE PRECISION,
        trust_level VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
      );
      CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published_at DESC);

      CREATE TABLE IF NOT EXISTS news_stock_relations (
        id BIGSERIAL PRIMARY KEY,
        news_id BIGINT NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
        stock_code VARCHAR(20) NOT NULL,
        relevance_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        impact_level VARCHAR(20) DEFAULT 'MEDIUM',
        UNIQUE(news_id, stock_code)
      );

      CREATE TABLE IF NOT EXISTS corporate_announcements (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        title VARCHAR(500) NOT NULL,
        content TEXT,
        category VARCHAR(100),
        notice_date DATE NOT NULL,
        published_at TIMESTAMPTZ NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source_url VARCHAR(1000),
        fingerprint VARCHAR(64) UNIQUE NOT NULL
      );

      -- 8. 股东、机构与龙虎榜数据
      CREATE TABLE IF NOT EXISTS shareholder_disclosures (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        end_date DATE NOT NULL,
        notice_date DATE NOT NULL,
        rank INTEGER NOT NULL,
        holder_name VARCHAR(255) NOT NULL,
        holder_nature VARCHAR(100),
        holding_shares DOUBLE PRECISION NOT NULL,
        holding_ratio_pct DOUBLE PRECISION NOT NULL,
        change_shares DOUBLE PRECISION,
        direction VARCHAR(50),
        source VARCHAR(100) NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stock_code, end_date, rank)
      );

      CREATE TABLE IF NOT EXISTS dragon_tiger_seats (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        trade_date DATE NOT NULL,
        side VARCHAR(10) NOT NULL, -- 'BUY', 'SELL'
        rank INTEGER NOT NULL,
        seat_name VARCHAR(255) NOT NULL,
        buy_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        sell_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        net_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        seat_type VARCHAR(50), -- 'INSTITUTION', 'HOT_MONEY', 'RETAIL'
        source VARCHAR(100) NOT NULL,
        disclosed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stock_code, trade_date, side, rank)
      );

      CREATE TABLE IF NOT EXISTS block_trades (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        trade_date DATE NOT NULL,
        trade_price DOUBLE PRECISION NOT NULL,
        trade_volume DOUBLE PRECISION NOT NULL,
        trade_amount DOUBLE PRECISION NOT NULL,
        buyer_seat VARCHAR(255),
        seller_seat VARCHAR(255),
        premium_rate DOUBLE PRECISION,
        source VARCHAR(100) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS corporate_actions (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        action_date DATE NOT NULL,
        action_type VARCHAR(50) NOT NULL, -- 'SPLIT', 'DIVIDEND', 'ALLOTMENT'
        adj_factor DOUBLE PRECISION NOT NULL,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stock_code, action_date, action_type)
      );

      -- 9. 数据质量与风控事件
      CREATE TABLE IF NOT EXISTS data_quality_incidents (
        id BIGSERIAL PRIMARY KEY,
        incident_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        stock_code VARCHAR(20),
        incident_type VARCHAR(80) NOT NULL, -- 'MISSING_MINUTES', 'PRICE_ANOMALY', 'STALE_QUOTE', 'LEAKAGE_DETECTED'
        severity VARCHAR(20) NOT NULL, -- 'INFO', 'WARNING', 'CRITICAL', 'FATAL'
        description TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        resolved BOOLEAN NOT NULL DEFAULT FALSE
      );

      -- 10. 特征与标签层
      CREATE TABLE IF NOT EXISTS feature_snapshots (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        as_of TIMESTAMPTZ NOT NULL,
        feature_version VARCHAR(50) NOT NULL,
        features JSONB NOT NULL,
        input_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stock_code, as_of, feature_version)
      );

      CREATE TABLE IF NOT EXISTS training_labels (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        decision_time TIMESTAMPTZ NOT NULL,
        horizon_minutes INTEGER NOT NULL,
        target_return_pct DOUBLE PRECISION NOT NULL,
        direction_label VARCHAR(10) NOT NULL, -- 'UP', 'FLAT', 'DOWN'
        max_favorable_excursion DOUBLE PRECISION,
        max_adverse_excursion DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stock_code, decision_time, horizon_minutes)
      );

      -- 11. 模型工件与评估结果 (只追加)
      CREATE TABLE IF NOT EXISTS model_artifacts (
        model_id VARCHAR(100) PRIMARY KEY,
        algorithm VARCHAR(50) NOT NULL, -- 'LIGHTGBM', 'CATBOOST', 'LOGISTIC', 'VWAP_BENCHMARK'
        version VARCHAR(50) NOT NULL,
        train_start_date DATE NOT NULL,
        train_end_date DATE NOT NULL,
        features_list JSONB NOT NULL,
        hyperparameters JSONB NOT NULL,
        file_hash VARCHAR(64) NOT NULL,
        state VARCHAR(50) NOT NULL, -- 'TRAINED', 'CALIBRATED', 'SHADOW', 'CHAMPION', 'RETIRED'
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS model_evaluations (
        id BIGSERIAL PRIMARY KEY,
        model_id VARCHAR(100) NOT NULL REFERENCES model_artifacts(model_id) ON DELETE CASCADE,
        eval_window_start DATE NOT NULL,
        eval_window_end DATE NOT NULL,
        brier_score DOUBLE PRECISION,
        log_loss DOUBLE PRECISION,
        ece DOUBLE PRECISION,
        net_return_pct DOUBLE PRECISION,
        sharpe DOUBLE PRECISION,
        max_drawdown_pct DOUBLE PRECISION,
        sample_count INTEGER NOT NULL,
        metrics JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- 12. 影子交易与候选经验
      CREATE TABLE IF NOT EXISTS shadow_orders (
        id BIGSERIAL PRIMARY KEY,
        order_id UUID UNIQUE NOT NULL,
        stock_code VARCHAR(20) NOT NULL,
        signal_time TIMESTAMPTZ NOT NULL,
        order_time TIMESTAMPTZ NOT NULL,
        action_type VARCHAR(10) NOT NULL, -- 'BUY', 'SELL'
        target_price DOUBLE PRECISION NOT NULL,
        target_shares INTEGER NOT NULL,
        model_id VARCHAR(100),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS shadow_fills (
        id BIGSERIAL PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES shadow_orders(order_id) ON DELETE CASCADE,
        fill_time TIMESTAMPTZ NOT NULL,
        fill_price DOUBLE PRECISION NOT NULL,
        fill_shares INTEGER NOT NULL,
        commission DOUBLE PRECISION NOT NULL DEFAULT 0,
        stamp_duty DOUBLE PRECISION NOT NULL DEFAULT 0,
        transfer_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        slippage DOUBLE PRECISION NOT NULL DEFAULT 0,
        impact_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS review_candidates (
        id BIGSERIAL PRIMARY KEY,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        stock_code VARCHAR(20) NOT NULL,
        phenomenon TEXT NOT NULL,
        hypothesized_cause TEXT NOT NULL,
        testable_hypothesis TEXT NOT NULL,
        candidate_feature TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'PROPOSED', -- 'PROPOSED', 'BACKTESTING', 'REJECTED', 'PROMOTED'
        notes TEXT
      );
    `)
  },
  down: async (client: PoolClient) => {
    await client.query(`
      DROP TABLE IF EXISTS review_candidates CASCADE;
      DROP TABLE IF EXISTS shadow_fills CASCADE;
      DROP TABLE IF EXISTS shadow_orders CASCADE;
      DROP TABLE IF EXISTS model_evaluations CASCADE;
      DROP TABLE IF EXISTS model_artifacts CASCADE;
      DROP TABLE IF EXISTS training_labels CASCADE;
      DROP TABLE IF EXISTS feature_snapshots CASCADE;
      DROP TABLE IF EXISTS data_quality_incidents CASCADE;
      DROP TABLE IF EXISTS corporate_actions CASCADE;
      DROP TABLE IF EXISTS block_trades CASCADE;
      DROP TABLE IF EXISTS dragon_tiger_seats CASCADE;
      DROP TABLE IF EXISTS shareholder_disclosures CASCADE;
      DROP TABLE IF EXISTS corporate_announcements CASCADE;
      DROP TABLE IF EXISTS news_stock_relations CASCADE;
      DROP TABLE IF EXISTS news_articles CASCADE;
      DROP TABLE IF EXISTS trade_ticks CASCADE;
      DROP TABLE IF EXISTS order_events CASCADE;
      DROP TABLE IF EXISTS order_book_snapshots CASCADE;
      DROP TABLE IF EXISTS daily_bars CASCADE;
      DROP TABLE IF EXISTS minute_bars CASCADE;
      DROP TABLE IF EXISTS raw_market_events CASCADE;
      DROP TABLE IF EXISTS universe_membership CASCADE;
      DROP TABLE IF EXISTS trading_calendar CASCADE;
    `)
  }
}
