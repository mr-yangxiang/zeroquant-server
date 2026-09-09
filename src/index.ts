import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { randomBytes } from 'crypto'
import { pool } from './db.js'
import { cleanVoiceTradingText, parseTradingIntent } from './voice-cleaner.js'
import { startQuantInternalScheduler, getQuantSchedulerMetrics } from './scheduler/quant-scheduler.js'
import { createQuantRouter, quantInternalOnly } from './quant-routes.js'
import { fetchOwnershipProfile } from './ownership.js'
import { runMigrationsUp } from './migrations/runner.js'
import { getStockEntityProfiles } from './profiles/entity-profile-engine.js'

dayjs.extend(utc)
dayjs.extend(timezone)

dotenv.config()

const app = express()
const port = process.env.PORT ? parseInt(process.env.PORT) : 3002
const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex')
if (!process.env.JWT_SECRET) {
  console.warn('[Security] JWT_SECRET is not set; generated an ephemeral development secret.')
}

app.use(cors())
app.use(express.json())
app.use('/api/v1/quant', createQuantRouter())

// 1. 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ZeroQuant Express Server', timestamp: new Date().toISOString() })
})

// 1.1 量化内核多线程调度状态与监控指标 API
app.get('/api/v1/system/quant-status', (_req, res) => {
  res.json({ code: 0, message: 'success', data: getQuantSchedulerMetrics() })
})

// 2. 登录接口
app.post('/api/v1/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body
    if (!phone || !password) {
      return res.status(400).json({ code: 400, message: '请输入账号和密码', data: null })
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone])
    if (rows.length === 0) {
      return res.status(400).json({ code: 400, message: '账号或密码错误', data: null })
    }

    const user = rows[0]
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(400).json({ code: 400, message: '账号或密码错误', data: null })
    }

    const token = jwt.sign(
      { userId: user.id, phone: user.phone, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    )

    return res.json({
      code: 0,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          phone: user.phone,
          avatar: user.avatar,
        },
      },
    })
  } catch (err: any) {
    console.error('Login error:', err)
    return res.status(500).json({ code: 500, message: '服务器异常', data: null })
  }
})

// 2.5 注册接口
app.post('/api/v1/auth/register', async (req, res) => {
  try {
    const { phone, username, password } = req.body
    if (!phone || !password || !username) {
      return res.status(400).json({ code: 400, message: '请输入手机号、用户名和密码', data: null })
    }

    const { rows: existing } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone])
    if (existing.length > 0) {
      return res.status(400).json({ code: 400, message: '该手机号已存在，请直接登录', data: null })
    }

    const hash = await bcrypt.hash(password, 10)
    const { rows } = await pool.query(
      `INSERT INTO users (phone, username, password)
       VALUES ($1, $2, $3)
       RETURNING id, phone, username, avatar`,
      [phone, username, hash]
    )

    const user = rows[0]
    const token = jwt.sign(
      { userId: user.id, phone: user.phone, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    )

    return res.json({
      code: 0,
      message: '注册并登录成功',
      data: { token, user }
    })
  } catch (err: any) {
    console.error('Register error:', err)
    return res.status(500).json({ code: 500, message: '注册失败', data: null })
  }
})

function getUserFromReq(req: express.Request): string | null {
  try {
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      const decoded: any = jwt.verify(token, JWT_SECRET)
      if (decoded && (decoded.userId || decoded.phone)) {
        return String(decoded.userId || decoded.phone)
      }
    }
  } catch (err) {
    // fallback
  }
  return null
}

function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!getUserFromReq(req)) return res.status(401).json({ code: 401, message: '登录状态无效，请重新登录', data: null })
  return next()
}

class InsufficientRecordedPositionError extends Error {
  constructor(public readonly availableShares: number) {
    super(`insufficient recorded position: ${availableShares}`)
  }
}

