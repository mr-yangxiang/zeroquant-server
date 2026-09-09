import { createHash } from 'node:crypto'
import { pool } from '../db.js'

export const ENTITY_PROFILE_VERSION = 'entity_behavior_v1'
const LOOKBACK_DAYS = 3 * 365
const RECENCY_HALF_LIFE_DAYS = 120
const MIN_RESEARCH_SAMPLE = 8
const COST_FLOOR_PCT = 0.18

type EvidenceRow = {
  stockCode: string
  tradeDate: string
  disclosedAt: Date
  side: 'BUY' | 'SELL'
  seatName: string
  seatType: string | null
  buyAmount: number
  sellAmount: number
  netAmount: number
  source: string
}

type BarRow = {
  stockCode: string
  tradeDate: string
  open: number
  high: number
  low: number
  close: number
  prevClose: number
}

type NewsRow = { stockCode: string; publishedAt: Date }

type EnrichedEvidence = EvidenceRow & {
  eventReturnPct: number | null
  closeLocation: number | null
  forward1Pct: number | null
  forward3Pct: number | null
  forward5Pct: number | null
  alignedForward1Pct: number | null
  alignedForward3Pct: number | null
  alignedForward5Pct: number | null
  maxFavorable5Pct: number | null
  maxAdverse5Pct: number | null
  recentNews: boolean
  recencyWeight: number
}

type ComputedProfile = {
  entityKey: string
  canonicalName: string
  normalizedName: string
  entityType: string
  firstSeenDate: string
  lastSeenDate: string
  sampleCount: number
  labeledSampleCount: number
  confidence: number
  evidenceGrade: string
  status: 'INSUFFICIENT' | 'RESEARCH_READY'
  metrics: Record<string, unknown>
  traits: { code: string; label: string; strength: number; evidence: string }[]
  summary: string
  evidence: EnrichedEvidence[]
}

function finite(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, low = -1, high = 1): number {
  return Math.max(low, Math.min(high, value))
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value || '').slice(0, 10)
}

function shanghaiDateOnly(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
}

function daysBetween(later: string, earlier: string): number {
  const end = Date.parse(`${later}T00:00:00Z`)
  const start = Date.parse(`${earlier}T00:00:00Z`)
  return Math.max(0, (end - start) / 86_400_000)
}

function normalizeEntityName(value: string): string {
  return value.normalize('NFKC').replace(/[\s·•・,，。()（）]/g, '').toUpperCase()
}

function normalizeEntityType(value: string | null, name = ''): string {
  const text = String(value || '').toUpperCase()
  const normalizedName = name.normalize('NFKC')
  if (text.includes('INSTITUTION') || text.includes('机构') || normalizedName.includes('机构专用')) return '机构席位'
  if (text.includes('HOT_MONEY') || text.includes('游资') || /证券营业部|交易单元/.test(normalizedName)) return '活跃营业部席位'
  if (/沪股通|深股通/.test(normalizedName)) return '互联互通席位'
  if (text.includes('RETAIL') || text.includes('散户')) return '其他公开席位'
  return '公开交易席位'
}

function entityKey(name: string, type: string): string {
  return createHash('sha256').update(`${type}|${normalizeEntityName(name)}`).digest('hex')
}

function weightedMean(rows: EnrichedEvidence[], selector: (row: EnrichedEvidence) => number | null): number | null {
  let weighted = 0
  let total = 0
  for (const row of rows) {
    const value = selector(row)
    if (value === null || !Number.isFinite(value)) continue
    weighted += value * row.recencyWeight
    total += row.recencyWeight
  }
  return total > 0 ? weighted / total : null
}

function shrunkRate(successWeight: number, totalWeight: number, priorStrength = 8): number {
  return (successWeight + priorStrength * 0.5) / (totalWeight + priorStrength)
}

function profileGrade(sampleCount: number, labeledCount: number, confidence: number): string {
  const coverage = sampleCount > 0 ? labeledCount / sampleCount : 0
  if (sampleCount >= 50 && coverage >= 0.8 && confidence >= 0.8) return 'A'
  if (sampleCount >= 20 && coverage >= 0.65 && confidence >= 0.6) return 'B'
  if (sampleCount >= MIN_RESEARCH_SAMPLE && labeledCount >= 5) return 'C'
  return 'D'
}

