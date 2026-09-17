# 本轮验证记录（2026-09-15）

本记录来自当前任务的实际工具输出，不沿用上一轮的“全部通过”作为本轮证据。测试使用本机隔离数据；未执行云库 SQL、生产部署或实盘模型验收。

| 验证 | 实际命令 | 本轮结果 | 能证明 / 不能证明 |
| --- | --- | --- | --- |
| 后端 TypeScript | `npm run build` | 通过；密钥校验最后修改后重新构建通过 | 检查 src 类型与编译，不保证运行时所有分支 |
| 认证/持仓/行情/新增回归 | `npm run test:domains` | 27 项通过，0 失败；新增限流变体断言、6 项全局回归 | 包含真实回环 HTTP 与隔离 PostgreSQL/WASM；不等于真实多连接并发 |
| 最后追加弱密钥负例 | `node --import tsx --test --test-name-pattern='认证 Schema' test/auth-portfolio.test.ts` | 5 项通过（含父测试），0 失败 | 在完整 27 项通过后追加配置检查，局部重跑通过；不重复相加为 32 项独立用例 |
| 迁移与兼容 | `npm run test:migrations` | 9 个迁移、50 张表、旧库升级/回滚/008 兼容检查通过 | 单连接 WASM 隔离库，未连接云库 |
| 实体目录 | `npm run schema:catalog-check` | 50 张表一致，通过 | 定义与迁移目录一致，不代表线上结构完全一致 |
| 生产资格保护 | `node --import tsx test/research-production.test.ts` | 通过 | 验证已覆盖的新鲜度/批准缺失负例；不授予任何模型生产资格 |
| 前端安全/图表/账号切换 | `npm test`（web） | 4 项通过，0 失败 | 实际 Markdown、图表配置、拦截器代码；传输替身，无真实浏览器 Cookie 联调 |
| 前端编译与类型 | `npm run build`（web，已前置 `npm run typecheck`） | 通过；初次独立 tsc 发现 Web Locks 类型错误，修复后重跑通过 | tsc 检查 TS 文件，Vite 构建 Vue；没有 vue-tsc，不能宣称 Vue 模板/全部 script setup 类型验收 |
| Python 内部服务 | `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=quant_engine .venv-service/bin/python -m unittest discover -s quant_engine/service_tests -q` | 15 项通过 | ASGI/SQLite/契约、本机 Uvicorn；PostgreSQL/Redis 尚未真实联调 |
| Python 研究及新增审查回归 | `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=quant_engine .venv-research/bin/python -m unittest discover -s quant_engine/tests -q` | 63 项通过（原有 60＋新增 3），0 失败 | 时间负例、provider/outbox 脱敏与既有研究契约；不代表真实样本训练达标 |
| 文本差异 | 两端 `git diff --check` | 通过；新增文件另纳入审查清单 | 仅空白/补丁格式检查 |
| 文件与 80 项证据完整性 | `python3 scripts/review_inventory.py --check` | 80 项及 219 个文件条目一致，通过；临时夹具验证摘要变更和重复编号会失败 | 检查编号、文件集合、摘要、锚点与行号，不证明漏洞为零 |

## 仍可见的警告

- 前端单个 JS 产物约 2.44 MB（未压缩），超过 Vite 的 500 kB 警告阈值；未用调高阈值掩盖它。
- VueUse 部分 PURE 注解位置触发 Rollup 警告；构建成功。
- Python 服务测试有 Starlette/httpx 弃用提示；测试成功，兼容升级仍待处理。
- 本机回环 HTTP 测试使用获准的执行权限；没有将 EPERM 归为业务缺陷或跳过失败测试。

## 没有执行

真实 PostgreSQL 多连接压力与锁等待；真实 Redis；完整 baseline E2E；浏览器多标签、HTTPS/Cookie 与视觉验收；生产镜像构建；本轮依赖漏洞审计；云库验收；生产迁移/部署。它们的验收条件在 findings.md 中，不应从成功测试列表中推断为已经完成。

