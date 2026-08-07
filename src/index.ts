import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { pool } from './db.js'

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

    const targetDate = (date as string) || (startDate as string) || '2026-08-10' // 默认下一个开盘日

    // A. 真实实盘轨迹线 (只取选定日期的真实分钟交易数据)
    const { rows: realHistories } = await pool.query(
      `SELECT timestamp, real_price as "realPrice"
       FROM stock_price_histories
       WHERE stock_code = $1
         AND timestamp::date = $2::date
       ORDER BY timestamp ASC`,
      [code, targetDate]
    )

    // B. 开盘前全天预判线 (Base Version 1 与所有重重预测 Version 线)
    const { rows: predictions } = await pool.query(
      `SELECT version, is_base as "isBase", time_points as "timePoints", created_at as "createdAt"
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

    return res.json({
      code: 0,
      message: 'ok',
      data: {
        stockCode: code,
        date: targetDate,
        realHistories,
        predictions,
        rollingPredictions
      }
    })
  } catch (err: any) {
    console.error('Fetch advanced history error:', err)
    return res.status(500).json({ code: 500, message: '高级轨迹获取失败', data: null })
  }
})

// 5. 1分钟轮询脚本实时写入 (包含实盘价、提前5分钟动态预测线、版本重预测判断)
app.post('/api/v1/stocks/sync-point', async (req, res) => {
  try {
    const { stockCode, realPrice, predictedPrice, currentPrice, pct, highPrice, lowPrice, targetTime, tradeDate } = req.body

    if (!stockCode || realPrice === undefined) {
      return res.status(400).json({ code: 400, message: '参数缺失', data: null })
    }

    const tDate = tradeDate || new Date().toISOString().split('T')[0]
    const deviationPct = predictedPrice ? Number(((Math.abs(realPrice - predictedPrice) / realPrice) * 100).toFixed(2)) : 0

    // 1. 更新 Stocks 表最新价
    await pool.query(
      `UPDATE stocks
       SET current_price = $1, pct = COALESCE($2, pct), high_price = GREATEST(high_price, $3), low_price = LEAST(low_price, $4), updated_at = NOW()
       WHERE code = $5`,
      [currentPrice || realPrice, pct, highPrice || realPrice, lowPrice || realPrice, stockCode]
    )

    // 2. 插入真实轨迹点 (仅盘中记录)
    const { rows } = await pool.query(
      `INSERT INTO stock_price_histories (stock_code, timestamp, real_price, predicted_price, deviation_pct, trade_date)
       VALUES ($1, NOW(), $2, $3, $4, $5::date)
       RETURNING id, stock_code as "stockCode", timestamp, real_price as "realPrice", predicted_price as "predictedPrice", deviation_pct as "deviationPct"`,
      [stockCode, realPrice, predictedPrice || realPrice, deviationPct, tDate]
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