function computeTraits(metrics: Record<string, number | null>, sampleCount: number): ComputedProfile['traits'] {
  if (sampleCount < MIN_RESEARCH_SAMPLE) return []
  const traits: ComputedProfile['traits'] = []
  const add = (code: string, label: string, strength: number, evidence: string) => {
    traits.push({ code, label, strength: Number(clamp(strength, 0, 1).toFixed(3)), evidence })
  }
  const buyRatio = metrics.buyRatio ?? 0.5
  const breakout = metrics.breakoutParticipationRate ?? 0.5
  const dipBuy = metrics.dipBuyParticipationRate ?? 0.5
  const news = metrics.newsAffinityRate ?? 0.5
  const hit5 = metrics.alignedHitRate5 ?? 0.5
  const aligned5 = metrics.alignedForward5Pct ?? 0
  const aligned1 = metrics.alignedForward1Pct ?? 0
  const aligned3 = metrics.alignedForward3Pct ?? 0
  const hhi = metrics.stockConcentrationHhi ?? 0

  if (buyRatio >= 0.68) add('BUY_ACTIVE', '买方参与偏多', (buyRatio - 0.5) * 2, `历史买方出现占比 ${(buyRatio * 100).toFixed(1)}%`)
  if (buyRatio <= 0.32) add('SELL_ACTIVE', '卖方参与偏多', (0.5 - buyRatio) * 2, `历史卖方出现占比 ${((1 - buyRatio) * 100).toFixed(1)}%`)
  if (breakout >= 0.58) add('BREAKOUT', '强势突破参与倾向', (breakout - 0.5) * 2, `强势日买入倾向率 ${(breakout * 100).toFixed(1)}%`)
  if (dipBuy >= 0.58) add('DIP_BUY', '逆势低位参与倾向', (dipBuy - 0.5) * 2, `弱势日买入倾向率 ${(dipBuy * 100).toFixed(1)}%`)
  if (news >= 0.58) add('NEWS_SENSITIVE', '新闻事件附近较活跃', (news - 0.5) * 2, `事件前三日存在相关新闻的比例 ${(news * 100).toFixed(1)}%`)
  if (hit5 >= 0.58 && aligned5 > COST_FLOOR_PCT) add('FOLLOW_THROUGH', '出现后五日方向延续较强', (hit5 - 0.5) * 2, `经方向对齐的五日胜率 ${(hit5 * 100).toFixed(1)}%`)
  if (hit5 <= 0.42 && aligned5 < -COST_FLOOR_PCT) add('REVERSAL_RISK', '出现后五日反转风险较高', (0.5 - hit5) * 2, `经方向对齐的五日胜率仅 ${(hit5 * 100).toFixed(1)}%`)
  if (aligned1 > COST_FLOOR_PCT && aligned5 < aligned1 * 0.35) {
    add('SHORT_LIVED', '短线效应衰减较快', Math.min(1, Math.abs(aligned1 - aligned5) / 2), `方向对齐收益由一日 ${aligned1.toFixed(2)}% 衰减至五日 ${aligned5.toFixed(2)}%`)
  }
  if (aligned3 > COST_FLOOR_PCT && aligned5 > aligned3 + 0.10) {
    add('SWING_FOLLOW', '三至五日延续倾向', Math.min(1, aligned5 / 3), `方向对齐收益三日 ${aligned3.toFixed(2)}%、五日 ${aligned5.toFixed(2)}%`)
  }
  if (hhi >= 0.35) add('CONCENTRATED', '历史参与标的较集中', Math.min(1, hhi), `标的集中度指数 ${hhi.toFixed(2)}`)
  return traits.sort((a, b) => b.strength - a.strength).slice(0, 4)
}

