/** Isolated PostgreSQL/WASM: no production connection and no user data. */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { ALL_MIGRATIONS } from '../src/migrations/catalog.js'
import { migration008 } from '../src/migrations/008_legacy_schema_compatibility.js'
import { verifySchema } from '../src/database/schema-verifier.js'

if (!process.env.PGLITE_MODULE_PATH) throw new Error('需要独立 PGLITE_MODULE_PATH')
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href)
const db = new PGlite()
const client = {
  query: async (sql: string, params?: unknown[]) => params ? db.query(sql, params) :
    /^(SELECT|WITH)\b/i.test(sql.trim()) ? db.query(sql) : db.exec(sql),
  release() {},
} as any
const pool = { connect: async () => client } as any
try {
  await db.exec('CREATE TABLE schema_migrations(version VARCHAR(50) PRIMARY KEY,name VARCHAR(255) NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
  for (const migration of ALL_MIGRATIONS.filter(m => m.version !== '008')) await migration.up(client)
  // Numeric IDs already referenced logically must retain their string identity.
  await db.exec(`INSERT INTO users(id,username,phone,password) VALUES (42,'ISOLATED','fixture','not-a-real-password');
    INSERT INTO user_positions(user_id,stock_code) VALUES ('42','000572');
    INSERT INTO stocks(code,full_code,name) VALUES ('000572','sz000572','ISOLATED');
    INSERT INTO stock_day_predictions(stock_code,predict_date,is_base) VALUES ('000572','2026-09-10',true);
    ALTER TABLE stock_rolling_predictions ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC';
    INSERT INTO stock_rolling_predictions(stock_code,predict_date,target_time,predicted_price,created_at)
      VALUES ('000572','2026-09-10','10:00',10,'2026-09-10 02:00:00');`)
  const before = (await db.query('SELECT created_at::text AS value FROM stock_rolling_predictions')).rows[0].value
  await db.exec('BEGIN')
  await migration008.up(client)
  await db.exec('COMMIT')
  assert.equal((await db.query("SELECT id FROM users WHERE phone='fixture'")).rows[0].id, '42')
  assert.equal((await db.query("SELECT count(*)::int AS n FROM users u JOIN user_positions p ON p.user_id=u.id")).rows[0].n, 1)
  assert.equal((await db.query('SELECT is_base FROM stock_day_predictions')).rows[0].is_base, true)
  assert.equal((await db.query('SELECT created_at::text AS value FROM stock_rolling_predictions')).rows[0].value, before)
  const generated = (await db.query("INSERT INTO users(username,phone,password) VALUES ('ISOLATED','second','not-a-real-password') RETURNING id")).rows[0].id
  assert.match(generated, /^[0-9a-f-]{36}$/)
  await migration008.up(client)
  assert.equal((await db.query("SELECT id FROM users WHERE phone='second'")).rows[0].id, generated)
  const verified = await verifySchema(pool)
  assert.deepEqual(verified.filter(d => d.severity === 'ERROR'), [])
  assert.equal(verified.filter(d => d.kind === 'LEGACY_COLUMN_TYPE').length, 1)
  // Constraint-backed, standalone and INCLUDE unique indexes are equivalent
  // for phone uniqueness. Partial/expression/composite/nonunique ones are not.
  await db.exec('ALTER TABLE users DROP CONSTRAINT users_phone_key')
  for (const [definition, accepted] of [
    ['CREATE UNIQUE INDEX users_phone_key ON users(phone)', true],
    ['CREATE UNIQUE INDEX users_phone_key ON users(phone) INCLUDE(username)', true],
    ["CREATE UNIQUE INDEX users_phone_key ON users(phone) WHERE phone <> ''", false],
    ['CREATE UNIQUE INDEX users_phone_key ON users(lower(phone))', false],
    ['CREATE UNIQUE INDEX users_phone_key ON users(phone,username)', false],
    ['CREATE INDEX users_phone_key ON users(phone)', false],
  ] as const) {
    await db.exec(definition)
    const missing = (await verifySchema(pool)).some(d => d.table === 'users' && d.kind === 'MISSING_UNIQUE')
    assert.equal(missing, !accepted, definition)
    await db.exec('DROP INDEX users_phone_key')
  }
  // A failed required-column check must not leave a half-upgraded database.
  await db.exec("ALTER TABLE stock_day_predictions ALTER COLUMN stock_code DROP NOT NULL; UPDATE stock_day_predictions SET stock_code=NULL")
  await db.exec('BEGIN')
  await assert.rejects(() => migration008.up(client))
  await db.exec('ROLLBACK')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM stock_day_predictions WHERE stock_code IS NULL')).rows[0].n, 1)
  await db.exec("UPDATE stock_day_predictions SET stock_code='000572'; ALTER TABLE stock_day_predictions ALTER COLUMN direction TYPE TEXT; UPDATE stock_day_predictions SET direction=repeat('x',41)")
  await db.exec('BEGIN')
  await assert.rejects(() => migration008.up(client), /oversized values/)
  await db.exec('ROLLBACK')
  assert.equal((await db.query('SELECT length(direction)::int AS n FROM stock_day_predictions')).rows[0].n, 41)
  console.log('PASS: 008 preserves identifiers/history, idempotence, explicit timezone warning, unique-index variants, rollback')
} finally { await db.close() }
