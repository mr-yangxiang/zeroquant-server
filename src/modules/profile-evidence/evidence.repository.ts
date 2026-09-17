import type { UnitOfWork } from '../../shared/transaction.js'
import { AppError } from '../../shared/errors.js'
import type { DragonTiger, NewsEvidence } from './evidence.schema.js'
import type { EvidenceWriter } from './evidence.service.js'
export class EvidenceRepository implements EvidenceWriter {
  constructor(private readonly work:UnitOfWork) {}
  async dragonTiger(rows:DragonTiger[]) {
    const ordered=[...rows].sort((a,b)=>(a.stockCode+'|'+a.tradeDate+'|'+a.side+'|'+String(a.rank).padStart(3,'0')).localeCompare(b.stockCode+'|'+b.tradeDate+'|'+b.side+'|'+String(b.rank).padStart(3,'0')))
    await this.work.run(async db=>{
      for (const item of ordered) {
        await db.query(
          `INSERT INTO dragon_tiger_seats
            (stock_code, trade_date, side, rank, seat_name, buy_amount, sell_amount, net_amount, seat_type, source, disclosed_at)
           VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
           ON CONFLICT (stock_code, trade_date, side, rank) DO UPDATE SET
             seat_name = EXCLUDED.seat_name, buy_amount = EXCLUDED.buy_amount,
             sell_amount = EXCLUDED.sell_amount, net_amount = EXCLUDED.net_amount,
             seat_type = EXCLUDED.seat_type, source = EXCLUDED.source,
             disclosed_at = EXCLUDED.disclosed_at, ingested_at = NOW()`,
          [item.stockCode, item.tradeDate, item.side, item.rank, item.seatName, item.buyAmount,
            item.sellAmount, item.netAmount, item.seatType, item.source, item.disclosedAt]
        )
      }
    })
  }
  async news(rows:NewsEvidence[]) {
    const ordered=[...rows].sort((a,b)=>a.fingerprint.localeCompare(b.fingerprint))
    await this.work.run(async db=>{
      for (const item of ordered) {
        const { rows } = await db.query(
          `INSERT INTO news_articles
            (title, content, url, source, published_at, fingerprint, sentiment_label, sentiment_score, trust_level)
           VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9)
           ON CONFLICT (fingerprint) DO UPDATE SET
             title = EXCLUDED.title, content = EXCLUDED.content, url = EXCLUDED.url,
             sentiment_label = EXCLUDED.sentiment_label, sentiment_score = EXCLUDED.sentiment_score,
             trust_level = EXCLUDED.trust_level
           WHERE news_articles.source=EXCLUDED.source AND news_articles.published_at=EXCLUDED.published_at
           RETURNING id`,
          [item.title, item.content, item.url, item.source, item.publishedAt, item.fingerprint,
            item.sentimentLabel, item.sentimentScore, item.trustLevel]
        )
        if (!rows[0]) throw new AppError('CONFLICT', '同一新闻指纹的来源或发布时间不一致')
        for (const stockCode of item.stocks) {
          await db.query(
            `INSERT INTO news_stock_relations (news_id, stock_code, relevance_score, impact_level)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (news_id, stock_code) DO UPDATE SET
               relevance_score = EXCLUDED.relevance_score,
               impact_level = EXCLUDED.impact_level`,
            [rows[0].id, stockCode, item.relevanceScore, item.impactLevel]
          )
        }
      }
    })
  }
}
