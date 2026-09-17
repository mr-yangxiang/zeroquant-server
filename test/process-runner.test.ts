import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runProcess } from '../src/scheduler/process-runner.js'
test('process runner distinguishes success, skip, failure, timeout and spawn errors', async () => {
  const run = (code: string, timeoutMs = 3000) => runProcess(process.execPath, ['-e', code], { timeoutMs })
  assert.equal((await run('process.exit(0)')).status, 'SUCCESS')
  assert.equal((await run('console.log("ZEROQUANT_TASK_STATUS=SKIPPED")')).status, 'SKIPPED')
  assert.equal((await run('console.log("ZEROQUANT_TASK_STATUS=SKIPPED");process.exit(1)')).status, 'ERROR')
  assert.equal((await run('setInterval(()=>{},1000)', 100)).status, 'TIMEOUT')
  assert.equal((await runProcess('/nonexistent/zeroquant-test-process', [], { timeoutMs: 100 })).status, 'ERROR')
  const controller=new AbortController()
  const pending=runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:3000,signal:controller.signal})
  controller.abort()
  assert.equal((await pending).status,'ERROR')
})
