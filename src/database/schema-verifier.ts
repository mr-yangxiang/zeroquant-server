import type { Pool } from 'pg'
import { DATABASE_ENTITIES, DATABASE_SCHEMA_NAME } from './entities/index.js'

let databasePool: Pool | null = null

async function getDatabasePool() {
  if (!databasePool) databasePool = (await import('../db.js')).pool
  return databasePool
}

type Severity = 'ERROR' | 'WARNING'
type DifferenceKind =
  | 'MISSING_TABLE' | 'UNEXPECTED_TABLE'
  | 'MISSING_COLUMN' | 'UNEXPECTED_COLUMN' | 'COLUMN_TYPE' | 'COLUMN_NULLABLE' | 'COLUMN_LENGTH' | 'COLUMN_DEFAULT'
  | 'PRIMARY_KEY' | 'MISSING_UNIQUE' | 'MISSING_FOREIGN_KEY' | 'MISSING_INDEX' | 'INDEX_COLUMNS'

interface Difference {
  severity: Severity
  kind: DifferenceKind
  table: string
  object?: string
  expected?: unknown
  actual?: unknown
  message: string
}

type ActualColumn = {
  name: string
  type: string
  nullable: boolean
  maxLength: number | null
  defaultValue: string | null
}

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

function normalizeDefault(value: string | null, dataType: string): unknown {
  if (value === null) return undefined
  let normalized = value.trim()
  if (/^nextval\(/i.test(normalized)) return 'sequence'
  if (/^(now\(\)|CURRENT_TIMESTAMP)$/i.test(normalized)) return 'now'
  normalized = normalized.replace(/::[a-zA-Z0-9_\s\[\]"]+$/u, '').trim()
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    normalized = normalized.slice(1, -1).replace(/''/g, "'")
  }
  if (dataType === 'boolean') return normalized.toLowerCase() === 'true'
  if (['integer', 'bigint', 'smallint', 'double precision', 'numeric', 'real'].includes(dataType)) {
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : normalized
  }
  return normalized
}

function sameColumns(left: string[], right: string[]) {
  return left.length === right.length && left.every((columnName, index) => columnName === right[index])
}

function setKey(columns: string[]) {
  return [...columns].sort().join('|')
}

async function loadActualSchema() {
  const pool = await getDatabasePool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN READ ONLY')
    const [tableResult, columnResult, constraintResult, foreignKeyResult, indexResult] = await Promise.all([
      client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
        [DATABASE_SCHEMA_NAME]
      ),
      client.query(
        `SELECT table_name, column_name, data_type, is_nullable, character_maximum_length, column_default
         FROM information_schema.columns WHERE table_schema = $1
         ORDER BY table_name, ordinal_position`,
        [DATABASE_SCHEMA_NAME]
      ),
      client.query(
        `SELECT tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name, kcu.ordinal_position
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name
         WHERE tc.table_schema = $1 AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
         ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
        [DATABASE_SCHEMA_NAME]
      ),
      client.query(
        `SELECT tc.table_name, tc.constraint_name, kcu.column_name,
                ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name,
                rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name
         WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'
         ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position`,
        [DATABASE_SCHEMA_NAME]
      ),
      client.query(
        `SELECT tbl.relname AS table_name, idx.relname AS index_name,
                ARRAY_AGG(att.attname ORDER BY key_column.ordinality) FILTER (WHERE att.attname IS NOT NULL) AS columns
         FROM pg_index definition
         JOIN pg_class tbl ON tbl.oid = definition.indrelid
         JOIN pg_class idx ON idx.oid = definition.indexrelid
         JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
         CROSS JOIN LATERAL UNNEST(definition.indkey) WITH ORDINALITY AS key_column(attnum, ordinality)
         LEFT JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = key_column.attnum
         WHERE ns.nspname = $1
         GROUP BY tbl.relname, idx.relname
         ORDER BY tbl.relname, idx.relname`,
        [DATABASE_SCHEMA_NAME]
      ),
    ])
    await client.query('COMMIT')

    const tables = new Set(tableResult.rows.map((row) => String(row.table_name)))
    const columns = new Map<string, Map<string, ActualColumn>>()
    for (const row of columnResult.rows) {
      const table = String(row.table_name)
      const tableColumns = columns.get(table) || new Map<string, ActualColumn>()
      tableColumns.set(String(row.column_name), {
        name: String(row.column_name), type: String(row.data_type), nullable: row.is_nullable === 'YES',
        maxLength: row.character_maximum_length === null ? null : Number(row.character_maximum_length),
        defaultValue: row.column_default === null ? null : String(row.column_default),
      })
      columns.set(table, tableColumns)
    }

    const primaryKeys = new Map<string, string[]>()
    const uniques = new Map<string, Map<string, string[]>>()
    for (const row of constraintResult.rows) {
      const table = String(row.table_name)
      const constraint = String(row.constraint_name)
      if (row.constraint_type === 'PRIMARY KEY') {
        primaryKeys.set(table, [...(primaryKeys.get(table) || []), String(row.column_name)])
      } else {
        const tableUniques = uniques.get(table) || new Map<string, string[]>()
        tableUniques.set(constraint, [...(tableUniques.get(constraint) || []), String(row.column_name)])
        uniques.set(table, tableUniques)
      }
    }

    const foreignKeys = new Map<string, Array<{ columns: string[]; referencesTable: string; referencesColumns: string[]; onDelete: string }>>()
    for (const row of foreignKeyResult.rows) {
      const table = String(row.table_name)
      const values = foreignKeys.get(table) || []
      values.push({
        columns: [String(row.column_name)], referencesTable: String(row.foreign_table_name),
        referencesColumns: [String(row.foreign_column_name)], onDelete: String(row.delete_rule),
      })
      foreignKeys.set(table, values)
    }

    const indexes = new Map<string, Map<string, string[]>>()
    for (const row of indexResult.rows) {
      const table = String(row.table_name)
      const tableIndexes = indexes.get(table) || new Map<string, string[]>()
      tableIndexes.set(String(row.index_name), Array.isArray(row.columns) ? row.columns.map(String) : [])
      indexes.set(table, tableIndexes)
    }
    return { tables, columns, primaryKeys, uniques, foreignKeys, indexes }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function verifySchema(): Promise<Difference[]> {
  const actual = await loadActualSchema()
  const expectedTableNames = new Set(DATABASE_ENTITIES.map((entity) => entity.name))
  const differences: Difference[] = []
  const push = (difference: Difference) => differences.push(difference)

  for (const entity of DATABASE_ENTITIES) {
    if (!actual.tables.has(entity.name)) {
      push({ severity: 'ERROR', kind: 'MISSING_TABLE', table: entity.name, expected: entity,
        message: `缺少表 ${entity.name}` })
      continue
    }
    const actualColumns = actual.columns.get(entity.name) || new Map()
    for (const [columnName, expected] of Object.entries(entity.columns)) {
      const actualColumn = actualColumns.get(columnName)
      if (!actualColumn) {
        push({ severity: 'ERROR', kind: 'MISSING_COLUMN', table: entity.name, object: columnName, expected,
          message: `表 ${entity.name} 缺少字段 ${columnName}` })
        continue
      }
      if (actualColumn.type !== expected.type) {
        push({ severity: 'ERROR', kind: 'COLUMN_TYPE', table: entity.name, object: columnName,
          expected: expected.type, actual: actualColumn.type, message: `表 ${entity.name}.${columnName} 类型不一致` })
      }
      if (actualColumn.nullable !== expected.nullable) {
        push({ severity: 'ERROR', kind: 'COLUMN_NULLABLE', table: entity.name, object: columnName,
          expected: expected.nullable, actual: actualColumn.nullable, message: `表 ${entity.name}.${columnName} 可空约束不一致` })
      }
      if ((expected.maxLength ?? null) !== actualColumn.maxLength) {
        push({ severity: 'ERROR', kind: 'COLUMN_LENGTH', table: entity.name, object: columnName,
          expected: expected.maxLength ?? null, actual: actualColumn.maxLength, message: `表 ${entity.name}.${columnName} 长度不一致` })
      }
      const expectedDefault = hasOwn(expected, 'default') ? expected.default : undefined
      const actualDefault = normalizeDefault(actualColumn.defaultValue, actualColumn.type)
      if (expectedDefault !== actualDefault) {
        push({ severity: 'ERROR', kind: 'COLUMN_DEFAULT', table: entity.name, object: columnName,
          expected: expectedDefault, actual: actualDefault, message: `表 ${entity.name}.${columnName} 默认值不一致` })
      }
    }
    for (const columnName of actualColumns.keys()) {
      if (!entity.columns[columnName]) {
        push({ severity: 'WARNING', kind: 'UNEXPECTED_COLUMN', table: entity.name, object: columnName,
          actual: actualColumns.get(columnName), message: `表 ${entity.name} 存在实体清单未定义的字段 ${columnName}` })
      }
    }

    const actualPrimaryKey = actual.primaryKeys.get(entity.name) || []
    if (!sameColumns(entity.primaryKey, actualPrimaryKey)) {
      push({ severity: 'ERROR', kind: 'PRIMARY_KEY', table: entity.name,
        expected: entity.primaryKey, actual: actualPrimaryKey, message: `表 ${entity.name} 主键不一致` })
    }
    const actualUniqueKeys = new Set([...(actual.uniques.get(entity.name)?.values() || [])].map(setKey))
    for (const unique of entity.unique || []) {
      if (!actualUniqueKeys.has(setKey(unique))) {
        push({ severity: 'ERROR', kind: 'MISSING_UNIQUE', table: entity.name, object: unique.join(','),
          expected: unique, message: `表 ${entity.name} 缺少唯一约束 (${unique.join(', ')})` })
      }
    }
    const actualForeignKeys = actual.foreignKeys.get(entity.name) || []
    for (const foreignKey of entity.foreignKeys || []) {
      const found = actualForeignKeys.some((actualForeignKey) =>
        sameColumns(foreignKey.columns, actualForeignKey.columns)
        && foreignKey.referencesTable === actualForeignKey.referencesTable
        && sameColumns(foreignKey.referencesColumns, actualForeignKey.referencesColumns)
        && (foreignKey.onDelete || 'NO ACTION') === actualForeignKey.onDelete
      )
      if (!found) {
        push({ severity: 'ERROR', kind: 'MISSING_FOREIGN_KEY', table: entity.name, object: foreignKey.columns.join(','),
          expected: foreignKey, message: `表 ${entity.name} 缺少外键 ${foreignKey.columns.join(', ')} -> ${foreignKey.referencesTable}` })
      }
    }
    const actualIndexes = actual.indexes.get(entity.name) || new Map()
    for (const index of entity.indexes || []) {
      const actualIndexColumns = actualIndexes.get(index.name)
      if (!actualIndexColumns) {
        push({ severity: 'ERROR', kind: 'MISSING_INDEX', table: entity.name, object: index.name,
          expected: index.columns, message: `表 ${entity.name} 缺少索引 ${index.name}` })
      } else if (!sameColumns(index.columns, actualIndexColumns)) {
        push({ severity: 'ERROR', kind: 'INDEX_COLUMNS', table: entity.name, object: index.name,
          expected: index.columns, actual: actualIndexColumns, message: `索引 ${index.name} 字段顺序不一致` })
      }
    }
  }

  for (const tableName of actual.tables) {
    if (!expectedTableNames.has(tableName)) {
      push({ severity: 'WARNING', kind: 'UNEXPECTED_TABLE', table: tableName,
        message: `数据库存在实体清单未定义的表 ${tableName}` })
    }
  }
  return differences
}

function printExpectedSchema() {
  console.log(JSON.stringify({ schema: DATABASE_SCHEMA_NAME, tableCount: DATABASE_ENTITIES.length, tables: DATABASE_ENTITIES }, null, 2))
}

async function main() {
  if (process.argv.includes('--expected')) {
    printExpectedSchema()
    return
  }
  const jsonOutput = process.argv.includes('--json')
  try {
    const differences = await verifySchema()
    const errors = differences.filter((item) => item.severity === 'ERROR')
    const warnings = differences.filter((item) => item.severity === 'WARNING')
    if (jsonOutput) {
      console.log(JSON.stringify({ ok: errors.length === 0, expectedTableCount: DATABASE_ENTITIES.length, errors, warnings }, null, 2))
    } else if (differences.length === 0) {
      console.log(`✅ 数据库结构完全一致：${DATABASE_ENTITIES.length} 张表，未发现缺表、缺字段或约束差异。`)
    } else {
      console.log(`数据库结构核验结果：${errors.length} 个错误，${warnings.length} 个警告。`)
      for (const item of differences) console.log(`${item.severity === 'ERROR' ? '❌' : '⚠️'} [${item.kind}] ${item.message}`)
    }
    if (errors.length) process.exitCode = 1
  } catch (error) {
    console.error('❌ 无法核验数据库结构：', error instanceof Error ? error.message : error)
    process.exitCode = 2
  } finally {
    if (databasePool) await databasePool.end()
  }
}

main()
