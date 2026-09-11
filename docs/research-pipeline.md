# 真实数据 → 研究候选 → 影子验证：部署与验收手册

本管道不会向券商下单。**能训练出文件、回测盈利、或把状态写成 `CHAMPION`，都不等于具备生产资格。** 当前不提供绕过证据的强制晋级命令；页面保持研究观察，直到正式生产适配和验收完成。

固定股票池：000572、600362、600839、601899、603366、603696。不使用 MD 文档代替历史行情、真实新闻和成交数据；MD 经验只能作为待检验假设。

## 1. 文件与表的位置

| 文件 | 职责 |
|---|---|
| `quant_engine/research_pipeline.py` | 命令行入口 |
| `quant_engine/zeroquant/research/ingestion.py` | Tushare 分日回填、公开近期采集、授权导出导入 |
| `quant_engine/zeroquant/research/data.py` | 原始版本、数据质量、时间点一致特征和标签 |
| `quant_engine/zeroquant/research/training.py` | 三模型、滚动样本外、概率校准、消融、冻结最终留出集 |
| `quant_engine/zeroquant/research/backtest.py` | 冻结样本外信号的含成本历史重放 |
| `quant_engine/zeroquant/research/execution.py` | 成交约束、实时影子账本、晋级证据检查 |
| `quant_engine/zeroquant/research/shadow.py` | 已注册候选模型实时推理、数据库事务写入 |
| `quant_engine/zeroquant/research/warehouse.py` | 数据库访问与幂等入库 |
| `src/migrations/006_research_pipeline.ts` | 新增五张证据表，不支持自动删除回滚 |
| `src/migrations/007_repair_l2_created_at.ts` | 修复旧库遗漏的盘口创建时间字段，回滚不删除基准字段 |
| `src/migrations/catalog.ts` | 生产迁移与隔离测试共用的 001–007 迁移清单 |
| `src/database/entities/research.entities.ts` | 全部研究相关表、字段与约束清单 |
| `src/research-production.ts` | 服务端生产授权与信号时效检查 |

完整数据库预期结构共 **47 张表**，都位于 `src/database/entities/`。迁移 006 新增：

- `research_raw_records`：原始内容版本、事件时间、首次可用时间、实际采集时间和内容哈希。
- `research_datasets`：数据集版本、质量清单和内容哈希。
- `research_runs`：实验执行结果。
- `research_shadow_state`：模型与成本绑定的可恢复影子账本。
- `model_promotions`：生产批准证据及撤销状态。本次不会写入虚假批准。

原有 `minute_bars`、`news_articles`、`order_book_snapshots` 等仍用于业务访问；研究只从不可变原始版本重新构建，避免业务表修订导致未来信息泄漏。龙虎榜源缺少真实披露时间或排名时只保留原始记录，不编造字段塞进业务表。

## 2. 准备环境与核实数据库

在后端服务器运行。以下示例目录为 `/usr/local/zeroquant-server`；本机对应 `/Users/yx/mine/project/zeroquant-server`。

```bash
cd /usr/local/zeroquant-server
python3.11 -m venv .venv-research
.venv-research/bin/pip install -r quant_engine/requirements-research.txt
npm ci
npm run build
npm run schema:catalog-check
PYTHONPATH=quant_engine .venv-research/bin/python -m unittest discover -s quant_engine/tests -v
node --import tsx test/research-production.test.ts
```

macOS 的 LightGBM 需要 OpenMP，缺失时安装 `brew install libomp`；Linux 应由运维通过系统包安装 `libgomp1`。不要把整个虚拟环境、数据集、模型大文件提交到 Git。

数据库凭据使用服务器已有 `.env`、受控环境变量或权限为 0600 的 `PGPASSFILE`，不要放进命令历史或文档。远端连接默认要求 TLS；生产优先使用可验证证书的 `verify-full`。不要为远端数据库禁用 TLS。经过验证的本机 SSH 隧道可按本地安全策略配置连接。

先只读审计，确认目标库正确并完成备份，再运行迁移：

