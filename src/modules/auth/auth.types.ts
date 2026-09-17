/** 认证领域端口与 DTO；Service 不依赖 Express、pg、bcrypt 或 JWT 实现。 */
export interface User { id: string; phone: string; username: string; avatar: string | null }
export interface CredentialUser extends User { password: string }
export interface Principal { userId: string; sessionId: string }
export interface Session { id: string; userId: string; createdAt: Date; expiresAt: Date; revokedAt: Date | null }
export interface RefreshRecord { tokenHash: string; sessionId: string; usedAt: Date | null }
export interface AuthRepository {
  findUser(phone: string): Promise<CredentialUser | null>
  getUser(id: string): Promise<User | null>
  createUser(phone: string, username: string, hash: string): Promise<User>
  createSession(id: string, userId: string, expiresAt: Date): Promise<void>
  getSession(id: string, lock?: boolean): Promise<Session | null>
  findRefresh(hash: string): Promise<RefreshRecord | null>
  insertRefresh(hash: string, sessionId: string): Promise<void>
  consumeRefresh(hash: string): Promise<void>
  revokeSession(id: string, userId: string): Promise<void>
  listSessions(userId: string): Promise<Session[]>
}
export interface AuthWork {
  run<T>(operation: (repository: AuthRepository) => Promise<T>): Promise<T>
}
export interface PasswordPort { hash(password: string): Promise<string>; verify(password: string, hash?: string): Promise<boolean> }
export interface TokenPort {
  access(principal: Principal): string
  verify(token: string): Principal
  refresh(): string
  digest(token: string): string
  id(): string
}
