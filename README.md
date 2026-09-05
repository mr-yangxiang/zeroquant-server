# ZeroQuant Server

ZeroQuant 是一个面向 A 股盘前与盘中研究的概率预测系统。当前版本已经从“手工模板生成确定曲线”迁移为“时间点一致的数据 → 可审计特征 → 市场状态 → 多周期概率分布 → 硬风控 → 版本化审计”的结构。

> 重要：仓库自带的 `bootstrap_probability_v1` 只用于打通训练、校准和展示链路，状态明确为 `untrained_bootstrap`。它不会产生自动交易指令，也不代表已经获得可持续的实盘超额收益。

## 核心数据流

```text
腾讯行情 / 前复权日线 / 东财公告
              │
              ▼
       point-in-time 过滤与质量标记
              │
              ▼
量价、VWAP、波动率、动量、事件特征
              │
              ▼
      市场状态识别 + 版本化概率模型
              │
              ▼
  5/15/30/60 分钟概率与 P10/P50/P90
              │
              ▼
      硬风控门禁 + PostgreSQL + JSONL
```

公共逐笔成交不包含最终账户或营业部身份。`sync_official_l2.py` 这个文件名只为兼容旧调度保留，内部现在只记录可验证的主动买入、主动卖出或中性成交，不再虚构游资席位。

## 目录

- `quant_engine/zeroquant/`：纯 Python 预测核心，无导入时网络或数据库副作用。
- `quant_engine/models/`：版本化模型产物。只有完成走样本外验证和校准的产物才可以晋级。
- `quant_engine/generate_daily_predictions.py`：09:20 盘前概率基线。
- `quant_engine/realtime_monitor_1m.py`：连续竞价期间的一分钟增量预测。
- `quant_engine/nightly_review.py`：收盘评估，只生成证据，不因单日结果修改模型。
- `src/quant-routes.ts`：参数化持久化接口和最新概率查询。
- `src/quant-schema.ts`：概率预测表结构。

## 本地验证

```bash
npm ci
npm run build
PYTHONPATH=quant_engine python3 -m unittest discover -s quant_engine/tests -v
python3 quant_engine/generate_daily_predictions.py 2026-09-04 --no-persist
```

一分钟脚本在非交易时间默认完全休眠。只读调试可运行：

```bash
python3 quant_engine/realtime_monitor_1m.py --debug --no-persist
```

## 配置

复制 `.env.example` 并由部署系统注入真实值。仓库不再保存数据库密码、JWT 密钥或 SMTP 授权码。

生产环境至少必须配置：

- `DATABASE_URL`
- `JWT_SECRET`
- `ZEROQUANT_INTERNAL_TOKEN`

可选配置包括行情超时、公告缓存、审计目录、模型文件和估算交易成本。`ZEROQUANT_ALLOW_UNCALIBRATED_TRADING` 默认且应保持为 `false`。

## 调度

- 工作日 09:20：生成盘前基线。
- 连续竞价期间每分钟：更新概率；脚本自己过滤周末、盘前、午休和盘后。
- 工作日 18:10：计算 Brier Score、收益误差和 P10-P90 覆盖率。

旧版 00:00 提前生成当日曲线和“每三次检查自动扩展历史并写知识库”的调度已停用。模型或规则晋级必须基于多个市场状态下的滚动样本外结果，不允许由一天的复盘自动写入生产系统。

## 模型晋级门槛

模型产物只有同时满足以下条件，才应把 `state` 改成生产 champion 并设置 `calibrated: true`：

1. 使用按时间排序的 purged/embargoed walk-forward 验证；
2. 对比随机游走、VWAP、简单动量和当前 champion；
3. 扣除佣金、税费、滑点和冲击成本后仍稳定为正；
4. Brier Score、分箱校准和区间覆盖率达到预设门槛；
5. 多头、空头、震荡、高波和事件行情均有足够样本；
6. 通过影子交易，且没有数据陈旧、未来函数和幸存者偏差；
7. 独立风险门禁、A 股 T+1 可卖库存和仓位约束验证通过。

Markdown 知识库继续保留为人类可读的复盘档案，但不会直接成为模型参数。复盘结论先进入候选证据池，经验证后再转换为版本化特征、模型或硬规则。