```bash
.venv-research/bin/python quant_engine/research_pipeline.py audit --database
npm run migrate:status
# 以下命令会修改数据库结构，仅在确认目标库、备份完成后执行。
npm run migrate:up
npm run schema:verify
.venv-research/bin/python quant_engine/research_pipeline.py audit --database
```

审计失败不代表库是空的；只代表尚未读取到内容。若 TCP 可连接但 PostgreSQL 协议握手超时，应检查监听地址、Docker 端口映射、安全组、主机防火墙及代理，不能靠反复改密码解决。不要关闭全局防火墙；仅开放可信源 IP 或使用 SSH 隧道。

## 3. 数据权限与导入合同

现成适配器支持：Tushare 的分钟、新闻、龙虎榜与交易日历；没有 token 时明确阻止执行。

- [分钟接口](https://tushare.pro/document/2?doc_id=370)：`stk_mins`，历史分钟需要独立权限；不是免费日线权限的延伸。
- [历史新闻](https://tushare.pro/document/2?doc_id=143)：`news`，当前适配 `cls`，按小时取窗口，触及返回上限会报错，不把截断当完整。
- [龙虎榜机构明细](https://tushare.pro/document/2?doc_id=107)：`top_inst`，不从营业部名称推断隐蔽账户身份。
- 真实 Level-2：需要交易所授权的数据服务或合法导出。普通行情五档不能仅因为有五档就标成真实 Level-2，授权和来源须人工核验。当前只接收多档快照；逐笔委托事件、逐笔成交和队列重放适配仍待供应商协议确定。

公开采集是补充，不是历史数据采购的替代：

```bash
.venv-research/bin/python quant_engine/research_pipeline.py collect
# 仅在审计和迁移通过后加 --database，才会向数据库写入。
```

新闻源是“尽力采集”：东财公告、Google News RSS、GDELT，可选 Finnhub；不保证覆盖全球全部新闻、零延迟或历史全量。情绪仍为可消融的词典特征，不宣称大模型理解正确率。

**三个时间必须分开：** `event_at` 事件发生时间；`available_at` 该版本首次可获取时间；`ingested_at` 本系统实际采集时间。今天下载去年行情，默认只能从今天起使用，不能把下载时间改成去年冒充严格历史 PIT。

`research-contracts.example.json` 默认全部未核验。只有供应商证明历史版本、发布时序和修订规则后，才可在受控配置中启用 `availability_verified` 并填写 `evidence_reference`。启用后，每条导入记录还必须提供真实 `available_at`，不得直接照抄 `event_at`。Tushare 常规响应不包含这样的逐条证据，所以标准回填默认不认证历史可用时间；要取得证据或使用经过核验的导出适配后再训练严格 PIT 模型。

授权导出格式为 JSONL，每行一个对象，顶层字段：

```json
{
  "kind": "minute",
  "stock_code": "000572",
  "source": "供应商合同中登记的来源名",
  "event_at": "供应商真实带时区的事件时间",
  "available_at": "供应商证明的首次可获取时间",
  "payload": {
    "open": "真实开盘价", "high": "真实最高价", "low": "真实最低价", "close": "真实收盘价",
    "volume": "真实股数", "amount": "真实成交额",
    "volume_unit": "shares", "price_basis": "unadjusted",
    "upper_limit": "当日实际涨停价", "lower_limit": "当日实际跌停价"
  }
}
```

这是字段说明，不是可导入假数据。将文字占位符替换为供应商真实数字和 ISO 时间。分钟统一为已结束 K 线 09:31–11:30、13:01–15:00；集合竞价单独处理，不补午休、不用价格插值填缺口。

其他 payload：

- 新闻：`title`、可选 `content/url`、`sentiment`（-1 至 1）、`relevance`（0 至 1）。
- 龙虎榜：`seat_name`、`side`（BUY/SELL）、`buy_amount/sell_amount/net_amount`；写入旧业务表还需真实 `trade_date/rank/disclosed_at`。
- Level-2：`level: 2`、`bids/asks`（至少五档 `[价格, 数量]`），必须来自已核验授权源。
- 日历：`stock_code: MARKET`、`payload.is_trading_day` 为布尔值。

## 4. 回填、质量和数据集

请先小范围验证权限和字段，不要直接启动多年下载：

```bash
.venv-research/bin/python quant_engine/research_pipeline.py backfill --start 2026-09-01 --end 2026-09-03 --output quant_engine/research_artifacts/backfill-smoke
# 小窗口核验通过后，才扩大范围；示例输出按日保存并支持断点恢复。
.venv-research/bin/python quant_engine/research_pipeline.py backfill --start 2023-01-01 --end 2026-09-09 --database --output quant_engine/research_artifacts/backfill

# 对带有真实 PIT 时间证据的授权导出：
.venv-research/bin/python quant_engine/research_pipeline.py import --input /安全目录/真实导出.jsonl --contracts /安全目录/已核验合同.json --database

.venv-research/bin/python quant_engine/research_pipeline.py quality --database --start 2023-01-01 --end 2026-09-09 --output quant_engine/research_artifacts/quality
.venv-research/bin/python quant_engine/research_pipeline.py dataset --database --start 2023-01-01 --end 2026-09-09 --horizon 15 --output quant_engine/research_artifacts/dataset-v1
```

质量检查至少要求每只股票 504 个交易日，并检查分钟完整性、时间证据、版本冲突、日历、历史 Level-2 覆盖、缺失源。停牌或供应商修订应通过证据处理，目前保守判为未通过，不能手改 `production_ready`。

2026-09-11 修复后的质量策略为 `pit_coverage_v2`：

- 分钟完整性按明确的 `as_of` 检查。已完成交易日要求 240 分钟；盘中仅要求已闭合且超过 60 秒到达宽限的分钟，午休不补分钟。尚未结束的当日不计入 504 个完整历史日。
- `promotion-check` 另外要求评估当日的明确交易日历；不猜测开市状态。未来事件或尚未实际采集的记录不参与本次质量统计。
- Level-2 不再只检查“每天有记录”：与特征生成共享决策时间及 31 根分钟历史选择规则，从第 31 根分钟开始逐分钟核验。盘口必须在决策前 60 秒内发生，且当时已可用；未认证记录还必须已实际采集。
- 每只股票、每个日期的决策覆盖率至少 95%，连续缺失不超过 5 个交易分钟；报告输出覆盖率、最长缺口和使用盘口的最大可用延迟。此阈值是数据接入验收规则，不是预测准确率。
- 报告中的 `missing_minutes_by_day` 使用 0–239 的交易分钟索引：0 是 09:31，119 是 11:30，120 是 13:01，239 是 15:00。

若库里同时保存公开观察数据与已授权的严格研究数据，`quality/dataset` 使用相同的 `--sources` 来源白名单，并包括分钟、日历、新闻、席位与盘口的实际来源。未选择足够来源时质量检查仍会失败。数据源范围将冻结进数据集和模型元数据，历史成本重放、影子推理及晋级检查继续使用同一范围，避免公开延迟数据混进正式样本；更换供应商需重新建模验证。

特征包括过去 5/15 分钟收益、30 分钟波动/VWAP、成交量比、新闻情绪及缺失标记、已披露席位净额、真实盘口不平衡。先使用可验证的基础因子；复杂机构画像必须重新进行 PIT 与消融测试后纳入，不能把今后形成的画像灌入过去。

15 分钟标签是未来 15 个交易分钟收益，午休不制造成交分钟；标签成熟时间也进入训练隔离。生成结果写入 `feature_snapshots/training_labels`，冲突拒绝覆盖。完整复现文件为 `dataset.json`，其中包含标签可用时间、输入哈希和质量清单。

## 5. 训练、校准和消融

```bash
.venv-research/bin/python quant_engine/research_pipeline.py train --input quant_engine/research_artifacts/dataset-v1/dataset.json --output quant_engine/research_artifacts/candidate-v1 --database
```

默认三模型：逻辑回归、LightGBM、CatBoost。按所有股票共享的日期划分：最少 120 天训练、20 天概率校准、20 天测试、60 分钟隔离，至少三个滚动测试窗口，另冻结最后 20 天最终留出集。最低 220 个有标签交易日只是训练程序最低要求，不替代 504 天数据质量门槛。

模型和缺失值处理只在训练集拟合；温度校准只在校准集拟合；开发集比较完整特征与去新闻/去席位/去 L2 的消融；开发窗口选择模型后，只检查一次最终留出集。主评估包括 Brier、对数损失、校准误差、相对训练类别频率基准的表现，不只报方向命中率。

同一实验目录封存后，重试复用结果，换参数拒绝复用。使用 `train --database` 时还会在训练前集中登记最终留出区间；相互重叠的区间禁止换目录/换数据版本重新试验，中断登记也不会自动清除。只能取回完整原模型继续注册，或使用全新的未来留出区间。无数据库的本地实验仅供开发，不具备生产晋级资格。报告内的区间目前是训练期无条件分位数基线，不是已训练的条件价格路径模型，不能宣称精确预测全天曲线。

产物：`report.json`、各算法 `*-oos.json`、`holdout-oos.json`、`candidate.joblib`、`candidate.json`、实验封存标记。只加载本机可信来源、哈希与注册表一致的 joblib 文件，不接收用户上传的任意 pickle/joblib。

## 6. 成本和成交模拟

`research-costs.example.json` 只是示例。用真实券商交割单核对佣金、最低收费；用真实盘口和成交检验价差、滑点、冲击及参与率，并保存证据，才可启用 `broker_verified`。

```bash
.venv-research/bin/python quant_engine/research_pipeline.py backtest --database --artifact quant_engine/research_artifacts/candidate-v1 --costs /安全目录/已核验成本.json --start 2023-01-01 --end 2026-09-09 --output quant_engine/research_artifacts/candidate-v1
```

只重放被冻结的留出集信号。固定概率阈值 0.62、每单 100 股、初始资金 10 万且空仓，下一完整分钟收盘保守模拟，含 T+1、整手、现金、真实涨跌停、成交量参与率、佣金/印花税/过户费/价差/滑点/冲击。涨跌停封死或缺少当日真实限价直接拒绝成交，不虚构排队成交。

分别评估 1、2、3 倍券商与流动性成本，法定税费保持按交易日期适用。滑点和冲击已体现在成交价里，不重复从现金扣款。它仍是分钟级近似，不是真实 Level-2 委托队列模拟。期末未平仓持股按市值估值，不能冒充全部已实现收益。

历史印花税生效日参考 [上交所 2023-08-27 通知](https://www.sse.com.cn/aboutus/mediacenter/hotandd/c/c_20230827_5725662.shtml)。券商应核对过户费和佣金组成，避免将已含在佣金中的费用重复计收；本系统示例参数不能替代真实交割单和最新收费标准。

## 7. 真实时间影子交易

前提：模型通过 CLI `train --database` 注册；交易日历、当日分钟、相关新闻和盘口持续增量进入 `research_raw_records`；模型及成本文件可读取。**原有页面行情刷新不会自动补齐研究原始表。** 当前提供导入/采集命令，供应商实时授权流的常驻增量适配还需按选定协议部署；没有新数据时影子任务会等待，不补造历史成交。

在服务器 `.env` 设置实际绝对路径：

```dotenv
ZEROQUANT_PYTHON=/usr/local/zeroquant-server/.venv-research/bin/python
ZEROQUANT_RESEARCH_SHADOW_ENABLED=true
ZEROQUANT_RESEARCH_ARTIFACT_DIR=/usr/local/zeroquant-server/quant_engine/research_artifacts/candidate-v1
ZEROQUANT_RESEARCH_COSTS_PATH=/安全目录/已核验成本.json
```

按原部署方式重启后端后，每分钟运行受控任务，非连续竞价或未确认交易日不写影子成交。也可以手工执行单次检查：

```bash
.venv-research/bin/python quant_engine/research_pipeline.py shadow --database --artifact quant_engine/research_artifacts/candidate-v1 --costs /安全目录/已核验成本.json
```

模型哈希、数据集哈希、成本配置绑定账本；改模型或改成本必须新建受控候选账本，不能混合成绩。订单、成交和账本同一事务提交；重复分钟不重复下单；迟到行情不回补为“实时成交”。收益只来自真实运行时间，不靠历史回放凑 20 天。

逐股估值策略为 `per_position_marks_v1`。`research_shadow_state.state.price_marks` 保存行情来源、内容哈希、事件/可用/采集时间；`state.equity` 的每个历史点保存当时现金、持仓和独立价格证据，后续更新不会覆盖旧点。任一持仓缺价或陈旧时，仅保留明确标注的未核验估算值；报告列出 `missing_symbols/stale_symbols`，不能将别的股票更新视作该持仓行情更新。空仓账户可按现金核验，不要求无关股票报价。

晋级时对全部历史净值点按其当时的时间重新核验，并在当前评估时刻再次检查最新持仓价格。证据不合格时不输出已验证的最大回撤值。旧账本中的无逐股证据净值点不会自动补成有效证据；保留原账本供审计，使用受控的新候选验证流程，不删除旧点或重写日期来凑足验收天数。

## 8. 晋级检查与尚待完成的生产衔接

开盘 09:30–09:31:59、午后恢复 13:00–13:01:59，影子任务等待新时段首根完整分钟及 60 秒到达宽限，不写入估值或成交。否则隔夜/午休旧报价会在每天恢复时被记为陈旧净值，误伤后续整段验证；到达宽限后仍缺行情则正常按陈旧或缺失处理。

```bash
.venv-research/bin/python quant_engine/research_pipeline.py promotion-check --database --artifact quant_engine/research_artifacts/candidate-v1 --costs /安全目录/已核验成本.json --output quant_engine/research_artifacts/promotion-check
```

这只是检查，**不会升级模型或下单**。默认要求：数据和样本外验证通过、至少 3 窗口、最终留出集至少 1000 条且优于频率基准、校准误差 ≤ 0.05；成本核验和加压实验通过；至少 28 个自然日、20 个有信号且有数据的交易日、100 笔实时影子成交；净收益为正、回撤 ≤ 10%，以及成交账本、漂移、容量和线上特征一致性的独立验收。

当前晋级策略为 `production_v2`，服务端只认可同时包含新版质量策略与逐股估值策略的批准证据。旧 `production_v1` 批准记录保持原样，但不再作为可执行信号权限。旧训练报告没有新版质量策略标记时不能自动继承合格状态；不得手工补标记、删除实验封存或重复使用已看过的最终留出集来绕过验证。升级时按原实验登记及未来独立留出集流程处理。

这些是初始保守验收阈值，不是统计显著性或盈利保证。还需增加按日相关性分组的置信区间、市场状态/每只股票分层检验、风险预算和压力情景等生产验收。

正式上线前仍须完成：

1. 供应商历史版本证明、停牌/公司行为校验、真实委托事件与成交 tick 适配。
2. 流式增量采集及延迟监控、数据许可/留存边界核验。
3. 集中实验登记已在数据库路径实现；仍需模型制品发布、登记中断的人工审计恢复和运维签审流程。
4. 候选模型到页面预测接口的生产适配；当前研究模型是 15 分钟三分类，并非原曲线引擎的即插即用替代。上线适配必须复用相同特征、校准器，并补条件收益/区间模型，不能把无条件分位数画成“高准确度曲线”。
5. 晋级检查现已从数据库原始订单、成交及原始分钟哈希重核成交计数、价格、费用、现金和库存；仍需券商级对账、公司行为处理、自动漂移/容量报告、停止开关与回滚策略。
6. 以上通过后以受审计的发布流程写入批准记录；当前没有提供快捷晋级开关。

服务端会重新核验批准记录、模型哈希、模型状态、校准状态、行情质量和 120 秒信号期限；页面也主动让旧授权过期。无批准记录、断库、旧缓存、或自由填写 `champion` 都不能被当作生产资格。模型尚未批准时聊天返回受控研究说明，不让自由生成的确定买卖建议绕过门禁。
