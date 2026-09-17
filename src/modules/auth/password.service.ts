/** 密码基础设施：替换算法只需实现 PasswordPort。bcrypt 上限必须在 Schema 先校验。 */
import bcrypt from 'bcryptjs'
import { AppError } from '../../shared/errors.js'
import type { PasswordPort } from './auth.types.js'
export class PasswordService implements PasswordPort {
  private active = 0
  private readonly dummyHash: string
  constructor(private readonly rounds: number) {
    // 启动阶段生成同成本伪哈希；不存在账号也走比较路径，减小显著时序差异。
    this.dummyHash = bcrypt.hashSync('dummy-password-never-an-account', rounds)
  }
  private async bounded<T>(operation: () => Promise<T>): Promise<T> {
    // 每进程最多两个昂贵操作；不建立无界排队。公网还须结合共享限流和网关防护。
    if (this.active >= 2) throw new AppError('BUSY')
    this.active++
    try { return await operation() } finally { this.active-- }
  }
  hash(password: string) { return this.bounded(() => bcrypt.hash(password, this.rounds)) }
  async verify(password: string, hash?: string) {
    return this.bounded(async () => (await bcrypt.compare(password, hash ?? this.dummyHash)) && !!hash)
  }
}
