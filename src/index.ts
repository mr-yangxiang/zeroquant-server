import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { pool } from './db.js'

dayjs.extend(utc)
dayjs.extend(timezone)

dotenv.config()

const app = express()
const port = process.env.PORT ? parseInt(process.env.PORT) : 3002
const JWT_SECRET = process.env.JWT_SECRET || 'zeroquant_secret_2026_super_safe'

app.use(cors())
app.use(express.json())

// 1. 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ZeroQuant Express Server', timestamp: new Date().toISOString() })
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
    const { rows: positionRows } = await pool.query(
      `SELECT holding_shares as "holdingShares", cost_price as "costPrice", t_shares as "tShares"
       FROM user_positions WHERE stock_code = $1 AND user_id = 1`,
      [code]
    )

    const { rows: tradeRows } = await pool.query(
      `SELECT id, action_type as "actionType", trade_price as "tradePrice", trade_shares as "tradeShares", 
              TO_CHAR(trade_time AT TIME ZONE 'Asia/Shanghai', 'HH24:MI:SS') as "tradeTime", note
       FROM user_trade_actions WHERE stock_code = $1 AND user_id = 1 AND (trade_time AT TIME ZONE 'Asia/Shanghai')::date = $2::date
       ORDER BY trade_time DESC`,
      [code, targetDate]
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
    const { stockCode, holdingShares, costPrice } = req.body
    if (!stockCode) return res.status(400).json({ code: 400, message: '股票代码缺失' })

    await pool.query(
      `INSERT INTO user_positions (user_id, stock_code, holding_shares, cost_price)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (user_id, stock_code) DO UPDATE SET
         holding_shares = EXCLUDED.holding_shares,
         cost_price = EXCLUDED.cost_price,
         updated_at = NOW()`,
      [stockCode, parseInt(holdingShares) || 0, parseFloat(costPrice) || 0.0]
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
    const { stockCode, actionType, tradePrice, tradeShares } = req.body
    if (!stockCode || !actionType || !tradePrice || !tradeShares) {
      return res.status(400).json({ code: 400, message: '操作参数不完整' })
    }

    const { rows } = await pool.query(
      `INSERT INTO user_trade_actions (user_id, stock_code, action_type, trade_price, trade_shares, trade_time)
       VALUES (1, $1, $2, $3, $4, NOW())
       RETURNING id, action_type as "actionType", trade_price as "tradePrice", trade_shares as "tradeShares", TO_CHAR(trade_time AT TIME ZONE 'Asia/Shanghai', 'HH24:MI:SS') as "tradeTime"`,
      [stockCode, actionType.toUpperCase(), parseFloat(tradePrice), parseInt(tradeShares)]
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
    const { id } = req.params
    if (!id) {
      return res.status(400).json({ code: 400, message: '参数缺失' })
    }

    await pool.query(
      `DELETE FROM user_trade_actions WHERE id = $1 AND user_id = 1`,
      [parseInt(id)]
    )

    return res.json({ code: 0, message: '成功撤销该笔实盘操作' })
  } catch (err: any) {
    console.error('Delete trade action error:', err)
    return res.status(500).json({ code: 500, message: '删除失败' })
  }
})

// 5. 1分钟轮询脚本实时写入 (包含实盘价、提前5分钟动态预测线、版本重预测判断)
app.post('/api/v1/stocks/sync-point', async (req, res) => {
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

// 6. 重新模拟/生成版本对比预测线 (当偏差过大时)
app.post('/api/v1/stocks/re-predict', async (req, res) => {
  try {
    const { stockCode, date, newTimePoints } = req.body
    if (!stockCode || !newTimePoints) {
      return res.status(400).json({ code: 400, message: '参数缺失', data: null })
    }

    const tDate = date || '2026-08-10'

    // 获取当前最大 version
    const { rows: verRows } = await pool.query(
      `SELECT COALESCE(MAX(version), 0) as max_ver FROM stock_day_predictions WHERE stock_code = $1 AND predict_date = $2::date`,
      [stockCode, tDate]
    )
    const nextVer = verRows[0].max_ver + 1

    await pool.query(
      `INSERT INTO stock_day_predictions (stock_code, predict_date, version, is_base, time_points)
       VALUES ($1, $2::date, $3, FALSE, $4)`,
      [stockCode, tDate, nextVer, JSON.stringify(newTimePoints)]
    )

    return res.json({ code: 0, message: `成功重新模拟生成第 ${nextVer} 版预测对比折线`, data: { version: nextVer } })
  } catch (err: any) {
    console.error('Re-predict error:', err)
    return res.status(500).json({ code: 500, message: '重新模拟失败', data: null })
  }
})

app.listen(port, () => {
  console.log(`🚀 ZeroQuant Express Server running at http://localhost:${port}`)
})
