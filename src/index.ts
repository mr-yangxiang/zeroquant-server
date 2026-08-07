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
    
    // 附加最新的做 T 分析
    for (const stock of stocks) {
      const { rows: analyses } = await pool.query(
        'SELECT * FROM stock_t_analyses WHERE stock_code = $1 ORDER BY updated_at DESC LIMIT 1',
        [stock.code]
      )
      stock.analyses = analyses.map(a => ({
        id: a.id,
        chipAnalysis: a.chip_analysis,
        hostStyle: a.host_style,
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

// 4. 获取单支股票真实 vs 预测双线历史数据 (ECharts 专供)
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

// 5. 1分钟轮询脚本实时写入 (把真实价与预测价写入数据库)
app.post('/api/v1/stocks/sync-point', async (req, res) => {
  try {
    const { stockCode, realPrice, predictedPrice, currentPrice, pct, highPrice, lowPrice } = req.body

    if (!stockCode || realPrice === undefined || predictedPrice === undefined) {
      return res.status(400).json({ code: 400, message: '参数缺失', data: null })
    }

    const deviationPct = Number(((Math.abs(realPrice - predictedPrice) / realPrice) * 100).toFixed(2))

    // 更新 Stocks 表最新价
    await pool.query(
      `UPDATE stocks
       SET current_price = $1, pct = COALESCE($2, pct), high_price = GREATEST(high_price, $3), low_price = LEAST(low_price, $4), updated_at = NOW()
       WHERE code = $5`,
      [currentPrice || realPrice, pct, highPrice || realPrice, lowPrice || realPrice, stockCode]
    )

    // 插入 StockPriceHistory
    const { rows } = await pool.query(
      `INSERT INTO stock_price_histories (stock_code, timestamp, real_price, predicted_price, deviation_pct)
       VALUES ($1, NOW(), $2, $3, $4)
       RETURNING id, stock_code as "stockCode", timestamp, real_price as "realPrice", predicted_price as "predictedPrice", deviation_pct as "deviationPct"`,
      [stockCode, realPrice, predictedPrice, deviationPct]
    )

    return res.json({ code: 0, message: '数据点同步成功', data: rows[0] })
  } catch (err: any) {
    console.error('Sync point error:', err)
    return res.status(500).json({ code: 500, message: '同步失败', data: null })
  }
})

app.listen(port, () => {
  console.log(`🚀 ZeroQuant Express Server running at http://localhost:${port}`)
})
