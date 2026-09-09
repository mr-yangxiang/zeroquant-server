export type DefaultValue = string | number | boolean | null | 'sequence' | 'now'

export interface ColumnEntity {
  type: string
  nullable: boolean
  maxLength?: number
  default?: DefaultValue
}

export interface ForeignKeyEntity {
  columns: string[]
  referencesTable: string
  referencesColumns: string[]
  onDelete?: 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION'
}

export interface IndexEntity {
  name: string
  columns: string[]
}

export interface TableEntity {
  name: string
  description: string
  columns: Record<string, ColumnEntity>
  primaryKey: string[]
  unique?: string[][]
  foreignKeys?: ForeignKeyEntity[]
  indexes?: IndexEntity[]
}

export const column = (
  type: string,
  nullable: boolean,
  options: Omit<ColumnEntity, 'type' | 'nullable'> = {}
): ColumnEntity => ({ type, nullable, ...options })

export const serialId = () => column('integer', false, { default: 'sequence' })
export const bigserialId = () => column('bigint', false, { default: 'sequence' })
export const varchar = (maxLength: number, nullable = false, defaultValue?: DefaultValue) =>
  column('character varying', nullable, {
    maxLength,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  })
export const timestamp = (nullable = false, defaultValue?: DefaultValue) =>
  column('timestamp without time zone', nullable, defaultValue === undefined ? {} : { default: defaultValue })
export const timestamptz = (nullable = false, defaultValue?: DefaultValue) =>
  column('timestamp with time zone', nullable, defaultValue === undefined ? {} : { default: defaultValue })