function computeProfile(rows: EnrichedEvidence[], asOfDate: string): ComputedProfile {
  const first = rows[0]
  const normalizedName = normalizeEntityName(first.seatName)
  const type = normalizeEntityType(first.seatType, first.seatName)
  const totalWeight = rows.reduce((sum, row) => sum + row.recencyWeight, 0)
  const buyWeight = rows.filter((row) => row.side === 'BUY').reduce((sum, row) => sum + row.recencyWeight, 0)
  const labeled = rows.filter((row) => row.alignedForward5Pct !== null)
  const labeledWeight = labeled.reduce((sum, row) => sum + row.recencyWeight, 0)
  const hitWeight = labeled.filter((row) => finite(row.alignedForward5Pct) > COST_FLOOR_PCT).reduce((sum, row) => sum + row.recencyWeight, 0)
  const breakoutRows = rows.filter((row) => row.side === 'BUY' && row.eventReturnPct !== null)
  const breakoutTotal = breakoutRows.reduce((sum, row) => sum + row.recencyWeight, 0)
  const breakoutHit = breakoutRows.filter((row) => finite(row.eventReturnPct) >= 3 && finite(row.closeLocation) >= 0.75).reduce((sum, row) => sum + row.recencyWeight, 0)
  const dipHit = breakoutRows.filter((row) => finite(row.eventReturnPct) <= -2 || finite(row.closeLocation, 0.5) <= 0.30).reduce((sum, row) => sum + row.recencyWeight, 0)
  const newsWeight = rows.filter((row) => row.recentNews).reduce((sum, row) => sum + row.recencyWeight, 0)
  const stockWeights = new Map<string, number>()
  for (const row of rows) stockWeights.set(row.stockCode, (stockWeights.get(row.stockCode) || 0) + row.recencyWeight)
  const hhi = totalWeight > 0 ? [...stockWeights.values()].reduce((sum, value) => sum + (value / totalWeight) ** 2, 0) : 0
  const coverage = rows.length > 0 ? labeled.length / rows.length : 0
  const sourceCount = new Set(rows.map((row) => row.source)).size
  const lastSeenDate = rows.reduce((latest, row) => row.tradeDate > latest ? row.tradeDate : latest, rows[0].tradeDate)
  const freshness = Math.exp(-daysBetween(asOfDate, lastSeenDate) / 180)
  const sampleFactor = 1 - Math.exp(-rows.length / 20)
  const sourceFactor = 0.9 + 0.1 * Math.min(1, Math.max(0, sourceCount - 1) / 2)
  const confidence = clamp(sampleFactor * (0.55 + 0.25 * coverage + 0.20 * freshness) * sourceFactor, 0, 1)

  const numericMetrics: Record<string, number | null> = {
    buyRatio: totalWeight > 0 ? buyWeight / totalWeight : 0.5,
    breakoutParticipationRate: shrunkRate(breakoutHit, breakoutTotal),
    dipBuyParticipationRate: shrunkRate(dipHit, breakoutTotal),
    newsAffinityRate: shrunkRate(newsWeight, totalWeight),
    alignedHitRate5: shrunkRate(hitWeight, labeledWeight),
    alignedForward1Pct: weightedMean(rows, (row) => row.alignedForward1Pct),
    alignedForward3Pct: weightedMean(rows, (row) => row.alignedForward3Pct),
    alignedForward5Pct: weightedMean(rows, (row) => row.alignedForward5Pct),
    maxFavorable5Pct: weightedMean(rows, (row) => row.maxFavorable5Pct),
    maxAdverse5Pct: weightedMean(rows, (row) => row.maxAdverse5Pct),
    stockConcentrationHhi: hhi,
    averageAbsoluteNetAmount: weightedMean(rows, (row) => Math.abs(row.netAmount)),
    labelCoverage: coverage,
    sourceCount,
  }
  const metrics = Object.fromEntries(Object.entries(numericMetrics).map(([key, value]) => [key, value === null ? null : Number(value.toFixed(6))])) as Record<string, number | null>
  const traits = computeTraits(metrics, rows.length)
  const status = rows.length >= MIN_RESEARCH_SAMPLE && labeled.length >= 5 ? 'RESEARCH_READY' : 'INSUFFICIENT'
  const grade = profileGrade(rows.length, labeled.length, confidence)
  const summary = status === 'INSUFFICIENT'
    ? `目前只有 ${rows.length} 次可验证公开席位记录，样本不足，暂不形成操盘风格结论。`
    : `基于 ${sourceCount} 个来源的 ${rows.length} 次公开席位记录、${labeled.length} 次可计算后续表现的样本形成；${traits.length ? traits.map((item) => item.label).join('、') : '暂未发现稳定且显著的单一风格'}。`

  return {
    entityKey: entityKey(first.seatName, type), canonicalName: first.seatName, normalizedName, entityType: type,
    firstSeenDate: rows.reduce((earliest, row) => row.tradeDate < earliest ? row.tradeDate : earliest, rows[0].tradeDate),
    lastSeenDate, sampleCount: rows.length, labeledSampleCount: labeled.length,
    confidence: Number(confidence.toFixed(6)), evidenceGrade: grade, status, metrics, traits, summary, evidence: rows,
  }
}

