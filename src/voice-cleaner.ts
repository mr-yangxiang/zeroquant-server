/** 只清洗常见识别错字；不补成交价格、股数或将意向改写成成交。 */
export function cleanVoiceTradingText(text: string): string {
  return text.replace(/块钱|块前|快钱/g, '元')
    .replace(/买聊|买辽|迈聊/g, '买了').replace(/卖聊|卖辽|出聊|抛聊/g, '卖了')
}

export interface TradeIntentResult {
  isTradeAction: boolean
  actionType: 'BUY' | 'SELL' | 'SET_POSITION' | null
  price: number | null
  shares: number | null
  rawCleaned: string
}

/**
 * 只接受完整、单一、带明确数值的成交陈述。
 * 开放式聊天不能可靠地区分否定、计划、引用和实际成交，因此整句匹配；
 * 其他文本留在解释流程，用户可通过结构化成交表单录入。defaultPrice 仅保留调用兼容。
 */
export function parseTradingIntent(rawText: string, _defaultPrice = 0): TradeIntentResult {
  const cleaned = cleanVoiceTradingText(rawText).trim()
  const none: TradeIntentResult = { isTradeAction: false, actionType: null, price: null, shares: null, rawCleaned: cleaned }
  const number = '(\\d+(?:\\.\\d{1,4})?)'
  const action = '(买了|已买入|已买|刚买了|卖了|已卖出|已卖|刚卖了)'
  // 例如：我买了100股，成交价10元；已卖出2手 @ 10.5。
  const after = new RegExp('^(?:我)?' + action + '\\s*(\\d+)\\s*(股|手)\\s*[,，]?\\s*(?:成交价\\s*|价格\\s*|@\\s*|按\\s*)?' + number + '\\s*(?:元|块)?[。！!]?$', 'u').exec(cleaned)
  // 例如：我以10元买了100股。价格前置时强制单位，避免把股票代码当价格。
  const before = new RegExp('^(?:我)?(?:以|按)\\s*' + number + '\\s*(?:元|块)\\s*' + action + '\\s*(\\d+)\\s*(股|手)[。！!]?$', 'u').exec(cleaned)
  const position = new RegExp('^设置持仓为\\s*(\\d+)\\s*股\\s*[,，]?\\s*成本(?:价)?\\s*' + number + '\\s*(?:元|块)[。！!]?$', 'u').exec(cleaned)
  let actionType: TradeIntentResult['actionType'] = null
  let shares: number
  let price: number
  if (after) {
    actionType = after[1].includes('买') ? 'BUY' : 'SELL'
    shares = Number(after[2]) * (after[3] === '手' ? 100 : 1)
    price = Number(after[4])
  } else if (before) {
    actionType = before[2].includes('买') ? 'BUY' : 'SELL'
    shares = Number(before[3]) * (before[4] === '手' ? 100 : 1)
    price = Number(before[1])
  } else if (position) {
    actionType = 'SET_POSITION'; shares = Number(position[1]); price = Number(position[2])
  } else return none
  const minimum = actionType === 'SET_POSITION' ? 0 : 1
  if (!Number.isSafeInteger(shares) || shares < minimum || shares > 2147483647
    || !Number.isFinite(price) || price < 0 || (actionType !== 'SET_POSITION' && price === 0) || price > 100000000) return none
  return { isTradeAction: true, actionType, price, shares, rawCleaned: cleaned }
}
