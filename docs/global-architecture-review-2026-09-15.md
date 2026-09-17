# 全局架构与安全复查（2026-09-15）

> 后续逐项复核以 [80 项证据表与全项目文件清单](./audit/README.md) 为准。下文是前一轮阶段性记录，不能据此宣称 80 项或全局审查完成。

## 当前结论

本轮完成了认证、持仓、行情读取三个领域的分层及若干跨模块安全修复。**不等于全站分层完成，不等于已经部署，也不等于量化模型达到实盘门槛。**

此前仅新增 Python 内部只读服务，没有解决旧 Node 入口里的 Fat Controller。此次不再以“增加 Python 文件夹”代替 Node 业务改造。

检查覆盖：启动入口、认证/用户/行情/聊天/量化导入路由、数据库配置与迁移、结构目录、调度与画像代码的异常/数据访问边界、前端登录与聊天渲染、依赖及已有回归测试。不是对全部算法逐行正确性的证明。

## 1. 已实施

| 范围 | 改动 | 验证或边界 |
| --- | --- | --- |
| 认证分层 | auth.routes / controller / service / user.repository / register.schema / password.service / token.service | Service 可离开 Express 测试，路由无认证 SQL |
| 并发注册 | 直接 INSERT，以 phone 唯一索引和 ON CONFLICT 裁决；已知 23505 归类 | phone 唯一约束在原迁移 001 和实体目录中已经存在；启动时另做实际结构核验 |
| 注册原子性 | 用户、会话、刷新摘要同一事务；签发失败回滚 | 不再存在用户创建成功但会话写入失败的半成功 |
| 输入与口令 | 大陆手机号规范化、昵称 2～32 字符且无空白；新密码至少 15 字符、最多 72 UTF-8 字节；密码不 trim | 旧短密码登录仍允许；既有不规范手机号不擅自改写 |
| 认证配置 | 密钥、bcrypt 成本、访问/刷新期限集中；不再随机临时 JWT 密钥 | 默认访问令牌 900 秒，刷新会话绝对上限 30 天 |
| 刷新/退出 | 随机刷新凭据仅存摘要；每次轮换；已用凭据重放撤销本会话；访问请求检查会话撤销状态 | 不是无状态 JWT；数据库不可用不能放行 |
| 多设备 | 每次登录独立会话，可列出与撤销自己的会话 | 后端接口已实现，前端多设备管理页面尚未增加 |
| 访问控制 | HS256 算法/issuer/audience 固定；载荷移除手机号昵称；移除 phone 回退身份 | 旧无 sid 的 30 天令牌将失效，必须重新登录 |
| 反滥用 | PostgreSQL 共享 IP/手机号速率桶；bcrypt 每进程并发上限；请求体大小限制 | 不是验证码/短信所有权验证；生产默认关闭注册，启用必须有邀请码 |
| 统一错误 | AppError、业务 code、requestId、安全日志、Express 4 async 转发 | 未分类异常不回显原文；旧量化部分仍使用历史错误契约 |
| 持仓 | 控制器/服务/仓储分离，聊天录入共用同一服务 | 没有真实下单功能 |
| 并发持仓 | SET_POSITION 与成交共用锁；返回本事务 INSERT 行；撤销统一锁序 | 撤销检查最新记录和结果快照，拒绝覆盖事后更正的持仓 |
| 行情 | 列表、历史、复盘、股东查询分离；显式字段映射；日期和分页校验 | 多表复盘用 REPEATABLE READ READ ONLY；旧预测取样规则未宣称被重新校准 |
| 启动配置 | index.ts 仅启动；app.ts 组装；生产数据库必须显式配置；迁移后结构核验 | 不能仅凭 schema_migrations 有记录就放行缺表/缺索引系统 |
| 前端会话 | JWT 仅存内存；HttpOnly/SameSite Cookie 刷新；Web Locks 串行化支持该 API 的多标签页刷新 | 不支持 Web Locks 的浏览器只有单页合并；冲突可能要求重登，不能降级放行 |
| 聊天 XSS | 先转义所有 HTML，再生成有限 Markdown 标签 | 原实现 v-html 接收未经转义内容，已加恶意标签测试 |
| 图表依赖 | ECharts 6.1.0 + richText tooltip；实际页面配置做 SVG 渲染测试 | 并非浏览器视觉截图验收；真实高低点标签不再命名为预测买卖点 |
| CI | 认证/持仓/行情与架构护栏、隔离迁移测试接入后端 CI | 保留原 Python 和生产门禁测试 |

