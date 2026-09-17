import { PgPredictionReader } from '../src/modules/predictions/prediction-reader.repository.js'
import { PredictionQueryService } from '../src/modules/predictions/prediction-query.service.js'
import { PredictionQueryController } from '../src/modules/predictions/prediction-query.controller.js'
import type { UnitOfWork } from '../src/shared/transaction.js'
/** 本机隔离数据库与故障注入；不调用供应商或云库。 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import express from 'express'
import { PGlite } from '@electric-sql/pglite'
import type { Pool,PoolClient } from 'pg'
import { AppError } from '../src/shared/errors.js'
import { PgUnitOfWork } from '../src/shared/transaction.js'
import { errorHandler,requestContext } from '../src/shared/http.js'
import { ALL_MIGRATIONS } from '../src/migrations/catalog.js'
import { EvidenceService } from '../src/modules/profile-evidence/evidence.service.js'
import { EvidenceRepository } from '../src/modules/profile-evidence/evidence.repository.js'
import { EvidenceController } from '../src/modules/profile-evidence/evidence.controller.js'
import { PredictionService } from '../src/modules/predictions/prediction.service.js'
import { PredictionRepository } from '../src/modules/predictions/prediction.repository.js'
import { PredictionController } from '../src/modules/predictions/prediction.controller.js'
import { quantInternalOnly } from '../src/quant-routes.js'
import { asyncHandler } from '../src/shared/http.js'
const invalid=(error:unknown)=>error instanceof AppError && error.key==='VALIDATION'
const conflict=(error:unknown)=>error instanceof AppError && error.key==='CONFLICT'
const seat={stockCode:'000572',tradeDate:'2026-09-15',side:'BUY',rank:1,seatName:'公开席位',buyAmount:100,sellAmount:20,netAmount:80,source:'fixture',disclosedAt:'2026-09-15T17:00:00+08:00'}
const news={title:'测试公告',content:'公告正文',source:'fixture',publishedAt:'2026-09-15T17:00:00+08:00',stocks:['000572','600839'],fingerprint:'a'.repeat(64),sentimentScore:0,relevanceScore:0.5}
const horizon={horizonMinutes:15,pUp:0.4,pFlat:0.3,pDown:0.3,expectedReturnPct:0,q10ReturnPct:-1,q50ReturnPct:0,q90ReturnPct:1,confidence:0.7,actionable:true,reasons:[]}
const prediction=()=>({runId:randomUUID(),stockCode:'000572',tradeDate:'2026-09-15',asOf:'2026-09-15T10:00:00+08:00',mode:'daily',referencePrice:10,previousClose:10,modelVersion:'fixture',modelState:'champion',modelCalibrated:true,inputHash:'c'.repeat(64),features:{values:{x:1},qualityScore:0.9,qualityFlags:[],observedAt:'2026-09-15T10:00:00+08:00'},regime:{},newsEvents:[],warnings:[],horizons:[horizon],legacyCurve:[{time:'10:01',price:10,lower:9,upper:11}]})

test('龙虎榜整批拒绝隐式数值、坏日期/时区、缺字段、重复键；缺省与显式坏值区分',async()=>{
  let calls=0
  const service=new EvidenceService({async dragonTiger(){calls++},async news(){calls++}})
  for(const row of [{...seat,buyAmount:true},{...seat,sellAmount:[]},{...seat,netAmount:'bad'},
    {...seat,rank:1.5},{...seat,stockCode:572},{...seat,tradeDate:'2026-02-30'},
    {...seat,disclosedAt:'2026-02-30T17:00:00Z'},{...seat,disclosedAt:'2026-09-15T17:00:00'},
    {...seat,disclosedAt:'2026-09-14T23:00:00+08:00'},{...seat,seatName:{}},{...seat,buyAmount:null}]) {
    await assert.rejects(()=>service.dragonTiger({records:[{...seat,stockCode:'600839'},row]}),invalid)
  }
  await assert.rejects(()=>service.dragonTiger({records:[seat,seat]}),invalid)
  assert.equal(calls,0)
  await service.dragonTiger({records:[{...seat,buyAmount:undefined,sellAmount:undefined,netAmount:undefined}]})
  assert.equal(calls,1)
})
test('新闻整批拒绝隐式评分、无效日期、非字符串股票和重复指纹；文本有上限',async()=>{
  let calls=0
  const service=new EvidenceService({async dragonTiger(){calls++},async news(){calls++}})
  for(const row of [{...news,relevanceScore:false},{...news,sentimentScore:'bad'},
    {...news,publishedAt:'2026-02-30T17:00:00Z'},{...news,publishedAt:'2026-09-15'},
    {...news,stocks:[572]},{...news,url:'javascript:alert(1)'},{...news,title:{}},
    {...news,content:'x'.repeat(50001)},{...news,trustLevel:false},{...news,fingerprint:'bad'}]) {
    await assert.rejects(()=>service.news({records:[{...news,fingerprint:'b'.repeat(64)},row]}),invalid)
  }
  await assert.rejects(()=>service.news({records:[news,news]}),invalid)
  assert.equal(calls,0)
  await service.news({records:[news]});assert.equal(calls,1)
})
test('预测在批准查询前拒绝坏身份、概率、分位数、周期与曲线，不把字符串当布尔值',async()=>{
  let calls=0
  const service=new PredictionService({async receipt(){return null},async persist(input){calls++;return {runId:input.runId,baselineApplied:false}}},async()=>{calls++;return true})
  const base=prediction()
  for(const patch of [{runId:'-'.repeat(36)},{tradeDate:'2026-02-30'},{asOf:'2026-02-30T10:00:00Z'},
    {referencePrice:true},{modelCalibrated:'true'},{horizons:[horizon,horizon]},
    {horizons:[{...horizon,horizonMinutes:1.5}]},{horizons:[{...horizon,horizonMinutes:0}]},
    {horizons:[{...horizon,pUp:true}]},{horizons:[{...horizon,pUp:0.9}]},
    {horizons:[{...horizon,q10ReturnPct:undefined}]},{horizons:[{...horizon,q10ReturnPct:2}]},
    {horizons:[{...horizon,confidence:null}]},{horizons:[{...horizon,actionable:'false'}]},
    {legacyCurve:[{time:'24:00',price:10}]},{legacyCurve:[{time:'10:00',price:10,lower:11}]},
    {legacyCurve:[{time:'10:00',price:true}]},{legacyCurve:[{time:'10:00',price:10},{time:'10:00',price:11}]}]) {
    await assert.rejects(()=>service.ingest({...base,...patch}),invalid)
  }
  assert.equal(calls,0)
  await service.ingest(base);assert.equal(calls,2)
})

test('画像证据与预测：实际迁移表、事务故障和HTTP',async t=>{
  const db=new PGlite();let fail:string|null=null;let receiptWritten=false
  const client={async query(sql:string,values?:unknown[]){
    if(fail==='dragon-second' && sql.includes('INSERT INTO dragon_tiger_seats') && values?.[3]===2){fail=null;throw new Error('isolated second-row failure')}
    if(fail && sql.includes(fail)){fail=null;throw new Error('isolated write failure')}
    if(sql==='BEGIN') receiptWritten=false
    const result=await (values ? db.query(sql,values) : /^(SELECT|WITH)\b/.test(sql.trim()) ? db.query(sql) : db.exec(sql))
    if(sql.startsWith('INSERT INTO prediction_ingestion_receipts')) receiptWritten=true
    if(fail==='commit-ack' && sql==='COMMIT' && receiptWritten){fail=null;throw new Error('commit succeeded, response lost')}
    return result
  },release(){}} as unknown as PoolClient
  const work=new PgUnitOfWork({connect:async()=>client} as unknown as Pool)
  const evidence=new EvidenceService(new EvidenceRepository(work))
  const forecasts=new PredictionService(new PredictionRepository(work),async()=>false)
  try {
    for(const migration of ALL_MIGRATIONS) await migration.up(client)
    await db.exec("INSERT INTO stocks(code,full_code,name) VALUES('000572','sz000572','甲'),('600839','sh600839','乙')")
    await t.test('新闻关系失败回滚文章和更新；重复导入不增行；不同来源同指纹冲突',async()=>{
      fail='INSERT INTO news_stock_relations'
      await assert.rejects(()=>evidence.news({records:[news]}))
      assert.equal((await db.query('SELECT * FROM news_articles')).rows.length,0)
      await evidence.news({records:[news]});await evidence.news({records:[news]})
      assert.equal((await db.query('SELECT * FROM news_articles')).rows.length,1)
      assert.equal((await db.query('SELECT * FROM news_stock_relations')).rows.length,2)
      fail='INSERT INTO news_stock_relations'
      await assert.rejects(()=>evidence.news({records:[{...news,title:'不应保留的新标题'}]}))
      assert.equal((await db.query('SELECT title FROM news_articles')).rows[0].title,news.title)
      await assert.rejects(()=>evidence.news({records:[{...news,source:'another'}]}),conflict)
      await assert.rejects(()=>evidence.news({records:[{...news,publishedAt:'2026-09-16T17:00:00+08:00'}]}),conflict)
      assert.equal((await db.query('SELECT source FROM news_articles')).rows[0].source,'fixture')
    })
    await t.test('龙虎榜重复导入不增行；批次更新失败原值保留',async()=>{
      await evidence.dragonTiger({records:[seat]});await evidence.dragonTiger({records:[seat]})
      assert.equal((await db.query('SELECT * FROM dragon_tiger_seats')).rows.length,1)
      fail='dragon-second'
      await assert.rejects(()=>evidence.dragonTiger({records:[{...seat,rank:2},{...seat,buyAmount:200}]}))
      assert.equal((await db.query('SELECT buy_amount FROM dragon_tiger_seats')).rows[0].buy_amount,100)
    })
    await t.test('预测周期或基线写入失败回滚运行及关联数据；保存结果不因调用者标志放开门禁',async()=>{
      for(const stage of ['INSERT INTO quant_horizon_forecasts','INSERT INTO stock_day_predictions']) {
        fail=stage;await assert.rejects(()=>forecasts.ingest(prediction()))
        assert.equal((await db.query('SELECT * FROM quant_prediction_runs')).rows.length,0)
        assert.equal((await db.query('SELECT * FROM quant_horizon_forecasts')).rows.length,0)
      }
      const run={...prediction(),horizons:[{...horizon,horizonMinutes:30,q50ReturnPct:0.5},horizon]};await forecasts.ingest(run)
      assert.equal((await db.query('SELECT target_pct FROM stock_day_predictions')).rows[0].target_pct,0.5)
      assert.equal((await db.query('SELECT actionable FROM quant_horizon_forecasts')).rows[0].actionable,false)
      assert.equal((await forecasts.ingest(run)).runId,run.runId)
      await assert.rejects(()=>forecasts.ingest({...run,previousClose:9}),conflict)
      assert.equal((await db.query('SELECT * FROM quant_prediction_runs')).rows.length,1)
      const before=(await db.query('SELECT time_points FROM stock_day_predictions')).rows
      fail='INSERT INTO stock_day_predictions'
      await assert.rejects(()=>forecasts.ingest({...prediction(),asOf:'2026-09-15T11:00:00+08:00',legacyCurve:[{time:'10:02',price:12,lower:11,upper:13}]}))
      assert.deepEqual((await db.query('SELECT time_points FROM stock_day_predictions')).rows,before)
    })
    await t.test('实时曲线中途失败全部回滚；硬风控即使批准端口返回true也禁用actionable',async()=>{
      const approved=new PredictionService(new PredictionRepository(work),async()=>true)
      const run={...prediction(),mode:'realtime',warnings:['硬风控测试']}
      fail='INSERT INTO stock_rolling_predictions'
      await assert.rejects(()=>approved.ingest(run))
      assert.equal((await db.query('SELECT * FROM quant_prediction_runs WHERE run_id=$1',[run.runId])).rows.length,0)
      await approved.ingest(run)
      assert.equal((await db.query('SELECT actionable FROM quant_horizon_forecasts WHERE run_id=$1',[run.runId])).rows[0].actionable,false)
    })
    await t.test('预测回执：键顺序不影响重放，变更正文冲突，重放不再次查询批准',async()=>{
      let approvals=0
      const service=new PredictionService(new PredictionRepository(work),async()=>{approvals++;return false})
      const run={...prediction(),features:{...prediction().features,values:{a:1,b:2}}}
      const first=await service.ingest(run)
      const reordered={...run,features:{...run.features,values:{b:2,a:1}}}
      assert.deepEqual(await service.ingest(reordered),first);assert.equal(approvals,1)
      await assert.rejects(()=>service.ingest({...run,features:{...run.features,values:{a:1,b:3}}}),conflict)
      assert.equal(approvals,1)
      const counts=await db.query('SELECT COUNT(*)::int AS count FROM quant_horizon_forecasts WHERE run_id=$1',[run.runId])
      assert.equal(counts.rows[0].count,1)
    })
    await t.test('回执写入失败回滚运行；提交确认丢失后原编号重放成功',async()=>{
      const run=prediction()
      fail='INSERT INTO prediction_ingestion_receipts'
      await assert.rejects(()=>forecasts.ingest(run))
      assert.equal((await db.query('SELECT * FROM quant_prediction_runs WHERE run_id=$1',[run.runId])).rows.length,0)
      fail='commit-ack'
      await assert.rejects(()=>forecasts.ingest(run))
      const saved=(await db.query('SELECT response FROM prediction_ingestion_receipts WHERE run_id=$1',[run.runId])).rows[0].response
      assert.deepEqual(await forecasts.ingest(run),saved)
      assert.equal((await db.query('SELECT * FROM quant_horizon_forecasts WHERE run_id=$1',[run.runId])).rows.length,1)
    })
    await t.test('排队的重复请求锁内复查只创建一次；不声称真实多连接验证',async()=>{
      let queue=Promise.resolve()
      const serial:UnitOfWork={run(operation){const result=queue.then(()=>work.run(operation));queue=result.then(()=>{},()=>{});return result}}
      const service=new PredictionService(new PredictionRepository(serial),async()=>false)
      const run=prediction()
      const replies=await Promise.all([service.ingest(run),service.ingest(run),service.ingest(run)])
      assert.deepEqual(replies[0],replies[1]);assert.deepEqual(replies[0],replies[2])
      assert.equal((await db.query('SELECT * FROM prediction_ingestion_receipts WHERE run_id=$1',[run.runId])).rows.length,1)
    })
    await t.test('迟到和同时间预测归档但不覆盖新基线；较早交易日不覆盖股票摘要',async()=>{
      const newer={...prediction(),tradeDate:'2026-09-17',asOf:'2026-09-17T11:00:00+08:00',legacyCurve:[{time:'10:00',price:30,lower:29,upper:31}]}
      assert.equal((await forecasts.ingest(newer)).baselineApplied,true)
      const older={...newer,runId:randomUUID(),asOf:'2026-09-17T09:00:00+08:00',legacyCurve:[{time:'10:00',price:20,lower:19,upper:21}]}
      assert.equal((await forecasts.ingest(older)).baselineApplied,false)
      assert.equal((await forecasts.ingest({...older,runId:randomUUID(),asOf:newer.asOf})).baselineApplied,false)
      const base=(await db.query("SELECT metadata FROM stock_day_predictions WHERE stock_code='000572' AND predict_date='2026-09-17' AND is_base=TRUE")).rows
      assert.equal(base.length,1);assert.equal((base[0].metadata as {runId:string}).runId,newer.runId)
      const priorDay={...older,runId:randomUUID(),tradeDate:'2026-09-16',asOf:'2026-09-18T11:00:00+08:00'}
      assert.equal((await forecasts.ingest(priorDay)).baselineApplied,true)
      const stock=(await db.query("SELECT predicted_low,predicted_high FROM stocks WHERE code='000572'")).rows[0]
      assert.equal(stock.predicted_low,29);assert.equal(stock.predicted_high,31)
      assert.equal((await db.query('SELECT * FROM quant_prediction_runs WHERE run_id=$1',[older.runId])).rows.length,1)
    })
    await t.test('无完整回执的旧运行冲突；未知来源旧基线不会被自动覆盖',async()=>{
      const existing=prediction();await forecasts.ingest(existing)
      await db.query('DELETE FROM prediction_ingestion_receipts WHERE run_id=$1',[existing.runId]) // 构造迁移前旧运行夹具。
      await assert.rejects(()=>forecasts.ingest(existing),conflict)
      await db.query(`INSERT INTO stock_day_predictions(stock_code,predict_date,version,is_base,time_points,metadata)
        VALUES('000572','2026-09-18',1,TRUE,'[]'::jsonb,'{}'::jsonb)`)
      const unknown={...prediction(),tradeDate:'2026-09-18',asOf:'2026-09-18T12:00:00+08:00'}
      assert.equal((await forecasts.ingest(unknown)).baselineApplied,false)
      assert.deepEqual((await db.query("SELECT metadata FROM stock_day_predictions WHERE stock_code='000572' AND predict_date='2026-09-18'")).rows[0].metadata,{})
    })
    const presentation=async()=>({productionApproved:false,signalExpiresAt:null,modelStateLabel:'研究',modelStateExplanation:'测试'})
    const queryService=new PredictionQueryService(new PgPredictionReader(work),presentation)
    await t.test('查询严格校验日期/代码，按北京时间日末裁剪且不受数据库时区影响',async()=>{
      const approved=new PredictionService(new PredictionRepository(work),async()=>true)
      const before={...prediction(),mode:'realtime',tradeDate:'2026-09-19',asOf:'2026-09-19T15:59:59.999Z',legacyCurve:[]}
      const boundary={...before,runId:randomUUID(),tradeDate:'2026-09-20',asOf:'2026-09-19T16:00:00.000Z'}
      await approved.ingest(before);await approved.ingest(boundary)
      for(const zone of ['UTC','America/New_York','Asia/Shanghai']) {
        await db.query("SELECT set_config('TimeZone',$1,false)",[zone])
        const page=await queryService.latest('000572',{asOf:'2026-09-19'})
        assert.equal(page?.runId,before.runId)
        assert.equal(page?.horizons[0].actionable,false) // 查询必须重新判定批准，不能沿用落库标记。
        assert.equal((await queryService.latest('000572',{asOf:'2026-09-20'}))?.runId,boundary.runId)
      }
      await db.query("SELECT set_config('TimeZone','UTC',false)")
      for(const query of [{asOf:'2026-02-30'},{asOf:[]},{asOf:null},{asOf:'2026-09-19T10:00:00Z'}]) await assert.rejects(()=>queryService.latest('000572',query),invalid)
      await assert.rejects(()=>queryService.latest('bad',{}),invalid)
      assert.equal(await queryService.latest('600839',{}),null)
    })
    await t.test('HTTP内部令牌、统一400、正常成功与相同运行重放200/更改内容409',async()=>{
      const previous=process.env.ZEROQUANT_INTERNAL_TOKEN;process.env.ZEROQUANT_INTERNAL_TOKEN='fixture-internal'
      const app=express(),ec=new EvidenceController(evidence),pc=new PredictionController(forecasts)
      app.use(requestContext,express.json());app.post('/news',quantInternalOnly,asyncHandler(ec.news));app.post('/prediction',quantInternalOnly,asyncHandler(pc.ingest));app.get('/latest/:code',asyncHandler(new PredictionQueryController(queryService).latest));app.use(errorHandler)
      const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve))
      const address=server.address();assert.ok(address&&typeof address!=='string')
      const base='http://127.0.0.1:'+address.port
      const headers={'Content-Type':'application/json','X-ZeroQuant-Internal-Token':'fixture-internal'}
      try {
        assert.equal((await fetch(base+'/news',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({records:[news]})})).status,401)
        assert.equal((await fetch(base+'/news',{method:'POST',headers,body:JSON.stringify({records:[{...news,relevanceScore:true}]})})).status,400)
        assert.equal((await fetch(base+'/latest/000572?asOf=2026-02-30')).status,400)
        const missing=await fetch(base+'/latest/600839');assert.equal(missing.status,200);assert.match(missing.headers.get('cache-control')||'',/no-store/);assert.equal((await missing.json()).data,null)
        const run=prediction();const body=JSON.stringify(run)
        assert.equal((await fetch(base+'/prediction',{method:'POST',headers,body})).status,200)
        assert.equal((await fetch(base+'/prediction',{method:'POST',headers,body})).status,200)
        assert.equal((await fetch(base+'/prediction',{method:'POST',headers,body:JSON.stringify({...run,previousClose:9})})).status,409)
      } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));if(previous===undefined)delete process.env.ZEROQUANT_INTERNAL_TOKEN;else process.env.ZEROQUANT_INTERNAL_TOKEN=previous}
    })
  } finally {await db.close()}
})
