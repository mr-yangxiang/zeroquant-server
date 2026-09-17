import { dailyBarsSchema, type DailyBar } from './daily-bars.schema.js'
export interface DailyBarsWriter { upsert(rows: DailyBar[]): Promise<void> }
export class DailyBarsService {
  constructor(private readonly repository: DailyBarsWriter) {}
  async ingest(input: unknown) {
    const rows = dailyBarsSchema(input)
    await this.repository.upsert(rows)
    return { accepted: rows.length }
  }
}
