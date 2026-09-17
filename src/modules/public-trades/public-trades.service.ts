/** 替换一批公共逐笔成交快照。事务及锁由仓储实现，验证不触及存储。 */
import { publicTradesSchema, type PublicTrade } from './public-trades.schema.js'
export interface PublicTradesWriter { replace(records: PublicTrade[]): Promise<void> }
export class PublicTradesService {
  constructor(private readonly repository: PublicTradesWriter) {}
  async replace(input: unknown) {
    const records = publicTradesSchema(input)
    if (records.length) await this.repository.replace(records)
    return { inserted: records.length }
  }
}
