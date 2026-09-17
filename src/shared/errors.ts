/** 跨领域业务异常：消息由错误目录统一管理；未知异常不得向客户端回显。 */
export const errors = {
  VALIDATION: [400, 10001, '请求参数不符合要求'],
  INVALID_CREDENTIALS: [401, 10002, '账号或密码错误'],
  UNAUTHENTICATED: [401, 10003, '登录状态无效，请重新登录'],
  REGISTRATION_CONFLICT: [409, 10004, '无法创建该账号，请登录或联系管理员'],
  REGISTRATION_DISABLED: [403, 10005, '当前未开放注册，请联系管理员'],
  RATE_LIMITED: [429, 10006, '请求过于频繁，请稍后再试'],
  FORBIDDEN: [403, 10007, '请求来源或凭据不符合要求'],
  BUSY: [503, 10008, '服务繁忙，请稍后再试'],
  NOT_FOUND: [404, 10009, '记录不存在'],
  CONFLICT: [409, 10010, '记录已变化，不能安全执行该操作'],
  INTERNAL: [500, 10999, '服务暂时不可用，请稍后重试'],
} as const
export type ErrorKey = keyof typeof errors
export class AppError extends Error {
  /** detail 必须是开发者明确编写的安全提示，不能传入 SQL/第三方异常原文。 */
  constructor(public readonly key: ErrorKey, detail?: string) {
    super(detail ?? errors[key][2])
    this.name = 'AppError'
  }
}
/** 只读取错误的分类代码，不读取 message/detail/query 等可能含敏感内容的字段。 */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(error.code) ? error.code : undefined
}
