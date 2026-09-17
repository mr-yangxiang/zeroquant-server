/** 安全结构化日志；禁止传入请求体、密码、令牌、连接串或第三方异常原文。 */
import { errorCode } from './errors.js'
export function logError(event: string, error: unknown, requestId?: string) {
  console.error(JSON.stringify({ level: 'error', event, requestId,
    category: error instanceof Error ? 'Error' : 'UnknownError', code: errorCode(error),
    timestamp: new Date().toISOString() }))
}