function enrichEvidence(events: EvidenceRow[], bars: BarRow[], newsRows: NewsRow[], asOfDate: string): EnrichedEvidence[] {
  const barsByStock = new Map<string, BarRow[]>()
  for (const bar of bars) {
    const list = barsByStock.get(bar.stockCode) || []
    list.push(bar)
    barsByStock.set(bar.stockCode, list)
  }
  for (const list of barsByStock.values()) list.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
  const newsByStock = new Map<string, string[]>()
  for (const item of newsRows) {
    const list = newsByStock.get(item.stockCode) || []
    list.push(dateOnly(item.publishedAt))
    newsByStock.set(item.stockCode, list)
  }

  return events.map((event) => {
    const stockBars = barsByStock.get(event.stockCode) || []
    const index = stockBars.findIndex((bar) => bar.tradeDate === event.tradeDate)
    const bar = index >= 0 ? stockBars[index] : null
    const forward = (offset: number) => {
      const target = index >= 0 ? stockBars[index + offset] : null
      return bar && target && bar.close > 0 ? (target.close / bar.close - 1) * 100 : null
    }
    const sideSign = event.side === 'BUY' ? 1 : -1
    const nextFive = index >= 0 && bar ? stockBars.slice(index + 1, index + 6).map((item) => (item.close / bar.close - 1) * 100 * sideSign) : []
    const eventReturnPct = bar && bar.prevClose > 0 ? (bar.close / bar.prevClose - 1) * 100 : null
    const closeLocation = bar && bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : null
    const forward1Pct = forward(1)
    const forward3Pct = forward(3)
    const forward5Pct = forward(5)
    const recentNews = (newsByStock.get(event.stockCode) || []).some((date) => {
      const age = daysBetween(event.tradeDate, date)
      return date <= event.tradeDate && age <= 3
    })
    return {
      ...event, eventReturnPct, closeLocation, forward1Pct, forward3Pct, forward5Pct,
      alignedForward1Pct: forward1Pct === null ? null : forward1Pct * sideSign,
      alignedForward3Pct: forward3Pct === null ? null : forward3Pct * sideSign,
      alignedForward5Pct: forward5Pct === null ? null : forward5Pct * sideSign,
      maxFavorable5Pct: nextFive.length ? Math.max(...nextFive) : null,
      maxAdverse5Pct: nextFive.length ? Math.min(...nextFive) : null,
      recentNews,
      recencyWeight: Math.exp(-Math.log(2) * daysBetween(asOfDate, event.tradeDate) / RECENCY_HALF_LIFE_DAYS),
    }
  })
}

