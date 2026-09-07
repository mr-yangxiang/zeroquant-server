import type { PoolClient } from 'pg'

export interface Migration {
  version: string
  name: string
  up: (client: PoolClient) => Promise<void>
  down: (client: PoolClient) => Promise<void>
}
