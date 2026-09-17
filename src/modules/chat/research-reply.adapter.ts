/** 研究解释兼容适配器：只读上下文并生成文本，不写消息、不持有事务。
 * SQL/画像与提示词仍待进一步拆分；通过 ResearchReplyPort 注入，测试不调用外部模型。
 */
import { pool } from '../../db.js'
import { getStockEntityProfiles } from '../../profiles/entity-profile-engine.js'
import { logError } from '../../shared/logger.js'
import { AppError } from '../../shared/errors.js'
export async function generateResearchReply(currentUserId: string, stockCode: string, cleanMsg: string): Promise<string> {
    // 1. 抓取当前股票的最新行情与量化参数
    const { rows: stockRows } = await pool.query(`SELECT code,full_code,name,current_price,yesterday_price,high_price,low_price,pct,predicted_high,predicted_low,is_hot,updated_at FROM stocks WHERE code = $1`, [stockCode])
    if (stockRows.length === 0) throw new AppError('NOT_FOUND', '标的不存在')
    const stock = stockRows[0]
    
    // 3. 抓取当前用户的专属持仓与成本
    const { rows: posRows } = await pool.query(`SELECT holding_shares,cost_price,t_shares FROM user_positions WHERE user_id = $1 AND stock_code = $2`, [currentUserId, stockCode])
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
              r.model_state as "modelState", r.model_calibrated as "modelCalibrated", r.mode, r.regime, r.features, r.news_events as "newsEvents", r.warnings,
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
      logError('chat.entity_profile.unavailable', error, undefined)
    }
    const gate = await import('../../research-production.js')
    const quantActionable = quantForecast?.actionable === true && gate.forecastSignalEligible(quantForecast)
      && await gate.productionApproved(quantForecast.modelVersion, quantForecast.asOf)
    const quantModelStateLabel = gate.localizeModelState(quantForecast?.modelState, quantActionable).label

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
    { // 成交写入已由 chat-trade 路由处理；本兼容分支只做研究问答。
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

        chatContext.push({ role: 'user', content: cleanMsg })

        const liveNewsText = Array.isArray(quantForecast?.newsEvents) && quantForecast.newsEvents.length > 0
          ? quantForecast.newsEvents.map((event: any) => {
              const relevance = Number.isFinite(Number(event.relevance))
                ? `，相关度 ${(Number(event.relevance) * 100).toFixed(0)}%`
                : ''
              return `• [${event.published_at || '时间未知'}] ${event.title}（${event.event_type}；来源 ${event.source || '未知'}${relevance}）`
            }).join('\n')
          : '当前预测快照没有时间点一致的新闻或公告事件'
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
        if (apiKey && quantActionable) {
          const cpaRes = await fetch('http://127.0.0.1:8317/v1/chat/completions', {
          signal: AbortSignal.timeout(20000),
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
      } catch (err: unknown) {
        logError('LLM invoke error:', err)
      }

      // 若 LLM 异常时的专业兜底推演
      if (!reply) {
        reply = `### 概率研究快照——${stock.name} (${stock.code})\n\n`
        reply += quantForecast
          ? `当前模型 **${quantModelStateLabel}** 的15分钟输出为：上涨 ${(Number(quantForecast.pUp) * 100).toFixed(1)}%、震荡 ${(Number(quantForecast.pFlat) * 100).toFixed(1)}%、下跌 ${(Number(quantForecast.pDown) * 100).toFixed(1)}%，置信度 ${(Number(quantForecast.confidence) * 100).toFixed(1)}%。\n\n偏弱到偏强情景是风险范围，不是保证成交的支撑阻力。当前是否通过交易门槛：**${quantActionable ? '是' : '否'}**。`
          : '当前没有完成版本化概率预测，系统不会用固定话术代替缺失数据。'
      }
    }

    // Unverified models get controlled research text. Slow responses cannot
    // retain authority from a signal that expired while the LLM was answering.
    if (!quantActionable || !gate.forecastSignalEligible(quantForecast)) {
      const label = gate.localizeModelState(quantForecast?.modelState, false)
      reply = `### 研究观察——${stock.name} (${stock.code})\n\n当前状态：**${label.label}**。${label.explanation}\n\n`
        + `数据快照时间：${quantForecast?.asOf ? new Date(quantForecast.asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '暂无'}（北京时间）。当前没有通过核验的可执行买卖信号，因此不提供确定买卖价或收益承诺。\n\n`
        + `复盘时请对照原始预测与实际轨迹，检查行情延迟、新闻首次可见时间和含成本的偏差；历史机构画像不代表其今天正在交易。`
    }

    return reply
}
