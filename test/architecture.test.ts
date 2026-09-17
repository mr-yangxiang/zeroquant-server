/** 分层回归护栏及行情纯业务测试；不连接数据库。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { MarketService, marketDate } from '../src/modules/market/market.service.js'
import { loadDatabaseConfig } from '../src/config/database.config.js'
const root = path.resolve('src')
test('入口、路由和控制器禁止重新加入数据库/JWT/密码实现', () => {
  for (const domain of ['auth','portfolio','market','public-trades','chat','daily-bars','profile-evidence','predictions','market-sync']) {
    for (const file of readdirSync(path.join(root,'modules',domain)).filter(n => /\.(controller|routes|service)\.ts$/.test(n))) {
      const text = readFileSync(path.join(root,'modules',domain,file),'utf8')
      const tree = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true)
      const imports = tree.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text)
      if (!file.endsWith('service.ts') || !['password.service.ts','token.service.ts'].includes(file)) {
        assert.ok(!imports.some(i => ['pg','bcryptjs','jsonwebtoken'].includes(i)), file)
        assert.ok(!/\b(?:SELECT|INSERT INTO|DELETE FROM|UPDATE)\s+(?:users|user_positions|auth_sessions)\b/.test(text), file)
      }
      if (file.endsWith('.service.ts') && !['password.service.ts','token.service.ts'].includes(file)) assert.ok(!imports.includes('express'),file)
    }
  }
  const entry = readFileSync(path.join(root,'index.ts'),'utf8')
  assert.ok(!/app\.(?:get|post|delete|put)\(/.test(entry))
  assert.ok(!entry.includes('pool.query'))
  const legacy = readFileSync(path.join(root,'legacy-routes.ts'),'utf8')
  assert.ok(!/persistUserTrade|portfolio\.record|INSERT INTO user_trade_actions/.test(legacy), '兼容聊天不得保留第二条成交写入路径')
  assert.ok(!legacy.includes('/api/v1/chat/'), '旧路由不得重新接入聊天接口')
  const app = readFileSync(path.join(root,'app.ts'),'utf8')
  assert.ok(app.indexOf('createChatTradeModule(pool).router') < app.indexOf('registerLegacyRoutes(app)'))
})
test('日期校验拒绝不存在的日期及非字符串；数据库生产配置拒绝隐式回退', () => {
  assert.equal(marketDate('2024-02-29'),'2024-02-29')
  for (const input of ['2025-02-29','2026-09-31',['2026-09-15'],{},'']) assert.throws(() => marketDate(input))
  assert.throws(() => loadDatabaseConfig({NODE_ENV:'production'}))
  assert.equal(loadDatabaseConfig({NODE_ENV:'test'}).connectionTimeoutMillis,5000)
})
test('行情 Service 可脱离 Express/SQL 独立测试，输出不泄漏额外实体属性', async () => {
  let snapshotArgs: unknown[] = []
  const service = new MarketService({
    async stocks() { return [{code:'000572',full_code:'sz000572',name:'测试',current_price:10,yesterday_price:9,
      high_price:11,low_price:9,pct:1,predicted_high:12,predicted_low:8,is_hot:true,updated_at:null,internal_secret:'hidden'}] },
    async history() { return [] },
    async snapshot(...args) { snapshotArgs=args; return {
      realHistories:[{timestamp:'2026-09-15T10:00:00+08:00',realPrice:10}],
      rollingPredictions:[{targetTime:'10:00',predictedPrice:11,forecastAt:null,leadMinutes:5}],
      predictions:[],rollingArchiveRows:[{storedPointCount:1,snapshotCount:1}],l2Orders:[],positionRows:[],tradeRows:[],
    } },
  },async () => ({}))
  const stocks = await service.stocks()
  assert.equal('internal_secret' in stocks[0],false)
  assert.equal(stocks[0].winRate,null)
  const result = await service.advanced('000572','2026-09-15','user-a')
  assert.deepEqual(snapshotArgs,['000572','2026-09-15','user-a'])
  assert.equal(result.rollingEvaluation.meanAbsoluteDeviationPct,10)
  assert.deepEqual(result.position,{holdingShares:0,costPrice:0,tShares:0})
})
