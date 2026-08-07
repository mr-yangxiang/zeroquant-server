import { pool } from './db.js'
import bcrypt from 'bcryptjs'
import dayjs from 'dayjs'

async function seed() {
  console.log('🌱 正在初始化 ZeroQuant 数据库与基础数据...')

  // 1. 初始化表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL DEFAULT '管理员',
      phone VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      avatar TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stocks (
      code VARCHAR(20) PRIMARY KEY,
      full_code VARCHAR(20) NOT NULL,
      name VARCHAR(100) NOT NULL,
      current_price DOUBLE PRECISION DEFAULT 0,
      yesterday_price DOUBLE PRECISION DEFAULT 0,
      high_price DOUBLE PRECISION DEFAULT 0,
      low_price DOUBLE PRECISION DEFAULT 0,
      pct DOUBLE PRECISION DEFAULT 0,
      predicted_high DOUBLE PRECISION DEFAULT 0,
      predicted_low DOUBLE PRECISION DEFAULT 0,
      win_rate DOUBLE PRECISION DEFAULT 88.5,
      is_hot BOOLEAN DEFAULT TRUE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_price_histories (
      id SERIAL PRIMARY KEY,
      stock_code VARCHAR(20) REFERENCES stocks(code) ON DELETE CASCADE,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      real_price DOUBLE PRECISION NOT NULL,
      predicted_price DOUBLE PRECISION NOT NULL,
      deviation_pct DOUBLE PRECISION DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stock_t_analyses (
      id SERIAL PRIMARY KEY,
      stock_code VARCHAR(20) REFERENCES stocks(code) ON DELETE CASCADE,
      chip_analysis TEXT NOT NULL,
      host_style TEXT NOT NULL,
      scenario_1 TEXT NOT NULL,
      scenario_2 TEXT NOT NULL,
      scenario_3 TEXT NOT NULL,
      scenario_4 TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // 2. 初始化管理员 (15079393100 / admin@3100)
  const hashedPassword = await bcrypt.hash('admin@3100', 10)
  await pool.query(
    `INSERT INTO users (username, phone, password)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET password = EXCLUDED.password;`,
    ['ZeroQuant 总控管理员', '15079393100', hashedPassword]
  )
  console.log('✅ 管理员账号初始化成功: 15079393100')

  // 3. 全量 6 支股票做 T 博弈档案与 4 大分支策略
  const STOCKS_DATA = [
    {
      code: '600839',
      fullCode: 'sh600839',
      name: '四川长虹',
      currentPrice: 6.98,
      yesterdayPrice: 7.05,
      highPrice: 7.13,
      lowPrice: 6.91,
      pct: -0.99,
      predictedLow: 6.90,
      predictedHigh: 7.15,
      winRate: 88.5,
      chipAnalysis: '6.91元触发强反弹（MA10均线强支撑与22万手买单托盘），6.90元整数关口防御坚固。',
      hostStyle: '江浙游资（章盟主等）+ T+0网格量化算法。近30天冲高回落率 30.0%，做T高抛需提前0.5%挂单。',
      scenario1: '【高卖后不跌反涨（卖飞/踩空）】：冲高途中绝对不要追高！等待缩量回踩 7.12 - 7.15 元突破确认位企稳后再分批买回；若大阴线砸穿卖出价则为假突破，严禁买回。',
      scenario2: '【高卖后正常回调】：必须满足卖买差价 > 1.5% 且触及 6.91 支撑才回补，绝不在跌 0.3% 时急于急吃回。',
      scenario3: '【低吸被套】：若早盘低吸后跌破买入价，至 14:30 仍位于买入价下 1.5%，尾盘必须平 T 仓止损。',
      scenario4: '【深跌破位】：若失守 6.85 强止损位，说明游资弃庄，停止买回做 T 仓并减仓底仓。',
    },
    {
      code: '601899',
      fullCode: 'sh601899',
      name: '紫金矿业',
      currentPrice: 34.50,
      yesterdayPrice: 34.10,
      highPrice: 35.80,
      lowPrice: 34.15,
      pct: 1.17,
      predictedLow: 34.10,
      predictedHigh: 35.80,
      winRate: 92.4,
      chipAnalysis: '受伦敦金突破 2450 美元驱动冲高，35.80 元面临前期历史解套盘压制，34.15 元强支撑。',
      hostStyle: '北向外资 + 机构公募。近2年500天数据：外资高开高抛/低开回补成功率 76.8%，极度看重现货金铜价格。',
      scenario1: '【高卖后不跌反涨（卖飞/踩空）】：高卖后若继续大涨突破 35.80 前高，不要顺势追高；等待盘中回踩 35.50 - 35.80 突破位确认强支撑后方可分批买回。',
      scenario2: '【高卖后正常回调】：等待回踩 34.15 - 34.30 元强支撑区且外盘大宗稳健时分批买回，锁定 3%-4% 日内差价。',
      scenario3: '【低吸被套】：若低吸后受大盘拖累下探，失守 33.80 支撑需在尾盘平 T 仓防御。',
      scenario4: '【深跌破位】：若外盘金铜大跌导致紫金失守 33.50，停止做 T，等待 14:00 机构抄底。',
    },
    {
      code: '600362',
      fullCode: 'sh600362',
      name: '江西铜业',
      currentPrice: 47.37,
      yesterdayPrice: 46.25,
      highPrice: 47.88,
      lowPrice: 46.81,
      pct: 2.42,
      predictedLow: 46.50,
      predictedHigh: 48.20,
      winRate: 90.1,
      chipAnalysis: '伦铜大涨刺激大仓位机构买盘入场，46.50 元为前高转换为强支撑位，成交量放量。',
      hostStyle: '北向外资 + 有色大宗对冲机构 + 江浙大户。做T空间占比 60.2%，冲高回落率 20.0%。',
      scenario1: '【高卖后不跌反涨（卖飞/踩空）】：高卖后继续大涨冲破 48.00 元时切勿追高！只有当股价缩量回踩至 47.30 - 47.50 元突破确认位企稳且有大单托盘时，才能买回。若放量杀跌砸穿卖出价则为假突破诱多，严禁买回。',
      scenario2: '【高卖后正常回调】：必须满足卖买差价 > 1.5% 且触及 46.80 支撑位买回。',
      scenario3: '【低吸被套】：若早盘低吸后不涨反跌，至 14:30 仍位于买入价下 1.5%，尾盘必须平 T 仓止损。',
      scenario4: '【深跌破位】：若失守 46.20 强止损位，说明机构出逃，放弃接回并减仓底仓。',
    },
    {
      code: '603696',
      fullCode: 'sh603696',
      name: '安记食品',
      currentPrice: 12.99,
      yesterdayPrice: 13.46,
      highPrice: 13.48,
      lowPrice: 12.86,
      pct: -3.49,
      predictedLow: 12.75,
      predictedHigh: 13.50,
      winRate: 84.2,
      chipAnalysis: '触及 12.80 元小盘股前高平台支持线止跌，多空对撤后空头衰减。',
      hostStyle: '高β游资游击队（成泉系/拉萨天团）。近2年冲高回落率 25.8% (近30日达43.3%)，年涨停 17 次。',
      scenario1: '【高卖后不跌反涨（卖飞/踩空）】：安记属高β妖股，高卖后大涨绝不追高！若封涨停锁仓；若未封涨停回踩 13.30 确认支撑后再回补。',
      scenario2: '【高卖后正常回调】：等待探底 12.75 - 12.85 元长下影冰点低吸。',
      scenario3: '【低吸被套】：设 2% 坚决止损线，若低吸后跌破买入价 2%，尾盘平仓。',
      scenario4: '【深跌破位】：失守 12.60 元平台停止买回，防止主力大单跌停。',
    },
    {
      code: '000572',
      fullCode: 'sz000572',
      name: '海马汽车',
      currentPrice: 3.85,
      yesterdayPrice: 3.92,
      highPrice: 3.95,
      lowPrice: 3.79,
      pct: -1.79,
      predictedLow: 3.78,
      predictedHigh: 3.98,
      winRate: 91.8,
      chipAnalysis: '3.80 元低价股整数关口处聚集了大批游资托盘买单，3.95 元见明显抛压。',
      hostStyle: '低价股网格庄家 + 汽车出海游资。近2年冲高回落率 36.2% (全场最高)！13:30 午后脉冲拉高砸盘特征 100% 吻合。',
      scenario1: '【高卖后不跌反涨（卖飞/踩空）】：海马汽车冲高回落率 36.2% 为全场最高！午后脉冲高卖后大涨绝不追高，因为 65% 的概率会快速砸回！只有回踩 3.90 元托盘位才买回。',
      scenario2: '【高卖后正常回调】：按计划在 3.78 - 3.82 元低吸买回。',
      scenario3: '【低吸被套】：买入后若失守 3.75 元，尾盘平 T 仓。',
      scenario4: '【深跌破位】：若破位跌穿 3.74 元整数关，停止做 T。',
    },
    {
      code: '603366',
      fullCode: 'sh603366',
      name: '日出东方',
      currentPrice: 6.85,
      yesterdayPrice: 6.90,
      highPrice: 6.95,
      lowPrice: 6.77,
      pct: -0.72,
      predictedLow: 6.75,
      predictedHigh: 7.10,
      winRate: 86.9,
      chipAnalysis: '6.75 元为前期涨停启动强支撑，收盘缩量洗盘，主力控盘度极高。',
      hostStyle: '高控盘知名游资。习惯在 09:30-09:50 压盘洗盘，09:50 缩量见底低吸，14:15 脉冲高抛。',
      scenario1: '【高卖后不跌反涨（卖飞/踩空）】：游资高控盘，若高卖后大涨突破 7.00 元，等待盘中缩量回踩 6.95 元平台确认后方可接回。',
      scenario2: '【高卖后正常回调】：等待 09:50 压盘见底于 6.78 - 6.83 元低吸。',
      scenario3: '【低吸被套】：失守 6.75 元启动点，尾盘平 T 仓。',
      scenario4: '【深跌破位】：失守 6.70 元，全面防守减仓。',
    },
  ]

  for (const item of STOCKS_DATA) {
    await pool.query(
      `INSERT INTO stocks (code, full_code, name, current_price, yesterday_price, high_price, low_price, pct, predicted_high, predicted_low, win_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (code) DO UPDATE SET
         current_price = EXCLUDED.current_price,
         yesterday_price = EXCLUDED.yesterday_price,
         high_price = EXCLUDED.high_price,
         low_price = EXCLUDED.low_price,
         pct = EXCLUDED.pct,
         predicted_high = EXCLUDED.predicted_high,
         predicted_low = EXCLUDED.predicted_low,
         win_rate = EXCLUDED.win_rate;`,
      [
        item.code,
        item.fullCode,
        item.name,
        item.currentPrice,
        item.yesterdayPrice,
        item.highPrice,
        item.lowPrice,
        item.pct,
        item.predictedHigh,
        item.predictedLow,
        item.winRate,
      ]
    )

    await pool.query(`DELETE FROM stock_t_analyses WHERE stock_code = $1;`, [item.code])
    await pool.query(
      `INSERT INTO stock_t_analyses (stock_code, chip_analysis, host_style, scenario_1, scenario_2, scenario_3, scenario_4)
       VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      [
        item.code,
        item.chipAnalysis,
        item.hostStyle,
        item.scenario1,
        item.scenario2,
        item.scenario3,
        item.scenario4,
      ]
    )

    // 生成近 30 个时间点的真实 vs 预测双线数据
    await pool.query(`DELETE FROM stock_price_histories WHERE stock_code = $1;`, [item.code])
    const now = dayjs()
    const basePrice = item.currentPrice

    for (let i = 30; i >= 0; i--) {
      const ts = now.subtract(i * 5, 'minute').toDate()
      const sineWave = Math.sin((30 - i) / 3) * (basePrice * 0.015)
      const realP = Number((basePrice + sineWave + (Math.random() - 0.5) * 0.05).toFixed(2))
      const predP = Number((basePrice + sineWave * 0.95 + (Math.random() - 0.5) * 0.03).toFixed(2))
      const devPct = Number(((Math.abs(realP - predP) / realP) * 100).toFixed(2))

      await pool.query(
        `INSERT INTO stock_price_histories (stock_code, timestamp, real_price, predicted_price, deviation_pct)
         VALUES ($1, $2, $3, $4, $5);`,
        [item.code, ts, realP, predP, devPct]
      )
    }

    console.log(`✅ 标的 [${item.name} (${item.code})] 初始做 T 数据与 30 点对比曲线填充成功！`)
  }

  console.log('🎉 ZeroQuant 基础数据 Seed 全部完成！')
}

seed()
  .catch((e) => console.error(e))
  .finally(() => pool.end())
