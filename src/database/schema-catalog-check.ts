import fs from 'node:fs'
import path from 'node:path'
import { DATABASE_ENTITIES } from './entities/index.js'

const migrationsDirectory = path.resolve(process.cwd(), 'src/migrations')
const migrationTableNames = new Set<string>()

for (const fileName of fs.readdirSync(migrationsDirectory).filter((name) => /^\d+_.+\.ts$/.test(name))) {
  const source = fs.readFileSync(path.join(migrationsDirectory, fileName), 'utf8')
  for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/gi)) {
    migrationTableNames.add(match[1])
  }
}

// schema_migrations is created by runner.ts instead of a numbered migration.
migrationTableNames.add('schema_migrations')

const entityTableNames = new Set(DATABASE_ENTITIES.map((entity) => entity.name))
const missingInEntities = [...migrationTableNames].filter((name) => !entityTableNames.has(name)).sort()
const missingInMigrations = [...entityTableNames].filter((name) => !migrationTableNames.has(name)).sort()

if (missingInEntities.length || missingInMigrations.length) {
  console.error(JSON.stringify({
    ok: false,
    migrationTableCount: migrationTableNames.size,
    entityTableCount: entityTableNames.size,
    missingInEntities,
    missingInMigrations,
  }, null, 2))
  process.exitCode = 1
} else {
  console.log(`✅ 迁移与实体目录一致：${entityTableNames.size} 张表均有定义。`)
}
