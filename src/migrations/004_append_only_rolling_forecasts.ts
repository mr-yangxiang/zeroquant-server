import type { PoolClient } from 'pg'
import type { Migration } from './types.js'

export const migration004: Migration = {
  version: '004',
  name: 'append_only_rolling_forecast_snapshots',
  up: async (client: PoolClient) => {
    await client.query(`
      ALTER TABLE stock_rolling_predictions
        ADD COLUMN IF NOT EXISTS run_id UUID,
        ADD COLUMN IF NOT EXISTS forecast_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS target_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS lead_minutes INTEGER;

      UPDATE stock_rolling_predictions
      SET forecast_at = COALESCE(forecast_at, created_at),
          target_at = COALESCE(
            target_at,
            ((predict_date::text || ' ' || target_time || ':00')::timestamp AT TIME ZONE 'Asia/Shanghai')
          )
      WHERE forecast_at IS NULL OR target_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_rolling_forecast_replay
        ON stock_rolling_predictions(stock_code, predict_date, target_time, forecast_at DESC);
      CREATE INDEX IF NOT EXISTS idx_rolling_forecast_snapshot
        ON stock_rolling_predictions(stock_code, predict_date, forecast_at DESC);
    `)
  },
  down: async (client: PoolClient) => {
    await client.query(`
      DROP INDEX IF EXISTS idx_rolling_forecast_snapshot;
      DROP INDEX IF EXISTS idx_rolling_forecast_replay;
      ALTER TABLE stock_rolling_predictions
        DROP COLUMN IF EXISTS lead_minutes,
        DROP COLUMN IF EXISTS target_at,
        DROP COLUMN IF EXISTS forecast_at,
        DROP COLUMN IF EXISTS run_id;
    `)
  },
}
