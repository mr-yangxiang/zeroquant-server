import { dragonTigerSchema, newsSchema, type DragonTiger, type NewsEvidence } from './evidence.schema.js'
export interface EvidenceWriter { dragonTiger(rows:DragonTiger[]):Promise<void>; news(rows:NewsEvidence[]):Promise<void> }
export class EvidenceService {
  constructor(private readonly repository:EvidenceWriter) {}
  async dragonTiger(input:unknown) {const rows=dragonTigerSchema(input);await this.repository.dragonTiger(rows);return {accepted:rows.length}}
  async news(input:unknown) {const rows=newsSchema(input);await this.repository.news(rows);return {accepted:rows.length}}
}
