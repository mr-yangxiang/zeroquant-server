import { applicationEntities } from './application.entities.js'
import { marketDataEntities } from './market-data.entities.js'
import { profileEntities } from './profile.entities.js'
import { researchEntities } from './research.entities.js'
import { systemEntities } from './system.entities.js'
import type { TableEntity } from './types.js'

export const DATABASE_SCHEMA_NAME = 'public'

export const DATABASE_ENTITIES: TableEntity[] = [
  ...systemEntities,
  ...applicationEntities,
  ...marketDataEntities,
  ...researchEntities,
  ...profileEntities,
]

const duplicateNames = DATABASE_ENTITIES
  .map((entity) => entity.name)
  .filter((name, index, values) => values.indexOf(name) !== index)

if (duplicateNames.length) {
  throw new Error(`数据库实体定义存在重复表名: ${[...new Set(duplicateNames)].join(', ')}`)
}

export type { ColumnEntity, ForeignKeyEntity, IndexEntity, TableEntity } from './types.js'
