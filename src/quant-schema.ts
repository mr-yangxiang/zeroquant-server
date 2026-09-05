import { pool } from './db.js'

export async function ensureQuantSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_day_predictions (
      id BIGSERIAL PRIMARY KEY,
      stock_code VARCHAR(20) NOT NULL,
      predict_date DATE NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      is_base BOOLEAN NOT NULL DEFAULT FALSE,
      time_points JSONB NOT NULL DEFAULT '[]'::jsonb,
      direction VARCHAR(40),
      target_pct DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS stock_rolling_predictions (
      id BIGSERIAL PRIMARY KEY,
      stock_code VARCHAR(20) NOT NULL,
      predict_date DATE NOT NULL,
      target_time VARCHAR(5) NOT NULL,
      predicted_price DOUBLE PRECISION NOT NULL,
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

  await pool.query(`
    ALTER TABLE quant_prediction_runs ADD COLUMN IF NOT EXISTS reference_price DOUBLE PRECISION;
    ALTER TABLE quant_prediction_runs ADD COLUMN IF NOT EXISTS previous_close DOUBLE PRECISION;
    ALTER TABLE stock_day_predictions ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE stock_day_predictions ADD COLUMN IF NOT EXISTS probability_bands JSONB NOT NULL DEFAULT '[]'::jsonb;
  `)
}