## 2026-09-16：成交聊天增量验证

- 后端 `npm run build && npm run test:domains && npm run test:migrations && npm run schema:catalog-check`：构建通过，38 项测试通过，10 个迁移/51 表通过。
- 修改最终护栏后 `node --import tsx --test test/architecture.test.ts test/chat-trade.test.ts`：14 项通过；`node --import tsx test/research-production.test.ts` 通过；`git diff --check` 通过。
- 前端 `npm test && npm run build`：7 项通过，tsc/Vite 构建通过。首次新增测试因测试转译默认 ES5 导致 Error 子类 instanceof 失败；测试 target 改为与生产相容的 ES2020 后通过。
- 未运行真实 PostgreSQL 多连接、浏览器 E2E、云库迁移；Python 无本轮变更，沿用前轮记录，不计为本轮重新验证。

## 2026-09-16：普通问答与分页增量

- 后端 `npm run test:domains`：42项通过；迁移测试及目录核验仍为10迁移/51表通过。
- 后端最终 build、research-production.test.ts、git diff --check 通过。
- 前端最终 `npm test && npm run build`：8项通过；VueUse 注释与约2.445MB包体积告警仍在。
- 新增普通问答重复生成竞态、回执重放、生成失败和两种写入失败回滚、分页完整性/游标/跨用户隔离、清空保留回执测试；实际前端历史读取函数乱序和身份/股票切换测试。
- 模型端口使用替身，未发出真实LLM请求；未做真实数据库并发、查询计划/容量或浏览器验收。

## 2026-09-16：日线导入增量

- `npm run build && npm run test:domains`：构建及44项通过。
- 最终细化负例，避免重复键提前拒绝而遮挡数值校验；`node --import tsx --test test/global-review-regressions.test.ts` 8项通过，`git diff --check`通过。
- 用全部10个迁移建立本机PGlite日线表，验证同批第二行失败撤销首行更新、无关日期保留、重复导入不新增行。顺序写入已检查，不声称真实数据库多连接无死锁。
- 保留原接口内部令牌中间件；未测试真实供应商传输。Python生产者字段逐项核对，无Python修改。本次未改变迁移，迁移10/51结果沿用本轮前述记录。

## 2026-09-16：新闻、龙虎榜与预测导入

- `npm run build && npm run test:domains && node --import tsx test/research-production.test.ts`：构建、53项领域测试、生产门禁通过。
- 最终补强龙虎榜第二行失败回滚、新闻发布时间冲突及预测周期排序断言后：`node --import tsx --test test/ingestion.test.ts && git diff --check` 9项通过、差异检查通过。
- Schema负例在仓储/批准调用前拒绝；实际迁移表测试回滚、重复导入不增行、HTTP内部令牌与400/409。范围与限制见 ingestion-2026-09-16.md。
- 前端/Python/迁移无本次变更，未重跑其套件；无真实多连接、供应商或云环境验证。

## 2026-09-17：预测回执与查询边界

- 前序测试会话不可读取，重新执行 `node --import tsx --test test/ingestion.test.ts`：15项通过。
- 最终 `npm run build && npm run test:domains && node --import tsx test/research-production.test.ts && git diff --check`：构建、59项领域测试、生产门禁、空白检查通过。
- 本轮迁移测试及catalog-check：11迁移/52表，旧库升级与回滚夹具通过；全部为隔离本机PGlite。
- 回执插入失败回滚、提交后响应丢失重放、排队请求重复提交、旧运行无回执、未知来源基线、同日/跨日迟到与三种数据库时区测试通过。排队请求不是真实多连接。
- 未执行云库迁移、部署或真实供应商/浏览器验证。

## 2026-09-17：行情同步增量

