/** 持仓领域契约；这里只记录用户陈述的成交，不连接券商、不执行下单。 */
export interface Position { holdingShares: number; costPrice: number }
export interface Trade {
  id: number; stockCode: string; actionType: 'BUY' | 'SELL'; tradePrice: number; tradeShares: number; tradeTime: string
  previousShares: number | null; previousCost: number | null; resultingShares: number | null; resultingCost: number | null
}
export interface PortfolioRepository {
  lockStock(userId: string, stockCode: string): Promise<void>
  position(userId: string, stockCode: string): Promise<Position>
  save(userId: string, stockCode: string, position: Position): Promise<void>
  insert(userId: string, stockCode: string, action: 'BUY' | 'SELL', price: number, shares: number, before: Position, after: Position): Promise<Trade>
  findTrade(userId: string, id: number, lock?: boolean): Promise<Trade | null>
  latestId(userId: string, stockCode: string): Promise<number | null>
  remove(userId: string, id: number): Promise<void>
}
export interface PortfolioWork { run<T>(operation: (repository: PortfolioRepository) => Promise<T>): Promise<T> }
