import { pool } from '../db.js'
import type { PoolClient } from 'pg'
import type { Migration } from './types.js'
import { migration001 } from './001_initial_baseline.js'
import { migration002 } from './002_data_warehouse_core.js'
import { migration003 } from './003_baseline_contract_fixes.js'
import { migration004 } from './004_append_only_rolling_forecasts.js'

const ALL_MIGRATIONS: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
]

export async function ensureMigrationTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function getAppliedVersions(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query(`SELECT version FROM schema_migrations ORDER BY version ASC`)
  return rows.map((r) => String(r.version))
}

export async function runMigrationsUp() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock(987654321)`)
    await ensureMigrationTable(client)
    const applied = await getAppliedVersions(client)

    for (const migration of ALL_MIGRATIONS) {
      if (!applied.includes(migration.version)) {
        console.log(`🚀 [Migration UP] 正在应用迁移: ${migration.version} - ${migration.name}...`)
        await migration.up(client)
        await client.query(
          `INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW())`,
          [migration.version, migration.name]
        )
        console.log(`✅ [Migration UP] 迁移 ${migration.version} 应用成功！`)
      } else {
        console.log(`⏩ [Migration SKIP] 迁移 ${migration.version} - ${migration.name} 已存在，跳过`)
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('❌ [Migration UP] 迁移失败，已安全回滚:', error)
    throw error
  } finally {
    client.release()
  }
}

export async function runMigrationsDown() {
  if (process.env.NODE_ENV === 'production' && process.env.ZEROQUANT_ALLOW_DESTRUCTIVE_MIGRATION_DOWN !== 'true') {
    throw new Error('生产环境禁止回滚迁移；如已完成备份并明确授权，请设置 ZEROQUANT_ALLOW_DESTRUCTIVE_MIGRATION_DOWN=true')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock(987654321)`)
    await ensureMigrationTable(client)
    const applied = await getAppliedVersions(client)
    if (applied.length === 0) {
      console.log('ℹ️ 没有可回滚的迁移')
      await client.query('COMMIT')
      return
    }

    const lastVersion = applied[applied.length - 1]
    const targetMigration = ALL_MIGRATIONS.find((m) => m.version === lastVersion)
    if (!targetMigration) {
      throw new Error(`找不到版本为 ${lastVersion} 的迁移定义`)
    }

    console.log(`⏪ [Migration DOWN] 正在回滚迁移: ${targetMigration.version} - ${targetMigration.name}...`)
    await targetMigration.down(client)
    await client.query(`DELETE FROM schema_migrations WHERE version = $1`, [targetMigration.version])
    await client.query('COMMIT')
    console.log(`✅ [Migration DOWN] 迁移 ${targetMigration.version} 回滚成功！`)
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('❌ [Migration DOWN] 回滚失败:', error)
    throw error
  } finally {
    client.release()
  }
}

export async function printMigrationStatus() {
  const client = await pool.connect()
  try {
    await ensureMigrationTable(client)
    const applied = await getAppliedVersions(client)
    console.log('==================================================')
    console.log('📋 ZeroQuant 数据库迁移状态清单')
    console.log('==================================================')
    for (const m of ALL_MIGRATIONS) {
      const isApplied = applied.includes(m.version)
      console.log(`${isApplied ? '🟢 [APPLIED]' : '⚪ [PENDING]'} ${m.version.padEnd(5)} | ${m.name}`)
    }
    console.log('==================================================')
  } finally {
    client.release()
  }
}

// 命令行入口
if (process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')) {
  const cmd = process.argv[2] || 'status'
  try {
    if (cmd === 'up') {
      await runMigrationsUp()
    } else if (cmd === 'down') {
      await runMigrationsDown()
    } else if (cmd === 'status') {
      await printMigrationStatus()
    } else {
      console.error(`未知命令: ${cmd}。支持: up, down, status`)
      process.exit(1)
    }
    process.exit(0)
  } catch (err) {
    console.error('迁移运行器执行异常:', err)
    process.exit(1)
  }
}
