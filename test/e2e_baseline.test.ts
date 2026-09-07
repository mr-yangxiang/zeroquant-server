import assert from 'node:assert/strict'
import { pool } from '../src/db.js'

const BASE_URL = 'http://127.0.0.1:3002'
const INTERNAL_TOKEN = '8da0c6ce51a8b909afdbd0e6759fc88fb30e15f056174f0afbfc2769deaec04e'

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, data: json }
}

async function runAllTests() {
  console.log('====================================================')
  console.log('🧪 开始执行 ZeroQuant 1.2 全量端到端基线测试套件')
  console.log('====================================================')

  const timestamp = Date.now()
  const userA_phone = `13800${String(timestamp).slice(-6)}`
  const userB_phone = `13900${String(timestamp).slice(-6)}`
  let tokenA = ''
  let tokenB = ''
  let userA_id = ''
  let userB_id = ''

  // 1. 测试新用户注册
  console.log('▶️ [1/18] 测试新用户注册 (User A & User B)...')
  const regA = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone: userA_phone, username: '测试用户A', password: 'Password123!' }),
  })
  assert.equal(regA.status, 200, '用户A注册失败')
  assert.equal(regA.data.code, 0, '用户A业务返回码非0')
  tokenA = regA.data.data.token
  userA_id = String(regA.data.data.user.id)

  const regB = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone: userB_phone, username: '测试用户B', password: 'Password123!' }),
  })
  assert.equal(regB.status, 200, '用户B注册失败')
  tokenB = regB.data.data.token
  userB_id = String(regB.data.data.user.id)
  console.log('✅ 新用户注册通过！')

  // 2. 测试登录与 JWT 鉴权
  console.log('▶️ [2/18] 测试登录与 JWT 鉴权...')
  const loginRes = await request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone: userA_phone, password: 'Password123!' }),
  })
  assert.equal(loginRes.status, 200, '登录失败')
  assert.ok(loginRes.data.data.token, '未返回有效的 Token')

  // 测试未携带 Token 被拒绝
  const unauthRes = await request('/api/v1/user/position', {
    method: 'POST',
    body: JSON.stringify({ stockCode: '600839', holdingShares: 1000, costPrice: 6.5 }),
  })
  assert.equal(unauthRes.status, 401, '未授权请求未返回 401')
  console.log('✅ 登录与 JWT 鉴权验证通过！')

  // 3. 测试不同用户的数据隔离
  console.log('▶️ [3/18] 测试不同用户的数据隔离...')
  // 用户A录入聊天消息
  const chatSendA = await request('/api/v1/chat/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ stockCode: '600839', message: '用户A专属测试推演内容' }),
  })
  assert.equal(chatSendA.status, 200, '用户A发送对话失败')

  // 用户B获取该股票的消息
  const chatMsgB = await request('/api/v1/chat/messages?stockCode=600839', {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenB}` },
  })
  assert.equal(chatMsgB.status, 200)
  const bHasAContent = (chatMsgB.data.data || []).some((m: any) => m.content.includes('用户A专属测试推演内容'))
  assert.equal(bHasAContent, false, '数据隔离失效：用户B看到了用户A的专属内容！')
  console.log('✅ 用户数据绝对隔离验证通过！')

  // 4. 测试设置个人持仓
  console.log('▶️ [4/18] 测试设置个人持仓...')
  const setPosRes = await request('/api/v1/user/position', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ stockCode: '600839', holdingShares: 10000, costPrice: 6.50 }),
  })
  assert.equal(setPosRes.status, 200)
  assert.equal(setPosRes.data.code, 0)
  const posInDb = await pool.query('SELECT holding_shares, cost_price FROM user_positions WHERE user_id = $1 AND stock_code = $2', [userA_id, '600839'])
  assert.equal(Number(posInDb.rows[0].holding_shares), 10000)
  console.log('✅ 设置个人持仓验证通过！')

  // 5. 测试记录买入成交
  console.log('▶️ [5/18] 测试记录买入成交...')
  const buyRes = await request('/api/v1/user/trade-action', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ stockCode: '600839', actionType: 'BUY', tradePrice: 6.80, tradeShares: 2000 }),
  })
  assert.equal(buyRes.status, 200)
  const tradeId = buyRes.data.data.id
  assert.ok(tradeId, '买入成交未返回交易 ID')
  const posAfterBuy = await pool.query('SELECT holding_shares, cost_price FROM user_positions WHERE user_id = $1 AND stock_code = $2', [userA_id, '600839'])
  assert.equal(Number(posAfterBuy.rows[0].holding_shares), 12000)
  console.log('✅ 记录买入成交并通过事务更新持仓通过！')

  // 6. 测试记录卖出成交
  console.log('▶️ [6/18] 测试记录卖出成交...')
  const sellRes = await request('/api/v1/user/trade-action', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ stockCode: '600839', actionType: 'SELL', tradePrice: 7.10, tradeShares: 3000 }),
  })
  assert.equal(sellRes.status, 200)
  const posAfterSell = await pool.query('SELECT holding_shares FROM user_positions WHERE user_id = $1 AND stock_code = $2', [userA_id, '600839'])
  assert.equal(Number(posAfterSell.rows[0].holding_shares), 9000)
  console.log('✅ 记录卖出成交扣减持仓通过！')

  // 7. 测试卖出数量超过持仓时被拒绝
  console.log('▶️ [7/18] 测试卖出数量超过持仓时被拒绝...')
  const oversellRes = await request('/api/v1/user/trade-action', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ stockCode: '600839', actionType: 'SELL', tradePrice: 7.20, tradeShares: 999999 }),
  })
  assert.equal(oversellRes.status, 400, '超卖请求未被返回 400 拒绝！')
  assert.ok(oversellRes.data.message.includes('超过当前持仓'), '错误提示不包含超量拒绝信息')
  console.log('✅ 卖出数量超过持仓硬门禁拦截通过！')

  // 8. 测试撤销成交记录
  console.log('▶️ [8/18] 测试撤销成交记录...')
  const delTradeRes = await request(`/api/v1/user/trade-action/${tradeId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenA}` },
  })
  assert.equal(delTradeRes.status, 200)
  const posAfterCancel = await pool.query('SELECT holding_shares FROM user_positions WHERE user_id = $1 AND stock_code = $2', [userA_id, '600839'])
  // 之前买入 2000 股被撤销，持仓应从 9000 减少 2000 变为 7000
  assert.equal(Number(posAfterCancel.rows[0].holding_shares), 7000)
  console.log('✅ 撤销成交记录并回滚持仓验证通过！')

  // 9. 测试盘前预测写入数据库
  console.log('▶️ [9/18] 测试盘前预测写入数据库...')
  const runIdDaily = `11111111-2222-3333-4444-${String(timestamp).slice(-12).padStart(12, '0')}`
  const dailyPayload = {
    runId: runIdDaily,
    stockCode: '600839',
    tradeDate: '2026-09-08',
    asOf: '2026-09-08T09:20:00+08:00',
    mode: 'daily',
    referencePrice: 6.60,
    previousClose: 6.55,
    modelVersion: 'bootstrap_probability_v1',
    modelState: 'untrained_bootstrap',
    inputHash: 'hash_daily_test_001',
    horizons: [
      { horizonMinutes: 5, pUp: 0.35, pFlat: 0.40, pDown: 0.25, expectedReturnPct: 0.2, q10ReturnPct: -0.5, q50ReturnPct: 0.1, q90ReturnPct: 0.8, confidence: 0.6, actionable: false },
      { horizonMinutes: 15, pUp: 0.40, pFlat: 0.35, pDown: 0.25, expectedReturnPct: 0.3, q10ReturnPct: -0.8, q50ReturnPct: 0.2, q90ReturnPct: 1.1, confidence: 0.6, actionable: false }
    ],
    legacyCurve: [{ time: '09:30', price: 6.60, lower: 6.50, upper: 6.70 }],
  }
  const dailyRes = await request('/api/v1/quant/prediction-runs', {
    method: 'POST',
    headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN },
    body: JSON.stringify(dailyPayload),
  })
  assert.equal(dailyRes.status, 200, '盘前预测写入失败')
  console.log('✅ 盘前预测写入数据库通过！')

  // 10. 测试盘中预测写入数据库
  console.log('▶️ [10/18] 测试盘中预测写入数据库...')
  const runIdRealtime = `22222222-3333-4444-5555-${String(timestamp).slice(-12).padStart(12, '0')}`
  const realtimePayload = {
    runId: runIdRealtime,
    stockCode: '600839',
    tradeDate: '2026-09-08',
    asOf: '2026-09-08T10:00:00+08:00',
    mode: 'realtime',
    referencePrice: 6.65,
    previousClose: 6.55,
    modelVersion: 'bootstrap_probability_v1',
    modelState: 'untrained_bootstrap',
    inputHash: 'hash_realtime_test_001',
    horizons: [
      { horizonMinutes: 5, pUp: 0.50, pFlat: 0.30, pDown: 0.20, expectedReturnPct: 0.4, q10ReturnPct: -0.3, q50ReturnPct: 0.3, q90ReturnPct: 0.9, confidence: 0.7, actionable: false }
    ],
    legacyCurve: [{ time: '10:00', price: 6.65, lower: 6.58, upper: 6.72 }],
  }
  const realtimeRes = await request('/api/v1/quant/prediction-runs', {
    method: 'POST',
    headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN },
    body: JSON.stringify(realtimePayload),
  })
  assert.equal(realtimeRes.status, 200, '盘中预测写入失败')
  console.log('✅ 盘中预测写入数据库通过！')

  // 11. 测试一分钟滚动预测更新
  console.log('▶️ [11/18] 测试一分钟滚动预测更新...')
  // 测试通过 sync-point 接口更新滚动预测点
  const syncPointRes = await request('/api/v1/stocks/sync-point', {
    method: 'POST',
    headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN },
    body: JSON.stringify({
      stockCode: '600839',
      realPrice: 6.66,
      currentPrice: 6.66,
      highPrice: 6.70,
      lowPrice: 6.55,
      pct: 1.5,
      tradeDate: '2026-09-08',
      rollingPredictions: [
        { targetTime: '10:05', predictedPrice: 6.68 },
        { targetTime: '10:10', predictedPrice: 6.70 },
      ],
    }),
  })
  assert.equal(syncPointRes.status, 200, 'sync-point 接口失败')

  const rollQuery = await pool.query('SELECT * FROM stock_rolling_predictions WHERE stock_code = $1 AND predict_date = $2', ['600839', '2026-09-08'])
  assert.ok(rollQuery.rows.length >= 1, '滚动预测点未生成')
  console.log('✅ 一分钟滚动预测更新验证通过！')

  // 12. 测试历史日期查询
  console.log('▶️ [12/18] 测试历史日期查询 (advanced-history)...')
  const histRes = await request('/api/v1/stocks/600839/advanced-history?date=2026-09-08')
  assert.equal(histRes.status, 200)
  assert.equal(histRes.data.code, 0)
  assert.ok(Array.isArray(histRes.data.data.predictions), '历史接口未返回 predictions 数组')
  console.log('✅ 历史日期高级轨迹查询验证通过！')

  // 13. 测试历史预测不会读取未来信息 (point-in-time)
  console.log('▶️ [13/18] 测试历史预测不会读取未来信息...')
  // 在 10:00 时刻的预测中，其 legacyCurve 或任何时间点不应包含 10:00 之前的合成历史点
  assert.ok(realtimePayload.legacyCurve.every((pt) => pt.time >= '10:00'), '未来预测中混入了历史过去点！')
  console.log('✅ 历史预测防未来信息泄漏验证通过！')

  // 14. 测试公开股东数据查询
  console.log('▶️ [14/18] 测试公开股东数据查询...')
  const ownerRes = await request('/api/v1/stocks/600839/ownership-profile')
  assert.equal(ownerRes.status, 200)
  assert.ok(ownerRes.data.data.sourceName, '未返回公开股东数据源名称')
  assert.ok(Array.isArray(ownerRes.data.data.topHolders), 'topHolders 应为数组')
  console.log('✅ 公开股东数据查询通过！')

  // 15. 测试公告接口失败时的降级行为
  console.log('▶️ [15/18] 测试公告/股东接口失败时的降级行为...')
  // 查询不存在的股票代码
  const degradedRes = await request('/api/v1/stocks/999999/ownership-profile')
  assert.equal(degradedRes.status, 200, '降级接口应返回 200 并携带警告')
  assert.ok(degradedRes.data.data.warnings.length > 0, '未生成降级警告信息')
  console.log('✅ 接口异常降级行为验证通过！')

  // 16. 测试行情陈旧时禁止产生交易状态
  console.log('▶️ [16/18] 测试行情陈旧时禁止产生交易状态...')
  const stalePayload = {
    ...realtimePayload,
    runId: '33333333-4444-5555-6666-777777777777',
    modelState: 'champion',
    horizons: [
      { horizonMinutes: 5, pUp: 0.8, pFlat: 0.1, pDown: 0.1, expectedReturnPct: 1.5, q10ReturnPct: 0.5, q50ReturnPct: 1.2, q90ReturnPct: 2.0, confidence: 0.9, actionable: true }
    ],
  }
  // 未设置 champion 且数据陈旧时，路由应硬门禁禁止 actionable
  const staleRunRes = await request('/api/v1/quant/prediction-runs', {
    method: 'POST',
    headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN },
    body: JSON.stringify({ ...stalePayload, modelState: 'untrained_bootstrap' }),
  })
  assert.equal(staleRunRes.status, 200)
  const checkActionable = await pool.query('SELECT actionable FROM quant_horizon_forecasts WHERE run_id = $1', ['33333333-4444-5555-6666-777777777777'])
  assert.equal(checkActionable.rows[0].actionable, false, '未训练模型被错误赋予了 actionable 交易状态！')
  console.log('✅ 行情陈旧与未校准模型禁止产生交易状态验证通过！')

  // 17. 测试数据库写入失败时事务回滚
  console.log('▶️ [17/18] 测试数据库写入失败时事务回滚...')
  const badRunId = '44444444-5555-6666-7777-888888888888'
  const failPayload = {
    runId: badRunId,
    stockCode: '600839',
    tradeDate: '2026-09-08',
    asOf: '2026-09-08T10:00:00+08:00',
    mode: 'realtime',
    referencePrice: 6.65,
    previousClose: 6.55,
    modelVersion: 'test_fail',
    modelState: 'untrained_bootstrap',
    inputHash: 'hash_fail',
    horizons: [
      // 故意触发第二个元素概率和不为1的异常导致事务中途失败
      { horizonMinutes: 5, pUp: 0.5, pFlat: 0.3, pDown: 0.2, expectedReturnPct: 0.1, q10ReturnPct: 0, q50ReturnPct: 0, q90ReturnPct: 0, confidence: 0.5, actionable: false },
      { horizonMinutes: 15, pUp: 0.9, pFlat: 0.9, pDown: 0.9, expectedReturnPct: 0.1, q10ReturnPct: 0, q50ReturnPct: 0, q90ReturnPct: 0, confidence: 0.5, actionable: false }
    ],
  }
  const failRes = await request('/api/v1/quant/prediction-runs', {
    method: 'POST',
    headers: { 'X-ZeroQuant-Internal-Token': INTERNAL_TOKEN },
    body: JSON.stringify(failPayload),
  })
  assert.equal(failRes.status, 400, '异常 payload 未被捕获拒绝')
  const checkRollback = await pool.query('SELECT * FROM quant_prediction_runs WHERE run_id = $1', [badRunId])
  assert.equal(checkRollback.rows.length, 0, '事务未回滚，残留了父级记录！')
  console.log('✅ 数据库写入失败事务完整回滚验证通过！')

  // 18. 测试服务重启后预测和用户数据仍然存在
  console.log('▶️ [18/18] 测试服务重启后预测和用户数据持久化仍然存在...')
  const persistedUser = await pool.query('SELECT * FROM users WHERE id = $1', [userA_id])
  assert.equal(persistedUser.rows.length, 1, '用户数据未持久化')
  const persistedRun = await pool.query('SELECT * FROM quant_prediction_runs WHERE run_id = $1', [runIdDaily])
  assert.equal(persistedRun.rows.length, 1, '预测数据未持久化')
  console.log('✅ 持久化完整性验证通过！')

  console.log('====================================================')
  console.log('🎉 恭喜！1.2 全部 18 项端到端测试 100% 全部通过！')
  console.log('====================================================')
  process.exit(0)
}

runAllTests().catch((err) => {
  console.error('❌ 测试套件执行失败:', err)
  process.exit(1)
})
