/** 进程启动入口：配置校验、迁移和服务启动；不得加入路由、SQL 或业务计算。 */
import { createApp } from './app.js'
import { runMigrationsUp } from './migrations/runner.js'
import { startQuantInternalScheduler } from './scheduler/quant-scheduler.js'
import { logError } from './shared/logger.js'
import { verifySchema } from './database/schema-verifier.js'

async function startServer() {
  const app = createApp() // 先校验配置；失败时不执行迁移。
  const port = Number(process.env.PORT ?? 3002)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 配置无效')
  if (process.env.NODE_ENV === 'production' && (process.env.ZEROQUANT_INTERNAL_TOKEN?.length ?? 0) < 32) throw new Error('生产内部令牌至少 32 字节')
  await runMigrationsUp()
  // 迁移登记不等于字段/唯一索引真实存在；不满足契约时禁止带病提供认证服务。
  const differences = await verifySchema()
  if (differences.some(item => item.severity === 'ERROR')) throw new Error('数据库结构验收失败，请运行 schema:verify')
  app.listen(port, () => {
    console.log(JSON.stringify({ level: 'info', event: 'server.started', port }))
    if (process.env.ZEROQUANT_DISABLE_SCHEDULER !== 'true') startQuantInternalScheduler()
  })
}
startServer().catch(error => { logError('server.startup.failed', error); process.exit(1) })