用户名明确允许重复，它是昵称，不是登录标识；因此没有无依据新增 username UNIQUE。重复注册仍可通过返回结果推断存在性，通用文案只能降低信息暴露，**不声称消除了账号枚举**。彻底匿名注册需另设计短信/邮箱确认流程。

## 2. 对“80 项问题”的处理范围

- 1～5、15～19、23～29、47～61、74～80：认证领域已按职责拆分，映射/配置/密码/令牌封装完成；旧其他领域不借此冒充已全部完成。
- 6～8：用已存在的数据库唯一性裁决竞争，已知唯一键异常分类；没有重复创建同义索引。
- 9～14、71～73：Schema、口令字节上限、参数化成本与负载限制已实现。
- 20～22：短期访问、刷新轮换、撤销、独立设备会话后端已实现，设备管理 UI 待补。
- 30～42：新的统一异常和日志链路已落地；外部/旧量化错误仍须逐域迁移，完整可观测平台不是本轮交付。
- 43～46：新增认证工作单元；昵称允许重复；手机号唯一；不凭想象增加钱包/角色表。
- 62～66：入口职责已收敛，并为新领域增加结构护栏；团队协作收益不能靠目录数量保证。
- 67～70：共享限流及默认关闭/受邀注册已落地；短信验证码、人机校验、账号枚举匿名流程**尚未实现**，不能按“全修好”勾选。

## 3. 文件位置

```text
src/index.ts                       # 进程启动、迁移与结构核验
src/app.ts                         # HTTP 组合根
src/config/                        # 认证与数据库配置
src/shared/                        # 业务错误、脱敏日志、HTTP、事务工作单元
src/modules/auth/                  # 认证完整链路
src/modules/portfolio/             # 持仓与成交记录
src/modules/market/                # 行情读取与复盘统计
src/legacy-routes.ts               # 尚待迁出的聊天与旧行情写入
src/quant-routes.ts                # 尚待迁出的量化导入与查询
src/database/entities/auth.entities.ts
src/migrations/009_auth_sessions.ts
test/auth-portfolio.test.ts
test/architecture.test.ts
```

新增认证表：auth_sessions、auth_refresh_tokens、auth_rate_limits。完整实体目录由 47 表扩为 50 表，迁移由 8 个扩为 9 个；Python model_artifacts 映射不因此扩为全表 ORM。

## 4. 部署前必需配置与兼容变化

**此次尚未 push、部署或修改云库。前后端须协调发布，不能只更新一端。**

使用服务器秘密管理/受限环境文件配置，不把真实值贴到聊天或提交 Git：

| 配置 | 要求 |
| --- | --- |
| NODE_ENV | 线上 production |
| DATABASE_URL | 显式指向实际 PostgreSQL；禁止依赖开发回退 |
| JWT_SECRET | 至少 32 字节高熵随机值，不可使用示例占位值 |
| ZEROQUANT_INTERNAL_TOKEN | 生产至少 32 字节，量化写入使用独立凭据 |
| ZEROQUANT_PUBLIC_ORIGIN | 前端真实 HTTPS origin，不含路径、尾斜杠 |
| ZEROQUANT_AUTH_COOKIE_PATH | 默认 /zeroquant/api/v1/auth；若外部代理前缀不同必须对应调整 |
| ZEROQUANT_REGISTRATION_ENABLED | 默认 false；确认受邀注册需求后才设 true |
| ZEROQUANT_REGISTRATION_INVITE | 生产启用注册时至少 32 字节；邀请码不是手机号验证 |
| ZEROQUANT_TRUST_PROXY | 只填真实可信反代 IP/CIDR；配合封闭后端直连入口，不能信任任意来源 |
| JWT_ACCESS_SECONDS | 默认 900，允许 60～3600 秒 |
| JWT_REFRESH_SECONDS | 默认 2592000，允许 3600～2592000 秒，轮换不延长会话绝对期限 |
| BCRYPT_ROUNDS | 默认 12，范围 10～14；上线前压测 |
| ZEROQUANT_DB_POOL_MAX | 默认每进程 10，范围 1～50；多实例须累计数据库连接预算 |

