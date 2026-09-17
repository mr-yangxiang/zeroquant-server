import { spawn, type ChildProcess } from 'node:child_process'
const active = new Set<ChildProcess>()
let stopping = false
export async function stopProcesses() {
  stopping = true
  await Promise.all([...active].map(child => new Promise<void>(resolve => {
    child.once('close', () => resolve())
    child.kill('SIGKILL')
  })))
}

export interface ProcessResult { status: 'SUCCESS' | 'SKIPPED' | 'TIMEOUT' | 'ERROR'; durationMs: number }
/** Resolve once, after the process has closed; never release an execution lock while it is alive. */
export function runProcess(command: string, args: string[], options: {
  cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal
}): Promise<ProcessResult> {
  return new Promise(resolve => {
    if (stopping || options.signal?.aborted) { resolve({ status: 'ERROR', durationMs: 0 }); return }
    const started = Date.now()
    let timedOut = false, failed = false, output = ''
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    active.add(child)
    const abort = () => { failed = true; child.kill('SIGKILL') }
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-65536) })
    child.stderr.on('data', () => { /* Drain without retaining potentially sensitive diagnostics. */ })
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, options.timeoutMs)
    child.on('error', () => { failed = true })
    child.once('close', code => {
      clearTimeout(timer)
      active.delete(child)
      options.signal?.removeEventListener('abort', abort)
      const skipped = output.split('\n').some(line => line.trim() === 'ZEROQUANT_TASK_STATUS=SKIPPED')
      resolve({ status: timedOut ? 'TIMEOUT' : failed || code !== 0 ? 'ERROR' : skipped ? 'SKIPPED' : 'SUCCESS', durationMs: Date.now() - started })
    })
  })
}
