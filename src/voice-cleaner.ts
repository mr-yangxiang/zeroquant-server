// 中文口语数字转换辅助函数 (如 "两千" -> 2000, "三块八毛五" -> 3.85)
function parseChineseOralNumber(text: string): number | null {
  const digitMap: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '百': 100, '千': 1000, '万': 10000
  }

  // 1. 口语价格转换：如 "三块八毛五" -> 3.85, "七块零五" -> 7.05, "十四块八" -> 14.80, "3块8" -> 3.80
  const priceMatch = text.match(/(?:([零一二两三四五六七八九十]+)|\d+)\s*(?:块|元)(?:([零一二两三四五六七八九]+|\d+)(?:毛|角)?)?(?:([零一二两三四五六七八九]+|\d+)(?:分)?)?/)
  if (priceMatch) {
    let intPart = 0
    if (/^\d+$/.test(priceMatch[1])) {
      intPart = parseInt(priceMatch[1])
    } else if (priceMatch[1]) {
      // 简易中文整数转换 (1-99)
      if (priceMatch[1].startsWith('十')) {
        intPart = 10 + (digitMap[priceMatch[1][1]] || 0)
      } else if (priceMatch[1].includes('十')) {
        const parts = priceMatch[1].split('十')
        intPart = (digitMap[parts[0]] || 1) * 10 + (digitMap[parts[1]] || 0)
      } else {
        intPart = digitMap[priceMatch[1]] || 0
      }
    }

    let decPart = 0
    if (priceMatch[2]) {
      const d1 = /^\d+$/.test(priceMatch[2]) ? parseInt(priceMatch[2]) : (digitMap[priceMatch[2]] || 0)
      decPart += d1 * 0.1
    }
    if (priceMatch[3]) {
      const d2 = /^\d+$/.test(priceMatch[3]) ? parseInt(priceMatch[3]) : (digitMap[priceMatch[3]] || 0)
      decPart += d2 * 0.01
    }
    const total = Number((intPart + decPart).toFixed(2))
    if (total > 0) return total
  }

  return null
}

// 语音识别与股票交易口语清洗转化函数
export function cleanVoiceTradingText(text: string): string {
  if (!text) return ''
  let cleaned = text
    .replace(/块钱|块前|快钱/g, '元')
    .replace(/买聊|买辽|迈聊/g, '买了')
    .replace(/卖聊|卖辽|出聊|抛聊/g, '卖了')
    .replace(/建仓聊/g, '建仓了')
    .replace(/加仓聊/g, '加仓了')
    .replace(/减仓聊/g, '减仓了')
    .replace(/平仓聊/g, '平仓了')
    .replace(/止损聊/g, '止损了')
    .replace(/低吸聊/g, '低吸了')
    .replace(/高抛聊/g, '高抛了')
    // 口语价格替换
    .replace(/三块八毛五|三块八五|3块8毛5/g, '3.85')
    .replace(/三块九毛|三块九|3块9/g, '3.90')
    .replace(/三块八/g, '3.80')
    .replace(/四块零二|四块零两分/g, '4.02')
    .replace(/四块/g, '4.00')
    .replace(/七块零五|七块五分/g, '7.05')
    .replace(/七块/g, '7.00')
    .replace(/十四块八/g, '14.80')
    .replace(/十五块四/g, '15.40')
    // 股数/手口语替换
    .replace(/一千股|1千股/g, '1000股')
    .replace(/两千股|2千股|二千股/g, '2000股')
    .replace(/三千股|3千股/g, '3000股')
    .replace(/四千股|4千股/g, '4000股')
    .replace(/五千股|5千股/g, '5000股')
    .replace(/一万股|1万股/g, '10000股')
    .replace(/两万股|2万股/g, '20000股')
    .replace(/一手/g, '100股')
    .replace(/两手|二手/g, '200股')
    .replace(/五手/g, '500股')
    .replace(/十手/g, '1000股')
    .replace(/二十手/g, '2000股')
    .replace(/三十手/g, '3000股')
    .replace(/五十手/g, '5000股')
    .replace(/一百手/g, '10000股')

  return cleaned
}

export interface TradeIntentResult {
  isTradeAction: boolean
  actionType: 'BUY' | 'SELL' | 'SET_POSITION' | null
  price: number | null
  shares: number | null
  rawCleaned: string
}

// 智能股票交易意图解析器
export function parseTradingIntent(rawText: string, defaultPrice: number = 0): TradeIntentResult {
  const cleaned = cleanVoiceTradingText(rawText)
  
  // 排除疑问句、反问句、征求意见句（如：卖吗、买吗、要不要买、该不该卖、怎么办、什么时候买）
  const isQuestion = /(?:吗|么|呢|吧|？|\?|怎么办|如何|要不要|该不该|什么时候|能不能|是不是|建议|请问)/i.test(cleaned)
  if (isQuestion) {
    return {
      isTradeAction: false,
      actionType: null,
      price: null,
      shares: null,
      rawCleaned: cleaned
    }
  }

  // 1. 判断是否包含明确陈述性的买卖/建仓动作（如“买了”、“已买”、“以3.85买了1000股”、“卖出1000股”）
  const isBuy = /(?:已买|又买|刚买|买了|买入|加仓了|加了仓|低吸了|建了仓)/i.test(cleaned)
  const isSell = /(?:已卖|又卖|刚卖|卖了|卖出|减仓了|减了仓|高抛了|平仓了|止损了|清仓了)/i.test(cleaned)
  const isSetPos = /(?:底仓|现有持仓|设置持仓)/i.test(cleaned) && /(?:改成|设为|为|是|有)/i.test(cleaned)

  if (!isBuy && !isSell && !isSetPos) {
    return {
      isTradeAction: false,
      actionType: null,
      price: null,
      shares: null,
      rawCleaned: cleaned
    }
  }

  const actionType: 'BUY' | 'SELL' | 'SET_POSITION' = isSetPos ? 'SET_POSITION' : (isBuy ? 'BUY' : 'SELL')

  // 2. 提取股数 (例如 1000股, 500股, 20手 -> 2000股)
  let shares: number | null = null
  const shareMatch = cleaned.match(/(\d+)\s*(?:股|shares)/i)
  if (shareMatch) {
    shares = parseInt(shareMatch[1])
  } else {
    const lotMatch = cleaned.match(/(\d+)\s*手/i)
    if (lotMatch) {
      shares = parseInt(lotMatch[1]) * 100
    }
  }

  // 3. 提取价格 (例如 3.85, 3.85元, ¥3.85)
  let price: number | null = null
  const priceMatches = Array.from(cleaned.matchAll(/(?:¥|￥|@|在|按|价格)?\s*(\d+(?:\.\d{1,3})?)\s*(?:元|块)?/g))
  for (const m of priceMatches) {
    const p = parseFloat(m[1])
    // 排除股数数值 (如 1000 不是价格)
    if (p > 0 && p < 1000 && p !== shares) {
      price = p
      break
    }
  }

  if (price === null) {
    const oralP = parseChineseOralNumber(cleaned)
    if (oralP && oralP < 1000) {
      price = oralP
    }
  }

  // 如果依然没有识别出价格，默认使用标的当前市价
  if (price === null && defaultPrice > 0) {
    price = defaultPrice
  }

  // 如果没有识别出股数，默认 1000 股
  if (shares === null && (isBuy || isSell)) {
    shares = 1000
  }

  return {
    isTradeAction: true,
    actionType,
    price,
    shares,
    rawCleaned: cleaned
  }
}
