import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { pool } from '../src/db.js'

const { Pool } = pg
const BASE_URL = process.env.ZEROQUANT_E2E_BASE_URL || 'http://127.0.0.1:3002'
const INTERNAL_TOKEN = process.env.ZEROQUANT_E2E_INTERNAL_TOKEN || ''
const DATABASE_URL = process.env.DATABASE_URL || ''
const TEST_DATE = '2099-01-06'
const FUTURE_DATE = '2099-01-07'
const marker = String(Date.now())
const STOCK_CODE = `99${marker.slice(-4)}`
const phoneA = `138${marker.slice(-8)}`
const phoneB = `139${marker.slice(-8)}`
const SEAT_NAME = `E2E活跃营业部${marker}`

function assertSafeEnvironment() {
  const databaseName = (() => {
    try { return new URL(DATABASE_URL).pathname.replace(/^\//, '') }
    catch { return '' }
  })()
  assert.equal(process.env.NODE_ENV, 'test', 'E2E 只能在 NODE_ENV=test 下运行')
  assert.equal(process.env.ZEROQUANT_E2E_CONFIRM, 'true', '必须显式设置 ZEROQUANT_E2E_CONFIRM=true')
  assert.ok(/(?:^|[_-])(test|e2e)(?:$|[_-])/i.test(databaseName), `数据库 ${databaseName || '(空)'} 不是专用测试库`)
  assert.ok(INTERNAL_TOKEN.length >= 16, '必须通过 ZEROQUANT_E2E_INTERNAL_TOKEN 提供测试服务的内部令牌')
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

function forecastPayload(overrides: Record<string, unknown> = {}) {
  return {
    runId: randomUUID(), stockCode: STOCK_CODE, tradeDate: TEST_DATE,
    asOf: `${TEST_DATE}T09:20:00+08:00`, mode: 'daily', referencePrice: 10,
    previousClose: 9.9, modelVersion: 'e2e-bootstrap', modelState: 'untrained_bootstrap',
    modelCalibrated: false, inputHash: 'a'.repeat(64),
    regime: { name: 'range_bound', confidence: 0.5, reasons: [] },
    features: { qualityScore: 1, qualityFlags: [], observedAt: `${TEST_DATE}T09:20:00+08:00`, values: {} },
    warnings: [],
    horizons: [{
      horizonMinutes: 15, pUp: 0.4, pFlat: 0.35, pDown: 0.25,
      expectedReturnPct: 0.2, q10ReturnPct: -0.8, q50ReturnPct: 0.1,
      q90ReturnPct: 1, confidence: 0.6, actionable: false, reasons: [],
    }],
    legacyCurve: [{ time: '09:30', price: 10, lower: 9.9, upper: 10.1 }],
    ...overrides,
  }
}

async function cleanup() {
  await pool.query('DELETE FROM user_chat_messages WHERE user_id IN (SELECT id::text FROM users WHERE phone = ANY($1))', [[phoneA, phoneB]])
  await pool.query('DELETE FROM user_trade_actions WHERE user_id IN (SELECT id::text FROM users WHERE phone = ANY($1))', [[phoneA, phoneB]])
  await pool.query('DELETE FROM user_positions WHERE user_id IN (SELECT id::text FROM users WHERE phone = ANY($1))', [[phoneA, phoneB]])
  await pool.query('DELETE FROM users WHERE phone = ANY($1)', [[phoneA, phoneB]])
  await pool.query('DELETE FROM stock_entity_profile_links WHERE stock_code = $1', [STOCK_CODE])
  await pool.query('DELETE FROM entity_behavior_profiles WHERE entity_key IN (SELECT entity_key FROM market_entities WHERE canonical_name = $1)', [SEAT_NAME])
  await pool.query('DELETE FROM market_entities WHERE canonical_name = $1', [SEAT_NAME])
  await pool.query('DELETE FROM entity_profile_refresh_runs WHERE as_of_date = $1::date', [TEST_DATE])
  await pool.query('DELETE FROM dragon_tiger_seats WHERE stock_code = $1', [STOCK_CODE])
  await pool.query('DELETE FROM daily_bars WHERE stock_code = $1', [STOCK_CODE])
  await pool.query('DELETE FROM quant_prediction_runs WHERE stock_code = $1', [STOCK_CODE])
  await pool.query('DELETE FROM stock_rolling_predictions WHERE stock_code = $1', [STOCK_CODE])
  await pool.query('DELETE FROM stock_day_predictions WHERE stock_code = $1', [STOCK_CODE])
  await pool.query('DELETE FROM stock_price_histories WHERE stock_code = $1', [STOCK_CODE])
  await pool.query('DELETE FROM stocks WHERE code = $1', [STOCK_CODE])
}

async function runAllTests() {
  assertSafeEnvironment()
  let tokenA = ''
  let tokenB = ''
  let userAId = ''

  try {
    await cleanup()
    await pool.query(
      `INSERT INTO stocks (code, full_code, name, current_price, yesterday_price, high_price, low_price)
       VALUES ($1, $2, 'E2E临时标的', 10, 9.9, 10.1, 9.8)`,
      [STOCK_CODE, `sh${STOCK_CODE}`]
    )

    console.log('[1/21] 服务和测试数据库同源')
    assert.equal((await request('/health')).status, 200)
    const stocks = await request('/api/v1/stocks')
    assert.equal(stocks.status, 200)
    assert.ok(stocks.data.data.some((stock: any) => stock.code === STOCK_CODE), 'API 服务没有连接当前专用测试库')

    console.log('[2/21] 注册两个临时用户')
    const regA = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ phone: phoneA, username: 'E2E用户A', password: 'Password123!' }) })
    const regB = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ phone: phoneB, username: 'E2E用户B', password: 'Password123!' }) })
    assert.equal(regA.status, 200)
    assert.equal(regB.status, 200)
    tokenA = regA.data.data.token
    tokenB = regB.data.data.token
    userAId = String(regA.data.data.user.id)

    console.log('[3/21] 登录和未授权拦截')
    assert.equal((await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ phone: phoneA, password: 'Password123!' }) })).status, 200)
    assert.equal((await request('/api/v1/user/position', { method: 'POST', body: '{}' })).status, 401)

    console.log('[4/21] 多租户聊天隔离')
    await pool.query(
      `INSERT INTO user_chat_messages (user_id, stock_code, role, content)
       VALUES ($1, $2, 'user', 'E2E用户A私有内容')`,
      [userAId, STOCK_CODE]
    )
    const userBMessages = await request(`/api/v1/chat/messages?stockCode=${STOCK_CODE}`, { headers: auth(tokenB) })
    assert.equal(userBMessages.status, 200)
    assert.equal(userBMessages.data.data.some((item: any) => String(item.content).includes('E2E用户A私有内容')), false)

    console.log('[5/21] 设置初始持仓')
    assert.equal((await request('/api/v1/user/position', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ stockCode: STOCK_CODE, holdingShares: 10000, costPrice: 6.5 }) })).status, 200)

    console.log('[6/21] 买入原子更新股数和成本')
    const buy = await request('/api/v1/user/trade-action', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ stockCode: STOCK_CODE, actionType: 'BUY', tradePrice: 6.8, tradeShares: 2000 }) })
    assert.equal(buy.status, 200)
    const buyId = Number(buy.data.data.id)
    let position = (await pool.query('SELECT holding_shares, cost_price FROM user_positions WHERE user_id = $1 AND stock_code = $2', [userAId, STOCK_CODE])).rows[0]
    assert.equal(Number(position.holding_shares), 12000)
    assert.equal(Number(position.cost_price), 6.55)

    console.log('[7/21] 卖出原子更新持仓')
    const sell = await request('/api/v1/user/trade-action', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ stockCode: STOCK_CODE, actionType: 'SELL', tradePrice: 7.1, tradeShares: 3000 }) })
    assert.equal(sell.status, 200)
    const sellId = Number(sell.data.data.id)
    position = (await pool.query('SELECT holding_shares FROM user_positions WHERE user_id = $1 AND stock_code = $2', [userAId, STOCK_CODE])).rows[0]
    assert.equal(Number(position.holding_shares), 9000)

    console.log('[8/21] 超卖被拒绝且不留下成交')
    const countBefore = Number((await pool.query('SELECT COUNT(*) FROM user_trade_actions WHERE user_id = $1', [userAId])).rows[0].count)
    const oversell = await request('/api/v1/user/trade-action', { method: 'POST', headers: auth(tokenA), body: JSON.stringify({ stockCode: STOCK_CODE, actionType: 'SELL', tradePrice: 7.2, tradeShares: 999999 }) })
    assert.equal(oversell.status, 400)
    const countAfter = Number((await pool.query('SELECT COUNT(*) FROM user_trade_actions WHERE user_id = $1', [userAId])).rows[0].count)
    assert.equal(countAfter, countBefore)

    console.log('[9/21] 禁止撤销非最新成交')
    assert.equal((await request(`/api/v1/user/trade-action/${buyId}`, { method: 'DELETE', headers: auth(tokenA) })).status, 409)

    console.log('[10/21] 撤销最新卖出并恢复完整快照')
    const undoSell = await request(`/api/v1/user/trade-action/${sellId}`, { method: 'DELETE', headers: auth(tokenA) })
    assert.equal(undoSell.status, 200)
    assert.equal(Number(undoSell.data.data.holdingShares), 12000)
    assert.equal(Number(undoSell.data.data.costPrice), 6.55)

    console.log('[11/21] 撤销最新买入并恢复初始成本')
    const undoBuy = await request(`/api/v1/user/trade-action/${buyId}`, { method: 'DELETE', headers: auth(tokenA) })
    assert.equal(undoBuy.status, 200)
    assert.equal(Number(undoBuy.data.data.holdingShares), 10000)
    assert.equal(Number(undoBuy.data.data.costPrice), 6.5)

    console.log('[12/21] 盘前预测写库')
    const dailyRunId = randomUUID()
    assert.equal((await request('/api/v1/quant/prediction-runs', { method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN }, body: JSON.stringify(forecastPayload({ runId: dailyRunId })) })).status, 200)

    console.log('[13/21] 历史 asOf 不读取未来运行')
    const futurePayload = forecastPayload({ runId: randomUUID(), tradeDate: FUTURE_DATE, asOf: `${FUTURE_DATE}T09:20:00+08:00` })
    assert.equal((await request('/api/v1/quant/prediction-runs', { method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN }, body: JSON.stringify(futurePayload) })).status, 200)
    const historical = await request(`/api/v1/quant/stocks/${STOCK_CODE}/latest-forecast?asOf=${TEST_DATE}`)
    assert.equal(historical.status, 200)
    assert.equal(historical.data.data.runId, dailyRunId)

    console.log('[14/21] 盘中前向曲线写库')
    const realtimePayload = forecastPayload({ runId: randomUUID(), mode: 'realtime', asOf: `${TEST_DATE}T10:00:00+08:00`, legacyCurve: [{ time: '10:00', price: 10, leadMinutes: 0 }, { time: '10:05', price: 10.05, leadMinutes: 5 }] })
    assert.equal((await request('/api/v1/quant/prediction-runs', { method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN }, body: JSON.stringify(realtimePayload) })).status, 200)
    const rolling = await pool.query('SELECT target_time FROM stock_rolling_predictions WHERE stock_code = $1 AND predict_date = $2 ORDER BY target_time', [STOCK_CODE, TEST_DATE])
    assert.deepEqual(rolling.rows.map((row) => row.target_time), ['10:00', '10:05'])

    console.log('[15/21] sync-point 行情和滚动线同事务写入')
    const sync = await request('/api/v1/stocks/sync-point', { method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN }, body: JSON.stringify({ stockCode: STOCK_CODE, realPrice: 10.02, currentPrice: 10.02, highPrice: 10.1, lowPrice: 9.8, pct: 1.2, tradeDate: TEST_DATE, timestampStr: `${TEST_DATE}T10:01:00+08:00`, rollingPredictions: [{ targetTime: '10:01', predictedPrice: 10.02, leadMinutes: 0 }, { targetTime: '10:02', predictedPrice: 10.03, leadMinutes: 1 }] }) })
    assert.equal(sync.status, 200)
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM stock_price_histories WHERE stock_code = $1', [STOCK_CODE])).rows[0].count), 1)
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM stock_rolling_predictions WHERE stock_code = $1 AND predict_date = $2', [STOCK_CODE, TEST_DATE])).rows[0].count), 4)
    const replay = await request(`/api/v1/stocks/${STOCK_CODE}/advanced-history?date=${TEST_DATE}`)
    assert.equal(replay.status, 200)
    assert.deepEqual(replay.data.data.rollingPredictions.map((row: any) => row.targetTime), ['10:02', '10:05'])
    assert.equal(replay.data.data.rollingEvaluation.snapshotCount, 2)
    assert.equal(replay.data.data.rollingEvaluation.storedPointCount, 4)

    console.log('[16/21] 已校准生产模型仍受陈旧数据硬门禁')
    const staleRunId = randomUUID()
    const stale = forecastPayload({
      runId: staleRunId, mode: 'realtime', modelVersion: 'e2e-champion', modelState: 'champion', modelCalibrated: true,
      features: { qualityScore: 1, qualityFlags: ['stale_quote_over_10_minutes'], observedAt: `${TEST_DATE}T09:00:00+08:00`, values: {} },
      legacyCurve: [],
      horizons: [{ horizonMinutes: 15, pUp: 0.8, pFlat: 0.1, pDown: 0.1, expectedReturnPct: 1, q10ReturnPct: 0.2, q50ReturnPct: 1, q90ReturnPct: 2, confidence: 0.9, actionable: true, reasons: [] }],
    })
    assert.equal((await request('/api/v1/quant/prediction-runs', { method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN }, body: JSON.stringify(stale) })).status, 200)
    assert.equal((await pool.query('SELECT actionable FROM quant_horizon_forecasts WHERE run_id = $1', [staleRunId])).rows[0].actionable, false)

    console.log('[17/21] 事务中途失败不残留父预测')
    const badRunId = randomUUID()
    const badPayload = forecastPayload({ runId: badRunId, mode: 'realtime', legacyCurve: [{ time: 'TIME-TOO-LONG', price: 10 }] })
    assert.equal((await request('/api/v1/quant/prediction-runs', { method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN }, body: JSON.stringify(badPayload) })).status, 500)
    assert.equal((await pool.query('SELECT COUNT(*) FROM quant_prediction_runs WHERE run_id = $1', [badRunId])).rows[0].count, '0')

    console.log('[18/21] 画像证据批量入库并拒绝非法批次')
    const barRecords = Array.from({ length: 20 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0')
      const close = 10 + index * 0.1
      return { stockCode: STOCK_CODE, tradeDate: `2098-12-${day}`, open: close - 0.03,
        high: close + 0.08, low: close - 0.08, close, prevClose: index ? 10 + (index - 1) * 0.1 : 9.9,
        volume: 100000 + index, amount: (100000 + index) * close, source: 'e2e' }
    })
    const barIngest = await request('/api/v1/quant/profile-evidence/daily-bars/batch', {
      method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN }, body: JSON.stringify({ records: barRecords }),
    })
    assert.equal(barIngest.status, 200)
    const seatRecords = Array.from({ length: 8 }, (_, index) => ({
      stockCode: STOCK_CODE, tradeDate: `2098-12-${String(index + 1).padStart(2, '0')}`,
      side: 'BUY', rank: 1, seatName: SEAT_NAME, seatType: 'HOT_MONEY',
      buyAmount: 10000000, sellAmount: 1000000, netAmount: 9000000,
      source: 'e2e', disclosedAt: `2098-12-${String(index + 1).padStart(2, '0')}T16:30:00+08:00`,
    }))
    const seatIngest = await request('/api/v1/quant/profile-evidence/dragon-tiger/batch', {
      method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN }, body: JSON.stringify({ records: seatRecords }),
    })
    assert.equal(seatIngest.status, 200)
    const invalidSeatIngest = await request('/api/v1/quant/profile-evidence/dragon-tiger/batch', {
      method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN }, body: JSON.stringify({ records: [...seatRecords, { broken: true }] }),
    })
    assert.equal(invalidSeatIngest.status, 400)
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM dragon_tiger_seats WHERE stock_code = $1', [STOCK_CODE])).rows[0].count), 8)

    console.log('[19/21] 画像满足样本门槛并形成可解释统计标签')
    const refresh = await request('/api/v1/quant/entity-profiles/refresh', {
      method: 'POST', headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN },
      body: JSON.stringify({ asOf: `${TEST_DATE}T18:25:00+08:00` }),
    })
    assert.equal(refresh.status, 200)
    const afterProfile = await request(`/api/v1/quant/stocks/${STOCK_CODE}/entity-profiles?asOf=${TEST_DATE}T19:00:00%2B08:00`)
    assert.equal(afterProfile.status, 200)
    assert.equal(afterProfile.data.data.researchReadyEntityCount, 1)
    assert.equal(afterProfile.data.data.profiles[0].status, 'RESEARCH_READY')
    assert.equal(afterProfile.data.data.profiles[0].sampleCount, 8)
    assert.ok(afterProfile.data.data.profiles[0].traits.length > 0)

    console.log('[20/21] 历史查询不会读取未来才生成的画像快照')
    const beforeProfile = await request(`/api/v1/quant/stocks/${STOCK_CODE}/entity-profiles?asOf=${TEST_DATE}T12:00:00%2B08:00`)
    assert.equal(beforeProfile.status, 200)
    assert.equal(beforeProfile.data.data.profiles.length, 0)
    assert.equal(beforeProfile.data.data.signal, 0)

    console.log('[21/21] 独立数据库连接可见已提交数据')
    const independentPool = new Pool({ connectionString: DATABASE_URL })
    try {
      assert.equal((await independentPool.query('SELECT COUNT(*) FROM quant_prediction_runs WHERE run_id = $1', [dailyRunId])).rows[0].count, '1')
    } finally {
      await independentPool.end()
    }

    console.log('✅ 21 项隔离 E2E 基线测试全部通过')
  } finally {
    await cleanup()
  }
}

runAllTests()
  .catch((error) => {
    console.error('❌ E2E 测试失败:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
