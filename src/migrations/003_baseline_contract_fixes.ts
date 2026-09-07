import type { PoolClient } from 'pg'
import type { Migration } from './types.js'

export const migration003: Migration = {
  version: '003',
  name: 'baseline_runtime_contract_fixes',
  up: async (client: PoolClient) => {
    await client.query(`
      ALTER TABLE user_trade_actions
        ADD COLUMN IF NOT EXISTS previous_holding_shares INTEGER,
        ADD COLUMN IF NOT EXISTS previous_cost_price DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS resulting_holding_shares INTEGER,
        ADD COLUMN IF NOT EXISTS resulting_cost_price DOUBLE PRECISION;

      ALTER TABLE stocks ALTER COLUMN win_rate DROP DEFAULT;

      ALTER TABLE quant_prediction_runs
        ADD COLUMN IF NOT EXISTS model_calibrated BOOLEAN NOT NULL DEFAULT FALSE;
    `)
  },
  down: async (client: PoolClient) => {
    await client.query(`
      ALTER TABLE user_trade_actions
        DROP COLUMN IF EXISTS resulting_cost_price,
        DROP COLUMN IF EXISTS resulting_holding_shares,
        DROP COLUMN IF EXISTS previous_cost_price,
        DROP COLUMN IF EXISTS previous_holding_shares;

      ALTER TABLE quant_prediction_runs DROP COLUMN IF EXISTS model_calibrated;
    `)
  },
}