async function persistUserTrade(
  userId: string,
  stockCode: string,
  actionType: 'BUY' | 'SELL' | 'SET_POSITION',
  price: number,
  shares: number,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 即使该用户尚无持仓行，也要串行化同一用户/标的的并发更新，避免首次写入丢失更新。
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${userId}|${stockCode}`])
    const { rows } = await client.query(
      `SELECT holding_shares, cost_price
       FROM user_positions
       WHERE user_id = $1 AND stock_code = $2
       FOR UPDATE`,
      [userId, stockCode]
    )
    const previousShares = Number(rows[0]?.holding_shares) || 0
    const previousCost = Number(rows[0]?.cost_price) || 0
    let nextShares = shares
    let nextCost = price

    if (actionType === 'BUY') {
      nextShares = previousShares + shares
      nextCost = Number(((previousShares * previousCost + shares * price) / nextShares).toFixed(4))
    } else if (actionType === 'SELL') {
      if (shares > previousShares) throw new InsufficientRecordedPositionError(previousShares)
      nextShares = previousShares - shares
      nextCost = previousCost
    }

    if (actionType !== 'SET_POSITION') {
      await client.query(
        `INSERT INTO user_trade_actions
          (user_id, stock_code, action_type, trade_price, trade_shares, trade_time,
           previous_holding_shares, previous_cost_price, resulting_holding_shares, resulting_cost_price)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)`,
        [userId, stockCode, actionType, price, shares, previousShares, previousCost, nextShares, nextCost]
      )
    }
    await client.query(
      `INSERT INTO user_positions (user_id, stock_code, holding_shares, cost_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, stock_code) DO UPDATE SET
         holding_shares = EXCLUDED.holding_shares,
         cost_price = EXCLUDED.cost_price,
         updated_at = NOW()`,
      [userId, stockCode, nextShares, nextCost]
    )
    await client.query('COMMIT')
    return { previousShares, previousCost, nextShares, nextCost }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

app.use('/api/v1/user', requireUser)
app.use('/api/v1/chat', requireUser)

// 3. 获取所有 6 支重点做 T 股票列表
app.get('/api/v1/stocks', async (_req, res) => {
  try {
    const { rows: stocks } = await pool.query('SELECT * FROM stocks ORDER BY code ASC')
    
    for (const stock of stocks) {
      // 旧表中的分析为手工演示文本且没有来源、样本区间或版本，禁止继续下发给实盘页面。
      stock.analyses = []
      stock.currentPrice = stock.current_price
      stock.yesterdayPrice = stock.yesterday_price
      stock.highPrice = stock.high_price
      stock.lowPrice = stock.low_price
      stock.predictedHigh = stock.predicted_high
      stock.predictedLow = stock.predicted_low
      // 旧字段的 88.5 等默认值没有可复现的回测证据，不能作为“胜率”下发。
      stock.winRate = null
      delete stock.win_rate
    }

    return res.json({ code: 0, message: 'ok', data: stocks })
  } catch (err: any) {
    console.error('Fetch stocks error:', err)
    return res.status(500).json({ code: 500, message: '数据获取失败', data: null })
  }
})

// 主要公开股东与持仓变化：按公告日过滤，历史复盘不会看到未来披露。
app.get('/api/v1/stocks/:code/ownership-profile', async (req, res) => {
  try {
    const asOf = String(req.query.asOf || dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD'))
    const data = await fetchOwnershipProfile(req.params.code, asOf)
    return res.json({ code: 0, message: 'ok', data })
  } catch (err: any) {
    console.error('Fetch ownership profile error:', err)
    return res.status(502).json({ code: 502, message: '公开股东披露暂时不可用', data: null })
  }
})

// 4. 获取单支股票真实 vs 预测双线历史数据 (向后兼容 API)
app.get('/api/v1/stocks/:code/history', async (req, res) => {
  try {
    const { code } = req.params
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100

    const { rows: histories } = await pool.query(
      `SELECT id, stock_code as "stockCode", timestamp, real_price as "realPrice",
              predicted_price as "predictedPrice", deviation_pct as "deviationPct"
       FROM stock_price_histories
       WHERE stock_code = $1
       ORDER BY timestamp ASC
       LIMIT $2`,
      [code, limit]
    )

    return res.json({ code: 0, message: 'ok', data: histories })
  } catch (err: any) {
    console.error('Fetch history error:', err)
    return res.status(500).json({ code: 500, message: '历史点位获取失败', data: null })
  }
})

// 5. 高级维度分时轨迹 API：开盘前预判线、版本对比线、5分钟动态修正线、真实轨迹线及历史日期区间查询
app.get('/api/v1/stocks/:code/advanced-history', async (req, res) => {
  try {
    const { code } = req.params
    const { startDate, endDate, date } = req.query

    const targetDate = (date as string) || (startDate as string) || dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD')

    // A. 真实实盘轨迹线 (只取选定日期的真实分钟交易数据，结合北京时间 timezone 对齐)
    const { rows: realHistories } = await pool.query(
      `SELECT TO_CHAR(timestamp AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD"T"HH24:MI:SS+08:00') as "timestamp", real_price as "realPrice"
       FROM stock_price_histories
       WHERE stock_code = $1
         AND (timestamp AT TIME ZONE 'Asia/Shanghai')::date = $2::date
       ORDER BY timestamp ASC`,
      [code, targetDate]
    )

    // B. 开盘前全天预判线 (Base Version 1 与所有重预测 Version 线，包含看涨/看跌方向与目标幅度)
    const { rows: predictions } = await pool.query(
      `SELECT version, is_base as "isBase", time_points as "timePoints", direction, target_pct as "targetPct", created_at as "createdAt"
       FROM stock_day_predictions
       WHERE stock_code = $1
         AND predict_date = $2::date
       ORDER BY version ASC`,
      [code, targetDate]
    )

    // C. 可复盘的盘中动态线：过去每个目标分钟固定取至少提前 5 分钟发布的最近预测；
    //    尚未发生的目标分钟取当前最新预测。底层快照只追加、不覆盖。
    const { rows: rollingPredictions } = await pool.query(
      `WITH latest_observation AS (
         SELECT MAX(timestamp) AS latest_at
         FROM stock_price_histories
         WHERE stock_code = $1
           AND (timestamp AT TIME ZONE 'Asia/Shanghai')::date = $2::date
       ), ranked AS (
         SELECT rp.target_time, rp.predicted_price, rp.forecast_at, rp.lead_minutes,
                ROW_NUMBER() OVER (
                  PARTITION BY rp.target_time
                  ORDER BY
                    CASE WHEN lo.latest_at IS NOT NULL AND rp.target_at <= lo.latest_at THEN rp.lead_minutes END ASC NULLS LAST,
                    CASE WHEN lo.latest_at IS NULL OR rp.target_at > lo.latest_at THEN rp.forecast_at END DESC NULLS LAST,
                    rp.forecast_at DESC NULLS LAST,
                    rp.id DESC
                ) AS choice_rank
         FROM stock_rolling_predictions rp
         CROSS JOIN latest_observation lo
         WHERE rp.stock_code = $1
           AND rp.predict_date = $2::date
           AND (
             lo.latest_at IS NULL
             OR rp.target_at > lo.latest_at
             OR COALESCE(rp.lead_minutes, 0) >= 5
           )
       )
       SELECT target_time as "targetTime", predicted_price as "predictedPrice",
              forecast_at as "forecastAt", lead_minutes as "leadMinutes"
       FROM ranked
       WHERE choice_rank = 1
       ORDER BY target_time ASC`,
      [code, targetDate]
    )
    const { rows: rollingArchiveRows } = await pool.query(
      `SELECT COUNT(*)::int as "storedPointCount",
              COUNT(DISTINCT forecast_at)::int as "snapshotCount"
       FROM stock_rolling_predictions
       WHERE stock_code = $1 AND predict_date = $2::date`,
      [code, targetDate]
    )
    const realByMinute = new Map(realHistories.map((row: any) => [String(row.timestamp).slice(11, 16), Number(row.realPrice)]))
    const comparableDeviations = rollingPredictions.flatMap((row: any) => {
      const actual = realByMinute.get(String(row.targetTime))
      const predicted = Number(row.predictedPrice)
      return Number.isFinite(actual) && Number(actual) > 0 && Number.isFinite(predicted)
        ? [Math.abs(predicted - Number(actual)) / Number(actual) * 100]
        : []
    })
    const rollingEvaluation = {
      snapshotCount: Number(rollingArchiveRows[0]?.snapshotCount || 0),
      storedPointCount: Number(rollingArchiveRows[0]?.storedPointCount || 0),
      comparablePointCount: comparableDeviations.length,
      meanAbsoluteDeviationPct: comparableDeviations.length > 0
        ? Number((comparableDeviations.reduce((sum: number, value: number) => sum + value, 0) / comparableDeviations.length).toFixed(4))
        : null,
      evaluationLeadMinutes: 5,
    }

    // D. 公开逐笔大额成交（>=1000手）。它不是多档委托簿，也不含账户/席位身份。
    const { rows: l2Orders } = await pool.query(
      `SELECT time_str as "timeStr", type, price, volume_lots as "volumeLots", note
       FROM stock_l2_orders
       WHERE stock_code = $1
         AND trade_date = $2::date
       ORDER BY time_str ASC`,
      [code, targetDate]
    )

    // E. 用户实时持仓与个人成交记录。
    const currentUserId = getUserFromReq(req)
    const positionRows = currentUserId
      ? (await pool.query(
          `SELECT holding_shares as "holdingShares", cost_price as "costPrice", t_shares as "tShares"
           FROM user_positions WHERE stock_code = $1 AND user_id = $2`,
          [code, currentUserId]
        )).rows
      : []
    const tradeRows = currentUserId
      ? (await pool.query(
          `SELECT id, action_type as "actionType", trade_price as "tradePrice", trade_shares as "tradeShares",
                  TO_CHAR(trade_time AT TIME ZONE 'Asia/Shanghai', 'HH24:MI:SS') as "tradeTime", note
           FROM user_trade_actions WHERE stock_code = $1 AND user_id = $2 AND (trade_time AT TIME ZONE 'Asia/Shanghai')::date = $3::date
           ORDER BY trade_time DESC`,
          [code, currentUserId, targetDate]
        )).rows
      : []

    return res.json({
      code: 0,
      message: 'ok',
      data: {
        stockCode: code,
        date: targetDate,
        realHistories,
        predictions,
        rollingPredictions,
        rollingEvaluation,
        l2Orders,
        // 旧表没有策略版本、样本区间、成本和样本外证据，明确停止下发。
        backtestStats: [],
        dailyReview: null,
        position: positionRows[0] || { holdingShares: 0, costPrice: 0.0, tShares: 0 },
        userTrades: tradeRows
      }
    })
  } catch (err: any) {
    console.error('Fetch advanced history error:', err)
    return res.status(500).json({ code: 500, message: '高级轨迹获取失败', data: null })
  }
})

// 7. 用户个人仓位设置 API
app.post('/api/v1/user/position', async (req, res) => {
  try {
    const currentUserId = getUserFromReq(req)!
    const { stockCode, holdingShares, costPrice } = req.body
    const shares = Number(holdingShares)
    const cost = Number(costPrice)
    if (!/^\d{6}$/.test(String(stockCode || ''))) return res.status(400).json({ code: 400, message: '股票代码格式错误' })
    if (!Number.isInteger(shares) || shares < 0 || !Number.isFinite(cost) || cost < 0) {
      return res.status(400).json({ code: 400, message: '持仓股数必须为非负整数，成本必须为非负数' })
    }

    await pool.query(
      `INSERT INTO user_positions (user_id, stock_code, holding_shares, cost_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, stock_code) DO UPDATE SET
         holding_shares = EXCLUDED.holding_shares,
         cost_price = EXCLUDED.cost_price,
         updated_at = NOW()`,
      [currentUserId, stockCode, shares, cost]
    )
    return res.json({ code: 0, message: '个人持仓保存成功' })
  } catch (err: any) {
    console.error('User position error:', err)
    return res.status(500).json({ code: 500, message: '持仓保存失败' })
  }
})

// 8. 用户实盘买卖操作录入与战术对策指导 API
app.post('/api/v1/user/trade-action', async (req, res) => {
  try {
    const currentUserId = getUserFromReq(req)!
    const { stockCode, actionType, tradePrice, tradeShares } = req.body
    const normalizedAction = String(actionType || '').toUpperCase()
    const price = Number(tradePrice)
    const shares = Number(tradeShares)
    if (!/^\d{6}$/.test(String(stockCode || '')) || !['BUY', 'SELL'].includes(normalizedAction)) {
      return res.status(400).json({ code: 400, message: '股票代码或成交方向无效' })
    }
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(shares) || shares <= 0) {
      return res.status(400).json({ code: 400, message: '成交价格必须大于零，成交股数必须为正整数' })
    }

    try {
      const positionResult = await persistUserTrade(
        currentUserId,
        stockCode,
        normalizedAction as 'BUY' | 'SELL',
        price,
        shares
      )

      const { rows } = await pool.query(
        `SELECT id, action_type as "actionType", trade_price as "tradePrice", trade_shares as "tradeShares", TO_CHAR(trade_time AT TIME ZONE 'Asia/Shanghai', 'HH24:MI:SS') as "tradeTime"
         FROM user_trade_actions
         WHERE user_id = $1 AND stock_code = $2
         ORDER BY id DESC LIMIT 1`,
        [currentUserId, stockCode]
      )

      return res.json({
        code: 0,
        message: '用户陈述的成交记录已保存（未向券商下单）',
        data: {
          ...rows[0],
          position: positionResult,
        },
      })
    } catch (tradeErr: any) {
      if (tradeErr instanceof InsufficientRecordedPositionError) {
        return res.status(400).json({
          code: 400,
          message: `卖出数量超过当前持仓，已被拒绝（当前可用持仓: ${tradeErr.availableShares} 股）`,
          data: null,
        })
      }
      throw tradeErr
    }
  } catch (err: any) {
    console.error('Trade action error:', err)
    return res.status(500).json({ code: 500, message: '实盘操作录入失败' })
  }
})

// 9. 删除/撤销某笔用户实盘操作 API
app.delete('/api/v1/user/trade-action/:id', async (req, res) => {
  const client = await pool.connect()
  try {
    const currentUserId = getUserFromReq(req)!
    const { id } = req.params
    const tradeId = parseInt(id)
    if (!Number.isInteger(tradeId)) {
      return res.status(400).json({ code: 400, message: '参数缺失或无效' })
    }

    await client.query('BEGIN')
    const { rows: tradeRows } = await client.query(
      `SELECT * FROM user_trade_actions WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [tradeId, currentUserId]
    )
    if (tradeRows.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ code: 404, message: '成交记录不存在' })
    }

    const trade = tradeRows[0]
    const stockCode = trade.stock_code

    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${currentUserId}|${stockCode}`])
    const { rows: latestRows } = await client.query(
      `SELECT id FROM user_trade_actions
       WHERE user_id = $1 AND stock_code = $2
       ORDER BY trade_time DESC, id DESC LIMIT 1`,
      [currentUserId, stockCode]
    )
    if (Number(latestRows[0]?.id) !== tradeId) {
      await client.query('ROLLBACK')
      return res.status(409).json({ code: 409, message: '只能撤销该股票最新一笔成交；较早成交必须通过更正记录处理' })
    }
    if (trade.previous_holding_shares === null || trade.previous_cost_price === null) {
      await client.query('ROLLBACK')
      return res.status(409).json({ code: 409, message: '该历史成交缺少撤销快照，不能安全自动回滚' })
    }
    const nextShares = Number(trade.previous_holding_shares)
    const nextCost = Number(trade.previous_cost_price)

    await client.query(`DELETE FROM user_trade_actions WHERE id = $1 AND user_id = $2`, [tradeId, currentUserId])
    await client.query(
      `UPDATE user_positions SET holding_shares = $1, cost_price = $2, updated_at = NOW()
       WHERE user_id = $3 AND stock_code = $4`,
      [nextShares, nextCost, currentUserId, stockCode]
    )

    await client.query('COMMIT')
    return res.json({ code: 0, message: '最新成交记录已撤销，持仓和成本已恢复', data: { holdingShares: nextShares, costPrice: nextCost } })
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Delete trade action error:', err)
    return res.status(500).json({ code: 500, message: '删除失败' })
  } finally {
    client.release()
  }
})

// 10. AI 资深量化策略分析师 - 消息列表获取 API
app.get('/api/v1/chat/messages', async (req, res) => {
  try {
    const currentUserId = getUserFromReq(req)
    const stockCode = (req.query.stockCode as string) || '603696'

    const { rows } = await pool.query(
      `SELECT id, role, content, TO_CHAR(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') as "createdAt"
       FROM user_chat_messages
       WHERE user_id = $1 AND stock_code = $2
       ORDER BY created_at ASC`,
      [currentUserId, stockCode]
    )

    // 若无历史对话，生成首席量化分析师针对该标的的专属初始问候
    if (rows.length === 0) {
      const { rows: stockRows } = await pool.query(`SELECT * FROM stocks WHERE code = $1`, [stockCode])
      const s = stockRows[0] || { name: '目标标的', code: stockCode, current_price: 0, pct: 0, predicted_low: 0, predicted_high: 0 }
      const initGreeting = `您好，我是 **ZeroQuant 量化研究解释器**。当前标的是 **${s.name} (${s.code})**。\n\n实时盘口现价：**¥${Number(s.current_price || 0).toFixed(2)}** (${Number(s.pct || 0) >= 0 ? '+' : ''}${Number(s.pct || 0).toFixed(2)}%)，当前概率风险区间为 **[¥${Number(s.predicted_low || 0).toFixed(2)} ~ ¥${Number(s.predicted_high || 0).toFixed(2)}]**。该区间不是收益承诺或确定支撑阻力。\n\n我可以解释：概率分布、数据质量、模型误差、新闻事件、持仓风险和不同情景的失效条件。公开逐笔成交不包含最终账户身份，因此我不会虚构具体机构或游资席位。`
      
      return res.json({
        code: 0,
        data: [{ id: 0, role: 'assistant', content: initGreeting, createdAt: dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss') }]
      })
    }

    return res.json({ code: 0, data: rows })
  } catch (err: any) {
    console.error('Fetch chat messages error:', err)
    return res.status(500).json({ code: 500, message: '获取对话记录失败' })
  }
})

// 11. AI 资深量化策略分析师 - 发送消息与智能推演 API
app.post('/api/v1/chat/send', async (req, res) => {
  try {
    const currentUserId = getUserFromReq(req)
    const { stockCode, message } = req.body

    if (!stockCode || !message || !message.trim()) {
      return res.status(400).json({ code: 400, message: '消息内容不可为空' })
    }

    const cleanMsg = message.trim()

    // 1. 抓取当前股票的最新行情与量化参数
    const { rows: stockRows } = await pool.query(`SELECT * FROM stocks WHERE code = $1`, [stockCode])
    if (stockRows.length === 0) return res.status(404).json({ code: 404, message: '标的不存在', data: null })
    const stock = stockRows[0]
    
    // 3. 抓取当前用户的专属持仓与成本
    const { rows: posRows } = await pool.query(`SELECT * FROM user_positions WHERE user_id = $1 AND stock_code = $2`, [currentUserId, stockCode])
    const pos = posRows[0] || { holding_shares: 0, cost_price: 0 }

    // 4. 抓取最近公开逐笔成交。该数据不包含最终账户或营业部身份。
    const { rows: l2Rows } = await pool.query(
      `SELECT time_str as "orderTime", price, volume_lots as "volume", type as "orderType", note as "dataNote"
       FROM stock_l2_orders
       WHERE stock_code = $1
       ORDER BY id DESC LIMIT 5`,
      [stockCode]
    )

    const { rows: quantRows } = await pool.query(
      `SELECT r.run_id as "runId", r.as_of as "asOf", r.model_version as "modelVersion",
              r.model_state as "modelState", r.regime, r.features, r.news_events as "newsEvents", r.warnings,
              f.p_up as "pUp", f.p_flat as "pFlat", f.p_down as "pDown",
              f.q10_return_pct as "q10ReturnPct", f.q50_return_pct as "q50ReturnPct",
              f.q90_return_pct as "q90ReturnPct", f.confidence, f.actionable, f.reasons
       FROM quant_prediction_runs r
       JOIN quant_horizon_forecasts f ON f.run_id = r.run_id AND f.horizon_minutes = 15
       WHERE r.stock_code = $1
       ORDER BY r.as_of DESC LIMIT 1`,
      [stockCode]
    )
    const quantForecast = quantRows[0] || null
    let entityProfileContext: Awaited<ReturnType<typeof getStockEntityProfiles>> | null = null
    try {
      entityProfileContext = await getStockEntityProfiles(stockCode, new Date())
    } catch (error) {
      console.warn('Entity profile context unavailable for chat:', error)
    }
    const quantActionable = Boolean(quantForecast?.actionable)
    const quantModelStateLabel = quantForecast?.modelState === 'untrained_bootstrap'
      ? '基础试运行模型（尚未训练）'
      : quantForecast?.modelState === 'shadow'
        ? '影子验证中'
        : quantForecast?.modelState === 'champion'
          ? '已通过生产门槛'
          : '状态待确认'

    // 5. 保存用户消息
    await pool.query(
      `INSERT INTO user_chat_messages (user_id, stock_code, role, content, created_at)
       VALUES ($1, $2, 'user', $3, NOW())`,
      [currentUserId, stockCode, cleanMsg]
    )

    // 6. 基础量化指标与持仓参数提取
    const currP = Number(stock.current_price)
    const yestP = Number(stock.yesterday_price)
    const highP = Number(stock.high_price || currP)
    const lowP = Number(stock.low_price || currP)
    const pLow = Number(stock.predicted_low)
    const pHigh = Number(stock.predicted_high)
    const userHolding = Number(pos.holding_shares) || 0
    const userCost = Number(pos.cost_price) || 0

    let reply = ''
    const tradeResult = parseTradingIntent(cleanMsg, currP)

    if (tradeResult.isTradeAction && tradeResult.price && tradeResult.shares) {
      // 只持久化用户明确陈述的已成交事实；交易记录与持仓更新必须原子提交。
      if (tradeResult.actionType === 'BUY') {
        const persisted = await persistUserTrade(currentUserId!, stockCode, 'BUY', tradeResult.price, tradeResult.shares)
        const newShares = persisted.nextShares
        const newCost = persisted.nextCost
        const priceDiffPct = (((tradeResult.price - currP) / currP) * 100).toFixed(2)
        const isBuyHigh = tradeResult.price > currP * 1.01
        const isBuyLow = tradeResult.price < currP * 0.99
        
        reply = `### ✅ 【用户陈述的买入成交已记录】—— ${stock.name} (${stock.code})\n\n`
        reply += `系统只记录您明确陈述的成交，没有向券商下单。\n`
        reply += `- 🟢 **本次操作**：**买入 ${tradeResult.shares.toLocaleString()} 股 @ ¥${tradeResult.price.toFixed(2)}**\n`
        reply += `- 📊 **持仓重算**：记录持仓由 ${persisted.previousShares.toLocaleString()} 股增至 **${newShares.toLocaleString()} 股**，记录成本均价由 ¥${persisted.previousCost.toFixed(2)} 调整为 **¥${newCost.toFixed(2)}**\n\n`
        
        reply += `### 【价格位置观察】\n\n`
        if (isBuyHigh) {
          reply += `成交价高于当前盘口约 ${priceDiffPct}%，存在追价风险。\n`
        } else if (isBuyLow) {
          reply += `成交价低于当前盘口，但这只能说明当前有浮动价差，不能证明买点质量。\n`
        } else {
          reply += `成交价接近当前盘口，方向优势尚不明显。\n`
        }
        reply += `当前偏弱/偏强观察边界为 ¥${pLow.toFixed(2)}～¥${pHigh.toFixed(2)}。跌破下界代表风险扩大；接近上界后只有出现滞涨证据才评估卖出。区间不是收益承诺。`
      } else if (tradeResult.actionType === 'SELL') {
        let persisted
        try {
          persisted = await persistUserTrade(currentUserId!, stockCode, 'SELL', tradeResult.price, tradeResult.shares)
        } catch (error) {
          if (error instanceof InsufficientRecordedPositionError) {
            return res.status(400).json({ code: 400, message: `卖出数量超过系统记录的持仓 ${error.availableShares} 股，请先同步真实持仓`, data: null })
          }
          throw error
        }
        const remainShares = persisted.nextShares
        const lockedProfit = persisted.previousCost > 0 ? ((tradeResult.price - persisted.previousCost) * tradeResult.shares).toFixed(2) : null
        reply = `### ✅ 【用户陈述的卖出成交已记录】—— ${stock.name} (${stock.code})\n\n`
        reply += `系统只记录您明确陈述的成交，没有向券商下单。\n`
        reply += `- 🔴 **本次操作**：**卖出 ${tradeResult.shares.toLocaleString()} 股 @ ¥${tradeResult.price.toFixed(2)}**\n`
        reply += lockedProfit === null
          ? `- 💰 **收益估算**：没有有效持仓成本，暂不计算收益\n`
          : `- 💰 **相对持仓成本的毛收益**：约 **¥${lockedProfit} 元**（未扣除费用、税费和滑点）\n`
        reply += `- 📊 **持仓更新**：记录剩余持仓 **${remainShares.toLocaleString()} 股**（记录成本保持 ¥${persisted.previousCost.toFixed(2)}）\n\n`
        reply += `当前回落观察边界为 ¥${pLow.toFixed(2)}。只有回落后止跌且净差价覆盖费用，才评估接回；若价格持续突破 ¥${pHigh.toFixed(2)}，等待模型重算，不按旧上界追价。`
      } else if (tradeResult.actionType === 'SET_POSITION') {
        await persistUserTrade(currentUserId!, stockCode, 'SET_POSITION', tradeResult.price, tradeResult.shares)
        reply = `### ✅ 【个人持仓底仓已同步更新】—— ${stock.name} (${stock.code})\n\n`
        reply += `已根据您的指令将持仓设置为：**${tradeResult.shares.toLocaleString()} 股 @ ¥${tradeResult.price.toFixed(2)}**。\n`
        reply += `后续风险情景会以此记录成本为基准；它不替代券商真实持仓、可卖库存、费用和成交回报。`
      }
      if (!quantActionable) {
        const probabilities = quantForecast
          ? `15分钟概率为上涨 ${(Number(quantForecast.pUp) * 100).toFixed(1)}%、震荡 ${(Number(quantForecast.pFlat) * 100).toFixed(1)}%、下跌 ${(Number(quantForecast.pDown) * 100).toFixed(1)}%`
          : '当前没有可用的版本化概率预测'
        reply = `### 操作记录已更新——${stock.name} (${stock.code})\n\n系统只记录了您明确陈述的成交/持仓信息，没有向券商下单。${probabilities}。\n\n当前模型状态为 **${quantModelStateLabel}**，尚未达到自动交易门槛，因此不会根据未校准模型生成精确挂单或收益承诺。请以券商实际成交、A股 T+1 可卖库存和个人风险上限为准。`
      }
    } else {
      // 🚀 核心升级：调用大语言模型（LLM）基于真实实盘数据和知识库进行全方位深度解答（真实你问我答）
      try {
        // 读取最近历史消息作为上下文
        const { rows: historyRows } = await pool.query(
          `SELECT role, content FROM user_chat_messages
           WHERE user_id = $1 AND stock_code = $2
           ORDER BY id DESC LIMIT 6`,
          [currentUserId, stockCode]
        )
        const chatContext = historyRows.reverse().map(h => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content
        }))

        const liveNewsText = Array.isArray(quantForecast?.newsEvents) && quantForecast.newsEvents.length > 0
          ? quantForecast.newsEvents.map((event: any) => `• [${event.published_at || '时间未知'}] ${event.title}（${event.event_type}）`).join('\n')
          : '当前预测快照没有时间点一致的公告事件'
        const entityProfileText = entityProfileContext?.profiles?.length
          ? entityProfileContext.profiles.map((profile: any) => {
              const traits = Array.isArray(profile.traits) && profile.traits.length
                ? profile.traits.map((item: any) => item.label).join('、')
                : '样本不足，未形成稳定标签'
              return `• ${profile.name}（${profile.entityType}）：公开记录 ${profile.sampleCount} 次，可评估 ${profile.labeledSampleCount} 次，可信度 ${(Number(profile.confidence) * 100).toFixed(1)}%，证据等级 ${profile.evidenceGrade}；${traits}；最近公开出现 ${profile.lastEventDate} ${profile.lastSide === 'BUY' ? '买方榜' : '卖方榜'}`
            }).join('\n')
          : '当前没有达到展示条件的可验证机构/活跃席位历史画像'

        const systemPrompt = `你是 ZeroQuant 的量化研究解释器。你只能解释可观察数据、模型概率、风险与失效条件，不得声称知道未提供的真实机构/游资身份，不得承诺收益或把概率区间说成确定支撑阻力。

【当前标的实盘量化底表数据】：
- 股票名称与代码：${stock.name} (${stock.code})
- 盘口实时现价：¥${currP.toFixed(2)} (昨收: ¥${yestP.toFixed(2)}, 日内最高: ¥${highP.toFixed(2)}, 最低: ¥${lowP.toFixed(2)}, 涨跌幅: ${Number(stock.pct || 0).toFixed(2)}%)
- 当前价格情景：偏弱边界 ¥${pLow.toFixed(2)} ~ 偏强边界 ¥${pHigh.toFixed(2)}
- 用户当前绑定底仓：${userHolding > 0 ? `${userHolding.toLocaleString()} 股 @ 成本均价 ¥${userCost.toFixed(2)} (当前浮动盈亏: ¥${((currP - userCost) * userHolding).toFixed(2)})` : '暂未录入底仓（以大盘中枢指导）'}
- 最近公开逐笔成交：${l2Rows.map((o: any) => `[${o.orderTime || '盘中'}] ${o.orderType} ${o.volume}手 @ ¥${Number(o.price).toFixed(2)}`).join('; ') || '暂无可验证逐笔成交'}
- 模型版本与状态：${quantForecast?.modelVersion || '无'} / ${quantModelStateLabel}
- 15分钟概率：上涨 ${quantForecast ? (Number(quantForecast.pUp) * 100).toFixed(1) : '--'}%，震荡 ${quantForecast ? (Number(quantForecast.pFlat) * 100).toFixed(1) : '--'}%，下跌 ${quantForecast ? (Number(quantForecast.pDown) * 100).toFixed(1) : '--'}%
- 偏弱/最可能/偏强收益情景：${quantForecast ? `${Number(quantForecast.q10ReturnPct).toFixed(2)}% / ${Number(quantForecast.q50ReturnPct).toFixed(2)}% / ${Number(quantForecast.q90ReturnPct).toFixed(2)}%` : '无'}
- 是否通过交易门槛：${quantActionable ? '是' : '否'}

【实时个股最新公告与资讯】：
${liveNewsText}

【机构 / 活跃席位历史行为画像（统计推断，不代表当前正在交易）】：
${entityProfileText}
- 画像聚合方向：${entityProfileContext?.researchReadyEntityCount ? `${Number(entityProfileContext.signal) >= 0.15 ? '偏多' : Number(entityProfileContext.signal) <= -0.15 ? '偏空' : '中性'}，综合可信度 ${(Number(entityProfileContext.confidence) * 100).toFixed(1)}%` : '样本不足，不形成方向结论'}

【回答约束】：
1. 先说明数据时间和模型是否已校准；未通过交易门槛时只能给情景、风险和需要继续观察的确认信号。
2. 区分事实、模型推断和未知；公开逐笔成交不能归因为具体席位。历史席位画像只能描述公开记录中的统计倾向，不能声称该席位今天正在买卖。
3. 新闻只使用上述时间点一致事件，Markdown 复盘没有经过验证时不得当作模型事实。
4. 结合用户持仓说明 T+1、成本、滑点和最大损失，但不替用户作出确定性买卖决定。`

        const apiKey = process.env.CPA_API_KEY || ''
        if (apiKey) {
          const cpaRes = await fetch('http://127.0.0.1:8317/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gemini-3.7-flash-high',
            messages: [
              { role: 'system', content: systemPrompt },
              ...chatContext
            ]
          })
          })

          if (cpaRes.ok) {
            const cpaData: any = await cpaRes.json()
            reply = cpaData.choices?.[0]?.message?.content || ''
          }
        }
      } catch (err: any) {
        console.error('LLM invoke error:', err)
      }

      // 若 LLM 异常时的专业兜底推演
      if (!reply) {
        reply = `### 概率研究快照——${stock.name} (${stock.code})\n\n`
        reply += quantForecast
          ? `当前模型 **${quantModelStateLabel}** 的15分钟输出为：上涨 ${(Number(quantForecast.pUp) * 100).toFixed(1)}%、震荡 ${(Number(quantForecast.pFlat) * 100).toFixed(1)}%、下跌 ${(Number(quantForecast.pDown) * 100).toFixed(1)}%，置信度 ${(Number(quantForecast.confidence) * 100).toFixed(1)}%。\n\n偏弱到偏强情景是风险范围，不是保证成交的支撑阻力。当前是否通过交易门槛：**${quantActionable ? '是' : '否'}**。`
          : '当前没有完成版本化概率预测，系统不会用固定话术代替缺失数据。'
      }
    }

    // 7. 保存 Assistant 回复
    const { rows: replyRows } = await pool.query(
      `INSERT INTO user_chat_messages (user_id, stock_code, role, content, created_at)
       VALUES ($1, $2, 'assistant', $3, NOW())
       RETURNING id, role, content, TO_CHAR(created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') as "createdAt"`,
      [currentUserId, stockCode, reply]
    )

    return res.json({
      code: 0,
      message: '分析师已完成推演',
      data: replyRows[0]
    })
  } catch (err: any) {
    console.error('Chat send error:', err)
    return res.status(500).json({ code: 500, message: '分析师推演失败: ' + err.message })
  }
})

