import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Request, Response } from 'express'
import { readiness } from '../src/health.js'
test('readiness returns 503 on database failure without leaking connection secrets', async () => {
  let status=200,body:unknown
  const res={setHeader(){},status(n:number){status=n;return this},json(value:unknown){body=value}} as unknown as Response
  await readiness(async()=>{} )({} as Request,res)
  assert.equal(status,200);assert.deepEqual(body,{status:'ready'})
  await readiness(async()=>{throw new Error('postgres://secret')})({} as Request,res)
  assert.equal(status,503);assert.deepEqual(body,{status:'unavailable'})
})
