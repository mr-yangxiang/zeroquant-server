/** PGlite 以队列隔离事务；不是多连接并发证明。所有数据均为本机测试夹具。 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import express from 'express'
import { PGlite } from '@electric-sql/pglite'
import type { Pool, PoolClient } from 'pg'
import { ALL_MIGRATIONS } from '../src/migrations/catalog.js'
import { PgUnitOfWork, type UnitOfWork } from '../src/shared/transaction.js'
import { chatWork, createChatTradeService } from '../src/modules/chat/chat-trade.module.js'
import { chatTradeRouter } from '../src/modules/chat/chat-trade.routes.js'
import { ResearchChatService } from '../src/modules/chat/research-chat.service.js'
import { ChatHistoryService } from '../src/modules/chat/chat-history.service.js'
import { ChatHistoryRepository } from '../src/modules/chat/chat-history.repository.js'
import { AppError } from '../src/shared/errors.js'
import { requestContext, errorHandler } from '../src/shared/http.js'
import { verifySchema } from '../src/database/schema-verifier.js'
const is = (key: string) => (error: unknown) => error instanceof AppError && error.key === key

test('聊天成交原子性、请求回执和 HTTP 重试', async t => {
  const db = new PGlite()
  let fail: 'assistant' | 'receipt' | 'commit-ack' | null = null
  const client = { async query(sql: string, params?: unknown[]) {
    if ((fail === 'assistant' && sql.includes('INSERT INTO user_chat_messages') && params?.[2] === 'assistant')
      || (fail === 'receipt' && sql.includes('INSERT INTO chat_trade_requests'))) { fail = null; throw new Error('isolated write failure') }
    const result = params ? await db.query(sql, params) : /^(SELECT|WITH)\b/i.test(sql.trim()) ? await db.query(sql) : await db.exec(sql)
    if (fail === 'commit-ack' && sql === 'COMMIT') { fail = null; throw new Error('commit succeeded but acknowledgement lost') }
    return result
  }, release() {} } as unknown as PoolClient
  const pg = new PgUnitOfWork({ connect: async () => client } as unknown as Pool)
  let queue = Promise.resolve()
  const work: UnitOfWork = { run(operation) {
    const result = queue.then(() => pg.run(operation)); queue = result.then(() => {}, () => {}); return result
  } }
  const service = createChatTradeService(work)
  const userA = 'chat-fixture-a', userB = 'chat-fixture-b'
  const input = (message = '我买了100股，成交价10元') => ({ stockCode: '000572', message, requestId: randomUUID() })
  const counts = async () => {
    const result = await db.query<{ messages: number; trades: number; receipts: number; shares: number }>(`SELECT
      (SELECT COUNT(*)::int FROM user_chat_messages WHERE user_id='chat-fixture-a') AS messages,
      (SELECT COUNT(*)::int FROM user_trade_actions WHERE user_id='chat-fixture-a') AS trades,
      (SELECT COUNT(*)::int FROM chat_trade_requests WHERE user_id='chat-fixture-a') AS receipts,
      COALESCE((SELECT holding_shares FROM user_positions WHERE user_id='chat-fixture-a' AND stock_code='000572'),0) AS shares`)
    return result.rows[0]
  }
  try {
    await db.exec('CREATE TABLE schema_migrations(version VARCHAR(50) PRIMARY KEY,name VARCHAR(255) NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
    for (const migration of ALL_MIGRATIONS) await work.run(async () => {
      await migration.up(client)
      await db.query('INSERT INTO schema_migrations(version,name) VALUES($1,$2)', [migration.version,migration.name])
    })
    await db.query('INSERT INTO users(id,phone,username,password) VALUES($1,$2,$3,$4),($5,$6,$7,$8)', [userA,'13800000901','甲','unused',userB,'13800000902','乙','unused'])
    await db.exec("INSERT INTO stocks(code,full_code,name) VALUES('000572','sz000572','测试标的')")
    await t.test('11 个迁移后的回执表字段与权威目录一致', async () => {
      assert.deepEqual((await verifySchema({ connect: async () => client })).filter(row => row.severity === 'ERROR'), [])
    })
    await t.test('缺少或非法请求编号的成交拒绝；普通问答不写持仓', async () => {
      await assert.rejects(() => service.send(userA, { stockCode: '000572', message: '买了100股10元' }), is('VALIDATION'))
      await assert.rejects(() => service.send(userA, { ...input(), requestId: 'broken' }), is('VALIDATION'))
      assert.equal(await service.send(userA, input('请解释风险')), null)
      assert.deepEqual(await counts(), { messages: 0, trades: 0, receipts: 0, shares: 0 })
    })
    const command = input()
    let response: Awaited<ReturnType<typeof service.send>>
    await t.test('重复提交只产生一笔成交及一组消息，回执完全一致', async () => {
      const results = await Promise.all([service.send(userA,command),service.send(userA,command),service.send(userA,command)])
      response = results[0]
      assert.ok(response?.tradeRecorded)
      assert.deepEqual(results[1], response); assert.deepEqual(results[2], response)
      assert.deepEqual(await counts(), { messages: 2, trades: 1, receipts: 1, shares: 100 })
    })
    await t.test('同编号换消息/股票返回冲突；其他用户相同编号独立', async () => {
      await assert.rejects(() => service.send(userA,{...command,message:'买了200股10元'}), is('CONFLICT'))
      await assert.rejects(() => service.send(userA,{...command,stockCode:'600839'}), is('CONFLICT'))
      const other = await service.send(userB,command)
      assert.notEqual(other?.id,response?.id)
      assert.deepEqual(await counts(), { messages: 2, trades: 1, receipts: 1, shares: 100 })
    })
    for (const stage of ['assistant','receipt'] as const) await t.test(stage + ' 写入失败回滚消息、成交、持仓；原编号可安全重试', async () => {
      const before = await counts(); const request = input()
      fail = stage
      await assert.rejects(() => service.send(userA, request))
      assert.deepEqual(await counts(), before)
      await service.send(userA, request)
      const after = await counts()
      assert.equal(after.shares, before.shares + 100); assert.equal(after.trades,before.trades + 1)
    })
    await t.test('提交已成功但确认丢失时，重试不再次记账', async () => {
      const before = await counts(); const request = input()
      fail = 'commit-ack'
      await assert.rejects(() => service.send(userA,request))
      const committed = await counts()
      assert.equal(committed.shares, before.shares + 100)
      const replay = await service.send(userA,request)
      assert.ok(replay?.tradeRecorded); assert.deepEqual(await counts(),committed)
    })
    await t.test('超卖失败不留下用户消息、成交或请求回执', async () => {
      const before = await counts()
      await assert.rejects(() => service.send(userA,input('已卖出999999股10元')), is('VALIDATION'))
      assert.deepEqual(await counts(),before)
    })
    await t.test('清空聊天及之后更正持仓不会使旧请求再次执行', async () => {
      await db.query('DELETE FROM user_chat_messages WHERE user_id=$1',[userA])
      await db.query('UPDATE user_positions SET holding_shares=0,cost_price=0 WHERE user_id=$1',[userA])
      const before = await counts()
      assert.deepEqual(await service.send(userA,command),response)
      assert.deepEqual(await counts(),before)
    })
    let generated = 0
    const research = new ResearchChatService(chatWork(work), { async generate() { generated++; return '隔离研究回复' } })
    const history = new ChatHistoryService(new ChatHistoryRepository(client))
    await t.test('普通问答缺编号拒绝，成功后回放原回执且不再次生成，不改持仓', async () => {
      await assert.rejects(() => research.send(userA,{ stockCode:'000572',message:'风险' }),is('VALIDATION'))
      const request = input('请解释风险'), before = await counts()
      const one = await research.send(userA,request), calls = generated
      assert.equal(one.tradeRecorded,false)
      assert.deepEqual(await research.send(userA,request),one)
      assert.equal(generated,calls)
      assert.deepEqual(await service.send(userA,request),one)
      await assert.rejects(() => service.send(userA,{...request,message:'买了100股10元'}),is('CONFLICT'))
      const after = await counts()
      assert.equal(after.messages,before.messages+2); assert.equal(after.receipts,before.receipts+1)
      assert.equal(after.shares,before.shares); assert.equal(after.trades,before.trades)
    })
    await t.test('普通问答同时生成允许重复计算，最终只持久化一组消息和原回执', async () => {
      let release!: () => void
      const gate = new Promise<void>(resolve => { release=resolve })
      let entered = 0
      const concurrent = new ResearchChatService(chatWork(work), { async generate() {
        const ordinal=++entered
        if (entered===2) release()
        await gate
        return '候选回复 '+ordinal
      } })
      const request=input('同时请求'), before=await counts()
      const replies=await Promise.all([concurrent.send(userA,request),concurrent.send(userA,request)])
      assert.deepEqual(replies[0],replies[1]); assert.equal(entered,2)
      const after=await counts(); assert.equal(after.messages,before.messages+2); assert.equal(after.receipts,before.receipts+1)
    })
    await t.test('生成失败不留消息；普通回复写入失败整体回滚，原编号重试成功', async () => {
      const broken = new ResearchChatService(chatWork(work), { async generate() { throw new Error('isolated provider failure') } })
      const request=input('研究失败'), before=await counts()
      await assert.rejects(() => broken.send(userA,request)); assert.deepEqual(await counts(),before)
      for (const stage of ['assistant','receipt'] as const) {
        fail=stage
        await assert.rejects(() => research.send(userA,request)); assert.deepEqual(await counts(),before)
      }
      await research.send(userA,request)
      assert.equal((await counts()).messages,before.messages+2)
    })
    await t.test('历史分页稳定、不重叠、限制页大小并隔离用户；清空保留普通回执', async () => {
      const request=input('清空之前'), reply=await research.send(userA,request)
      const all=await db.query<{id:number}>('SELECT id FROM user_chat_messages WHERE user_id=$1 AND stock_code=$2 ORDER BY id DESC',[userA,'000572'])
      const ids:number[]=[]
      let before: string | undefined
      do {
        const page=await history.page(userA,{stockCode:'000572',limit:'2',...(before ? {before}: {})})
        assert.ok(page.messages.length<=2)
        ids.push(...page.messages.map(row=>row.id).reverse())
        before=page.nextCursor ?? undefined
      } while(before)
      assert.deepEqual(ids,all.rows.map(row=>row.id)); assert.equal(new Set(ids).size,ids.length)
      const other=await history.page(userB,{stockCode:'000572'})
      assert.ok(other.messages.every(row=>!ids.includes(row.id)))
      for (const query of [{limit:'101'},{limit:true},{before:'0'},{before:'9007199254740992'},{stockCode:['000572']}]) {
        await assert.rejects(()=>history.page(userA,{stockCode:'000572',...query}),is('VALIDATION'))
      }
      await history.clear(userA,{stockCode:'000572'})
      assert.deepEqual(await history.page(userA,{stockCode:'000572'}),{messages:[],nextCursor:null})
      assert.deepEqual(await research.send(userA,request),reply)
      assert.equal((await counts()).messages,0)
      assert.deepEqual(await history.page(userB,{stockCode:'000572'}),other)
    })
    await t.test('HTTP 鉴权、缺编号400、同编号重放200且同 id；旧适配器不能再写成交', async () => {
      const app = express()
      app.use(requestContext,express.json())
      app.use((req,_res,next) => { if (req.get('X-Fixture-User') === userA) req.principal={userId:userA,sessionId:randomUUID()};next() })
      app.use('/api/v1/chat',chatTradeRouter(service,research,history))
      app.post('/api/v1/chat/send',(_req,res) => res.json({ code:0, ordinary:true }))
      app.use(errorHandler)
      const server = app.listen(0,'127.0.0.1')
      await new Promise<void>((resolve,reject) => { server.once('listening',resolve);server.once('error',reject) })
      const address = server.address(); assert.ok(address && typeof address !== 'string')
      const url='http://127.0.0.1:'+address.port+'/api/v1/chat/send'
      const request = input()
      const headers={'Content-Type':'application/json','X-Fixture-User':userA}
      try {
        assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)})).status,401)
        assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({...request,requestId:undefined})})).status,400)
        const one=await fetch(url,{method:'POST',headers,body:JSON.stringify(request)})
        const two=await fetch(url,{method:'POST',headers,body:JSON.stringify(request)})
        assert.equal(one.status,200);assert.equal(two.status,200)
        assert.deepEqual((await one.json()).data,(await two.json()).data)
        const ordinary=input('HTTP 普通研究')
        const ordinaryOne=await fetch(url,{method:'POST',headers,body:JSON.stringify(ordinary)})
        const ordinaryTwo=await fetch(url,{method:'POST',headers,body:JSON.stringify(ordinary)})
        assert.equal(ordinaryOne.status,200); assert.deepEqual((await ordinaryOne.json()).data,(await ordinaryTwo.json()).data)
        const page=await fetch(url.replace('/send','/messages?stockCode=000572&limit=1'),{headers})
        const pageBody=await page.json(); assert.equal(page.status,200); assert.equal(pageBody.data.length,1); assert.ok(pageBody.nextCursor)
        assert.equal((await fetch(url.replace('/send','/messages?stockCode=000572'))).status,401)

      } finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())) }
    })
  } finally { await db.close() }
})
