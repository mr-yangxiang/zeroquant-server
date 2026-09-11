import assert from 'node:assert/strict'
import { forecastSignalEligible, localizeModelState, productionApproved, signalFresh } from '../src/research-production.js'

const now=Date.parse('2026-09-10T02:00:00Z')
const at=new Date(now).toISOString()
const snapshot={modelState:'champion',modelCalibrated:true,mode:'realtime',asOf:at,warnings:[],
  features:{observedAt:at,qualityFlags:[],qualityScore:.9}}
assert.ok(forecastSignalEligible(snapshot,now))
assert.equal(forecastSignalEligible({...snapshot,modelState:'untrained_bootstrap'},now),false)
assert.equal(forecastSignalEligible({...snapshot,modelCalibrated:false},now),false)
assert.equal(forecastSignalEligible({...snapshot,warnings:['stale_quote']},now),false)
assert.equal(forecastSignalEligible({...snapshot,features:{...snapshot.features,qualityScore:NaN}},now),false)
assert.equal(signalFresh(at,now+120_001),false)
assert.equal(await productionApproved('forged',at,async()=>({rows:[]}),now),false)
assert.equal(await productionApproved('forged',at,async()=>{throw Error('DB down')},now),false)
await productionApproved('candidate',at,async(sql)=>{
  assert.ok(sql.includes("policy_version'='production_v2'"))
  assert.ok(sql.includes("quality_policy'='pit_coverage_v2'"))
  assert.ok(sql.includes("valuation_policy'='per_position_marks_v1'"))
  assert.ok(!sql.includes("'production_v1'"))
  return {rows:[]}
},now)
assert.ok(localizeModelState('champion',false).label.includes('仅供观察'))
assert.ok(localizeModelState('untrained_bootstrap').label.includes('尚未完成训练'))
console.log('PASS: research production gates, stale data, missing approval and Chinese labels')
