/** 认证控制器：DTO 校验、Cookie 和响应映射；不依赖数据库、bcrypt 或 JWT 密钥。 */
import type { Request, Response } from 'express'
import type { AuthConfig } from '../../config/auth.config.js'
import { AppError } from '../../shared/errors.js'
import { registerSchema, loginSchema } from './register.schema.js'
import type { AuthService } from './auth.service.js'
const COOKIE = 'zeroquant_refresh'
export class AuthController {
  constructor(private readonly service: AuthService, private readonly config: AuthConfig) {}
  private cookieOptions() { return { httpOnly: true, secure: this.config.cookieSecure, sameSite: 'strict' as const, path: this.config.cookiePath } }
  private send(res: Response, result: Awaited<ReturnType<AuthService['login']>>, status: number, message: string) {
    res.cookie(COOKIE, result.refreshToken, { ...this.cookieOptions(), expires: result.expiresAt })
    res.setHeader('Cache-Control', 'no-store')
    res.status(status).json({ code: 0, message, data: { token: result.token, expiresIn: result.expiresIn, user: result.user } })
  }
  register = async (req: Request, res: Response) => this.send(res, await this.service.register(registerSchema(req.body as unknown)), 201, '注册并登录成功')
  login = async (req: Request, res: Response) => this.send(res, await this.service.login(loginSchema(req.body as unknown)), 200, '登录成功')
  refresh = async (req: Request, res: Response) => {
    const matches = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(COOKIE + '='))
    if (matches.length !== 1) throw new AppError('UNAUTHENTICATED')
    try { this.send(res, await this.service.refresh(matches[0].slice(COOKIE.length + 1)), 200, '登录状态已刷新') }
    catch (error) { if (error instanceof AppError && error.key === 'UNAUTHENTICATED') res.clearCookie(COOKIE, this.cookieOptions()); throw error }
  }
  logout = async (req: Request, res: Response) => {
    await this.service.logout(req.principal!)
    res.clearCookie(COOKIE, this.cookieOptions())
    res.json({ code: 0, message: '已退出登录', data: null })
  }
  sessions = async (req: Request, res: Response) => res.json({ code: 0, message: 'ok', data: await this.service.sessions(req.principal!) })
  revoke = async (req: Request, res: Response) => {
    await this.service.logout(req.principal!, String(req.params.id))
    res.json({ code: 0, message: '会话已撤销', data: null })
  }
}
