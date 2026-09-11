/** Isolated PostgreSQL/WASM test; never loads .env or the production pool.
 * Supply PGLITE_MODULE_PATH pointing to a locally installed PGlite entry point.
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { DATABASE_ENTITIES } from '../src/database/entities/index.js'
import { ALL_MIGRATIONS } from '../src/migrations/catalog.js'
import { migration005 } from '../src/migrations/005_entity_behavior_profiles.js'
import { migration006 } from '../src/migrations/006_research_pipeline.js'
import { migration007 } from '../src/migrations/007_repair_l2_created_at.js'

if (!process.env.PGLITE_MODULE_PATH) throw new Error('需要独立的 PGLITE_MODULE_PATH，不允许连接生产数据库')
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href)
const db = new PGlite()
try {
  const client = { query: async (sql: string, params?: unknown[]) => params ? db.query(sql, params) : db.exec(sql) } as any
  await db.exec(`CREATE TABLE schema_migrations(version VARCHAR(50) PRIMARY KEY,name VARCHAR(255) NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
  for (const migration of ALL_MIGRATIONS) {
    await db.exec('BEGIN')
    await migration.up(client)
    await db.query('INSERT INTO schema_migrations(version,name) VALUES ($1,$2)', [migration.version, migration.name])
    await db.exec('COMMIT')
  }
  await migration006.up(client) // additive migration is idempotent
  await db.query(`INSERT INTO stock_l2_orders(stock_code,trade_date,time_str,type,price,volume_lots,created_at)
    VALUES ('000572','2026-09-10','10:00:00','ISOLATED_TEST',10,100,'2026-09-10T10:00:01+08:00')`)
  const originalRow = (await db.query('SELECT * FROM stock_l2_orders')).rows[0]
  await migration007.up(client)
  assert.deepEqual((await db.query('SELECT * FROM stock_l2_orders')).rows[0], originalRow)
  const { rows } = await db.query(`SELECT table_name,column_name,data_type,is_nullable,character_maximum_length FROM information_schema.columns WHERE table_schema='public'`)
  const differences: unknown[] = []
  for (const entity of DATABASE_ENTITIES) {
    const actual = rows.filter((r: any) => r.table_name === entity.name).map((r: any) => r.column_name)
    assert.ok(actual.length, `缺表 ${entity.name}`)
    for (const [name, expected] of Object.entries(entity.columns)) {
      const column = rows.find((r: any) => r.table_name === entity.name && r.column_name === name)
      assert.ok(column, `缺字段 ${entity.name}.${name}`)
      if (column.data_type !== expected.type || (column.is_nullable === 'YES') !== expected.nullable
        || (expected.maxLength && column.character_maximum_length !== expected.maxLength)) {
        differences.push({table:entity.name,column:name,expected,actual:column})
      }
    }
  }
  assert.deepEqual(differences,[], '实体目录与实际迁移的字段定义必须一致')
  await db.exec('BEGIN')
  await db.query(`INSERT INTO research_raw_records(record_hash,kind,stock_code,source,event_at,available_at,payload) VALUES ($1,'minute','000572','ISOLATED_TEST',NOW(),NOW(),'{}')`, ['a'.repeat(64)])
  await db.exec('ROLLBACK')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM research_raw_records')).rows[0].n, 0)
  // Reproduce an old installation: 001..005 recorded, but 005's late-added
  // column never ran. Only unapplied migrations may repair it.
  await db.exec('BEGIN')
  await db.exec("DELETE FROM schema_migrations WHERE version IN ('006','007')")
  await db.exec('ALTER TABLE stock_l2_orders DROP COLUMN created_at')
  const applied = (await db.query('SELECT version FROM schema_migrations')).rows.map((r: any) => r.version)
  const executed: string[] = []
  for (const migration of ALL_MIGRATIONS) {
    if (applied.includes(migration.version)) continue
    await migration.up(client)
    await db.query('INSERT INTO schema_migrations(version,name) VALUES ($1,$2)', [migration.version, migration.name])
    executed.push(migration.version)
  }
  assert.deepEqual(executed, ['006', '007'])
  const repaired = await db.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_name='stock_l2_orders' AND column_name='created_at'")
  assert.deepEqual(repaired.rows, [{data_type:'timestamp with time zone',is_nullable:'NO'}])
  const upgradedRow = (await db.query('SELECT * FROM stock_l2_orders')).rows[0]
  const { created_at: oldTimestamp, ...oldData } = originalRow
  const { created_at: repairTimestamp, ...newData } = upgradedRow
  assert.deepEqual(newData, oldData, '补字段必须保留已有业务数据')
  assert.ok(repairTimestamp)
  await migration007.up(client)
  assert.deepEqual((await db.query('SELECT * FROM stock_l2_orders')).rows[0], upgradedRow)
  // Both down paths must preserve a column owned by the initial baseline.
  await migration007.down(client)
  await migration005.down(client)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='stock_l2_orders' AND column_name='created_at'")).rows[0].n, 1)
  await db.exec('ROLLBACK')
  console.log(JSON.stringify({status:'PASS', expectedTables:DATABASE_ENTITIES.length, migrations:ALL_MIGRATIONS.length,
    legacyUpgrade:true, baselineColumnPreservedOnDown:true, rollback:true, scope:'isolated_postgresql_wasm_not_cloud'}))
} finally { await db.close() }
