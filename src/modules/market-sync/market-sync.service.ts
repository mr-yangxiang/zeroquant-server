import { syncSchema,type SyncInput } from './market-sync.schema.js'
export interface SyncWriter {persist(input:SyncInput):Promise<unknown>}
export class MarketSyncService {
  constructor(private readonly repository:SyncWriter) {}
  async ingest(value:unknown){return this.repository.persist(syncSchema(value))}
}
