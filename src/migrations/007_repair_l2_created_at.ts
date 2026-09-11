import type { Migration } from './types.js'

/** Additive repair for databases that recorded 005 before its SQL was amended. */
export const migration007: Migration = {
  version: '007',
  name: 'repair_legacy_l2_created_at',
  up: async (client) => {
    // Existing rows get the repair time, NOT a fabricated historical receipt time.
    // An existing column and its timestamps are left untouched.
    await client.query(`ALTER TABLE stock_l2_orders
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  },
  down: async () => {
    // Shared baseline column (001): rollback must not destroy it or its data.
  },
}
