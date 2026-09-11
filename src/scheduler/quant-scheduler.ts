import cron from 'node-cron'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { refreshEntityProfiles } from '../profiles/entity-profile-engine.js'

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
    name: '1分钟盘口概率更新与数据质量检查',
    cronExpr: '* * * * *',
    lastRunAt: null,
    lastDurationMs: 0,
    status: 'IDLE',
    lastError: null,
    totalRuns: 0,
    totalErrors: 0,
  },
  openingBaseline: {
    name: '09:20 盘前概率基线与风险区间生成',
    cronExpr: '20 9 * * 1-5',
    lastRunAt: null,
    lastDurationMs: 0,
    status: 'IDLE',
    lastError: null,
    totalRuns: 0,
    totalErrors: 0,
  },
  nightlyReview: {
    name: '18:10 收盘后概率评估与候选经验报告',
    cronExpr: '10 18 * * 1-5',
    lastRunAt: null,
    lastDurationMs: 0,
    status: 'IDLE',
    lastError: null,
    totalRuns: 0,
    totalErrors: 0,
  },
  entityProfileRefresh: {
    name: '18:25 机构与活跃席位画像滚动更新',
    cronExpr: '25 18 * * 1-5',
    lastRunAt: null,
    lastDurationMs: 0,
    status: 'IDLE',
    lastError: null,
    totalRuns: 0,
    totalErrors: 0,
  },
}

async function executeEntityProfileRefresh() {
  const metric = taskMetrics.entityProfileRefresh
  if (metric.status === 'RUNNING') {
    console.warn('[QuantScheduler] ⚠️ 画像更新任务上一次运行尚未完成，跳过本次触发。')
    return
  }
  const startedAt = Date.now()
  metric.status = 'RUNNING'
  metric.lastRunAt = new Date().toISOString()
  metric.lastError = null
  metric.totalRuns++
  try {
    const result = await refreshEntityProfiles(new Date())
    metric.status = 'SUCCESS'
    console.log(`[QuantScheduler] 画像更新完成：${result.entityCount} 个公开交易实体，${result.evidenceCount} 条证据。`)
  } catch (error) {
    metric.status = 'ERROR'
    metric.totalErrors++
    metric.lastError = error instanceof Error ? error.message : String(error)
    console.error('[QuantScheduler] ❌ 画像更新失败:', error)
  } finally {
    metric.lastDurationMs = Date.now() - startedAt
  }
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
    const pythonProc = spawn(process.env.ZEROQUANT_PYTHON || 'python3', [scriptPath, ...args], {
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

  // 1. 每分钟盘口概率更新；脚本内部严格过滤非连续竞价时段
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

  // 2. 开盘前 09:20 概率基线与风险区间
  cron.schedule(
    taskMetrics.openingBaseline.cronExpr,
    async () => {
      try {
        console.log('🎯 [QuantScheduler] 触发 09:20 概率基线生成...')
        await executeQuantScript('openingBaseline', 'generate_daily_predictions.py')
      } catch (err: any) {
        //
      }
    },
    { timezone: 'Asia/Shanghai' }
  )

  // 3. 收盘后评估。只记录证据，不因单日结果自动修改模型或知识库。
  cron.schedule(
    taskMetrics.nightlyReview.cronExpr,
    async () => {
      try {
        console.log('📏 [QuantScheduler] 触发收盘后概率质量评估...')
        await executeQuantScript('nightlyReview', 'nightly_review.py')
      } catch (err: any) {
        //
      }
    },
    { timezone: 'Asia/Shanghai' }
  )

  // 4. 收盘数据落库后重算画像；画像按日期快照保存，盘前和盘中只读取当时可见版本。
  cron.schedule(
    taskMetrics.entityProfileRefresh.cronExpr,
    executeEntityProfileRefresh,
    { timezone: 'Asia/Shanghai' }
  )

  if (process.env.ZEROQUANT_RESEARCH_SHADOW_ENABLED === 'true') {
    const artifact = process.env.ZEROQUANT_RESEARCH_ARTIFACT_DIR
    if (!artifact) throw new Error('影子交易已启用，但缺少 ZEROQUANT_RESEARCH_ARTIFACT_DIR')
    taskMetrics.researchShadow = {
      name: '已训练候选模型的实时影子交易', cronExpr: '* * * * *',
      lastRunAt: null, lastDurationMs: 0, status: 'IDLE', lastError: null, totalRuns: 0, totalErrors: 0,
    }
    const shadowArgs = ['shadow', '--database', '--artifact', artifact,
      '--output', path.join(QUANT_ENGINE_DIR, 'research_artifacts', 'shadow')]
    if (process.env.ZEROQUANT_RESEARCH_COSTS_PATH) shadowArgs.push('--costs', process.env.ZEROQUANT_RESEARCH_COSTS_PATH)
    cron.schedule('* * * * *', async () => {
      try { await executeQuantScript('researchShadow', 'research_pipeline.py', shadowArgs) }
      catch { /* executeQuantScript records the failure in task metrics */ }
    }, { timezone: 'Asia/Shanghai' })
  }
  console.log('[QuantScheduler] 已激活 ' + Object.keys(taskMetrics).length + ' 项受控任务')
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
