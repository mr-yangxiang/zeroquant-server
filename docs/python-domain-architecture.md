# Python 量化服务分层改造

## 本轮范围与边界

本轮已增加一个可运行的内部只读 Python 服务，按研究状态、模型登记两个业务领域分层。不是全项目迁移完成，也没有替换线上 Node.js API、量化任务、旧 psycopg Warehouse 或模型预测入口。

技术：Python 3.11、FastAPI、Pydantic 2、SQLAlchemy 2、PostgreSQL、可选 Redis。

```text
quant_engine/quant_api/
  app.py                         # 工厂与资源生命周期，不运行任务
  api/router.py                  # HTTP、请求参数、响应 DTO
  api/dependencies.py            # 内部鉴权、每请求会话、依赖装配
  domains/
    research/
      schemas.py                 # 研究统计契约
      service.py                 # 状态解释、短时诊断缓存
      repository.py              # SQLAlchemy 只读统计
    model_registry/
      schemas.py                 # 对外模型登记契约
      service.py                 # 分页与领域语义
      repository.py              # SQLAlchemy ORM 查询
      entities.py                # model_artifacts 完整字段映射
  shared/
    settings.py                  # 显式配置、秘密字段、PostgreSQL 驱动约束
    database.py                  # 连接池、每请求只读事务
    contracts.py                 # 基础设施接口，Service 不依赖 Redis 实现
    cache.py                     # Redis 诊断缓存；不用作事实库
```

Router → Service → Repository → SQLAlchemy → PostgreSQL。Service 依赖 Repository 接口，不处理 SQL 或 HTTP。Redis 仅缓存 15 秒的研究数据数量统计，响应保留观察时点和 cached 标志；不缓存模型状态、生产批准、行情、信号。缓存不可用或内容失效时回源。

## 与现有系统的关系

- Node.js 保持用户、鉴权、持仓、成交与现有前端接口的唯一所有者。
- `zeroquant/` 保持纯计算核心，后续由按领域拆分的 Service 调用；不能把计算逻辑塞进 Router 或 ORM。
- 本服务只查询已有表，绝不调用 metadata.create_all、自动迁移、训练或模型晋级。
- 50 表权威完整清单（含新增认证三表）仍在 `src/database/entities/`，唯一 DDL 入口仍为 `src/migrations/`。Python ORM 只映射本模块使用的表，不另建 Alembic 历史。
- 模型的登记 state 即使写着 champion，也不等于当前输入具备生产资格。查询响应固定标记 signal_eligibility=not_evaluated，不能替代既有生产门禁。
- 训练、回填、实时计算与持续影子运行应属于独立 worker/CLI；不使用 FastAPI BackgroundTasks 启动重计算任务。

## 本机启动（不是生产发布操作）

在后端项目根目录创建独立环境，避免升级现有研究依赖：

```bash
python3.11 -m venv .venv-service
.venv-service/bin/python -m pip install -r quant_engine/requirements-service-test.txt
PYTHONPATH=quant_engine .venv-service/bin/python -m unittest discover -s quant_engine/service_tests -v
```

使用受保护的环境配置或秘密管理工具设置以下变量，不把真实密码提交到 Git：

- `ZEROQUANT_PY_API_DATABASE_URL`：必须显式为 postgresql+psycopg:// 格式，使用只读数据库账号；默认要求 TLS。受控本机 Unix socket 如需不同连接选项应单独审核。
- `ZEROQUANT_PY_API_TOKEN`：独立的至少 32 字节随机令牌，不复用公网用户 JWT。
- `ZEROQUANT_PY_API_REDIS_URL`：可选，Redis 必须限制网络和权限；未配置时禁用缓存。

配置后，在项目根目录执行：

```bash
PYTHONPATH=quant_engine .venv-service/bin/uvicorn quant_api.app:create_app --factory --host 127.0.0.1 --port 3003 --workers 1
```

只监听本机。不要直接开放 3003 到公网。现有 Node.js 尚未增加该服务的代理或调用，启用本服务不会自动改变页面。

接口：

| 接口 | 鉴权 | 用途 |
|---|---|---|
| GET /health/live | 无 | 进程存活，不查询数据库 |
| GET /health/ready | 内部令牌 | 连接和迁移 008 前置条件；不是完整结构/模型验收 |
| GET /internal/v1/research/status | 内部令牌 | 数据与模型登记数量，不判定数据合格 |
| GET /internal/v1/models?limit=20&after=... | 内部令牌 | 模型登记列表，最多 100 条，游标分页 |

令牌放在 `X-ZeroQuant-Internal-Token` 请求头。错误响应不返回原始 SQL、连接串或凭据。数据库异常返回 503。

## 测试范围与未完成事项

新测试覆盖 FastAPI ASGI HTTP 调用、隔离 SQLite SQLAlchemy 查询、鉴权前置、分页、参数校验、故障脱敏、缓存过期/损坏/不可用、事务回滚、无启动 DDL 和基本分层依赖。另有跨语言契约测试通过 Node.js/tsx 读取权威实体目录，核对 Python ORM 的字段、类型、可空性、长度、主键及默认值；运行该测试需要已执行 npm ci。

进程冒烟测试会启动独立 Uvicorn 子进程，绑定本机随机端口，验证真实 HTTP 存活、未授权拦截及数据库不可用时的 503；结束后只终止该测试子进程。SQLite 测试不是 PostgreSQL 实例验收；Redis 故障测试使用适配器替身，不是线上 Redis 联调。

仍需逐步完成：

1. 将 `research_pipeline.py` 的业务编排提取到各领域 Service，将旧 Warehouse 按采集、数据集、实验、影子账本拆开；原有幂等、PIT 和事务测试必须保持。
2. 用 SQLAlchemy 逐模块替换旧 psycopg 数据访问，不能仅改目录或包一层接口就宣称完成。
3. 正式模型加载、统一训练/实时特征、周期与区间预测接口，以及 worker 持久化调度。
4. 真实 PostgreSQL/Redis 集成测试、Node.js 内部代理、部署配置和完整页面端到端验收。
5. 真实数据许可、样本外实验、校准与持续影子运行；架构变化不证明预测准确度。

本轮不修改 Hermes cron、不启动第二套量化调度、不重启线上服务，也不修改云库。

参考：[FastAPI 重计算任务边界](https://fastapi.tiangolo.com/tutorial/background-tasks/)、[SQLAlchemy 会话与事务](https://docs.sqlalchemy.org/en/20/orm/session_basics.html)。
