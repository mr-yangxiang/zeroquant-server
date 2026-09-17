import assert from 'node:assert/strict'
import {test} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import type {Pool,PoolClient} from 'pg'
import {ALL_MIGRATIONS} from '../src/migrations/catalog.js'
import {PgUnitOfWork} from '../src/shared/transaction.js'
import {AppError} from '../src/shared/errors.js'
import {MarketSyncService} from '../src/modules/market-sync/market-sync.service.js'
import {MarketSyncRepository} from '../src/modules/market-sync/market-sync.repository.js'
const point={stockCode:'000572',tradeDate:'2026-09-16',timestampStr:'2026-09-16T10:01:00+08:00',observedAt:'2026-09-16T10:00:00+08:00',realPrice:10,predictedPrice:11,highPrice:12,lowPrice:9,pct:1}
test('同步校验拒绝隐式数值、坏日历、时序矛盾及整批坏点，未通过不写仓储',async()=>{
 let writes=0;const service=new MarketSyncService({async persist(){writes++}})
 for(const patch of [{realPrice:true},{pct:[]},{tradeDate:'2026-02-30'},{timestampStr:'bad'},
   {observedAt:'2026-09-15T10:00:00+08:00'},{observedAt:'2026-09-16T10:02:00+08:00'},
   {currentPrice:12},{highPrice:9},{targetTime:'25:00'},{runId:'broken'},
   {rollingPredictions:[{targetTime:'10:05',predictedPrice:11},{targetTime:'10:06',predictedPrice:false}]},
   {rollingPredictions:Array(243).fill({targetTime:'10:05',predictedPrice:11})}]) {
   await assert.rejects(()=>service.ingest({...point,...patch}),e=>e instanceof AppError&&e.key==='VALIDATION')
 }
 assert.equal(writes,0);await service.ingest(point);assert.equal(writes,1)
})
test('行情观测排序、跨日与滚动失败回滚',async()=>{
 const db=new PGlite();let fail=false
 const client={async query(sql:string,values?:unknown[]){
   if(fail&&sql.includes('INSERT INTO stock_rolling_predictions'))throw new Error('fixture failure')
   return values?db.query(sql,values):/^(SELECT|WITH)\b/.test(sql.trim())?db.query(sql):db.exec(sql)
 },release(){}} as unknown as PoolClient
 const service=new MarketSyncService(new MarketSyncRepository(new PgUnitOfWork({connect:async()=>client} as unknown as Pool)))
 const snapshot=async()=>(await db.query("SELECT current_price,high_price,low_price,pct,updated_at FROM stocks WHERE code='000572'")).rows[0]
 try {
  for(const migration of ALL_MIGRATIONS)await migration.up(client)
  await db.exec("INSERT INTO stocks(code,full_code,name,high_price,low_price) VALUES('000572','sz000572','测试',100,1)")
  const first=await service.ingest(point);let row=await snapshot();assert.equal(row.high_price,12);assert.equal(row.low_price,9)
  await service.ingest({...point,observedAt:'2026-09-16T10:01:00+08:00',realPrice:11,highPrice:13,lowPrice:10})
  const newest=await snapshot();assert.equal(newest.high_price,13);assert.equal(newest.low_price,9)
  await service.ingest({...point,observedAt:'2026-09-16T09:59:00+08:00',realPrice:5,highPrice:99,lowPrice:1})
  assert.deepEqual(await snapshot(),newest)
  assert.deepEqual(await service.ingest(point),first)
  await assert.rejects(()=>service.ingest({...point,pct:2}),e=>e instanceof AppError&&e.key==='CONFLICT')
  const next={...point,tradeDate:'2026-09-17',observedAt:'2026-09-17T09:30:00+08:00',timestampStr:'2026-09-17T09:30:00+08:00',realPrice:20,highPrice:21,lowPrice:19}
  await service.ingest(next);row=await snapshot();assert.equal(row.high_price,21);assert.equal(row.low_price,19)
  await service.ingest({...point,observedAt:'2026-09-16T10:00:30+08:00'});assert.deepEqual(await snapshot(),row)
  const before=(await db.query('SELECT COUNT(*)::int AS n FROM stock_price_histories')).rows[0].n
  fail=true
  await assert.rejects(()=>service.ingest({...next,observedAt:'2026-09-17T09:31:00+08:00',timestampStr:'2026-09-17T09:31:00+08:00',realPrice:21,rollingPredictions:[{targetTime:'09:35',predictedPrice:22}]}))
  assert.deepEqual(await snapshot(),row)
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM stock_price_histories')).rows[0].n,before)
  fail=false
  await db.exec('DELETE FROM stock_price_histories')
  await service.ingest({...point,observedAt:'2026-09-16T09:58:00+08:00'})
  assert.deepEqual(await snapshot(),row)
  assert.deepEqual(await service.ingest(point),first)
  await assert.rejects(()=>service.ingest({...point,stockCode:'600839'}),e=>e instanceof AppError&&e.key==='NOT_FOUND')
 } finally {await db.close()}
})
