import { timestamptz, varchar, type TableEntity } from './types.js'

export const systemEntities: TableEntity[] = [
  {
    name: 'schema_migrations', description: '已执行迁移版本', primaryKey: ['version'],
    columns: {
      version: varchar(50), name: varchar(255), applied_at: timestamptz(false, 'now'),
    },
  },
]
