# 全项目逐文件审查清单（2026-09-17）

## 口径与边界

**所有 Git 可见文件均有条目，不等于所有文件均已通读。** 当前包括已跟踪文件和未忽略的新文件；排除 node_modules、dist、虚拟环境、.git、本地 .env、运行时数据库/状态/日志等 Git 忽略内容。用户数据与线上状态未读取。

- **通读审查**：本轮已阅读完整文件，结论限于列出的关注点；不等于数学正确性、真实并发或上线验收。
- **局部审查**：只审查列出的关键路径，其余仍待通读。
- **静态扫描，未通读**：扫描关键词并对 Python 做 AST 解析，不能算行为正确性证明。
- **元数据登记**：不把模型 JSON、历史日志或依赖锁文件的摘要当作内容审查。
- 每个条目包含路径、行数、验证结果、剩余缺口；JSON 另保存文件 SHA-256 和全部信号行号。信号只是审查线索，不是自动判定的漏洞。
- 重新扫描不会自动给文件贴上“人工通读”；人工记录绑定摘要，代码变化后自动降为“已变更待复核”。

## 覆盖统计

- 通读审查：125 个。
- 元数据登记，未通读：43 个。
- 已变更待复核：14 个。
- 审查工件：14 个。
- 静态扫描，未通读：71 个。
- 局部审查：7 个。

来源：[人工审查记录](./manual-review.json)、[机器清单](./file-review-inventory.json)、[缺口台账](./findings.md)、[验证记录](./verification.md)。

## server

