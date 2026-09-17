/** 认证配置唯一入口；密钥不回退为随机值，部署须显式注入，不在模块导入时读取。 */
export interface AuthConfig {
  secret: string; accessSeconds: number; refreshSeconds: number; bcryptRounds: number
  publicOrigin?: string; cookieSecure: boolean; cookiePath: string
  registrationEnabled: boolean; invitationCode?: string
}
function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const raw = env[key] ?? String(fallback)
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new Error(key + ' 配置不合法')
  return Number(raw)
}
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret = env.JWT_SECRET ?? ''
  // 长度不能证明随机性；另外拒绝示例占位值、首尾空白和明显重复字符。
  if (Buffer.byteLength(secret) < 32 || secret !== secret.trim() || new Set(secret).size < 8
    || /^(?:replace[-_]|change[-_]?me|your[-_])/i.test(secret)) throw new Error('JWT_SECRET 必须显式设置为至少 32 字节的随机密钥，不能使用占位或重复值')
  const production = env.NODE_ENV === 'production'
  const publicOrigin = env.ZEROQUANT_PUBLIC_ORIGIN
  if (publicOrigin) {
    const url = new URL(publicOrigin)
    if (url.origin !== publicOrigin || !['http:', 'https:'].includes(url.protocol)
      || (production && url.protocol !== 'https:')) throw new Error('ZEROQUANT_PUBLIC_ORIGIN 必须是无路径的站点 origin；生产要求 HTTPS')
  } else if (production) throw new Error('生产环境必须设置 ZEROQUANT_PUBLIC_ORIGIN')
  const registrationEnabled = env.ZEROQUANT_REGISTRATION_ENABLED === 'true'
  const invitationCode = env.ZEROQUANT_REGISTRATION_INVITE
  if (registrationEnabled && production && (!invitationCode || Buffer.byteLength(invitationCode) < 32)) {
    throw new Error('生产注册必须配置至少 32 字节的邀请码；尚未实现短信验证，不允许无门槛开放')
  }
  const cookiePath = env.ZEROQUANT_AUTH_COOKIE_PATH ?? '/zeroquant/api/v1/auth'
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(cookiePath)) throw new Error('ZEROQUANT_AUTH_COOKIE_PATH 格式无效')
  return {
    secret, publicOrigin, cookiePath, registrationEnabled, invitationCode, cookieSecure: production || publicOrigin?.startsWith('https:') === true,
    accessSeconds: integer(env, 'JWT_ACCESS_SECONDS', 900, 60, 3600),
    refreshSeconds: integer(env, 'JWT_REFRESH_SECONDS', 2592000, 3600, 2592000),
    bcryptRounds: integer(env, 'BCRYPT_ROUNDS', 12, 10, 14),
  }
}
