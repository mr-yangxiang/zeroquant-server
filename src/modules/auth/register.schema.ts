/** 认证 DTO 与运行时校验。手机号限中国大陆；昵称可重复，不作为账号标识。 */
import { AppError } from '../../shared/errors.js'
export interface LoginInput { phone: string; password: string }
export interface RegisterInput extends LoginInput { username: string; invitationCode?: string }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('VALIDATION')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new AppError('VALIDATION')
  return value
}
/** 只规范化账号，不修改密码；登录允许旧的短密码，但拒绝 bcrypt 的隐式截断。 */
export function loginSchema(value: unknown): LoginInput {
  const body = record(value)
  const phone = text(body.phone, 32).trim().normalize('NFKC').replace(/^\+86/, '')
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new AppError('VALIDATION', '请输入有效的 11 位中国大陆手机号')
  const password = text(body.password, 72)
  if (!password.length || Buffer.byteLength(password, 'utf8') > 72 || password.includes('\0')) {
    throw new AppError('VALIDATION', '密码不可为空，且不能超过 72 个 UTF-8 字节')
  }
  return { phone, password }
}
export function registerSchema(value: unknown): RegisterInput {
  const body = record(value)
  const input = loginSchema(body)
  const username = text(body.username, 100).normalize('NFKC').trim()
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(username)) {
    throw new AppError('VALIDATION', '昵称须为 2～32 个中英文字、数字、下划线或连字符，不含空格')
  }
  // 无 MFA 时优先采用长口令；不强制脆弱的“一个大写一个符号”组合规则。
  if ([...input.password].length < 15) throw new AppError('VALIDATION', '新密码至少 15 个字符，建议使用不重复的长口令')
  const invitationCode = body.invitationCode === undefined ? undefined : text(body.invitationCode, 256)
  return { ...input, username, invitationCode }
}
