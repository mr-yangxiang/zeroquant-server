import type { PoolClient } from 'pg'
import type { Migration } from './types.js'

export const migration001: Migration = {
  version: '001',
  name: 'initial_baseline_schema',
  up: async (client: PoolClient) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL DEFAULT '管理员',
        phone VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        avatar TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stocks (
        code VARCHAR(20) PRIMARY KEY,
        full_code VARCHAR(20) NOT NULL,
        name VARCHAR(100) NOT NULL,
        current_price DOUBLE PRECISION DEFAULT 0,
        yesterday_price DOUBLE PRECISION DEFAULT 0,
        high_price DOUBLE PRECISION DEFAULT 0,
        low_price DOUBLE PRECISION DEFAULT 0,
        pct DOUBLE PRECISION DEFAULT 0,
        predicted_high DOUBLE PRECISION DEFAULT 0,
        predicted_low DOUBLE PRECISION DEFAULT 0,
        win_rate DOUBLE PRECISION DEFAULT 88.5,
        is_hot BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stock_price_histories (
        id SERIAL PRIMARY KEY,
        stock_code VARCHAR(20) REFERENCES stocks(code) ON DELETE CASCADE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        real_price DOUBLE PRECISION NOT NULL,
        predicted_price DOUBLE PRECISION NOT NULL,
        deviation_pct DOUBLE PRECISION DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS stock_t_analyses (
        id SERIAL PRIMARY KEY,
        stock_code VARCHAR(20) REFERENCES stocks(code) ON DELETE CASCADE,
        chip_analysis TEXT NOT NULL,
        host_style TEXT NOT NULL,
        scenario_1 TEXT NOT NULL,
        scenario_2 TEXT NOT NULL,
        scenario_3 TEXT NOT NULL,
        scenario_4 TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stock_backtest_stats (
        id SERIAL PRIMARY KEY,
        stock_code VARCHAR(20) REFERENCES stocks(code) ON DELETE CASCADE,
        period VARCHAR(20) NOT NULL,
        win_rate DOUBLE PRECISION NOT NULL,
        cum_roi DOUBLE PRECISION NOT NULL,
        daily_roi_points JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(stock_code, period)
      );

      CREATE TABLE IF NOT EXISTS stock_daily_reviews (
        id SERIAL PRIMARY KEY,
        stock_code VARCHAR(20) REFERENCES stocks(code) ON DELETE CASCADE,
        review_date DATE NOT NULL,
        block_trades TEXT NOT NULL,
        holding_ratio TEXT NOT NULL,
        institution_style TEXT NOT NULL,
        tomorrow_advice TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deviation_reason TEXT,
        key_lesson TEXT,
        future_action TEXT,
        UNIQUE(stock_code, review_date)
      );

      CREATE TABLE IF NOT EXISTS user_positions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(64) DEFAULT '1',
        stock_code VARCHAR(20) NOT NULL,
        holding_shares INTEGER DEFAULT 0,
        cost_price DOUBLE PRECISION DEFAULT 0.0,
        t_shares INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, stock_code)
      );

      CREATE TABLE IF NOT EXISTS user_trade_actions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(64) DEFAULT '1',
        stock_code VARCHAR(20) NOT NULL,
        action_type VARCHAR(20) NOT NULL,
        trade_price DOUBLE PRECISION NOT NULL,
        trade_shares INTEGER NOT NULL,
        trade_time TIMESTAMPTZ DEFAULT now(),
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS user_chat_messages (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        stock_code VARCHAR(16) NOT NULL,
        role VARCHAR(16) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_chat_user_stock ON user_chat_messages(user_id, stock_code, created_at);

      CREATE TABLE IF NOT EXISTS stock_day_predictions (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        predict_date DATE NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_base BOOLEAN NOT NULL DEFAULT FALSE,
        time_points JSONB NOT NULL DEFAULT '[]'::jsonb,
        direction VARCHAR(40),
        target_pct DOUBLE PRECISION,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        probability_bands JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS stock_rolling_predictions (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        predict_date DATE NOT NULL,
        target_time VARCHAR(5) NOT NULL,
        predicted_price DOUBLE PRECISION NOT NULL,
        run_id UUID,
        forecast_at TIMESTAMPTZ,
        target_at TIMESTAMPTZ,
        lead_minutes INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS stock_l2_orders (
        id BIGSERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        trade_date DATE NOT NULL,
        time_str VARCHAR(8) NOT NULL,
        type VARCHAR(80) NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        volume_lots DOUBLE PRECISION NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS quant_prediction_runs (
        run_id UUID PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        trade_date DATE NOT NULL,
        as_of TIMESTAMPTZ NOT NULL,
        mode VARCHAR(20) NOT NULL,
        reference_price DOUBLE PRECISION NOT NULL,
        previous_close DOUBLE PRECISION NOT NULL,
        model_version VARCHAR(120) NOT NULL,
        model_state VARCHAR(80) NOT NULL,
        model_calibrated BOOLEAN NOT NULL DEFAULT FALSE,
        regime JSONB NOT NULL,
        features JSONB NOT NULL,
        news_events JSONB NOT NULL DEFAULT '[]'::jsonb,
        input_hash VARCHAR(64) NOT NULL,
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS quant_horizon_forecasts (
        id BIGSERIAL PRIMARY KEY,
        run_id UUID NOT NULL REFERENCES quant_prediction_runs(run_id) ON DELETE CASCADE,
        horizon_minutes INTEGER NOT NULL,
        p_up DOUBLE PRECISION NOT NULL,
        p_flat DOUBLE PRECISION NOT NULL,
        p_down DOUBLE PRECISION NOT NULL,
        expected_return_pct DOUBLE PRECISION NOT NULL,
        q10_return_pct DOUBLE PRECISION NOT NULL,
        q50_return_pct DOUBLE PRECISION NOT NULL,
        q90_return_pct DOUBLE PRECISION NOT NULL,
        confidence DOUBLE PRECISION NOT NULL,
        actionable BOOLEAN NOT NULL DEFAULT FALSE,
        reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
        UNIQUE(run_id, horizon_minutes)
      );

      CREATE INDEX IF NOT EXISTS idx_quant_runs_stock_asof
        ON quant_prediction_runs(stock_code, as_of DESC);
      CREATE INDEX IF NOT EXISTS idx_quant_forecasts_run
        ON quant_horizon_forecasts(run_id, horizon_minutes);
    `)
  },
  down: async (client: PoolClient) => {
    await client.query(`
      DROP TABLE IF EXISTS quant_horizon_forecasts CASCADE;
      DROP TABLE IF EXISTS quant_prediction_runs CASCADE;
      DROP TABLE IF EXISTS stock_l2_orders CASCADE;
      DROP TABLE IF EXISTS stock_rolling_predictions CASCADE;
      DROP TABLE IF EXISTS stock_day_predictions CASCADE;
      DROP TABLE IF EXISTS user_chat_messages CASCADE;
      DROP TABLE IF EXISTS user_trade_actions CASCADE;
      DROP TABLE IF EXISTS user_positions CASCADE;
      DROP TABLE IF EXISTS stock_daily_reviews CASCADE;
      DROP TABLE IF EXISTS stock_backtest_stats CASCADE;
      DROP TABLE IF EXISTS stock_t_analyses CASCADE;
      DROP TABLE IF EXISTS stock_price_histories CASCADE;
      DROP TABLE IF EXISTS stocks CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `)
  }
}