// 12. AI 资深量化策略分析师 - 清空当前标的对话记录 API
app.delete('/api/v1/chat/messages', async (req, res) => {
  try {
    const currentUserId = getUserFromReq(req)
    const stockCode = (req.query.stockCode as string) || '603696'

    await pool.query(
      `DELETE FROM user_chat_messages WHERE user_id = $1 AND stock_code = $2`,
      [currentUserId, stockCode]
    )

    return res.json({ code: 0, message: '对话记录已清空' })
  } catch (err: any) {
    console.error('Clear chat messages error:', err)
    return res.status(500).json({ code: 500, message: '清空对话失败' })
  }
})

// 5. 1分钟轮询脚本实时写入 (包含实盘价、盘中动态前向重塑线、版本重预测判断)
app.post('/api/v1/stocks/sync-point', quantInternalOnly, async (req, res) => {
  const client = await pool.connect()
  try {
    const { stockCode, realPrice, predictedPrice, currentPrice, pct, highPrice, lowPrice, targetTime, tradeDate, timestampStr, rollingPredictions, runId } = req.body
    const observedPrice = Number(realPrice)
    if (!/^\d{6}$/.test(String(stockCode || '')) || !Number.isFinite(observedPrice) || observedPrice <= 0) {
      return res.status(400).json({ code: 400, message: '股票代码或实盘价格无效', data: null })
    }

    const tDate = tradeDate || dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tDate))) {
      return res.status(400).json({ code: 400, message: '交易日期无效', data: null })
    }
    const parsedTimestamp = timestampStr ? dayjs(timestampStr) : dayjs()
    if (!parsedTimestamp.isValid()) {
      return res.status(400).json({ code: 400, message: '行情时间无效', data: null })
    }
    const tStamp = parsedTimestamp.tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss+08:00')
    const predicted = Number(predictedPrice)
    const safePredicted = Number.isFinite(predicted) && predicted > 0 ? predicted : observedPrice
    const deviationPct = Number(((Math.abs(observedPrice - safePredicted) / observedPrice) * 100).toFixed(2))

    const validRolling = Array.isArray(rollingPredictions)
      ? rollingPredictions.filter((item: any) =>
          item && /^\d{2}:\d{2}$/.test(String(item.targetTime || '')) &&
          Number.isFinite(Number(item.predictedPrice)) && Number(item.predictedPrice) > 0
        ).slice(0, 242)
      : []

    await client.query('BEGIN')
    await client.query(
      `UPDATE stocks
       SET current_price = $1,
           pct = COALESCE($2, pct),
           high_price = GREATEST(COALESCE(high_price, 0), $3),
           low_price = CASE WHEN COALESCE(low_price, 0) <= 0 THEN $4 ELSE LEAST(low_price, $4) END,
           updated_at = NOW()
       WHERE code = $5`,
      [Number(currentPrice) || observedPrice, Number.isFinite(Number(pct)) ? Number(pct) : null, Number(highPrice) || observedPrice, Number(lowPrice) || observedPrice, stockCode]
    )

    const { rows } = await client.query(
      `INSERT INTO stock_price_histories (stock_code, timestamp, real_price, predicted_price, deviation_pct)
       VALUES ($1, $2::timestamptz, $3, $4, $5)
       RETURNING id, stock_code as "stockCode", timestamp, real_price as "realPrice", predicted_price as "predictedPrice", deviation_pct as "deviationPct"`,
      [stockCode, tStamp, observedPrice, safePredicted, deviationPct]
    )

    if (validRolling.length > 0) {
      for (const rp of validRolling) {
        await client.query(
          `INSERT INTO stock_rolling_predictions
            (stock_code, predict_date, target_time, predicted_price, run_id, forecast_at, target_at, lead_minutes)
           VALUES ($1, $2::date, $3::text, $4, $5::uuid, $6::timestamptz,
                   (($2::date::text || ' ' || $3::text || ':00')::timestamp AT TIME ZONE 'Asia/Shanghai'), $7)`,
          [stockCode, tDate, rp.targetTime, Number(rp.predictedPrice),
            typeof runId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId) ? runId : null,
            tStamp, Number.isInteger(Number(rp.leadMinutes)) ? Number(rp.leadMinutes) : null]
        )
      }
    } else if (targetTime && Number.isFinite(predicted) && predicted > 0) {
      await client.query(
        `INSERT INTO stock_rolling_predictions
          (stock_code, predict_date, target_time, predicted_price, run_id, forecast_at, target_at, lead_minutes)
         VALUES ($1, $2::date, $3::text, $4, $5::uuid, $6::timestamptz,
                 (($2::date::text || ' ' || $3::text || ':00')::timestamp AT TIME ZONE 'Asia/Shanghai'), 5)`,
        [stockCode, tDate, targetTime, predicted,
          typeof runId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId) ? runId : null,
          tStamp]
      )
    }

    await client.query('COMMIT')
    return res.json({ code: 0, message: '数据点同步成功', data: rows[0] })
  } catch (err: any) {
    await client.query('ROLLBACK')
    console.error('Sync point error:', err)
    return res.status(500).json({ code: 500, message: '同步失败', data: null })
  } finally {
    client.release()
  }
})

// 旧接口曾允许前端提交随机正弦曲线。保留明确的退役响应，防止旧客户端静默写入伪预测。
app.post('/api/v1/stocks/re-predict', (_req, res) => {
  return res.status(410).json({
    code: 410,
    message: '任意曲线重模拟接口已退役；请使用版本化概率模型生成新的预测运行',
    data: null,
  })
})

async function startServer() {
  await runMigrationsUp()
  app.listen(port, () => {
    console.log(`🚀 ZeroQuant Express Server running at http://localhost:${port}`)
    if (process.env.ZEROQUANT_DISABLE_SCHEDULER === 'true') {
      console.log('[Scheduler] 已通过 ZEROQUANT_DISABLE_SCHEDULER 禁用（测试/维护模式）')
    } else {
      startQuantInternalScheduler()
    }
  })
}

startServer().catch((error) => {
  console.error('ZeroQuant startup failed:', error)
  process.exit(1)
})
