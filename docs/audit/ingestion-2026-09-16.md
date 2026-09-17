# 新闻、龙虎榜及预测导入增量证据（2026-09-16）

## 本轮修复及验证

| 代码位置 | 已实现与验证 | 剩余边界 |
| --- | --- | --- |
| [evidence.schema.ts:37](/Users/yx/mine/project/zeroquant-server/src/modules/profile-evidence/evidence.schema.ts:37) | 龙虎榜整批检查真实日期、带时区时间、整数排名、金额和文本；拒绝重复自然键；负例在仓储调用前拒绝 | 省略买/卖金额沿用0默认，显式null或非法值拒绝；披露真实性与供应商时序不由解析证明 |
| [evidence.schema.ts:56](/Users/yx/mine/project/zeroquant-server/src/modules/profile-evidence/evidence.schema.ts:56) | 新闻文本和关联数量上限、严格评分、HTTP(S) URL、指纹格式与同批重复校验 | 同一新闻关联多股票需在一条records中用stocks数组提交；同批重复指纹拒绝 |
| [evidence.repository.ts:5](/Users/yx/mine/project/zeroquant-server/src/modules/profile-evidence/evidence.repository.ts:5) | 按键排序后整批事务；新闻RETURNING空结果明确冲突；同指纹来源/发布时间不符409；新闻关系失败回滚文章、龙虎榜第二行失败撤销首行更新 | 新闻关系为增量upsert，不删除本次未列出的旧关系；更新不构成不可变PIT历史；真实多连接锁行为未验收 |
| [prediction.schema.ts:12](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction.schema.ts:12) | 严格UUID、日期、数值/布尔；非重复正整数周期；概率和与置信度；必填且有序分位数；完整验证曲线，不跳过坏点；按周期排序 | regime/newsEvents嵌套语义还未完全约束；曲线缺lower/upper时沿用价格，缺leadMinutes保留null；时序/供应商真实性尚待核验 |
| [prediction.repository.ts:6](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction.repository.ts:6) | 运行/周期/基线或实时曲线同事务；运行编号锁及日基线键锁；重复runId明确409；故障回滚通过 | 尚无全正文回执比较与相同请求成功重放；日基线迟到覆盖策略未完成；仓储仍含投影计算，需进一步迁出纯业务逻辑 |
| [quant-routes.ts:87](/Users/yx/mine/project/zeroquant-server/src/quant-routes.ts:87) | 组合根保留forecastSignalEligible与数据库productionApproved门禁；内部令牌中间件保留 | 最新预测读取与画像查询/刷新仍在旧路由，日期/时区及旧错误契约待修复 |
| [ingestion.test.ts:31](/Users/yx/mine/project/zeroquant-server/test/ingestion.test.ts:31) | 三组Schema负例及PGlite故障/HTTP契约，新增共9项；最终定向重跑通过；完整领域53项通过 | 隔离单连接不是真实多连接；HTTP仅本机夹具，不连接云端 |

## 验证命令

- `npm run build && npm run test:domains && node --import tsx test/research-production.test.ts`：构建、53项领域测试、生产门禁回归通过。
- 最终补强断言后 `node --import tsx --test test/ingestion.test.ts && git diff --check`：9项通过、差异空白检查通过。
- 未改前端/Python/迁移，不把此前前端8项、迁移10/51等结果计为本次重跑。数据库故障测试使用全部10个迁移创建夹具。

本轮没有推送、部署、云库迁移或外部供应商请求。G02保持部分完成，80项状态计数不变。
