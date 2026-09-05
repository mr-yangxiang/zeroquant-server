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
import { ensureQuantSchema } from './quant-schema.js'
import { createQuantRouter, quantInternalOnly } from './quant-routes.js'

dayjs.extend(utc)
dayjs.extend(timezone)

dotenv.config({ override: true })

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
      `INSERT INTO users (id, phone, username, password, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())
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

function getUserFromReq(req: express.Request): string {
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
  return '1'
}

// 3. 获取所有 6 支重点做 T 股票列表
app.get('/api/v1/stocks', async (_req, res) => {
  try {
    const { rows: stocks } = await pool.query('SELECT * FROM stocks ORDER BY code ASC')
    
    for (const stock of stocks) {
      const { rows: analyses } = await pool.query(
        'SELECT * FROM stock_t_analyses WHERE stock_code = $1 ORDER BY updated_at DESC LIMIT 1',
        [stock.code]
      )
      stock.analyses = analyses.map(a => ({
        id: a.id,
        chipAnalysis: a.chip_analysis,
        hostStyle: a.host_style,
        doReasons: a.do_reasons || '【推荐买入/做T理由】：处于均线密集密集托盘带，现货大宗支撑强劲，适合分批建仓。',
        dontReasons: a.dont_reasons || '【不推荐/禁忌行为】：严禁在分时快速脉冲拉高时追高！严禁在跌破强止损线时盲目补仓死扛！',
        realtimeAdvice: a.realtime_advice || '【实时开盘盘口指导】：盘中请紧盯 09:40-10:15 的回踩确认点与 13:30 午后脉冲点。',
        scenario1: a.scenario_1,
        scenario2: a.scenario_2,
        scenario3: a.scenario_3,
        scenario4: a.scenario_4,
        updatedAt: a.updated_at
      }))
      stock.currentPrice = stock.current_price
      stock.yesterdayPrice = stock.yesterday_price
      stock.highPrice = stock.high_price
      stock.lowPrice = stock.low_price
      stock.predictedHigh = stock.predicted_high
      stock.predictedLow = stock.predicted_low
      stock.winRate = stock.win_rate
    }

    return res.json({ code: 0, message: 'ok', data: stocks })
  } catch (err: any) {
    console.error('Fetch stocks error:', err)
    return res.status(500).json({ code: 500, message: '数据获取失败', data: null })
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

    // 防漏：若 11:30 存在但 13:00 缺失，自动补充 13:00 确保轨迹线在午盘接缝处平滑闭合
    const has1300 = realHistories.some((r: any) => r.timestamp && r.timestamp.includes('T13:00:00'))
    if (!has1300 && realHistories.length > 0) {
      const point1130 = realHistories.find((r: any) => r.timestamp && r.timestamp.includes('T11:30:00'))
      if (point1130) {
        const fill1300Ts = `${targetDate}T13:00:00+08:00`
        realHistories.push({ timestamp: fill1300Ts, realPrice: point1130.realPrice })
        realHistories.sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp))
      }
    }

    // B. 开盘前全天预判线 (Base Version 1 与所有重预测 Version 线，包含看涨/看跌方向与目标幅度)
    const { rows: predictions } = await pool.query(
      `SELECT version, is_base as "isBase", time_points as "timePoints", direction, target_pct as "targetPct", created_at as "createdAt"
       FROM stock_day_predictions
       WHERE stock_code = $1
         AND predict_date = $2::date
       ORDER BY version ASC`,
      [code, targetDate]
    )

    // C. 盘中提前 5 分钟动态修正线
    const { rows: rollingPredictions } = await pool.query(
      `SELECT target_time as "targetTime", predicted_price as "predictedPrice"
       FROM stock_rolling_predictions
       WHERE stock_code = $1
         AND predict_date = $2::date
       ORDER BY id ASC`,
      [code, targetDate]
    )

    // D. Level-2 逐笔大单 (>=1000手) 与冰山压单/托盘买单
    const { rows: l2Orders } = await pool.query(
      `SELECT time_str as "timeStr", type, price, volume_lots as "volumeLots", note
       FROM stock_l2_orders
       WHERE stock_code = $1
         AND trade_date = $2::date
       ORDER BY time_str ASC`,
      [code, targetDate]
    )

    // E. 30天与100天做T历史回测累积收益率看板
    const { rows: backtestStats } = await pool.query(
      `SELECT period, win_rate as "winRate", cum_roi as "cumRoi", daily_roi_points as "dailyRoiPoints"
       FROM stock_backtest_stats
       WHERE stock_code = $1`,
      [code]
    )

    // F. 每日龙虎榜/大宗交易与机构持仓复盘 (包含偏差原因剖析、总结道理与后续算法改进)
    const { rows: dailyReviews } = await pool.query(
      `SELECT block_trades as "blockTrades", holding_ratio as "holdingRatio",
              institution_style as "institutionStyle", tomorrow_advice as "tomorrowAdvice",
              deviation_reason as "deviationReason", key_lesson as "keyLesson",
              future_action as "futureAction"
       FROM stock_daily_reviews
       WHERE stock_code = $1
       ORDER BY review_date DESC
       LIMIT 1`,
      [code]
    )

    // G. 用户实时持仓与个人实盘操作记录 (针对个人仓位和买卖动作)
    const currentUserId = getUserFromReq(req)

    const { rows: positionRows } = await pool.query(
      `SELECT holding_shares as "holdingShares", cost_price as "costPrice", t_shares as "tShares"
       FROM user_positions WHERE stock_code = $1 AND user_id = $2`,
      [code, currentUserId]
    )

    const { rows: tradeRows } = await pool.query(
      `SELECT id, action_type as "actionType", trade_price as "tradePrice", trade_shares as "tradeShares", 
              TO_CHAR(trade_time AT TIME ZONE 'Asia/Shanghai', 'HH24:MI:SS') as "tradeTime", note
       FROM user_trade_actions WHERE stock_code = $1 AND user_id = $2 AND (trade_time AT TIME ZONE 'Asia/Shanghai')::date = $3::date
       ORDER BY trade_time DESC`,
      [code, currentUserId, targetDate]
    )

    return res.json({
      code: 0,
      message: 'ok',
      data: {
        stockCode: code,
        date: targetDate,
        realHistories,
        predictions,
        rollingPredictions,
        l2Orders,
        backtestStats,
        dailyReview: dailyReviews[0] || null,
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
    const currentUserId = getUserFromReq(req)
    const { stockCode, holdingShares, costPrice } = req.body
    if (!stockCode) return res.status(400).json({ code: 400, message: '股票代码缺失' })

    await pool.query(
      `INSERT INTO user_positions (user_id, stock_code, holding_shares, cost_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, stock_code) DO UPDATE SET
         holding_shares = EXCLUDED.holding_shares,
         cost_price = EXCLUDED.cost_price,
         updated_at = NOW()`,
      [currentUserId, stockCode, parseInt(holdingShares) || 0, parseFloat(costPrice) || 0.0]
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
    const currentUserId = getUserFromReq(req)
    const { stockCode, actionType, tradePrice, tradeShares } = req.body
    if (!stockCode || !actionType || !tradePrice || !tradeShares) {
      return res.status(400).json({ code: 400, message: '操作参数不完整' })
    }

    const { rows } = await pool.query(
      `INSERT INTO user_trade_actions (user_id, stock_code, action_type, trade_price, trade_shares, trade_time)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, action_type as "actionType", trade_price as "tradePrice", trade_shares as "tradeShares", TO_CHAR(trade_time AT TIME ZONE 'Asia/Shanghai', 'HH24:MI:SS') as "tradeTime"`,
      [currentUserId, stockCode, actionType.toUpperCase(), parseFloat(tradePrice), parseInt(tradeShares)]
    )

    return res.json({ code: 0, message: '实盘操作录入成功', data: rows[0] })
  } catch (err: any) {
    console.error('Trade action error:', err)
    return res.status(500).json({ code: 500, message: '实盘操作录入失败' })
  }
})

// 9. 删除/撤销某笔用户实盘操作 API
app.delete('/api/v1/user/trade-action/:id', async (req, res) => {
  try {
    const currentUserId = getUserFromReq(req)
    const { id } = req.params
    if (!id) {
      return res.status(400).json({ code: 400, message: '参数缺失' })
    }

    await pool.query(
      `DELETE FROM user_trade_actions WHERE id = $1 AND user_id = $2`,
      [parseInt(id), currentUserId]
    )

    return res.json({ code: 0, message: '成功撤销该笔实盘操作' })
  } catch (err: any) {
    console.error('Delete trade action error:', err)
    return res.status(500).json({ code: 500, message: '删除失败' })
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
    const stock = stockRows[0] || { name: '目标标的', code: stockCode, current_price: 10.0, yesterday_price: 10.0, high_price: 10.0, low_price: 10.0, pct: 0, predicted_low: 9.8, predicted_high: 10.3 }
    
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
    const quantActionable = Boolean(quantForecast?.actionable)

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
      // 🚀 核心：根据用户所说的明确陈述性买卖内容，直接自动帮用户执行对应实盘操作，并给出针对性合理建议与分析
      if (tradeResult.actionType === 'BUY') {
        // 1. 自动写入实盘买入操作
        await pool.query(
          `INSERT INTO user_trade_actions (user_id, stock_code, action_type, trade_price, trade_shares, trade_time)
           VALUES ($1, $2, 'BUY', $3, $4, NOW())`,
          [currentUserId, stockCode, tradeResult.price, tradeResult.shares]
        )
        // 2. 自动重算综合持仓与均价成本
        const newShares = userHolding + tradeResult.shares
        const newCost = Number(((userHolding * userCost + tradeResult.shares * tradeResult.price) / newShares).toFixed(2))
        await pool.query(
          `INSERT INTO user_positions (user_id, stock_code, holding_shares, cost_price)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, stock_code) DO UPDATE SET
             holding_shares = EXCLUDED.holding_shares,
             cost_price = EXCLUDED.cost_price,
             updated_at = NOW()`,
          [currentUserId, stockCode, newShares, newCost]
        )
        const tProfit = ((pHigh - tradeResult.price) * tradeResult.shares).toFixed(2)
        const stopLoss = (tradeResult.price * 0.985).toFixed(2)
        const priceDiffPct = (((tradeResult.price - currP) / currP) * 100).toFixed(2)
        const isBuyHigh = tradeResult.price > currP * 1.01
        const isBuyLow = tradeResult.price < currP * 0.99
        
        reply = `### ✅ 【实盘买入已自动入库并重算】—— ${stock.name} (${stock.code})\n\n`
        reply += `已根据您说的话，为您自动同步录入实盘操作并重算名下持仓：\n`
        reply += `- 🟢 **本次操作**：**买入 ${tradeResult.shares.toLocaleString()} 股 @ ¥${tradeResult.price.toFixed(2)}**\n`
        reply += `- 📊 **持仓重算**：名下持仓由 ${userHolding.toLocaleString()} 股增至 **${newShares.toLocaleString()} 股**，综合成本均价由 ¥${userCost.toFixed(2)} 调整为 **¥${newCost.toFixed(2)}**\n\n`
        
        reply += `### 💡 【本次加仓买入深度量化评估与诊断】\n\n`
        if (isBuyHigh) {
          reply += `1. ⚠️ **买入位置评估（盘中略有追高风险）**：您本次买入单价 **¥${tradeResult.price.toFixed(2)}** 高于当前盘口现价 **¥${currP.toFixed(2)}** (${priceDiffPct}%)。公开数据无法证明具体席位行为，应继续观察成交与订单流确认。\n`
        } else if (isBuyLow) {
          reply += `1. 💎 **买入位置评估（精准低吸）**：您本次买入单价 **¥${tradeResult.price.toFixed(2)}** 低于当前现价 **¥${currP.toFixed(2)}**，贴近模型预判强支撑位 **¥${pLow.toFixed(2)}**，属于高性价比的左侧/回踩建仓，筹码结构优异。\n`
        } else {
          reply += `1. 📊 **买入位置评估（平稳跟随）**：您本次买入单价 **¥${tradeResult.price.toFixed(2)}** 紧随当前盘口现价 **¥${currP.toFixed(2)}**，处于日内 VWAP 均价线健康波动中枢（[¥${pLow.toFixed(2)} ~ ¥${pHigh.toFixed(2)}]）。\n`
        }
        reply += `2. 🔍 **主力盘口与席位动态**：当前盘口多空处于平衡博弈期，日内关键防守位在 **¥${pLow.toFixed(2)}**。只要盘中不跌破该托盘线，本次加仓筹码具有较好的胜率基础。\n\n`
        
        reply += `### 🎯 【针对本次新增 ${tradeResult.shares.toLocaleString()} 股 T 仓的专属操作与解盘指引】\n\n`
        reply += `1. 🔴 **高抛兑现目标（接力高卖）**：\n`
        reply += `   风险区间上界为 **¥${pHigh.toFixed(2)}**；若模型已通过门槛且盘口确认，可将其作为情景参考。本次价格差对应的毛收益约 **¥${tProfit} 元**，尚未扣除费用、税费、滑点和冲击。\n`
        reply += `2. 🚨 **做 T 被套极端防守预案**：\n`
        reply += `   若买入后盘口遭遇突发抛压跳水跌破 **¥${stopLoss}**（跌幅超 1.5%），且 14:30 仍未收复 VWAP 均价线，请坚决平出这 ${tradeResult.shares.toLocaleString()} 股 T 仓止损，严禁将日内短 T 变为被动死扛！\n`
        reply += `3. 🔄 **防卖飞/深跌接回备用策略**：\n`
        reply += `   后续在 ¥${pHigh.toFixed(2)} 高抛后若股价继续放量主升浪突破，决不直接追高，待回踩确认突破位时再接；若高抛后回落跌超 1.5% 且在支撑位出现万手托盘，再挂单接回完成滚仓。`
      } else if (tradeResult.actionType === 'SELL') {
        // 1. 自动写入实盘卖出操作
        await pool.query(
          `INSERT INTO user_trade_actions (user_id, stock_code, action_type, trade_price, trade_shares, trade_time)
           VALUES ($1, $2, 'SELL', $3, $4, NOW())`,
          [currentUserId, stockCode, tradeResult.price, tradeResult.shares]
        )
        // 2. 更新剩余持仓
        const remainShares = Math.max(0, userHolding - tradeResult.shares)
        const lockedProfit = userCost > 0 ? ((tradeResult.price - userCost) * tradeResult.shares).toFixed(2) : ((tradeResult.price - pLow) * tradeResult.shares).toFixed(2)
        await pool.query(
          `INSERT INTO user_positions (user_id, stock_code, holding_shares, cost_price)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, stock_code) DO UPDATE SET
             holding_shares = EXCLUDED.holding_shares,
             updated_at = NOW()`,
          [currentUserId, stockCode, remainShares, userCost]
        )
        reply = `### ✅ 【实盘高抛/卖出已自动入库】—— ${stock.name} (${stock.code})\n\n`
        reply += `已根据您说的话，为您自动同步录入实盘高抛并锁定收益：\n`
        reply += `- 🔴 **本次操作**：**卖出 ${tradeResult.shares.toLocaleString()} 股 @ ¥${tradeResult.price.toFixed(2)}**\n`
        reply += `- 💰 **本笔价差毛收益**：约 **¥${lockedProfit} 元**（未扣除费用、税费和滑点）\n`
        reply += `- 📊 **持仓更新**：剩余底仓 **${remainShares.toLocaleString()} 股**（成本保持 ¥${userCost.toFixed(2)}）\n\n`
        
        reply += `### 💡 【本次高抛卖出量化时机与盘口评估】\n\n`
        reply += `1. 🎯 **卖点位置质量**：卖出价格 **¥${tradeResult.price.toFixed(2)}** 距离预测阻力位 **¥${pHigh.toFixed(2)}** 贴合度高，成功将浮盈落袋为安，有效规避了日内冲高回落倒仓风险。\n`
        reply += `2. 🔍 **承接情景**：公开成交无法识别最终操盘者；只有在风险下界附近出现可验证的成交与订单流改善时，承接情景才获得确认。\n\n`
        
        reply += `### 🎯 【高抛后低吸接回与防踩空/深跌预案】\n\n`
        reply += `1. 🟢 **低位接回挂单点**：\n`
        reply += `   建议等待股价回踩第一支撑位 **¥${pLow.toFixed(2)}** 且盘口出现连续托盘大单时，重新挂单接回 **${tradeResult.shares.toLocaleString()} 股**，完成完整做 T 闭环。\n`
        reply += `2. 🚀 **踩空/卖飞应对预案**：\n`
        reply += `   若高卖后股价不跌反涨（放量突破主升浪），**决不可盲目追高**！必须等待股价回踩突破确认位（¥${(tradeResult.price * 1.01).toFixed(2)} 附近企稳）才可考虑重新进场。\n`
        reply += `3. 📉 **深跌预案**：\n`
        reply += `   若高卖后盘中大跌，只有差价 >1.5% 且企稳才接回，若直接跌破强支撑位决不盲目接飞刀。`
      } else if (tradeResult.actionType === 'SET_POSITION') {
        // 设置底仓
        await pool.query(
          `INSERT INTO user_positions (user_id, stock_code, holding_shares, cost_price)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, stock_code) DO UPDATE SET
             holding_shares = EXCLUDED.holding_shares,
             cost_price = EXCLUDED.cost_price,
             updated_at = NOW()`,
          [currentUserId, stockCode, tradeResult.shares, tradeResult.price]
        )
        reply = `### ✅ 【个人持仓底仓已同步更新】—— ${stock.name} (${stock.code})\n\n`
        reply += `已根据您的指令将持仓设置为：**${tradeResult.shares.toLocaleString()} 股 @ ¥${tradeResult.price.toFixed(2)}**。\n`
        reply += `后续做 T 测算与挂单点位将基于此持仓基准为您精确计算收益与止损线！`
      }
      if (!quantActionable) {
        const probabilities = quantForecast
          ? `15分钟概率为上涨 ${(Number(quantForecast.pUp) * 100).toFixed(1)}%、震荡 ${(Number(quantForecast.pFlat) * 100).toFixed(1)}%、下跌 ${(Number(quantForecast.pDown) * 100).toFixed(1)}%`
          : '当前没有可用的版本化概率预测'
        reply = `### 操作记录已更新——${stock.name} (${stock.code})\n\n系统只记录了您明确陈述的成交/持仓信息，没有向券商下单。${probabilities}。\n\n当前模型状态为 **${quantForecast?.modelState || 'unavailable'}**，尚未达到自动交易门槛，因此不会根据未校准模型生成精确挂单或收益承诺。请以券商实际成交、A股 T+1 可卖库存和个人风险上限为准。`
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

        const systemPrompt = `你是 ZeroQuant 的量化研究解释器。你只能解释可观察数据、模型概率、风险与失效条件，不得声称知道未提供的真实机构/游资身份，不得承诺收益或把概率区间说成确定支撑阻力。

【当前标的实盘量化底表数据】：
- 股票名称与代码：${stock.name} (${stock.code})
- 盘口实时现价：¥${currP.toFixed(2)} (昨收: ¥${yestP.toFixed(2)}, 日内最高: ¥${highP.toFixed(2)}, 最低: ¥${lowP.toFixed(2)}, 涨跌幅: ${Number(stock.pct || 0).toFixed(2)}%)
- 当前概率风险区间：P10 下界 ¥${pLow.toFixed(2)} ~ P90 上界 ¥${pHigh.toFixed(2)}
- 用户当前绑定底仓：${userHolding > 0 ? `${userHolding.toLocaleString()} 股 @ 成本均价 ¥${userCost.toFixed(2)} (当前浮动盈亏: ¥${((currP - userCost) * userHolding).toFixed(2)})` : '暂未录入底仓（以大盘中枢指导）'}
- 最近公开逐笔成交：${l2Rows.map((o: any) => `[${o.orderTime || '盘中'}] ${o.orderType} ${o.volume}手 @ ¥${Number(o.price).toFixed(2)}`).join('; ') || '暂无可验证逐笔成交'}
- 模型版本与状态：${quantForecast?.modelVersion || '无'} / ${quantForecast?.modelState || '无'}
- 15分钟概率：上涨 ${quantForecast ? (Number(quantForecast.pUp) * 100).toFixed(1) : '--'}%，震荡 ${quantForecast ? (Number(quantForecast.pFlat) * 100).toFixed(1) : '--'}%，下跌 ${quantForecast ? (Number(quantForecast.pDown) * 100).toFixed(1) : '--'}%
- P10/P50/P90收益：${quantForecast ? `${Number(quantForecast.q10ReturnPct).toFixed(2)}% / ${Number(quantForecast.q50ReturnPct).toFixed(2)}% / ${Number(quantForecast.q90ReturnPct).toFixed(2)}%` : '无'}
- 是否通过交易门槛：${quantActionable ? '是' : '否'}

【实时个股最新公告与资讯】：
${liveNewsText}

【回答约束】：
1. 先说明数据时间和模型是否已校准；未通过交易门槛时只能给情景、风险和需要继续观察的确认信号。
2. 区分事实、模型推断和未知；公开逐笔成交不能归因为具体席位。
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
          ? `当前模型 **${quantForecast.modelState}** 的15分钟输出为：上涨 ${(Number(quantForecast.pUp) * 100).toFixed(1)}%、震荡 ${(Number(quantForecast.pFlat) * 100).toFixed(1)}%、下跌 ${(Number(quantForecast.pDown) * 100).toFixed(1)}%，置信度 ${(Number(quantForecast.confidence) * 100).toFixed(1)}%。\n\nP10-P90 是风险范围，不是保证成交的支撑阻力。当前是否通过交易门槛：**${quantActionable ? '是' : '否'}**。`
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

// 5. 1分钟轮询脚本实时写入 (包含实盘价、提前5分钟动态预测线、版本重预测判断)
app.post('/api/v1/stocks/sync-point', quantInternalOnly, async (req, res) => {
  try {
    const { stockCode, realPrice, predictedPrice, currentPrice, pct, highPrice, lowPrice, targetTime, tradeDate, timestampStr } = req.body

    if (!stockCode || realPrice === undefined) {
      return res.status(400).json({ code: 400, message: '参数缺失', data: null })
    }

    const tDate = tradeDate || dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD')
    const tStamp = timestampStr ? dayjs(timestampStr).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss+08:00') : dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss+08:00')
    const deviationPct = predictedPrice ? Number(((Math.abs(realPrice - predictedPrice) / realPrice) * 100).toFixed(2)) : 0

    // 1. 更新 Stocks 表最新价
    await pool.query(
      `UPDATE stocks
       SET current_price = $1, pct = COALESCE($2, pct), high_price = GREATEST(high_price, $3), low_price = LEAST(low_price, $4), updated_at = NOW()
       WHERE code = $5`,
      [currentPrice || realPrice, pct, highPrice || realPrice, lowPrice || realPrice, stockCode]
    )

    // 2. 插入真实轨迹点 (使用 ID 自动生成与北京时间 timestamptz)
    const { rows } = await pool.query(
      `INSERT INTO stock_price_histories (id, stock_code, timestamp, real_price, predicted_price, deviation_pct, trade_date)
       VALUES (gen_random_uuid()::text, $1, $2::timestamptz, $3, $4, $5, $6::date)
       RETURNING id, stock_code as "stockCode", timestamp, real_price as "realPrice", predicted_price as "predictedPrice", deviation_pct as "deviationPct"`,
      [stockCode, tStamp, realPrice, predictedPrice || realPrice, deviationPct, tDate]
    )

    // 3. 记录提前 5 分钟动态修正线
    if (targetTime && predictedPrice !== undefined) {
      await pool.query(
        `INSERT INTO stock_rolling_predictions (stock_code, predict_date, target_time, predicted_price)
         VALUES ($1, $2::date, $3, $4)`,
        [stockCode, tDate, targetTime, predictedPrice]
      )
    }

    return res.json({ code: 0, message: '数据点同步成功', data: rows[0] })
  } catch (err: any) {
    console.error('Sync point error:', err)
    return res.status(500).json({ code: 500, message: '同步失败', data: null })
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
  await ensureQuantSchema()
  app.listen(port, () => {
    console.log(`🚀 ZeroQuant Express Server running at http://localhost:${port}`)
    startQuantInternalScheduler()
  })
}

startServer().catch((error) => {
  console.error('ZeroQuant startup failed:', error)
  process.exit(1)
})