- build和领域61项通过；Python test_global_review.py针对性4项通过；git diff --check通过。
- 覆盖整批坏点零写入、同日/跨日乱序、重复时刻409、未知股票、滚动写入失败回滚、生产者观测与生成时间区分。
- 无迁移或前端改动，未重跑其套件；未执行完整Python、真实多连接、供应商或云库验收。

## 2026-09-17：行情同步增量

- build和领域61项通过；Python test_global_review.py针对性4项通过；git diff --check通过。
- 覆盖整批坏点零写入、同日/跨日乱序、重复时刻409、未知股票、滚动写入失败回滚、生产者观测与生成时间区分。
- 无迁移或前端改动，未重跑其套件；未执行完整Python、真实多连接、供应商或云库验收。

## 2026-09-17：预测回执与查询边界

- 前序测试会话不可读取，重新执行 `node --import tsx --test test/ingestion.test.ts`：15项通过。
- 最终 `npm run build && npm run test:domains && node --import tsx test/research-production.test.ts && git diff --check`：构建、59项领域测试、生产门禁、空白检查通过。
- 本轮迁移测试及catalog-check：11迁移/52表，旧库升级与回滚夹具通过；全部为隔离本机PGlite。
- 回执插入失败回滚、提交后响应丢失重放、排队请求重复提交、旧运行无回执、未知来源基线、同日/跨日迟到与三种数据库时区测试通过。排队请求不是真实多连接。
- 未执行云库迁移、部署或真实供应商/浏览器验证。

## 2026-09-16：新闻、龙虎榜与预测导入

- `npm run build && npm run test:domains && node --import tsx test/research-production.test.ts`：构建、53项领域测试、生产门禁通过。
- 最终补强龙虎榜第二行失败回滚、新闻发布时间冲突及预测周期排序断言后：`node --import tsx --test test/ingestion.test.ts && git diff --check` 9项通过、差异检查通过。
- Schema负例在仓储/批准调用前拒绝；实际迁移表测试回滚、重复导入不增行、HTTP内部令牌与400/409。范围与限制见 ingestion-2026-09-16.md。
- 前端/Python/迁移无本次变更，未重跑其套件；无真实多连接、供应商或云环境验证。

## 2026-09-17：行情同步增量

- build和领域61项通过；Python test_global_review.py针对性4项通过；git diff --check通过。
- 覆盖整批坏点零写入、同日/跨日乱序、重复时刻409、未知股票、滚动写入失败回滚、生产者观测与生成时间区分。
- 无迁移或前端改动，未重跑其套件；未执行完整Python、真实多连接、供应商或云库验收。

## 2026-09-17：预测回执与查询边界

- 前序测试会话不可读取，重新执行 `node --import tsx --test test/ingestion.test.ts`：15项通过。
- 最终 `npm run build && npm run test:domains && node --import tsx test/research-production.test.ts && git diff --check`：构建、59项领域测试、生产门禁、空白检查通过。
- 本轮迁移测试及catalog-check：11迁移/52表，旧库升级与回滚夹具通过；全部为隔离本机PGlite。
- 回执插入失败回滚、提交后响应丢失重放、排队请求重复提交、旧运行无回执、未知来源基线、同日/跨日迟到与三种数据库时区测试通过。排队请求不是真实多连接。
- 未执行云库迁移、部署或真实供应商/浏览器验证。

## 2026-09-16：新闻、龙虎榜与预测导入

- `npm run build && npm run test:domains && node --import tsx test/research-production.test.ts`：构建、53项领域测试、生产门禁通过。
- 最终补强龙虎榜第二行失败回滚、新闻发布时间冲突及预测周期排序断言后：`node --import tsx --test test/ingestion.test.ts && git diff --check` 9项通过、差异检查通过。
- Schema负例在仓储/批准调用前拒绝；实际迁移表测试回滚、重复导入不增行、HTTP内部令牌与400/409。范围与限制见 ingestion-2026-09-16.md。
- 前端/Python/迁移无本次变更，未重跑其套件；无真实多连接、供应商或云环境验证。