注册响应现在为 201 Created；成功仍是 code=0、data.token、data.user。
写入认证端点需要 X-ZeroQuant-Client: web；刷新凭据只通过 Cookie，不包含在 JSON。
GET /api/v1/system/quant-status 改为内部令牌保护。
未定义的旧短密码不强制修改，但新注册采用新策略。
历史无会话的旧 JWT 一律失效；不能为了“无感升级”恢复 phone 回退身份。
行情 advanced-history 单次只支持一个交易日；不再静默忽略不同 endDate。
数据库升级只运行已审核迁移，不使用 schema:sync 或临时自动补字段；009 不自动 down 删除认证证据。

## 5. 验证命令与实际边界

后端：
```bash
npm ci
npm run build
npm run schema:catalog-check
npm run test:domains
npm run test:migrations
node --import tsx test/research-production.test.ts
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=quant_engine .venv-service/bin/python -m unittest discover -s quant_engine/service_tests -q
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=quant_engine .venv-research/bin/python -m unittest discover -s quant_engine/tests -q
```

前端：
```bash
npm ci
npm test
npm run build
npm audit
```

2026-09-15 中断恢复后重新验证：新增领域/结构测试 21 项全部通过；前端安全和实际图表配置测试 3 项全部通过；9 个隔离迁移、50 张表实体目录、008 兼容和生产门禁检查通过；Python 服务 15 项、研究 60 项全部通过。前后端构建和 git diff --check 均通过。

首次回归的 Node HTTP 和 Python 进程冒烟测试被执行沙箱禁止绑定本机端口（EPERM）；允许回环监听后完整重跑通过，未跳过测试。前端构建仍报告产物大于 500 kB 的体积警告；Python 测试仍有 Starlette/httpx 弃用提示，这些不影响此次测试结果，但需要后续处理。

PGlite 是单连接 PostgreSQL/WASM，测试队列不证明真实多实例并发锁等待。本机 Docker daemon 未运行，尚未跑真实 PostgreSQL 多连接压力测试、全套 baseline E2E 或浏览器 Cookie 交互/视觉验收。CI 增加的是可重复的隔离测试，不是实盘模型验收。

## 6. 仍需继续，而非已经完成

1. 将 legacy-routes 的聊天上下文、LLM 客户端、聊天持久化、旧行情写入拆成独立领域；消息写入与成交录入的跨步骤失败/重试语义、幂等键仍需专项设计。
2. 将 quant-routes 的批量导入校验/服务/仓储继续分离；当前 async 拒绝、原始异常日志与内部凭据比较已加固，不代表批量导入业务彻底重构。
3. 画像引擎与 Python Warehouse 仍混合业务编排和数据访问；沿现有 PIT/幂等测试逐域迁移，不一次替换全部存储语义。
4. 调度器仍以脚本退出码表示执行成功，有跳过/执行混淆、统一 55 秒超时、进程内锁与跨实例重复执行等历史问题；不把 SUCCESS 解释为有效预测。
5. 认证会话/刷新摘要的到期清理及保留周期、手机验证/人机校验、密钥轮换、异常登录告警、忘记密码与设备管理 UI 仍需完善。速率桶已有过期小批清理；不能把它说成会话清理已完成。
6. 真实 PostgreSQL 多连接验收、反代 IP/Cookie/HTTPS 联调、页面端到端验收及容量压测。
7. 多年合法授权数据、正式模型推理接入、严格样本外验证、校准和持续影子交易；工程重构本身不提升已验证预测准确率。

依据：[OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[认证建议](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)、[PostgreSQL 唯一性约束](https://www.postgresql.org/docs/16/ddl-constraints.html)、[ECharts 6.1 修复说明](https://github.com/apache/echarts/releases/tag/6.1.0)。
