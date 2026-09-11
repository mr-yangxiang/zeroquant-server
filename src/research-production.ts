import { pool } from './db.js'
import type { QueryConfig } from 'pg'

export const SIGNAL_MAX_AGE_MS = 120_000

function timestamp(value: unknown): number {
  return value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN
}

export function signalFresh(value: unknown, now = Date.now()): boolean {
  const at = timestamp(value)
  return Number.isFinite(at) && at <= now + 1000 && now - at < SIGNAL_MAX_AGE_MS
}

/** Re-evaluate persisted payloads too: a historical actionable=true is not authority. */
export function forecastSignalEligible(value: any, now = Date.now()): boolean {
  const features = value?.features
  if (value?.modelState !== 'champion' || value?.modelCalibrated !== true || value?.mode !== 'realtime'
    || !signalFresh(value?.asOf, now) || !signalFresh(features?.observedAt, now)
    || !Array.isArray(features?.qualityFlags) || !Array.isArray(value?.warnings)
    || typeof features?.qualityScore !== 'number' || !Number.isFinite(features.qualityScore)
    || features.qualityScore < 0.5 || features.qualityScore > 1) return false
  const flags = [...features.qualityFlags, ...value.warnings].map(String)
  return !flags.some(flag => /stale_|source_unavailable|sources_unavailable|leakage|硬风控|未达到生产交易门槛/.test(flag))
}

export function localizeModelState(value: unknown, approved = false) {
  const state = String(value || '').toLowerCase()
  if (state === 'untrained_bootstrap') return {
    label: '尚未完成训练，仅供观察',
    explanation: '当前只是验证数据管道和页面的初始规则权重，尚未用多年历史样本训练，也未通过样本外回测和概率校准，不能据此证明预测准确率。',
  }
  if (state === 'trained') return { label: '已训练，等待概率校准', explanation: '训练已完成，但尚未完成独立样本验证、概率校准和影子交易，不能作为可执行信号。' }
  if (state === 'calibrated') return { label: '已校准，等待影子验证', explanation: '已完成研究训练与概率校准，仍需验证真实交易成本、成交约束及持续盘中表现。' }
  if (state === 'shadow') return { label: '影子验证中', explanation: '模型已训练，正在模拟成交中验证滑点、延迟和成本后的表现，尚未获准输出可执行信号。' }
  if (state === 'champion' && approved) return { label: '已通过生产门槛', explanation: '服务端已核验模型批准记录；此预测仍受实时数据、信号时效和个人风险约束，并不代表保证盈利。' }
  if (state === 'champion' || state === 'verification_required') return { label: '生产资格或数据时效待核验，仅供观察', explanation: '模型批准记录、实时数据或信号时效未通过本次核验。旧的已通过标记不再作为交易依据，需等待重新核验。' }
  if (state === 'retired') return { label: '模型已停用，仅供复盘', explanation: '此模型已退出生产，历史预测仅保留用于复盘。' }
  return { label: '模型状态待确认，仅供观察', explanation: '当前模型状态尚未核实，不输出可执行信号。' }
}

type EvidenceQuery = (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>

/** Database-held evidence, not a caller-supplied 'champion' string. Fail closed on errors. */
export async function productionApproved(modelId: string, asOf: unknown,
  query: EvidenceQuery = (text, values) => {
    const config: QueryConfig & { query_timeout: number } = { text, values, query_timeout: 5000 }
    return pool.query(config)
  },
  now = Date.now()): Promise<boolean> {
  if (typeof modelId !== 'string' || !modelId || modelId.length > 100 || !signalFresh(asOf, now)) return false
  try {
    const { rows } = await query(
      `SELECT 1 FROM model_artifacts a
     JOIN model_promotions p ON p.model_id=a.model_id
     WHERE a.model_id=$1 AND a.state='CHAMPION' AND p.revoked_at IS NULL
       AND p.approved_at <= $2::timestamptz
       AND p.evidence->'approved'='true'::jsonb
       AND p.evidence->>'policy_version'='production_v2'
       AND p.evidence->>'quality_policy'='pit_coverage_v2'
       AND p.evidence->>'valuation_policy'='per_position_marks_v1'
       AND p.evidence->>'model_file_hash'=a.file_hash
       AND a.file_hash ~ '^[0-9a-f]{64}$'
       AND p.evidence->'reasons'='[]'::jsonb`,
      [modelId, new Date(timestamp(asOf)).toISOString()]
    )
    return rows.length > 0
  } catch {
    console.warn('[量化门禁] 无法核验生产批准记录，本次仅供研究观察。')
    return false
  }
}
