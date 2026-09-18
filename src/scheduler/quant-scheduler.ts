import { logError } from '../shared/logger.js'
import cron from 'node-cron'
import { runProcess } from './process-runner.js'
import { pool } from '../db.js'
import { withTaskLock } from './task-lock.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { refreshEntityProfiles } from '../profiles/entity-profile-engine.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 引擎根目录收敛在工程 quant_engine 目录下
const QUANT_ENGINE_DIR = path.resolve(__dirname, '../../quant_engine')

export type TaskExecutionStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'VALID_COMPLETE'
  | 'PARTIAL_COMPLETE'
  | 'NORMAL_SKIP'
  | 'TIMEOUT'
  | 'ERROR'
  | 'SUCCESS'

interface TaskMetric {
  name: string
  cronExpr: string
  lastRunAt: string | null
  lastSuccessAt?: string
  lastDurationMs: number
  status: TaskExecutionStatus
  lastError: string | null
  totalRuns: number
  totalErrors: number
  expectedCount?: number
  processedCount?: number
  persistedCount?: number
  asOfAt?: string | null
  lastSkipReason?: string | null
  evidenceCount?: number
  entityCount?: number
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
    metric.entityCount = result.entityCount
    metric.evidenceCount = result.evidenceCount
    if (result.skipped) {
      metric.status = 'NORMAL_SKIP'
      metric.lastSkipReason = result.warnings?.[0] || '任务重叠跳过'
    } else if (result.evidenceCount === 0) {
      metric.status = 'NORMAL_SKIP'
      metric.lastSkipReason = '无新增披露证据，保持已有画像'
    } else {
      metric.status = 'VALID_COMPLETE'
      metric.lastSuccessAt = new Date().toISOString()
      console.log(`[QuantScheduler] 画像更新完成：${result.entityCount} 个公开交易实体，${result.evidenceCount} 条证据。`)
    }
  } catch (error) {
    metric.status = 'ERROR'
    metric.totalErrors++
    metric.lastError = '画像刷新失败，详见服务端分类日志'
    logError('scheduler.profile_refresh.failed', error)
  } finally {
    metric.lastDurationMs = Date.now() - startedAt
  }
}

// 运行 Python 算法脚本 (基于多线程并发隔离与超时熔断控制)
async function executeQuantScript(taskKey: string, scriptName: string, args: string[] = []): Promise<void> {
  const metric = taskMetrics[taskKey]
  if (!metric || metric.status === 'RUNNING') return
  const scriptPath = path.join(QUANT_ENGINE_DIR, scriptName)
  if (!fs.existsSync(scriptPath)) {
    metric.status = 'ERROR'; metric.lastError = '脚本文件不存在'; metric.totalErrors++
    return
  }
  const defaults: Record<string, number> = { minutelyMonitor: 30, openingBaseline: 180, nightlyReview: 300, researchShadow: 45 }
  const raw = process.env['ZEROQUANT_TASK_TIMEOUT_' + taskKey] ?? String(defaults[taskKey] ?? 120)
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 3600) throw new Error('任务期限配置无效: ' + taskKey)
  metric.status = 'RUNNING'
  metric.lastRunAt = new Date().toISOString()
  metric.lastError = null
  metric.totalRuns++
  const result = await withTaskLock(pool, taskKey, signal => runProcess(process.env.ZEROQUANT_PYTHON || 'python3', [scriptPath, ...args], {
    cwd: QUANT_ENGINE_DIR, timeoutMs: Number(raw) * 1000, signal,
    env: { ...process.env, PYTHONUNBUFFERED: '1', OMP_NUM_THREADS: '4', OPENBLAS_NUM_THREADS: '4', MKL_NUM_THREADS: '4' },
  })).catch(() => ({ status: 'ERROR' as const, durationMs: 0, output: '', parsedData: null })) ?? { status: 'SKIPPED' as const, durationMs: 0, output: '', parsedData: null }

  metric.lastDurationMs = result.durationMs

  if (result.parsedData) {
    const data = result.parsedData
    if (typeof data.expectedCount === 'number') metric.expectedCount = data.expectedCount
    if (typeof data.processedCount === 'number') metric.processedCount = data.processedCount
    if (typeof data.persistedCount === 'number') metric.persistedCount = data.persistedCount
    if (data.asOf) metric.asOfAt = String(data.asOf)
    if (data.reason) metric.lastSkipReason = String(data.reason)
  }

  if (result.status === 'SKIPPED') {
    metric.status = 'NORMAL_SKIP'
  } else if (result.status === 'SUCCESS') {
    if (result.parsedData?.taskStatus === 'VALID_COMPLETE' || (metric.processedCount && metric.expectedCount && metric.processedCount === metric.expectedCount)) {
      metric.status = 'VALID_COMPLETE'
      metric.lastSuccessAt = new Date().toISOString()
    } else if (result.parsedData?.taskStatus === 'PARTIAL_COMPLETE' || (metric.processedCount && metric.expectedCount && metric.processedCount < metric.expectedCount)) {
      metric.status = 'PARTIAL_COMPLETE'
      metric.lastSuccessAt = new Date().toISOString()
    } else {
      metric.status = 'VALID_COMPLETE'
      metric.lastSuccessAt = new Date().toISOString()
    }
  } else {
    metric.status = result.status === 'TIMEOUT' ? 'TIMEOUT' : 'ERROR'
    metric.totalErrors++
    metric.lastError = result.status === 'TIMEOUT' ? '任务超过配置期限' : '任务执行失败'
    logError('scheduler.script.failed', new Error(metric.lastError))
  }
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
      } catch {
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
      } catch {
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
      } catch {
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