| 文件 | 行数 | 审查层级 | 验证结果 | 剩余缺口 |
| --- | --- | --- | --- | --- |
| [.dockerignore](/Users/yx/mine/project/zeroquant-server/.dockerignore:1) | 15 | 通读审查 | 配置/构建输入与本轮变更全文核对；构建和相关测试通过（不是该配置每项均运行） | G11：镜像/依赖审计与线上配置验收未做 |
| [.env.example](/Users/yx/mine/project/zeroquant-server/.env.example:1) | 56 | 通读审查 | 配置/构建输入与本轮变更全文核对；构建和相关测试通过（不是该配置每项均运行） | G11：镜像/依赖审计与线上配置验收未做 |
| [.env.test.example](/Users/yx/mine/project/zeroquant-server/.env.test.example:1) | 11 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [.github/workflows/deploy.yml](/Users/yx/mine/project/zeroquant-server/.github/workflows/deploy.yml:1) | 68 | 已变更待复核 | 人工证据摘要不再匹配 | 重新审查变更，更新人工记录 |
| [.gitignore](/Users/yx/mine/project/zeroquant-server/.gitignore:1) | 18 | 通读审查 | 配置/构建输入与本轮变更全文核对；构建和相关测试通过（不是该配置每项均运行） | G11：镜像/依赖审计与线上配置验收未做 |
| [Dockerfile](/Users/yx/mine/project/zeroquant-server/Dockerfile:1) | 29 | 通读审查 | 配置/构建输入与本轮变更全文核对；构建和相关测试通过（不是该配置每项均运行） | G11：镜像/依赖审计与线上配置验收未做 |
| [README.md](/Users/yx/mine/project/zeroquant-server/README.md:1) | 112 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [docs/audit/80-point-evidence.json](/Users/yx/mine/project/zeroquant-server/docs/audit/80-point-evidence.json:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/80-point-evidence.md](/Users/yx/mine/project/zeroquant-server/docs/audit/80-point-evidence.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/README.md](/Users/yx/mine/project/zeroquant-server/docs/audit/README.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/chat-idempotency-2026-09-16.md](/Users/yx/mine/project/zeroquant-server/docs/audit/chat-idempotency-2026-09-16.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/file-review-checklist.md](/Users/yx/mine/project/zeroquant-server/docs/audit/file-review-checklist.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/file-review-inventory.json](/Users/yx/mine/project/zeroquant-server/docs/audit/file-review-inventory.json:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/findings.md](/Users/yx/mine/project/zeroquant-server/docs/audit/findings.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/ingestion-2026-09-16.md](/Users/yx/mine/project/zeroquant-server/docs/audit/ingestion-2026-09-16.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/manual-review.json](/Users/yx/mine/project/zeroquant-server/docs/audit/manual-review.json:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/market-sync-2026-09-17.md](/Users/yx/mine/project/zeroquant-server/docs/audit/market-sync-2026-09-17.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/prediction-replay-2026-09-17.md](/Users/yx/mine/project/zeroquant-server/docs/audit/prediction-replay-2026-09-17.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/production-hardening-2026-09-17.md](/Users/yx/mine/project/zeroquant-server/docs/audit/production-hardening-2026-09-17.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/research-chat-2026-09-16.md](/Users/yx/mine/project/zeroquant-server/docs/audit/research-chat-2026-09-16.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/audit/verification.md](/Users/yx/mine/project/zeroquant-server/docs/audit/verification.md:1) | — | 审查工件 | 目录登记；证据由 --check 核验 | 不属于被验证的业务代码 |
| [docs/compatibility-008-status-2026-09-13.md](/Users/yx/mine/project/zeroquant-server/docs/compatibility-008-status-2026-09-13.md:1) | 38 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [docs/entity-behavior-profiling.md](/Users/yx/mine/project/zeroquant-server/docs/entity-behavior-profiling.md:1) | 66 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [docs/global-architecture-review-2026-09-15.md](/Users/yx/mine/project/zeroquant-server/docs/global-architecture-review-2026-09-15.md:1) | 137 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [docs/global-news-pipeline.md](/Users/yx/mine/project/zeroquant-server/docs/global-news-pipeline.md:1) | 55 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [docs/python-domain-architecture.md](/Users/yx/mine/project/zeroquant-server/docs/python-domain-architecture.md:1) | 93 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [docs/research-fixes-2026-09-11.md](/Users/yx/mine/project/zeroquant-server/docs/research-fixes-2026-09-11.md:1) | 42 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [docs/research-pipeline.md](/Users/yx/mine/project/zeroquant-server/docs/research-pipeline.md:1) | 224 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [docs/research-readiness-2026-09-10.md](/Users/yx/mine/project/zeroquant-server/docs/research-readiness-2026-09-10.md:1) | 50 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [package-lock.json](/Users/yx/mine/project/zeroquant-server/package-lock.json:1) | 1862 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [package.json](/Users/yx/mine/project/zeroquant-server/package.json:1) | 44 | 已变更待复核 | 人工证据摘要不再匹配 | 重新审查变更，更新人工记录 |
| [quant_engine/alert_cooldown.json](/Users/yx/mine/project/zeroquant-server/quant_engine/alert_cooldown.json:1) | 8 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/expansion_state.json](/Users/yx/mine/project/zeroquant-server/quant_engine/expansion_state.json:1) | 31 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/generate_daily_predictions.py](/Users/yx/mine/project/zeroquant-server/quant_engine/generate_daily_predictions.py:1) | 169 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：62,95,101；异常输出（需人工核对脱敏）：82,91,100 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/knowledge_base.md](/Users/yx/mine/project/zeroquant-server/quant_engine/knowledge_base.md:1) | 184 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/knowledge_base.legacy.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/knowledge_base.legacy.md:1) | 133 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/analysis_--help.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/analysis_--help.md:1) | 48 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/analysis_2026-09-01.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/analysis_2026-09-01.md:1) | 48 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/analysis_2026-09-02.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/analysis_2026-09-02.md:1) | 48 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/analysis_2026-09-03.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/analysis_2026-09-03.md:1) | 48 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/analysis_2026-09-04.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/analysis_2026-09-04.md:1) | 48 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/prediction_runs/2026-09-04.jsonl](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/prediction_runs/2026-09-04.jsonl:1) | 36 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/prediction_runs/2026-09-06.jsonl](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/prediction_runs/2026-09-06.jsonl:1) | 6 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/prediction_runs/2026-09-07.jsonl](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/prediction_runs/2026-09-07.jsonl:1) | 1506 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/probability_analysis_2026-09-04.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/probability_analysis_2026-09-04.md:1) | 91 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/probability_analysis_2026-09-07.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/probability_analysis_2026-09-07.md:1) | 92 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/reviews/review_2026-09-04.json](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/reviews/review_2026-09-04.json:1) | 91 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/reviews/review_2026-09-04.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/reviews/review_2026-09-04.md:1) | 18 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/reviews/review_2026-09-07.json](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/reviews/review_2026-09-07.json:1) | 91 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/logs/daily_analysis_logs/reviews/review_2026-09-07.md](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/logs/daily_analysis_logs/reviews/review_2026-09-07.md:1) | 18 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/legacy/scripts/analyze_full_year.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/analyze_full_year.py:1) | 58 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：16 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/analyze_hosts.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/analyze_hosts.py:1) | 73 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：18 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/backtest_simulator.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/backtest_simulator.py:1) | 70 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：25 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/deep_research.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/deep_research.py:1) | 41 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：25,32 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/generate_opening_baseline_0920.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/generate_opening_baseline_0920.py:1) | 14 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/get_realtime_stocks.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/get_realtime_stocks.py:1) | 40 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：8 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/historical_expander.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/historical_expander.py:1) | 19 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/hourly_verifier.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/hourly_verifier.py:1) | 25 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/midnight_audit_and_predict.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/midnight_audit_and_predict.py:1) | 24 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/sampling_verifier.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/sampling_verifier.py:1) | 47 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：23 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/send_stock_email.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/send_stock_email.py:1) | 36 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/stock_report_engine.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/stock_report_engine.py:1) | 391 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：30 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/legacy/scripts/sync_official_l2.py](/Users/yx/mine/project/zeroquant-server/quant_engine/legacy/scripts/sync_official_l2.py:1) | 80 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：61；异常输出（需人工核对脱敏）：69 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/models/bootstrap_probability_v1.json](/Users/yx/mine/project/zeroquant-server/quant_engine/models/bootstrap_probability_v1.json:1) | 24 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/nightly_review.py](/Users/yx/mine/project/zeroquant-server/quant_engine/nightly_review.py:1) | 154 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：55；异常输出（需人工核对脱敏）：65 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/pytest.ini](/Users/yx/mine/project/zeroquant-server/quant_engine/pytest.ini:1) | 3 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/quant_api/__init__.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/__init__.py:1) | 1 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/api/__init__.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/api/__init__.py:1) | 1 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/api/dependencies.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/api/dependencies.py:1) | 33 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/api/router.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/api/router.py:1) | 23 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/app.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/app.py:1) | 62 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/__init__.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/__init__.py:1) | 1 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/model_registry/__init__.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/model_registry/__init__.py:1) | 1 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/model_registry/entities.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/model_registry/entities.py:1) | 32 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过；扫描定位 宽类型（不等于缺陷）：4,26 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/model_registry/repository.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/model_registry/repository.py:1) | 23 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/model_registry/schemas.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/model_registry/schemas.py:1) | 29 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/model_registry/service.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/model_registry/service.py:1) | 28 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过；扫描定位 宽类型（不等于缺陷）：3,9 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/research/__init__.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/research/__init__.py:1) | 1 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/research/repository.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/research/repository.py:1) | 22 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/research/schemas.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/research/schemas.py:1) | 36 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/domains/research/service.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/domains/research/service.py:1) | 52 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/shared/__init__.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/shared/__init__.py:1) | 1 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/shared/cache.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/shared/cache.py:1) | 50 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/shared/contracts.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/shared/contracts.py:1) | 16 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/shared/database.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/shared/database.py:1) | 54 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过；扫描定位 SQL/DDL（需判断所在层）：50 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/quant_api/shared/settings.py](/Users/yx/mine/project/zeroquant-server/quant_engine/quant_api/shared/settings.py:1) | 57 | 通读审查 | Python AST 解析通过；内部只读 API 分层/依赖/会话/配置/缓存/响应契约全文审查；Python 服务 15 项通过 | G06：PostgreSQL/Redis 真实联调；ready 仅查迁移 008；不是完整结构验收或全表 ORM |
| [quant_engine/realtime_monitor_1m.py](/Users/yx/mine/project/zeroquant-server/quant_engine/realtime_monitor_1m.py:1) | 205 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：16,94；网络调用（需核对超时/来源）：53,112,119；异常输出（需人工核对脱敏）：72,118 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/requirements-research.txt](/Users/yx/mine/project/zeroquant-server/quant_engine/requirements-research.txt:1) | 7 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/requirements-service-test.txt](/Users/yx/mine/project/zeroquant-server/quant_engine/requirements-service-test.txt:1) | 2 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/requirements-service.txt](/Users/yx/mine/project/zeroquant-server/quant_engine/requirements-service.txt:1) | 7 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/research-contracts.example.json](/Users/yx/mine/project/zeroquant-server/quant_engine/research-contracts.example.json:1) | 14 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/research-costs.example.json](/Users/yx/mine/project/zeroquant-server/quant_engine/research-costs.example.json:1) | 10 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [quant_engine/research_pipeline.py](/Users/yx/mine/project/zeroquant-server/quant_engine/research_pipeline.py:1) | 196 | 通读审查 | Python AST 解析通过；CLI 分支、显式数据库、训练/影子/晋升检查及退出路径通读；Python 回归 63 项通过；扫描定位 SQL/DDL（需判断所在层）：165；宽类型（不等于缺陷）：50；异常输出（需人工核对脱敏）：184 | G04/G08：CLI 仍直接 SQL，ValueError 原文输出与任意本地输入路径需进一步审查；未逐命令真实运行 |
| [quant_engine/service_tests/test_layered_api.py](/Users/yx/mine/project/zeroquant-server/quant_engine/service_tests/test_layered_api.py:1) | 211 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：54,55,56,155…；宽类型（不等于缺陷）：197 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/service_tests/test_schema_contract.py](/Users/yx/mine/project/zeroquant-server/quant_engine/service_tests/test_schema_contract.py:1) | 41 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 子进程/动态执行：16 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/service_tests/test_server_smoke.py](/Users/yx/mine/project/zeroquant-server/quant_engine/service_tests/test_server_smoke.py:1) | 61 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：37,45,49；子进程/动态执行：28 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/tests/__init__.py](/Users/yx/mine/project/zeroquant-server/quant_engine/tests/__init__.py:1) | 0 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/tests/test_entity_profiles.py](/Users/yx/mine/project/zeroquant-server/quant_engine/tests/test_entity_profiles.py:1) | 78 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：54,69 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/tests/test_global_review.py](/Users/yx/mine/project/zeroquant-server/quant_engine/tests/test_global_review.py:1) | 57 | 通读审查 | Python AST 解析通过；新增3项：坏时间、私密 URL/异常、outbox；Python 63 项通过；2026-09-17 F17 时序迁移及生产者字段增量复核，后端61/Python针对性4通过；2026-09-17 F17 时序迁移及生产者字段增量复核，后端61/Python针对性4通过；2026-09-17 F17 时序迁移及生产者字段增量复核，后端61/Python针对性4通过；扫描定位 SQL/DDL（需判断所在层）：50；网络调用（需核对超时/来源）：22 | 测试使用替身；不连接供应商/真实数据库 |
| [quant_engine/tests/test_news.py](/Users/yx/mine/project/zeroquant-server/quant_engine/tests/test_news.py:1) | 158 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：127；网络调用（需核对超时/来源）：96,97,117,118… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/tests/test_probability_core.py](/Users/yx/mine/project/zeroquant-server/quant_engine/tests/test_probability_core.py:1) | 190 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/tests/test_research_pipeline.py](/Users/yx/mine/project/zeroquant-server/quant_engine/tests/test_research_pipeline.py:1) | 186 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/tests/test_research_review_regressions.py](/Users/yx/mine/project/zeroquant-server/quant_engine/tests/test_research_review_regressions.py:1) | 225 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：65,126,167,172… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/tests/test_research_safety.py](/Users/yx/mine/project/zeroquant-server/quant_engine/tests/test_research_safety.py:1) | 109 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：48,105 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/__init__.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/__init__.py:1) | 10 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/audit.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/audit.py:1) | 56 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/config.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/config.py:1) | 107 | 通读审查 | Python AST 解析通过；环境变量来源、默认路径、配置解析全文通读 | G04/G08：数值范围/URL/TLS 配置未统一验证，异常路径仍需测试 |
| [quant_engine/zeroquant/curve.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/curve.py:1) | 157 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：5,75,76 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/entity_profiles.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/entity_profiles.py:1) | 60 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 网络调用（需核对超时/来源）：27,35 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/features.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/features.py:1) | 150 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：141 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/forecast.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/forecast.py:1) | 150 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/models.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/models.py:1) | 161 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：5,64,119,121 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/news.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/news.py:1) | 503 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：15,143,159,174…；网络调用（需核对超时/来源）：181,397,463,464… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/pipeline.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/pipeline.py:1) | 143 | 通读审查 | Python AST 解析通过；特征→分布→硬门禁→版本化输出编排与输入摘要通读；Python 63 项通过 | G12：仍是研究流程，真实数据/预测效果未验证 |
| [quant_engine/zeroquant/providers.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/providers.py:1) | 179 | 已变更待复核 | Python AST 解析通过；人工证据摘要不再匹配；扫描定位 网络调用（需核对超时/来源）：61 | 重新审查变更，更新人工记录 |
| [quant_engine/zeroquant/regime.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/regime.py:1) | 37 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/research/__init__.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/research/__init__.py:1) | 1 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/research/backtest.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/research/backtest.py:1) | 94 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：22 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/research/data.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/research/data.py:1) | 418 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：243,245,249,261… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/research/execution.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/research/execution.py:1) | 413 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：184,282,346,379… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/research/ingestion.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/research/ingestion.py:1) | 216 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：100；网络调用（需核对超时/来源）：30,148,183；异常输出（需人工核对脱敏）：199 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/research/shadow.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/research/shadow.py:1) | 70 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：40,41,44,50…；宽类型（不等于缺陷）：30 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/research/training.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/research/training.py:1) | 354 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：143,212,237,241；异常输出（需人工核对脱敏）：293 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/research/warehouse.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/research/warehouse.py:1) | 292 | 局部审查 | Python AST 解析通过；连接与 audit/ingest/records/live_records、登记/对账关键段落审查；Python 63 项通过；扫描定位 SQL/DDL（需判断所在层）：32,34,46,49… | G04/G06：没有完整仓储端口分层与真实 PG 验收；SELECT * 和无参全量 records；未完整逐行通读 |
| [quant_engine/zeroquant/risk.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/risk.py:1) | 27 | 静态扫描，未通读 | Python AST 解析通过；关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [quant_engine/zeroquant/sink.py](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/sink.py:1) | 150 | 通读审查 | Python AST 解析通过；HTTP 写入、outbox 与失败路径通读；F09 outbox 脱敏测试通过；2026-09-17 F17 时序迁移及生产者字段增量复核，后端61/Python针对性4通过；2026-09-17 F17 时序迁移及生产者字段增量复核，后端61/Python针对性4通过；2026-09-17 F17 时序迁移及生产者字段增量复核，后端61/Python针对性4通过；扫描定位 宽类型（不等于缺陷）：8,18,48,54…；网络调用（需核对超时/来源）：28,130 | G02/G03：多步骤写入及重试幂等未闭环；返回业务 code 未统一核验 |
| [scripts/review_inventory.py](/Users/yx/mine/project/zeroquant-server/scripts/review_inventory.py:1) | 172 | 通读审查 | Python AST 解析通过；本轮编写并审查：只读扫描、不跟随符号链接、摘要失效检查与证据编号校验；2026-09-16 日期取证据表日期，生成与 --check 再验证；扫描定位 SQL/DDL（需判断所在层）：26；宽类型（不等于缺陷）：27,32；子进程/动态执行：36；HTML 注入入口（需核对转义）：31 | 只检测清单完整性，不是漏洞扫描器；人工审查元数据仍须可信维护 |
| [src/app.ts](/Users/yx/mine/project/zeroquant-server/src/app.ts:1) | 65 | 已变更待复核 | 人工证据摘要不再匹配；扫描定位 SQL/DDL（需判断所在层）：40,47 | 重新审查变更，更新人工记录 |
| [src/config/auth.config.ts](/Users/yx/mine/project/zeroquant-server/src/config/auth.config.ts:1) | 37 | 通读审查 | TTL/密钥/Origin/受邀注册配置；T-A 通过，F07 弱值检查追加后复跑通过 | G07：不能证明密钥随机性，未实现轮换；其他配置尚分散 |
| [src/config/database.config.ts](/Users/yx/mine/project/zeroquant-server/src/config/database.config.ts:1) | 10 | 通读审查 | 生产显式配置、池大小、连接/语句/锁超时；T-C 通过 | G06：真实 TLS/连接池容量未验收 |
| [src/database/entities/README.md](/Users/yx/mine/project/zeroquant-server/src/database/entities/README.md:1) | 85 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [src/database/entities/application.entities.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/application.entities.ts:1) | 140 | 局部审查 | users 唯一性与主要行情表字段通读；T-M 目录检查通过 | G10：未通读所有表语义；不能把目录检查当历史数据正确性验证 |
| [src/database/entities/auth.entities.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/auth.entities.ts:1) | 15 | 通读审查 | 认证表字段/FK/索引目录通读；T-M/T-B 与迁移一致 | 实体目录不是运行时 ORM；G06 真实结构未核验 |
| [src/database/entities/chat.entities.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/chat.entities.ts:1) | 7 | 通读审查 | 2026-09-16 成交聊天事务/回执/重试边界复核；领域38、前端7、迁移10/51通过，详见本轮证据 | G01/G06：普通聊天仍待拆分；真实多连接与浏览器验收未执行 |
| [src/database/entities/index.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/index.ts:1) | 32 | 通读审查 | 2026-09-17 F16 回执/迟到/查询边界与迁移目录增量复核；领域59项、定向15项、迁移11/52通过 | G02/G06：旧数据兼容边界、嵌套快照/投影分层及真实多连接/供应商验收仍开放 |
| [src/database/entities/market-data.entities.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/market-data.entities.ts:1) | 134 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/database/entities/prediction.entities.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/prediction.entities.ts:1) | 14 | 已变更待复核 | 人工证据摘要不再匹配 | 重新审查变更，更新人工记录 |
| [src/database/entities/profile.entities.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/profile.entities.ts:1) | 43 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/database/entities/research.entities.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/research.entities.ts:1) | 110 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/database/entities/system.entities.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/system.entities.ts:1) | 10 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/database/entities/types.ts](/Users/yx/mine/project/zeroquant-server/src/database/entities/types.ts:1) | 50 | 通读审查 | 列/索引/FK/默认值描述类型与工厂通读；构建通过 | 非运行时值校验器；完整比较算法见 schema-verifier 待审部分 |
| [src/database/schema-catalog-check.ts](/Users/yx/mine/project/zeroquant-server/src/database/schema-catalog-check.ts:1) | 33 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：10；异常输出（需人工核对脱敏）：23 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/database/schema-verifier.ts](/Users/yx/mine/project/zeroquant-server/src/database/schema-verifier.ts:1) | 314 | 局部审查 | 查询元数据入口、类型与差异模型、异常输出；F05 脱敏；隔离迁移测试调用核验器通过；扫描定位 SQL/DDL（需判断所在层）：72,77,83,92… | G10：未逐分支通读比较算法；G06 云库未核验 |
| [src/db.ts](/Users/yx/mine/project/zeroquant-server/src/db.ts:1) | 19 | 通读审查 | dotenv 优先级、Pool 配置及 idle 错误日志通读；构建通过；扫描定位 异常输出（需人工核对脱敏）：14 | G06：未连接真实目标 PostgreSQL |
| [src/health.ts](/Users/yx/mine/project/zeroquant-server/src/health.ts:1) | 8 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/index.ts](/Users/yx/mine/project/zeroquant-server/src/index.ts:1) | 40 | 已变更待复核 | 人工证据摘要不再匹配 | 重新审查变更，更新人工记录 |
| [src/legacy-routes.ts](/Users/yx/mine/project/zeroquant-server/src/legacy-routes.ts:1) | 27 | 局部审查 | 2026-09-16 普通聊天迁移、原子回执、分页与响应竞态增量复核；后端42/前端8通过；2026-09-17 F17 时序迁移及生产者字段增量复核，后端61/Python针对性4通过；2026-09-17 F17 时序迁移及生产者字段增量复核，后端61/Python针对性4通过；2026-09-17 F17 时序迁移及生产者字段增量复核，后端61/Python针对性4通过 | G01/G06/G10：真实环境验收及其他未通读范围仍待完成 |
| [src/migrations/001_initial_baseline.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/001_initial_baseline.ts:1) | 214 | 局部审查 | users 唯一与逐笔表字段核对；T-M 迁移执行通过；扫描定位 SQL/DDL（需判断所在层）：9,18,34,43… | G10：未通读完整 baseline DDL/down 的每个语义；未执行线上 down |
| [src/migrations/002_data_warehouse_core.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/002_data_warehouse_core.ts:1) | 359 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：10,21,35,47… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/migrations/003_baseline_contract_fixes.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/003_baseline_contract_fixes.ts:1) | 32 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/migrations/004_append_only_rolling_forecasts.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/004_append_only_rolling_forecasts.ts:1) | 43 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：18 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/migrations/005_entity_behavior_profiles.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/005_entity_behavior_profiles.ts:1) | 97 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：16,29,52,75… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/migrations/006_research_pipeline.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/006_research_pipeline.ts:1) | 51 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：7,19,28,35… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/migrations/007_repair_l2_created_at.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/007_repair_l2_created_at.ts:1) | 16 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/migrations/008_legacy_schema_compatibility.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/008_legacy_schema_compatibility.ts:1) | 97 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：13,18,23,29…；宽类型（不等于缺陷）：53 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/migrations/009_auth_sessions.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/009_auth_sessions.ts:1) | 24 | 通读审查 | 三张表/FK/索引及拒绝自动 down 通读；T-M/T-B 结构通过；扫描定位 SQL/DDL（需判断所在层）：7,12,17 | G07：未加会话保留期/清理流程；G06 真实迁移未执行 |
| [src/migrations/010_chat_trade_requests.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/010_chat_trade_requests.ts:1) | 14 | 通读审查 | 2026-09-16 成交聊天事务/回执/重试边界复核；领域38、前端7、迁移10/51通过，详见本轮证据；扫描定位 SQL/DDL（需判断所在层）：6 | G01/G06：普通聊天仍待拆分；真实多连接与浏览器验收未执行 |
| [src/migrations/011_prediction_receipts.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/011_prediction_receipts.ts:1) | 13 | 通读审查 | 2026-09-17 F16 回执/迟到/查询边界与迁移目录增量复核；领域59项、定向15项、迁移11/52通过；扫描定位 SQL/DDL（需判断所在层）：6 | G02/G06：旧数据兼容边界、嵌套快照/投影分层及真实多连接/供应商验收仍开放 |
| [src/migrations/012_market_sync_receipts.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/012_market_sync_receipts.ts:1) | 22 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：5,11,16,17… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/migrations/catalog.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/catalog.ts:1) | 18 | 已变更待复核 | 人工证据摘要不再匹配 | 重新审查变更，更新人工记录 |
| [src/migrations/runner.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/runner.ts:1) | 125 | 通读审查 | up/down/status、事务/锁与生产 down 限制通读；构建通过；扫描定位 SQL/DDL（需判断所在层）：8,17,25,34…；异常输出（需人工核对脱敏）：117 | status 会创建迁移表，不是严格只读；G06 真实库升级/权限验收未做 |
| [src/migrations/types.ts](/Users/yx/mine/project/zeroquant-server/src/migrations/types.ts:1) | 8 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/modules/auth/auth.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/auth.controller.ts:1) | 34 | 通读审查 | HTTP/Cookie/DTO 边界；T-B 回环 HTTP 通过 | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/auth.middleware.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/auth.middleware.ts:1) | 20 | 通读审查 | 仅接受已验证 Bearer 会话，无 phone 回退；T-B HTTP 通过 | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/auth.module.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/auth.module.ts:1) | 16 | 通读审查 | 依赖组装与事务生命周期；构建和领域回归通过 | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/auth.routes.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/auth.routes.ts:1) | 40 | 通读审查 | CSRF/限流与 Express 变体匹配；T-B HTTP 通过；F01 | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/auth.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/auth.service.ts:1) | 81 | 通读审查 | 注册原子性、刷新重放提交、会话身份与 DTO；T-B 通过 | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/auth.types.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/auth.types.ts:1) | 29 | 通读审查 | 领域数据契约与接口依赖；后端构建通过（接口无独立运行行为） | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/password.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/password.service.ts:1) | 22 | 通读审查 | 密码端口、虚拟哈希、每进程并发上限；T-A 真实 bcrypt 通过 | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/rate-limit.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/rate-limit.repository.ts:1) | 18 | 通读审查 | HMAC 身份键、原子窗口更新与批量过期清理；T-B 通过；扫描定位 SQL/DDL（需判断所在层）：10,12,13 | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/register.schema.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/register.schema.ts:1) | 35 | 通读审查 | 账号规范化、昵称字符与密码字节边界；T-A 通过 | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/token.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/token.service.ts:1) | 26 | 通读审查 | 最小 JWT 载荷、issuer/audience/算法/过期校验；T-B/T-D 通过 | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/auth/user.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/auth/user.repository.ts:1) | 56 | 通读审查 | 显式 SQL 字段、参数化、ON CONFLICT 与已知约束分类；T-A/T-B 通过；扫描定位 SQL/DDL（需判断所在层）：9,13,18,20… | G06/G07：真实并发、会话生命周期、验证码/多设备 UI 等尚未完成 |
| [src/modules/chat/chat-history.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/chat-history.repository.ts:1) | 15 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型；扫描定位 SQL/DDL（需判断所在层）：6,13 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/chat-history.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/chat-history.service.ts:1) | 22 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/chat-trade.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/chat-trade.controller.ts:1) | 11 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/chat-trade.module.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/chat-trade.module.ts:1) | 25 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/chat-trade.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/chat-trade.repository.ts:1) | 28 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型；扫描定位 SQL/DDL（需判断所在层）：8,11,15,19… | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/chat-trade.routes.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/chat-trade.routes.ts:1) | 30 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/chat-trade.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/chat-trade.service.ts:1) | 41 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/chat.schema.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/chat.schema.ts:1) | 12 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/chat.types.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/chat.types.ts:1) | 17 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/research-chat.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/research-chat.service.ts:1) | 34 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/chat/research-reply.adapter.ts](/Users/yx/mine/project/zeroquant-server/src/modules/chat/research-reply.adapter.ts:1) | 168 | 通读审查 | 2026-09-16 普通聊天事务/回执/分页审查；领域42项通过。研究适配器仅静态核对迁移前后行为，未调用真实模型；扫描定位 SQL/DDL（需判断所在层）：10,15,20,28…；宽类型（不等于缺陷）：80,88,90,103…；网络调用（需核对超时/来源）：124 | G01/G06：适配器SQL/提示词进一步拆分，真实多连接/浏览器/容量未验收 |
| [src/modules/daily-bars/daily-bars.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/daily-bars/daily-bars.controller.ts:1) | 6 | 通读审查 | F13 日线整批Schema/业务/SQL/HTTP分层核对；领域44项及最终8项回归通过 | G02/G06：其他导入仍待拆分；真实多连接与供应商契约未验收 |
| [src/modules/daily-bars/daily-bars.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/daily-bars/daily-bars.repository.ts:1) | 19 | 通读审查 | F13 日线整批Schema/业务/SQL/HTTP分层核对；领域44项及最终8项回归通过；扫描定位 SQL/DDL（需判断所在层）：10,13 | G02/G06：其他导入仍待拆分；真实多连接与供应商契约未验收 |
| [src/modules/daily-bars/daily-bars.schema.ts](/Users/yx/mine/project/zeroquant-server/src/modules/daily-bars/daily-bars.schema.ts:1) | 33 | 通读审查 | F13 日线整批Schema/业务/SQL/HTTP分层核对；领域44项及最终8项回归通过 | G02/G06：其他导入仍待拆分；真实多连接与供应商契约未验收 |
| [src/modules/daily-bars/daily-bars.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/daily-bars/daily-bars.service.ts:1) | 10 | 通读审查 | F13 日线整批Schema/业务/SQL/HTTP分层核对；领域44项及最终8项回归通过 | G02/G06：其他导入仍待拆分；真实多连接与供应商契约未验收 |
| [src/modules/market-sync/market-sync.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/market-sync/market-sync.controller.ts:1) | 6 | 通读审查 | F17 输入/观测时序/事务边界通读；领域61项与Python针对性4项通过 | G03/G06：水位保留、幂等回执、其他写入入口及真实并发/供应商验收未完成 |
| [src/modules/market-sync/market-sync.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/market-sync/market-sync.repository.ts:1) | 49 | 已变更待复核 | 人工证据摘要不再匹配；扫描定位 SQL/DDL（需判断所在层）：12,13,15,20… | 重新审查变更，更新人工记录 |
| [src/modules/market-sync/market-sync.schema.ts](/Users/yx/mine/project/zeroquant-server/src/modules/market-sync/market-sync.schema.ts:1) | 34 | 通读审查 | F17 输入/观测时序/事务边界通读；领域61项与Python针对性4项通过 | G03/G06：水位保留、幂等回执、其他写入入口及真实并发/供应商验收未完成 |
| [src/modules/market-sync/market-sync.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/market-sync/market-sync.service.ts:1) | 6 | 通读审查 | F17 输入/观测时序/事务边界通读；领域61项与Python针对性4项通过 | G03/G06：水位保留、幂等回执、其他写入入口及真实并发/供应商验收未完成 |
| [src/modules/market/market.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/market/market.controller.ts:1) | 21 | 通读审查 | 查询 DTO、参数化 SQL、复盘只读快照与响应映射通读；构建及 T-C 对应领域回归通过 | G06/G12：真实库查询计划、历史取样偏差与供应商证据；repository 真实 SQL 场景未全覆盖 |
| [src/modules/market/market.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/market/market.repository.ts:1) | 105 | 通读审查 | 查询 DTO、参数化 SQL、复盘只读快照与响应映射通读；构建及 T-C 对应领域回归通过；扫描定位 SQL/DDL（需判断所在层）：44,45,51,56… | G06/G12：真实库查询计划、历史取样偏差与供应商证据；repository 真实 SQL 场景未全覆盖 |
| [src/modules/market/market.routes.ts](/Users/yx/mine/project/zeroquant-server/src/modules/market/market.routes.ts:1) | 14 | 通读审查 | 查询 DTO、参数化 SQL、复盘只读快照与响应映射通读；构建及 T-C 对应领域回归通过 | G06/G12：真实库查询计划、历史取样偏差与供应商证据；repository 真实 SQL 场景未全覆盖 |
| [src/modules/market/market.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/market/market.service.ts:1) | 47 | 通读审查 | 查询 DTO、参数化 SQL、复盘只读快照与响应映射通读；构建及 T-C 对应领域回归通过 | G06/G12：真实库查询计划、历史取样偏差与供应商证据；repository 真实 SQL 场景未全覆盖 |
| [src/modules/portfolio/portfolio.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/portfolio/portfolio.controller.ts:1) | 27 | 通读审查 | 持仓/成交输入、统一锁序、结果快照与事务边界逐文件通读；构建及 T-B 对应领域回归通过 | G06：真实并发验收；G01：聊天跨步骤幂等；并非每个类型文件有独立测试 |
| [src/modules/portfolio/portfolio.module.ts](/Users/yx/mine/project/zeroquant-server/src/modules/portfolio/portfolio.module.ts:1) | 11 | 通读审查 | 持仓/成交输入、统一锁序、结果快照与事务边界逐文件通读；构建及 T-B 对应领域回归通过 | G06：真实并发验收；G01：聊天跨步骤幂等；并非每个类型文件有独立测试 |
| [src/modules/portfolio/portfolio.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/portfolio/portfolio.repository.ts:1) | 41 | 通读审查 | 持仓/成交输入、统一锁序、结果快照与事务边界逐文件通读；构建及 T-B 对应领域回归通过；扫描定位 SQL/DDL（需判断所在层）：12,15,19,20… | G06：真实并发验收；G01：聊天跨步骤幂等；并非每个类型文件有独立测试 |
| [src/modules/portfolio/portfolio.routes.ts](/Users/yx/mine/project/zeroquant-server/src/modules/portfolio/portfolio.routes.ts:1) | 15 | 通读审查 | 持仓/成交输入、统一锁序、结果快照与事务边界逐文件通读；构建及 T-B 对应领域回归通过 | G06：真实并发验收；G01：聊天跨步骤幂等；并非每个类型文件有独立测试 |
| [src/modules/portfolio/portfolio.schema.ts](/Users/yx/mine/project/zeroquant-server/src/modules/portfolio/portfolio.schema.ts:1) | 22 | 通读审查 | 持仓/成交输入、统一锁序、结果快照与事务边界逐文件通读；构建及 T-B 对应领域回归通过 | G06：真实并发验收；G01：聊天跨步骤幂等；并非每个类型文件有独立测试 |
| [src/modules/portfolio/portfolio.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/portfolio/portfolio.service.ts:1) | 55 | 通读审查 | 持仓/成交输入、统一锁序、结果快照与事务边界逐文件通读；构建及 T-B 对应领域回归通过；扫描定位 SQL/DDL（需判断所在层）：30 | G06：真实并发验收；G01：聊天跨步骤幂等；并非每个类型文件有独立测试 |
| [src/modules/portfolio/portfolio.types.ts](/Users/yx/mine/project/zeroquant-server/src/modules/portfolio/portfolio.types.ts:1) | 16 | 通读审查 | 持仓/成交输入、统一锁序、结果快照与事务边界逐文件通读；构建及 T-B 对应领域回归通过 | G06：真实并发验收；G01：聊天跨步骤幂等；并非每个类型文件有独立测试 |
| [src/modules/predictions/prediction-query.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction-query.controller.ts:1) | 10 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/predictions/prediction-query.schema.ts](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction-query.schema.ts:1) | 6 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/predictions/prediction-query.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction-query.service.ts:1) | 13 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/predictions/prediction-reader.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction-reader.repository.ts:1) | 30 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过；扫描定位 SQL/DDL（需判断所在层）：16,24 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/predictions/prediction-receipt.ts](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction-receipt.ts:1) | 22 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/predictions/prediction.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction.controller.ts:1) | 6 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/predictions/prediction.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction.repository.ts:1) | 92 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过；扫描定位 SQL/DDL（需判断所在层）：10,20,21,24… | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/predictions/prediction.schema.ts](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction.schema.ts:1) | 58 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/predictions/prediction.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/predictions/prediction.service.ts:1) | 16 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/profile-evidence/evidence.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/profile-evidence/evidence.controller.ts:1) | 7 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/profile-evidence/evidence.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/profile-evidence/evidence.repository.ts:1) | 57 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过；扫描定位 SQL/DDL（需判断所在层）：12,15,31,34… | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/profile-evidence/evidence.schema.ts](/Users/yx/mine/project/zeroquant-server/src/modules/profile-evidence/evidence.schema.ts:1) | 78 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/profile-evidence/evidence.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/profile-evidence/evidence.service.ts:1) | 7 | 通读审查 | F14/F15 输入契约/服务/SQL事务/HTTP边界核对；领域53项、导入定向9项与生产门禁通过 | G02/G06：预测回执重放/迟到策略/嵌套快照/投影分层及真实并发未完成；详见增量证据 |
| [src/modules/public-trades/public-trades.controller.ts](/Users/yx/mine/project/zeroquant-server/src/modules/public-trades/public-trades.controller.ts:1) | 6 | 通读审查 | 本轮新增 F02；整批校验、仓储边界、事务锁序与失败回滚；T-C/T-D 通过 | G06：真实多连接验收；快照替换不是不可变逐笔历史 |
| [src/modules/public-trades/public-trades.repository.ts](/Users/yx/mine/project/zeroquant-server/src/modules/public-trades/public-trades.repository.ts:1) | 20 | 通读审查 | 本轮新增 F02；整批校验、仓储边界、事务锁序与失败回滚；T-C/T-D 通过；扫描定位 SQL/DDL（需判断所在层）：10,13,16 | G06：真实多连接验收；快照替换不是不可变逐笔历史 |
| [src/modules/public-trades/public-trades.schema.ts](/Users/yx/mine/project/zeroquant-server/src/modules/public-trades/public-trades.schema.ts:1) | 29 | 通读审查 | 本轮新增 F02；整批校验、仓储边界、事务锁序与失败回滚；T-C/T-D 通过 | G06：真实多连接验收；快照替换不是不可变逐笔历史 |
| [src/modules/public-trades/public-trades.service.ts](/Users/yx/mine/project/zeroquant-server/src/modules/public-trades/public-trades.service.ts:1) | 11 | 通读审查 | 本轮新增 F02；整批校验、仓储边界、事务锁序与失败回滚；T-C/T-D 通过 | G06：真实多连接验收；快照替换不是不可变逐笔历史 |
| [src/ownership.ts](/Users/yx/mine/project/zeroquant-server/src/ownership.ts:1) | 216 | 通读审查 | 公开股东源、分页截至日、缓存及失败响应通读；扫描定位 宽类型（不等于缺陷）：106；网络调用（需核对超时/来源）：112 | G12/G09：缓存无容量上限，失败响应包含外部异常文本；外部数据正确性/分页缺契约测试 |
| [src/profiles/entity-profile-engine.ts](/Users/yx/mine/project/zeroquant-server/src/profiles/entity-profile-engine.ts:1) | 425 | 通读审查 | 事件/行情/新闻查询、PIT 过滤、评分与画像写入/查询通读；构建通过；扫描定位 SQL/DDL（需判断所在层）：279,292,307,313… | G04/G12：数值算法及统计可信度未逐条证明；结构仍混合，真实 PG 快照/并发与新闻关联修订需验证 |
| [src/quant-routes.ts](/Users/yx/mine/project/zeroquant-server/src/quant-routes.ts:1) | 104 | 局部审查 | 复核三类导入迁出与生产批准组装；领域53项及门禁回归通过 | G02：最新预测读取、画像查询/刷新日期与时区及旧错误契约未闭环；仍保留局部审查口径 |
| [src/research-production.ts](/Users/yx/mine/project/zeroquant-server/src/research-production.ts:1) | 72 | 通读审查 | 实时/批准查询与固定策略版本，参数化 SQL 和故障拒绝；生产门禁测试通过；扫描定位 SQL/DDL（需判断所在层）：54；宽类型（不等于缺陷）：16；异常输出（需人工核对脱敏）：69 | G12：模型批准、真实数据与质量不是这组测试能证明的 |
| [src/scheduler/process-runner.ts](/Users/yx/mine/project/zeroquant-server/src/scheduler/process-runner.ts:1) | 37 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 子进程/动态执行：21 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/scheduler/quant-scheduler.ts](/Users/yx/mine/project/zeroquant-server/src/scheduler/quant-scheduler.ts:1) | 209 | 已变更待复核 | 人工证据摘要不再匹配；扫描定位 异常输出（需人工核对脱敏）：75 | 重新审查变更，更新人工记录 |
| [src/scheduler/task-lock.ts](/Users/yx/mine/project/zeroquant-server/src/scheduler/task-lock.ts:1) | 18 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：10,14 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/seed.ts](/Users/yx/mine/project/zeroquant-server/src/seed.ts:1) | 344 | 局部审查 | 检查结尾异常处理与退出码；F05 修复原样日志；构建通过；扫描定位 SQL/DDL（需判断所在层）：11,20,36,45… | G10：种子数据/SQL 全文未通读；未执行 seed |
| [src/shared/errors.ts](/Users/yx/mine/project/zeroquant-server/src/shared/errors.ts:1) | 27 | 通读审查 | 异常目录、脱敏、requestId、异步错误转发、事务释放通读；构建、T-B/T-D 通过 | G08：全链路 trace 与统一错误语言未完成；未逐个故障分支独立测试 |
| [src/shared/http.ts](/Users/yx/mine/project/zeroquant-server/src/shared/http.ts:1) | 28 | 通读审查 | 异常目录、脱敏、requestId、异步错误转发、事务释放通读；构建、T-B/T-D 通过 | G08：全链路 trace 与统一错误语言未完成；未逐个故障分支独立测试 |
| [src/shared/logger.ts](/Users/yx/mine/project/zeroquant-server/src/shared/logger.ts:1) | 7 | 通读审查 | 异常目录、脱敏、requestId、异步错误转发、事务释放通读；构建、T-B/T-D 通过；扫描定位 异常输出（需人工核对脱敏）：4 | G08：全链路 trace 与统一错误语言未完成；未逐个故障分支独立测试 |
| [src/shared/transaction.ts](/Users/yx/mine/project/zeroquant-server/src/shared/transaction.ts:1) | 22 | 通读审查 | 异常目录、脱敏、requestId、异步错误转发、事务释放通读；构建、T-B/T-D 通过 | G08：全链路 trace 与统一错误语言未完成；未逐个故障分支独立测试 |
| [src/voice-cleaner.ts](/Users/yx/mine/project/zeroquant-server/src/voice-cleaner.ts:1) | 48 | 通读审查 | F03：整句匹配，不猜价格/数量；T-D 正反例通过；扫描定位 子进程/动态执行：26,28,29 | 支持语法有意收紧；G01 幂等/聊天事务未完成 |
| [test/architecture.test.ts](/Users/yx/mine/project/zeroquant-server/test/architecture.test.ts:1) | 57 | 通读审查 | F14/F15 导入用例、分层护栏及测试脚本核对；领域53项、最终定向9项通过；扫描定位 SQL/DDL（需判断所在层）：18,27 | G06：单连接/本机HTTP夹具不代表真实并发与供应商验收 |
| [test/auth-portfolio.test.ts](/Users/yx/mine/project/zeroquant-server/test/auth-portfolio.test.ts:1) | 222 | 通读审查 | 审查用例前置条件、PGlite 排队边界与 HTTP 断言；完整领域 27 项/配置追加5项通过；扫描定位 SQL/DDL（需判断所在层）：69,87,90,103…；网络调用（需核对超时/来源）：192,199,202,204…；子进程/动态执行：69,74,75,76… | 不是多连接压力测试；部分标题（旧令牌）原覆盖不足，现由全局回归补真实 JWT 负例 |
| [test/chat-trade.test.ts](/Users/yx/mine/project/zeroquant-server/test/chat-trade.test.ts:1) | 205 | 通读审查 | 2026-09-17 F16 回执/迟到/查询边界与迁移目录增量复核；领域59项、定向15项、迁移11/52通过；扫描定位 SQL/DDL（需判断所在层）：24,25,26,39…；网络调用（需核对超时/来源）：188,189,190,191…；子进程/动态执行：26,47,53 | G02/G06：旧数据兼容边界、嵌套快照/投影分层及真实多连接/供应商验收仍开放 |
| [test/e2e_baseline.test.ts](/Users/yx/mine/project/zeroquant-server/test/e2e_baseline.test.ts:1) | 278 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：62,63,64,65…；宽类型（不等于缺陷）：100,123,189；网络调用（需核对超时/来源）：30；异常输出（需人工核对脱敏）：273 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [test/global-review-regressions.test.ts](/Users/yx/mine/project/zeroquant-server/test/global-review-regressions.test.ts:1) | 146 | 通读审查 | 本轮新增 6 项测试全文审查并通过；F13 日线迁移/校验/回滚增量复核，领域44项通过；扫描定位 SQL/DDL（需判断所在层）：61,66,69,95…；子进程/动态执行：61,127 | 真实库/浏览器/供应商验收见 G06/G12 |
| [test/health.test.ts](/Users/yx/mine/project/zeroquant-server/test/health.test.ts:1) | 12 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [test/ingestion.test.ts](/Users/yx/mine/project/zeroquant-server/test/ingestion.test.ts:1) | 235 | 通读审查 | F14/F15 导入用例、分层护栏及测试脚本核对；领域53项、最终定向9项通过；扫描定位 SQL/DDL（需判断所在层）：79,82,83,92…；网络调用（需核对超时/来源）：224,225,226,227…；子进程/动态执行：82,92 | G06：单连接/本机HTTP夹具不代表真实并发与供应商验收 |
| [test/market-sync.test.ts](/Users/yx/mine/project/zeroquant-server/test/market-sync.test.ts:1) | 55 | 已变更待复核 | 人工证据摘要不再匹配；扫描定位 SQL/DDL（需判断所在层）：25,26,29,32…；子进程/动态执行：26,32,49 | 重新审查变更，更新人工记录 |
| [test/postgres-concurrency.test.ts](/Users/yx/mine/project/zeroquant-server/test/postgres-concurrency.test.ts:1) | 53 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：22,34,39,40 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [test/process-runner.test.ts](/Users/yx/mine/project/zeroquant-server/test/process-runner.test.ts:1) | 15 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [test/research-migrations-smoke.ts](/Users/yx/mine/project/zeroquant-server/test/research-migrations-smoke.ts:1) | 79 | 通读审查 | 2026-09-17 F16 回执/迟到/查询边界与迁移目录增量复核；领域59项、定向15项、迁移11/52通过；扫描定位 SQL/DDL（需判断所在层）：17,21,25,27…；宽类型（不等于缺陷）：16,33,36,54；子进程/动态执行：16,17,19,22… | G02/G06：旧数据兼容边界、嵌套快照/投影分层及真实多连接/供应商验收仍开放 |
| [test/research-production.test.ts](/Users/yx/mine/project/zeroquant-server/test/research-production.test.ts:1) | 25 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [test/schema-compatibility.test.ts](/Users/yx/mine/project/zeroquant-server/test/schema-compatibility.test.ts:1) | 72 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 SQL/DDL（需判断所在层）：13,18,21,22…；宽类型（不等于缺陷）：15,16；子进程/动态执行：13,18,21,29… | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [tsconfig.json](/Users/yx/mine/project/zeroquant-server/tsconfig.json:1) | 22 | 通读审查 | 配置/构建输入与本轮变更全文核对；构建和相关测试通过（不是该配置每项均运行） | G11：镜像/依赖审计与线上配置验收未做 |

