# 生产可靠性修复与隔离验收（2026-09-17）

本记录覆盖本轮明确发现的缺陷；不代表全部 80 项和全部文件已完成审查。此前部署版本为服务端 827745a、前端 8037f92；以下修复属于后续工作区变更，未经发布不能视为生产已生效。

| 项目 | 代码位置 | 修复与验证 | 剩余边界 |
| --- | --- | --- | --- |
| 调度结算 | src/scheduler/process-runner.ts、quant-scheduler.ts | 子进程 close 后一次结算；SUCCESS/SKIPPED/ERROR/TIMEOUT；分任务期限；真实进程成功、失败、缺失可执行文件、超时测试 | 生产容量和长任务实际期限需运行证据 |
| 跨实例任务锁 | src/scheduler/task-lock.ts | PostgreSQL 会话锁，失联终止子进程，finally 释放；真实双连接排斥、正常退出及异常后再次取得锁通过 | 不是跨网络分区的严格 fencing 协议；生产切换须验证 |
| 采集成功语义 | quant_engine/realtime_monitor_1m.py、generate_daily_predictions.py | 部分计算/持久化失败导致非零退出；非交易时间明确 SKIPPED；失败摘要不带异常原文 | 历史 outbox 自动补发、完整交易日历仍需单独验收 |
| 行情重试 | src/modules/market-sync/market-sync.repository.ts、src/migrations/012_market_sync_receipts.ts | 请求摘要、原始响应与所有写入同一事务；同内容重放原响应、不同内容冲突；8 路真实连接只落一条行情 | 旧记录无回执仍拒绝猜测成功；同观测时间不同预测内容仍冲突 |
| 独立水位 | 同上 | 迁移从现存历史初始化；独立水位随提交推进；删除隔离历史后迟到记录不覆盖摘要测试通过 | 默认不自动清理回执/水位；需基于实际增长量制定归档容量预算 |
| 健康与停止 | src/health.ts、src/app.ts、src/index.ts | /health 存活；/ready 数据库探测及失败503；受内部令牌保护的 data-status 提供观测时间与年龄；关闭HTTP、定时器、子进程、连接池 | 数据年龄需结合交易日历判断，尚未接告警平台 |
| 行情 HTTPS | quant_engine/zeroquant/providers.py | 报价和分钟接口均实际请求 HTTPS 返回200，再替换代码；保留证书验证 | HTTPS不证明供应商内容真实性或历史可见时间 |
| 前端检查 | web/package.json、Dashboard.vue、.github/workflows/deploy.yml | vue-tsc 完整组件检查发现并修复价格数组类型错误；前端CI加入8项回归；完整构建通过 | 大组件和约2.44MB主包仍需优化 |
| 浏览器认证 | web/test/browser/auth.spec.ts | 实际Chromium页面登录、刷新、两个标签同时刷新、HttpOnly Cookie、退出后另一标签拒绝进入、非白名单Origin403通过 | 本机HTTP代理；正式域名HTTPS、Secure Cookie及生产白名单仍需外层网关验收 |
| 数据库并发 | test/postgres-concurrency.test.ts | PostgreSQL16同号并发注册、刷新重放撤销、8路持仓更新、8路行情重放及任务锁通过；CI加入独立PG服务 | 尚非全链路容量/连接中断故障矩阵 |
| 恢复演练 | 本机独立PG16 | pg_dump自定义格式备份合成测试库；pg_restore --exit-on-error恢复到全新测试库；用户、回执与12项迁移存在 | 未恢复生产32MB旧JSONL快照；不能把gzip校验等同可恢复性 |

验证：后端领域63项、Python研究64项、Python服务15项、前端8项、实际浏览器1条完整场景（含跨标签切换账号失效）通过；12项迁移/54张表隔离结构验证与生产门禁通过。完整HTTP业务基线21步通过。生产依赖npm审计0已知漏洞，不覆盖Python依赖和未来漏洞。

完整HTTP验收额外发现行情滚动写入SQL参数$3混合varchar/text推断导致真实PostgreSQL报42P08并返回500。已在所有使用处显式使用text，增加真实PG带滚动点并发测试。旧E2E样本补齐newsEvents，非法输入预期更新为400，并补新回执表的定向清理；不降低生产参数校验。

生产连接检查：SSH两次返回Connection closed，无法核对用户新增的Origin配置或部署后续修复。此次没有覆盖生产配置或应用012迁移。

实际断库检查：本机/ready正常200，停止隔离PostgreSQL后返回503且不泄漏连接信息；/health仍返回200存活。测试数据库已停止，未删除测试快照。前端产物仍有体积警告，不算错误。

本轮采用 /tmp 独立PG目录，未改动生产业务数据。Docker镜像下载EOF后进程不可用，改用本机PG16；未声称Docker镜像验证通过。

结论：以上代码缺陷已修复并获得相应隔离证据；正式环境验收、历史快照恢复、剩余逐文件审查及长期数据质量/模型证据仍开放。不能宣称现在只差等待数据。
