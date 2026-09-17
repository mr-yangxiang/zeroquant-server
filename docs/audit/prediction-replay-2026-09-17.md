# 预测回执、北京时间查询与迟到数据证据（2026-09-17）

| 代码位置 | 当前行为与验证 | 剩余边界 |
| --- | --- | --- |
| [prediction-receipt.ts:17](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction-receipt.ts:17) | 对已校验规范化DTO计算稳定SHA-256；对象键顺序不影响摘要；相同runId不同内容409 | 摘要覆盖被接纳的DTO字段，不包含被忽略的顶层字段；未来修改规范化规则需兼容v1摘要 |
| [prediction.service.ts:7](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction.service.ts:7) | 同内容先回放原回执，不重新请求批准；锁内再次检查，避免并发预读取竞态 | 已存回执仅证明写入结果，不授予实时交易资格；读取重新核验门禁 |
| [prediction.repository.ts:14](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction.repository.ts:14) | 运行/周期/曲线/回执同事务；回执写入失败全部回滚；提交成功但响应丢失后原编号重放 | PGlite单连接排队不证明真实PostgreSQL多连接锁等待；回执保留期尚未定义 |
| [prediction.repository.ts:43](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction.repository.ts:43) | 同股票日基线写入跨日期串行；更旧或同时间运行只归档，不替换较新基线；较早交易日不覆盖股票级预测区间 | 无完整来源旧基线保留不覆盖；旧运行无回执仍409；其他写入入口未统一这一锁协议，G03仍开放 |
| [prediction-reader.repository.ts:12](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction-reader.repository.ts:12) | asOf日期截止到北京时间次日00:00，SQL显式Asia/Shanghai；UTC/纽约/上海三种数据库时区结果一致 | 未提供asOf时仍查询最新记录；同asOf按created_at/runId确定排序，基线采用先到保留策略 |
| [prediction-query.service.ts:4](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction-query.service.ts:4) | 读取移出旧路由；无效日期/数组/股票代码400，空结果200/null；每次读取重新核验actionable | 画像查询/刷新仍在旧路由；真实浏览器联调未执行 |
| [011_prediction_receipts.ts:3](/Users/yx/mine/project/zeroquant-server/src/migrations/011_prediction_receipts.ts:3) | 新增prediction_ingestion_receipts，不回填无法证实的旧摘要；FK限制删除原运行；11迁移/52表目录通过 | 仅本机隔离库执行；未运行云库迁移；上线须先迁移011，禁止误称已经部署 |
| [ingestion.test.ts:140](/Users/yx/mine/project/zeroquant-server/test/ingestion.test.ts:140) | 15项定向测试通过：摘要、故障、重放、迟到、旧数据、查询边界及HTTP | 旧测试会话结果不可读取后重新执行；以重跑通过为准 |

## 验证与状态

- 最终构建、领域59项、生产门禁测试和git diff --check通过。
- 迁移回归：11个迁移、52表、旧库升级和回滚夹具通过；没有新增后续迁移改动。
- 前端/Python本轮无改动，未把旧测试算成重跑。G02仍部分完成：嵌套快照语义、投影业务拆分、画像查询/刷新和真实并发/供应商验收开放。
- baselineApplied表示这次提交是否替换了日基线，不代表股票级摘要一定更新，也不代表预测可执行。

未推送、未部署、未修改云库。
