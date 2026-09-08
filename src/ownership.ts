const EASTMONEY_HOLDER_API = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

type RawHolder = Record<string, unknown>

export interface OwnershipProfile {
  stockCode: string
  asOf: string
  reportDate: string | null
  noticeDate: string | null
  reportName: string | null
  sourceName: string
  sourceUrl: string
  dataNature: string
  topHolders: Array<{
    rank: number
    name: string
    shares: number
    ratioPct: number
    direction: string
    changeShares: number | null
    holderNature: string
    shareType: string
    profileLabel: string
    behaviorObservation: string
  }>
  summary: {
    disclosedTopHolderRatioPct: number
    topOneRatioPct: number
    topThreeRatioPct: number
    increasedCount: number
    decreasedCount: number
    unchangedCount: number
    newCount: number
  }
  warnings: string[]
}

const cache = new Map<string, { expiresAt: number; value: OwnershipProfile }>()

function dateOnly(value: unknown): string {
  return String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || ''
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function profileLabel(row: RawHolder): string {
  const name = String(row.HOLDER_NAME || '')
  const nature = String(row.HOLDER_NATURE || row.HOLDER_TYPE_ORG || '')
  const shareType = String(row.SHARES_TYPE || '')
  if (name.includes('香港中央结算(代理人)')) return '托管汇总账户'
  if (name === '香港中央结算有限公司' && shareType.includes('A股')) return '北向持仓汇总'
  if (/基金|保险|社保|QFII|理财|资管/.test(`${nature}${name}`)) return '专业机构配置'
  if (/国有|国资|财政|人民政府|国有资产/.test(`${nature}${name}`)) return '国资或政府背景'
  if (/自然人|个人/.test(nature)) return '个人大股东'
  if (/公司|集团|控股|企业|合伙/.test(`${nature}${name}`)) return '产业或法人股东'
  return '账户性质待核实'
}

function behaviorObservation(row: RawHolder): string {
  const name = String(row.HOLDER_NAME || '')
  const direction = String(row.DIRECTION || row.HOLDNUM_CHANGE_NAME || '变化未知')
  const nature = String(row.HOLDER_NATURE || row.HOLDER_TYPE_ORG || '类型未披露')
  const shareType = String(row.SHARES_TYPE || '')
  const ratioPct = finiteNumber(row.HOLD_RATIO)
  if (name.includes('香港中央结算(代理人)')) {
    return `本期${direction}；这是境外投资者名义托管汇总账户，不代表某一家机构，不能据此判断盘中操盘行为。`
  }
  if (name === '香港中央结算有限公司' && shareType.includes('A股')) {
    return `本期${direction}；通常反映陆股通合计持仓变化，只能观察报告期配置方向，不能定位具体外资机构。`
  }
  if (/基金|保险|社保|QFII|理财|资管/.test(`${nature}${name}`)) {
    return `本期${direction}；属于机构配置型账户。公开证据只支持报告期持仓变化，不支持推断日内拉升或砸盘习惯。`
  }
  if (/国有|国资|财政|人民政府|国有资产/.test(`${nature}${name}`)) {
    return `本期${direction}；属于国资或政府背景持股，通常更应从公司治理和长期配置角度观察，不能据此推断盘中交易动作。`
  }
  if (/自然人|个人/.test(nature)) {
    return `本期${direction}；属于个人大股东${ratioPct >= 5 ? '且披露比例较高' : ''}。公开报告不能识别其账户是否在盘中实际交易。`
  }
  if (/公司|集团|控股|企业|合伙/.test(`${nature}${name}`)) {
    return `本期${direction}；属于产业或法人股东${ratioPct >= 5 ? '且披露比例较高' : ''}，更适合观察持股稳定性与治理关系，不能当作短线席位画像。`
  }
  return `本期${direction}；当前仅能确认定期报告中的持仓数量与变化，暂无足够证据描述其盘中交易风格。`
}

function emptyProfile(stockCode: string, asOf: string, warning: string): OwnershipProfile {
  return {
    stockCode,
    asOf,
    reportDate: null,
    noticeDate: null,
    reportName: null,
    sourceName: '东方财富股东分析（公开披露汇总）',
    sourceUrl: `https://data.eastmoney.com/gdfx/stock/${stockCode}.html`,
    dataNature: '定期报告前十大股东快照，不是盘中账户、游资席位或实时持仓。',
    topHolders: [],
    summary: { disclosedTopHolderRatioPct: 0, topOneRatioPct: 0, topThreeRatioPct: 0, increasedCount: 0, decreasedCount: 0, unchangedCount: 0, newCount: 0 },
    warnings: [warning],
  }
}

async function fetchHolderPayload(url: URL): Promise<any> {
  let lastError: unknown = new Error('公开股东数据源不可用')
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 7000)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 ZeroQuant/1.0',
          Referer: 'https://data.eastmoney.com/gdfx/',
        },
      })
      if (!response.ok) throw new Error(`holder source returned HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

export async function fetchOwnershipProfile(stockCode: string, asOf: string): Promise<OwnershipProfile> {
  if (!/^\d{6}$/.test(stockCode) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('invalid stock code or date')
  const cacheKey = `${stockCode}|${asOf}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const url = new URL(EASTMONEY_HOLDER_API)
  for (const [key, value] of Object.entries({
    reportName: 'RPT_DMSK_HOLDERS', columns: 'ALL', source: 'WEB', client: 'WEB',
    pageNumber: '1', pageSize: '20', sortColumns: 'END_DATE,RANK', sortTypes: '-1,1',
    filter: `(SECURITY_CODE="${stockCode}")`,
  })) url.searchParams.set(key, value)

  const rows: RawHolder[] = []
  try {
    for (let pageNumber = 1; pageNumber <= 12; pageNumber++) {
      url.searchParams.set('pageNumber', String(pageNumber))
      const payload = await fetchHolderPayload(url)
      if (payload?.success !== true || !Array.isArray(payload?.result?.data)) {
        throw new Error(String(payload?.message || '公开股东数据返回异常'))
      }
      const pageRows = payload.result.data as RawHolder[]
      rows.push(...pageRows)
      if (pageRows.some((row) => dateOnly(row.NOTICE_DATE) && dateOnly(row.NOTICE_DATE) <= asOf)) break
      if (pageNumber >= finiteNumber(payload?.result?.pages, 1)) break
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const value = emptyProfile(stockCode, asOf, `公开股东数据源暂时不可用：${reason}`)
    cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, value })
    return value
  }

    const eligible = rows.filter((row) => dateOnly(row.NOTICE_DATE) && dateOnly(row.NOTICE_DATE) <= asOf)
    if (eligible.length === 0) {
      const value = emptyProfile(stockCode, asOf, '截至所选日期，没有查到已公开披露的前十大股东记录。')
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value })
      return value
    }

    const reportDate = eligible.reduce((latest, row) => dateOnly(row.END_DATE) > latest ? dateOnly(row.END_DATE) : latest, '')
    const reportRows = eligible
      .filter((row) => dateOnly(row.END_DATE) === reportDate)
      .sort((a, b) => finiteNumber(a.RANK, 999) - finiteNumber(b.RANK, 999))
      .slice(0, 10)
    const topHolders = reportRows.map((row) => ({
      rank: finiteNumber(row.RANK),
      name: String(row.HOLDER_NAME || '名称未披露'),
      shares: finiteNumber(row.HOLD_NUM),
      ratioPct: finiteNumber(row.HOLD_RATIO),
      direction: String(row.DIRECTION || row.HOLDNUM_CHANGE_NAME || '变化未知'),
      changeShares: row.HOLD_NUM_CHANGE === null || row.HOLD_NUM_CHANGE === undefined ? null : finiteNumber(row.HOLD_NUM_CHANGE),
      holderNature: String(row.HOLDER_NATURE || row.HOLDER_TYPE_ORG || '类型未披露'),
      shareType: String(row.SHARES_TYPE || '股份类型未披露'),
      profileLabel: profileLabel(row),
      behaviorObservation: behaviorObservation(row),
    }))
    const directions = topHolders.map((holder) => holder.direction)
    const noticeDate = reportRows.reduce((latest, row) => dateOnly(row.NOTICE_DATE) > latest ? dateOnly(row.NOTICE_DATE) : latest, '')
    const value: OwnershipProfile = {
      stockCode,
      asOf,
      reportDate,
      noticeDate: noticeDate || null,
      reportName: String(reportRows[0]?.REPORT_DATE_NAME || '') || null,
      sourceName: '东方财富股东分析（公开披露汇总）',
      sourceUrl: `https://data.eastmoney.com/gdfx/stock/${stockCode}.html`,
      dataNature: '定期报告前十大股东快照，不是盘中账户、游资席位或实时持仓。',
      topHolders,
      summary: {
        disclosedTopHolderRatioPct: Number(topHolders.reduce((sum, holder) => sum + holder.ratioPct, 0).toFixed(2)),
        topOneRatioPct: Number((topHolders[0]?.ratioPct || 0).toFixed(2)),
        topThreeRatioPct: Number(topHolders.slice(0, 3).reduce((sum, holder) => sum + holder.ratioPct, 0).toFixed(2)),
        increasedCount: directions.filter((item) => item.includes('增')).length,
        decreasedCount: directions.filter((item) => item.includes('减')).length,
        unchangedCount: directions.filter((item) => item.includes('不变')).length,
        newCount: directions.filter((item) => item.includes('新进')).length,
      },
      warnings: [
        '持股数据按定期报告披露，存在披露滞后，不能代表当前分钟真实持仓。',
        '股东名称与游资营业部席位不是同一概念，公开成交不能反推出具体操盘者。',
      ],
    }
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value })
    return value
}
