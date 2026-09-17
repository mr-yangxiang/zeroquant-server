/** Explicit loopback disposable database only. Does not load .env. */
import assert from 'node:assert/strict'
import pg from 'pg'
import { ALL_MIGRATIONS } from '../src/migrations/catalog.js'
import { PgUnitOfWork } from '../src/shared/transaction.js'
import { MarketSyncRepository } from '../src/modules/market-sync/market-sync.repository.js'
import { MarketSyncService } from '../src/modules/market-sync/market-sync.service.js'
import { withTaskLock } from '../src/scheduler/task-lock.js'
import { createAuthModule } from '../src/modules/auth/auth.module.js'
import { createPortfolioModule } from '../src/modules/portfolio/portfolio.module.js'
const raw=process.env.ZEROQUANT_ISOLATED_DATABASE_URL
if(!raw)throw new Error('Explicit isolated database required')
const url=new URL(raw)
assert.ok(['localhost','127.0.0.1'].includes(url.hostname))
assert.equal(url.pathname,'/zeroquant_isolated')
assert.equal(url.port,'55439')
const pool=new pg.Pool({connectionString:raw,max:8,statement_timeout:10000,connectionTimeoutMillis:3000})
try {
  const client=await pool.connect()
  try { for(const migration of ALL_MIGRATIONS) await migration.up(client) } finally {client.release()}
  const stockCode='98'+String(Date.now()).slice(-4)
  await pool.query("INSERT INTO stocks(code,full_code,name) VALUES($1,$2,'isolated test')",[stockCode,'sz'+stockCode])
  const config={secret:'isolated-auth-test-9876543210-ABCDEFGHIJKLMNOPQRSTUVWXYZ',accessSeconds:900,refreshSeconds:3600,bcryptRounds:10,cookieSecure:false,cookiePath:'/api/v1/auth',registrationEnabled:true}
  const auth=createAuthModule(pool,config).service
  const input={phone:'138'+String(Date.now()).slice(-8),username:'isolated',password:'OnlyForTests!234'}
  const registrations=await Promise.allSettled([auth.register(input),auth.register(input)])
  assert.equal(registrations.filter(r=>r.status==='fulfilled').length,1)
  const login=await auth.login(input)
  const refreshed=await Promise.allSettled([auth.refresh(login.refreshToken),auth.refresh(login.refreshToken)])
  assert.equal(refreshed.filter(r=>r.status==='fulfilled').length,1)
  for(const result of refreshed)if(result.status==='fulfilled')await assert.rejects(()=>auth.authenticate(result.value.token))
  const portfolio=createPortfolioModule(pool).service
  await Promise.all(Array.from({length:8},()=>portfolio.record(login.user.id,stockCode,'BUY',10,100)))
  assert.equal((await pool.query('SELECT holding_shares FROM user_positions WHERE user_id=$1 AND stock_code=$2',[login.user.id,stockCode])).rows[0].holding_shares,800)
  const service=new MarketSyncService(new MarketSyncRepository(new PgUnitOfWork(pool)))
  const point={stockCode,tradeDate:'2099-01-06',timestampStr:'2099-01-06T10:00:00+08:00',realPrice:10,rollingPredictions:[{targetTime:'10:05',predictedPrice:11,leadMinutes:5}]}
  const results=await Promise.all(Array.from({length:8},()=>service.ingest(point)))
  results.forEach(value=>assert.deepEqual(value,results[0]))
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM stock_price_histories WHERE stock_code=$1',[stockCode])).rows[0].n,1)
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM stock_rolling_predictions WHERE stock_code=$1',[stockCode])).rows[0].n,1)
  await assert.rejects(()=>service.ingest({...point,realPrice:11}))
  let release!:()=>void,entered!:()=>void
  const started=new Promise<void>(r=>{entered=r})
  const wait=new Promise<void>(r=>{release=r})
  const first=withTaskLock(pool,'isolated-test',async()=>{entered();await wait;return 'first'})
  await started
  try {assert.equal(await withTaskLock(pool,'isolated-test',async()=> 'duplicate'),null)}finally{release()}
  assert.equal(await first,'first')
  assert.equal(await withTaskLock(pool,'isolated-test',async()=> 'recovered'),'recovered')
  await assert.rejects(()=>withTaskLock(pool,'isolated-test',async()=>{throw new Error('injected')}))
  assert.equal(await withTaskLock(pool,'isolated-test',async()=> 'after-error'),'after-error')
  console.log('PASS: real PostgreSQL concurrent registration, refresh replay revocation, eight-connection portfolio and market replay, conflict, task exclusion and lock release')
}finally{await pool.end()}