## web

| 文件 | 行数 | 审查层级 | 验证结果 | 剩余缺口 |
| --- | --- | --- | --- | --- |
| [.dockerignore](/Users/yx/mine/project/zeroquant-web/.dockerignore:1) | 5 | 通读审查 | 构建/静态服务路径与本轮类型检查配置全文核对；构建通过 | G09/G11：外层网关 API 转发与镜像未实测；本轮未依赖漏洞审计 |
| [.github/workflows/deploy.yml](/Users/yx/mine/project/zeroquant-web/.github/workflows/deploy.yml:1) | 28 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [.gitignore](/Users/yx/mine/project/zeroquant-web/.gitignore:1) | 5 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [Dockerfile](/Users/yx/mine/project/zeroquant-web/Dockerfile:1) | 5 | 通读审查 | 构建/静态服务路径与本轮类型检查配置全文核对；构建通过 | G09/G11：外层网关 API 转发与镜像未实测；本轮未依赖漏洞审计 |
| [README.md](/Users/yx/mine/project/zeroquant-web/README.md:1) | 27 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [index.html](/Users/yx/mine/project/zeroquant-web/index.html:1) | 17 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [nginx.conf](/Users/yx/mine/project/zeroquant-web/nginx.conf:1) | 23 | 通读审查 | 构建/静态服务路径与本轮类型检查配置全文核对；构建通过 | G09/G11：外层网关 API 转发与镜像未实测；本轮未依赖漏洞审计 |
| [package-lock.json](/Users/yx/mine/project/zeroquant-web/package-lock.json:1) | 3258 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [package.json](/Users/yx/mine/project/zeroquant-web/package.json:1) | 35 | 已变更待复核 | 人工证据摘要不再匹配 | 重新审查变更，更新人工记录 |
| [playwright.config.ts](/Users/yx/mine/project/zeroquant-web/playwright.config.ts:1) | 10 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [postcss.config.js](/Users/yx/mine/project/zeroquant-web/postcss.config.js:1) | 6 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/App.vue](/Users/yx/mine/project/zeroquant-web/src/App.vue:1) | 9 | 通读审查 | 前端身份代次/刷新/路由/输入/渲染与组装通读；tsc、构建、4项前端测试通过 | G06/G09：真实 Cookie、多标签/跨账号浏览器测试、Vue 完整类型/视觉验收未做 |
| [src/api/chat-requests.ts](/Users/yx/mine/project/zeroquant-web/src/api/chat-requests.ts:1) | 45 | 通读审查 | 2026-09-16 成交聊天事务/回执/重试边界复核；领域38、前端7、迁移10/51通过，详见本轮证据 | G01/G06：普通聊天仍待拆分；真实多连接与浏览器验收未执行 |
| [src/api/index.ts](/Users/yx/mine/project/zeroquant-web/src/api/index.ts:1) | 46 | 通读审查 | 前端身份代次/刷新/路由/输入/渲染与组装通读；tsc、构建、4项前端测试通过 | G06/G09：真实 Cookie、多标签/跨账号浏览器测试、Vue 完整类型/视觉验收未做 |
| [src/api/session.ts](/Users/yx/mine/project/zeroquant-web/src/api/session.ts:1) | 48 | 已变更待复核 | 人工证据摘要不再匹配 | 重新审查变更，更新人工记录 |
| [src/env.d.ts](/Users/yx/mine/project/zeroquant-web/src/env.d.ts:1) | 7 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射；扫描定位 宽类型（不等于缺陷）：5 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [src/main.ts](/Users/yx/mine/project/zeroquant-web/src/main.ts:1) | 21 | 通读审查 | 前端身份代次/刷新/路由/输入/渲染与组装通读；tsc、构建、4项前端测试通过 | G06/G09：真实 Cookie、多标签/跨账号浏览器测试、Vue 完整类型/视觉验收未做 |
| [src/router/index.ts](/Users/yx/mine/project/zeroquant-web/src/router/index.ts:1) | 31 | 通读审查 | 前端身份代次/刷新/路由/输入/渲染与组装通读；tsc、构建、4项前端测试通过 | G06/G09：真实 Cookie、多标签/跨账号浏览器测试、Vue 完整类型/视觉验收未做 |
| [src/style.css](/Users/yx/mine/project/zeroquant-web/src/style.css:1) | 42 | 元数据登记，未通读 | 文件摘要及行数 | G10：配置、文档或数据内容仍待逐项核验 |
| [src/utils/markdown.ts](/Users/yx/mine/project/zeroquant-web/src/utils/markdown.ts:1) | 10 | 通读审查 | 前端身份代次/刷新/路由/输入/渲染与组装通读；tsc、构建、4项前端测试通过 | G06/G09：真实 Cookie、多标签/跨账号浏览器测试、Vue 完整类型/视觉验收未做 |
| [src/views/Dashboard.vue](/Users/yx/mine/project/zeroquant-web/src/views/Dashboard.vue:1) | 1627 | 已变更待复核 | 人工证据摘要不再匹配；扫描定位 宽类型（不等于缺陷）：396,643,644,650…；HTML 注入入口（需核对转义）：554；异常 any：1169,1193,1209,1408… | 重新审查变更，更新人工记录 |
| [src/views/Login.vue](/Users/yx/mine/project/zeroquant-web/src/views/Login.vue:1) | 133 | 通读审查 | 前端身份代次/刷新/路由/输入/渲染与组装通读；tsc、构建、4项前端测试通过；扫描定位 宽类型（不等于缺陷）：107 | G06/G09：真实 Cookie、多标签/跨账号浏览器测试、Vue 完整类型/视觉验收未做 |
| [tailwind.config.js](/Users/yx/mine/project/zeroquant-web/tailwind.config.js:1) | 23 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [test/browser/auth.spec.ts](/Users/yx/mine/project/zeroquant-web/test/browser/auth.spec.ts:1) | 44 | 静态扫描，未通读 | 关键词扫描；未建立逐文件行为测试映射 | G10：逐函数语义、调用边界、失败路径仍待人工审查；全套通过不等于该文件被覆盖 |
| [test/frontend-security.test.mjs](/Users/yx/mine/project/zeroquant-web/test/frontend-security.test.mjs:1) | 179 | 通读审查 | 2026-09-16 普通聊天迁移、原子回执、分页与响应竞态增量复核；后端42/前端8通过 | G01/G06/G10：真实环境验收及其他未通读范围仍待完成 |
| [tsconfig.json](/Users/yx/mine/project/zeroquant-web/tsconfig.json:1) | 25 | 通读审查 | 构建/静态服务路径与本轮类型检查配置全文核对；构建通过 | G09/G11：外层网关 API 转发与镜像未实测；本轮未依赖漏洞审计 |
| [vite.config.ts](/Users/yx/mine/project/zeroquant-web/vite.config.ts:1) | 23 | 已变更待复核 | 人工证据摘要不再匹配 | 重新审查变更，更新人工记录 |

## 更新与核验

```bash
python3 scripts/review_inventory.py
python3 scripts/review_inventory.py --check
```

仅更新机器清单不能关闭人工审查缺口；80 项代码证据有变化时必须复核对应条目并更新摘要和行号。
