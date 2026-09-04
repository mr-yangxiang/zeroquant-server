import cron from 'node-cron'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 引擎根目录收敛在工程 quant_engine 目录下
const QUANT_ENGINE_DIR = path.resolve(__dirname, '../../quant_engine')

interface TaskMetric {
  name: string
  cronExpr: string
  lastRunAt: string | null
  lastDurationMs: number
  status: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'ERROR'
  lastError: string | null
  totalRuns: number
  totalErrors: number
}

const taskMetrics: Record<string, TaskMetric> = {
  minutelyMonitor: {
    name: '1分钟盘口高频监控与前向动态重塑',
    cronExpr: '* * * * *',
    lastRunAt: null,
    lastDurationMs: 0,
    status: 'IDLE',
    lastError: null,
    totalRuns: 0,
    totalErrors: 0,
  },
  openingBaseline: {
    name: '09:20 竞价终极基准线与动量推演锁定',
    cronExpr: '20 9 * * 1-5',
    lastRunAt: null,
    lastDurationMs: 0,
    status: 'IDLE',
    lastError: null,
    totalRuns: 0,
    totalErrors: 0,
  },
  midnightAudit: {
    name: '00:00 全量系统健康巡检与首轮基准预测',
    cronExpr: '0 0 * * *',
    lastRunAt: null,
    lastDurationMs: 0,
    status: 'IDLE',
    lastError: null,
    totalRuns: 0,
    totalErrors: 0,
  },
  hourlyVerifier: {
    name: '逐小时实盘偏差核对与样本自主演进',
    cronExpr: '0 * * * *',
    lastRunAt: null,
    lastDurationMs: 0,
    status: 'IDLE',
    lastError: null,
    totalRuns: 0,
    totalErrors: 0,
  },
}

// 运行 Python 算法脚本 (基于多线程并发隔离与超时熔断控制)
function executeQuantScript(taskKey: string, scriptName: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const metric = taskMetrics[taskKey]
    if (metric && metric.status === 'RUNNING') {
      console.warn(`[QuantScheduler] ⚠️ 任务 ${taskKey} 上一次运行尚未完成，跳过本次触发防重叠！`)
      return resolve('SKIPPED_OVERLAPPING')
    }

    const scriptPath = path.join(QUANT_ENGINE_DIR, scriptName)
    if (!fs.existsSync(scriptPath)) {
      const err = `[QuantScheduler] 脚本文件不存在: ${scriptPath}`
      if (metric) {
        metric.status = 'ERROR'
        metric.lastError = err
        metric.totalErrors++
      }
      return reject(new Error(err))
    }

    const startTime = Date.now()
    if (metric) {
      metric.status = 'RUNNING'
      metric.lastRunAt = new Date().toISOString()
      metric.lastError = null
      metric.totalRuns++
    }

    // 启动多进程/多线程隔离沙盒 (4C6G 环境最大分配 4 线程并发)
    const pythonProc = spawn('python3', [scriptPath, ...args], {
      cwd: QUANT_ENGINE_DIR,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        OMP_NUM_THREADS: '4',
        OPENBLAS_NUM_THREADS: '4',
        MKL_NUM_THREADS: '4',
      },
    })

    let stdoutData = ''
    let stderrData = ''

    pythonProc.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString()
    })

    pythonProc.stderr.on('data', (chunk) => {
      stderrData += chunk.toString()
    })

    // 55 秒强制超时熔断机制，防止任务挂起阻塞系统
    const timeout = setTimeout(() => {
      try {
        pythonProc.kill('SIGKILL')
      } catch (_) {}
      const errMsg = `任务 ${taskKey} 执行超时 (55s 熔断)`
      if (metric) {
        metric.status = 'ERROR'
        metric.lastError = errMsg
        metric.totalErrors++
      }
      reject(new Error(errMsg))
    }, 55000)

    pythonProc.on('close', (code) => {
      clearTimeout(timeout)
      const duration = Date.now() - startTime
      if (metric) {
        metric.lastDurationMs = duration
        if (code === 0) {
          metric.status = 'SUCCESS'
        } else {
          metric.status = 'ERROR'
          metric.lastError = stderrData || `Exit code ${code}`
          metric.totalErrors++
        }
      }

      if (code === 0) {
        resolve(stdoutData)
      } else {
        console.error(`[QuantScheduler] ❌ ${taskKey} 执行异常:`, stderrData || stdoutData)
        reject(new Error(stderrData || stdoutData || `Process exited with code ${code}`))
      }
    })

    pythonProc.on('error', (err) => {
      clearTimeout(timeout)
      if (metric) {
        metric.status = 'ERROR'
        metric.lastError = err.message
        metric.totalErrors++
      }
      reject(err)
    })
  })
}

/**
 * 启动 ZeroQuant 核心内生量化调度管理器
 */
export function startQuantInternalScheduler() {
  console.log('⚡ [QuantScheduler] 正在初始化 ZeroQuant 内生多线程量化调度引擎...')

  // 1. 每分钟盘口监控与动态前向重塑 (* * * * *)
  cron.schedule(
    taskMetrics.minutelyMonitor.cronExpr,
    async () => {
      try {
        await executeQuantScript('minutelyMonitor', 'realtime_monitor_1m.py')
      } catch (err: any) {
        // 异常已记录在 metrics 中
      }
    },
    { timezone: 'Asia/Shanghai' }
  )

  // 2. 开盘前 09:20 竞价终极基准线锁定 (20 9 * * 1-5)
  cron.schedule(
    taskMetrics.openingBaseline.cronExpr,
    async () => {
      try {
        console.log('🎯 [QuantScheduler] 触发 09:20 终极基准线开盘推演与锁定...')
        await executeQuantScript('openingBaseline', 'generate_daily_predictions.py')
      } catch (err: any) {
        //
      }
    },
    { timezone: 'Asia/Shanghai' }
  )

  // 3. 每日 00:00 凌晨系统巡检与首轮基准生成 (0 0 * * *)
  cron.schedule(
    taskMetrics.midnightAudit.cronExpr,
    async () => {
      try {
        console.log('🌙 [QuantScheduler] 触发 00:00 凌晨系统健康巡检与首轮预测...')
        await executeQuantScript('midnightAudit', 'midnight_audit_and_predict.py')
      } catch (err: any) {
        //
      }
    },
    { timezone: 'Asia/Shanghai' }
  )

  // 4. 逐小时实盘偏差核对 (0 * * * *)
  cron.schedule(
    taskMetrics.hourlyVerifier.cronExpr,
    async () => {
      try {
        await executeQuantScript('hourlyVerifier', 'hourly_verifier.py')
      } catch (err: any) {
        //
      }
    },
    { timezone: 'Asia/Shanghai' }
  )

  console.log('🚀 [QuantScheduler] ZeroQuant 内生量化调度引擎已全量激活 (已加载 4 项高并发定时任务)')
}

/**
 * 获取当前量化调度引擎健康指标与性能数据
 */
export function getQuantSchedulerMetrics() {
  return {
    engineDir: QUANT_ENGINE_DIR,
    systemCores: 4,
    allocatedThreads: 4,
    tasks: taskMetrics,
  }
}
