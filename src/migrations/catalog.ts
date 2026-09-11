// Shared by the production runner and isolated upgrade tests; no DB connection.
import type { Migration } from './types.js'
import { migration001 } from './001_initial_baseline.js'
import { migration002 } from './002_data_warehouse_core.js'
import { migration003 } from './003_baseline_contract_fixes.js'
import { migration004 } from './004_append_only_rolling_forecasts.js'
import { migration005 } from './005_entity_behavior_profiles.js'
import { migration006 } from './006_research_pipeline.js'
import { migration007 } from './007_repair_l2_created_at.js'

export const ALL_MIGRATIONS: Migration[] = [
  migration001, migration002, migration003, migration004, migration005, migration006, migration007,
]