export async function refreshEntityProfiles(asOf = new Date()) {
  const asOfDate = shanghaiDateOnly(asOf)
  const lookbackStart = shanghaiDateOnly(new Date(asOf.getTime() - LOOKBACK_DAYS * 86_400_000))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: lockRows } = await client.query(`SELECT pg_try_advisory_xact_lock(73005005) AS acquired`)
    if (!lockRows[0]?.acquired) {
      await client.query('ROLLBACK')
      return {
        asOfDate,
        profileVersion: ENTITY_PROFILE_VERSION,
        entityCount: 0,
        evidenceCount: 0,
        warnings: ['另一画像刷新任务正在运行，本次安全跳过。'],
        skipped: true,
      }
    }
    const { rows: eventRows } = await client.query(
      `SELECT stock_code as "stockCode", trade_date::text as "tradeDate", disclosed_at as "disclosedAt",
              side, seat_name as "seatName", seat_type as "seatType", buy_amount as "buyAmount",
              sell_amount as "sellAmount", net_amount as "netAmount", source
       FROM dragon_tiger_seats
       WHERE trade_date BETWEEN $1::date AND $2::date
         AND disclosed_at <= $3::timestamptz AND ingested_at <= $3::timestamptz
       ORDER BY trade_date ASC`,
      [lookbackStart, asOfDate, asOf.toISOString()]
    )
    const events: EvidenceRow[] = eventRows.map((row) => ({
      ...row, side: String(row.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      buyAmount: finite(row.buyAmount), sellAmount: finite(row.sellAmount), netAmount: finite(row.netAmount),
    }))
    const stockCodes = [...new Set(events.map((row) => row.stockCode))]
    const bars: BarRow[] = stockCodes.length ? (await client.query(
      `SELECT stock_code as "stockCode", trade_date::text as "tradeDate", open, high, low, close, prev_close as "prevClose"
       FROM daily_bars WHERE stock_code = ANY($1::text[]) AND trade_date BETWEEN $2::date AND $3::date
         AND ingested_at <= $4::timestamptz
       ORDER BY stock_code, trade_date`, [stockCodes, lookbackStart, asOfDate, asOf.toISOString()]
    )).rows.map((row) => ({ ...row, open: finite(row.open), high: finite(row.high), low: finite(row.low), close: finite(row.close), prevClose: finite(row.prevClose) })) : []
    const newsRows: NewsRow[] = stockCodes.length ? (await client.query(
      `SELECT nsr.stock_code as "stockCode", na.published_at as "publishedAt"
       FROM news_articles na JOIN news_stock_relations nsr ON nsr.news_id = na.id
       WHERE nsr.stock_code = ANY($1::text[]) AND na.published_at <= $2::timestamptz
         AND na.ingested_at <= $2::timestamptz AND nsr.ingested_at <= $2::timestamptz`,
      [stockCodes, asOf.toISOString()]
    )).rows : []
    const enriched = enrichEvidence(events, bars, newsRows, asOfDate)
    const grouped = new Map<string, EnrichedEvidence[]>()
    for (const row of enriched) {
      const type = normalizeEntityType(row.seatType, row.seatName)
      const key = entityKey(row.seatName, type)
      const list = grouped.get(key) || []
      list.push(row)
      grouped.set(key, list)
    }
    const profiles = [...grouped.values()].map((rows) => computeProfile(rows, asOfDate))

    for (const profile of profiles) {
      await client.query(
        `INSERT INTO market_entities
          (entity_key, canonical_name, normalized_name, entity_type, first_seen_date, last_seen_date, source_count, updated_at)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, NOW())
         ON CONFLICT (entity_key) DO UPDATE SET canonical_name = EXCLUDED.canonical_name,
           first_seen_date = LEAST(market_entities.first_seen_date, EXCLUDED.first_seen_date),
           last_seen_date = GREATEST(market_entities.last_seen_date, EXCLUDED.last_seen_date),
           source_count = GREATEST(market_entities.source_count, EXCLUDED.source_count), updated_at = NOW()`,
        [profile.entityKey, profile.canonicalName, profile.normalizedName, profile.entityType,
          profile.firstSeenDate, profile.lastSeenDate, finite(profile.metrics.sourceCount, 1)]
      )
      await client.query(
        `INSERT INTO entity_behavior_profiles
          (entity_key, as_of_date, as_of_at, profile_version, sample_count, labeled_sample_count, confidence, evidence_grade, status, metrics, traits, evidence_summary)
         VALUES ($1, $2::date, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb)
         ON CONFLICT (entity_key, as_of_at, profile_version) DO NOTHING`,
        [profile.entityKey, asOfDate, asOf.toISOString(), ENTITY_PROFILE_VERSION, profile.sampleCount, profile.labeledSampleCount,
          profile.confidence, profile.evidenceGrade, profile.status, JSON.stringify(profile.metrics), JSON.stringify(profile.traits),
          JSON.stringify({ summary: profile.summary, lookbackStart, lookbackEnd: asOfDate, sources: ['dragon_tiger_seats', 'daily_bars', 'news_articles'] })]
      )
      const byStock = new Map<string, EnrichedEvidence[]>()
      for (const item of profile.evidence) {
        const list = byStock.get(item.stockCode) || []
        list.push(item)
        byStock.set(item.stockCode, list)
      }
      for (const [stockCode, stockRows] of byStock) {
        const latest = stockRows.reduce((current, item) => item.tradeDate > current.tradeDate ? item : current, stockRows[0])
        const sideSign = latest.side === 'BUY' ? 1 : -1
        const continuation = finite(profile.metrics.alignedForward5Pct)
        const eventRecency = Math.exp(-Math.log(2) * daysBetween(asOfDate, latest.tradeDate) / 20)
        const signal = clamp(sideSign * clamp(continuation / 3) * profile.confidence * eventRecency)
        await client.query(
          `INSERT INTO stock_entity_profile_links
            (stock_code, entity_key, as_of_date, as_of_at, profile_version, last_event_date, last_side, appearance_count, weighted_signal, confidence, evidence)
           VALUES ($1, $2, $3::date, $4::timestamptz, $5, $6::date, $7, $8, $9, $10, $11::jsonb)
           ON CONFLICT (stock_code, entity_key, as_of_at, profile_version) DO NOTHING`,
          [stockCode, profile.entityKey, asOfDate, asOf.toISOString(), ENTITY_PROFILE_VERSION, latest.tradeDate, latest.side,
            stockRows.length, Number(signal.toFixed(6)), profile.confidence,
            JSON.stringify({ latestSource: latest.source, lastNetAmount: latest.netAmount, profileGrade: profile.evidenceGrade })]
        )
      }
    }
    const warnings = profiles.length ? [] : ['尚无已入库的龙虎榜席位证据，未生成机构/游资画像。']
    await client.query(
      `INSERT INTO entity_profile_refresh_runs (run_at, as_of_date, profile_version, entity_count, evidence_count, warnings)
       VALUES ($1::timestamptz, $2::date, $3, $4, $5, $6::jsonb)`,
      [asOf.toISOString(), asOfDate, ENTITY_PROFILE_VERSION, profiles.length, events.length, JSON.stringify(warnings)]
    )
    await client.query('COMMIT')
    return { asOfDate, profileVersion: ENTITY_PROFILE_VERSION, entityCount: profiles.length, evidenceCount: events.length, warnings }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function getStockEntityProfiles(stockCode: string, asOf: Date) {
  const requestedAsOf = asOf.toISOString()
  const { rows } = await pool.query(
    `WITH latest_snapshot AS (
       SELECT MAX(as_of_at) AS value FROM stock_entity_profile_links
       WHERE stock_code = $1 AND as_of_at <= $2::timestamptz AND profile_version = $3
     )
     SELECT l.stock_code as "stockCode", l.as_of_date as "asOfDate", l.as_of_at as "asOfAt", l.last_event_date as "lastEventDate",
            l.last_side as "lastSide", l.appearance_count as "stockAppearanceCount", l.weighted_signal as "weightedSignal",
            l.confidence, e.canonical_name as "name", e.entity_type as "entityType",
            p.sample_count as "sampleCount", p.labeled_sample_count as "labeledSampleCount",
            p.evidence_grade as "evidenceGrade", p.status, p.metrics, p.traits, p.evidence_summary as "evidenceSummary"
     FROM stock_entity_profile_links l
     JOIN latest_snapshot ls ON l.as_of_at = ls.value
     JOIN market_entities e ON e.entity_key = l.entity_key
     JOIN entity_behavior_profiles p ON p.entity_key = l.entity_key AND p.as_of_at = l.as_of_at AND p.profile_version = l.profile_version
     WHERE l.stock_code = $1 AND l.profile_version = $3
     ORDER BY ABS(l.weighted_signal) * l.confidence DESC, p.sample_count DESC
     LIMIT 10`,
    [stockCode, requestedAsOf, ENTITY_PROFILE_VERSION]
  )
  const researchReady = rows.filter((row) => row.status === 'RESEARCH_READY')
  const totalConfidence = researchReady.reduce((sum, row) => sum + finite(row.confidence), 0)
  const signal = totalConfidence > 0
    ? clamp(researchReady.reduce((sum, row) => sum + finite(row.weightedSignal) * finite(row.confidence), 0) / totalConfidence)
    : 0
  return {
    stockCode, requestedAsOf, snapshotAsOf: rows[0]?.asOfAt || null, profileVersion: ENTITY_PROFILE_VERSION,
    signal: Number(signal.toFixed(6)),
    confidence: researchReady.length ? Number((totalConfidence / researchReady.length).toFixed(6)) : 0,
    sampleEntityCount: rows.length,
    researchReadyEntityCount: researchReady.length,
    profiles: rows,
    warnings: rows.length ? [] : ['尚无该标的可验证机构/游资历史画像；不会使用股东名称代替交易席位。'],
  }
}
