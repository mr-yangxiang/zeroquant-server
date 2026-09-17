# 行情同步时序增量证据（2026-09-17）

| 代码位置 | 实现与验证 | 剩余缺口 |
| --- | --- | --- |
| [market-sync.schema.ts:4](/Users/yx/mine/project/zeroquant-server/src/modules/market-sync/market-sync.schema.ts:4) | 整批先验证数值/真实日期/时区/股价范围；禁止过滤坏滚动点或截断超长数组；观测日期须与交易日一致、观测不晚于生成时间 | 未规定相对服务器时钟的未来容忍值；无供应商真实性验证；不验证runId归属 |
| [market-sync.repository.ts:7](/Users/yx/mine/project/zeroquant-server/src/modules/market-sync/market-sync.repository.ts:7) | 与日基线共用741003股票锁，再取stocks行锁；晚到点仅归档；同日高低价累计，跨日重置；历史/摘要/滚动同事务 | 最新观测从历史MAX推断；历史清理后需独立水位或明确保留政策；真实多连接/容量未测；其他直接写库脚本尚未全部迁移 |
| [legacy-routes.ts:13](/Users/yx/mine/project/zeroquant-server/src/legacy-routes.ts:13) | 旧适配器只保留路由映射和退役410响应；行情SQL已迁出 | 文件名保留以兼容现有组合根 |
| [sink.py:64](/Users/yx/mine/project/zeroquant-server/quant_engine/zeroquant/sink.py:64) | Python显式发送观测时间，timestampStr仍是预测生成时间 | 旧客户端缺observedAt时使用timestampStr兼容，不能据此证明其真实观测时刻 |
| [market-sync.test.ts:22](/Users/yx/mine/project/zeroquant-server/test/market-sync.test.ts:22) | 用全部迁移创建本机夹具；同日/跨日乱序、重复时刻409、不存在股票、滚动失败回滚通过 | 仅隔离PGlite，不是多连接或供应商端到端验收 |

## 协议边界

- tradeDate与timestampStr现在必填；新Python客户端同时发送observedAt。显式坏值不再变为默认价格。
- 省略predictedPrice继续以realPrice作为兼容值，尚不能称为独立模型预测证据。
- 同股票同观测时刻返回409，尚无成功回执重放；不自动覆盖更正数据。summaryApplied说明本次是否更新摘要。
- pct省略时保存null，不沿用前一天的涨跌幅；更新摘要时updated_at取观测时间的北京时间本地值。
- 第一条有记录的行情重置未知来源旧高低价；迟到点不会回补当前日极值，避免旧快照改写新摘要。
- 滚动预测仍为历史追加；不存在完整请求幂等、runId归属检查和供应商时间认证。

## 实际验证

`npm run build && npm run test:domains`：构建与61项通过。
`PYTHONPATH=quant_engine python3 -m unittest discover -s quant_engine/tests -p test_global_review.py`：4项通过（含观测/生成时间区分）。
`git diff --check`通过。未更改迁移和前端，未重跑前端或完整Python套件。

G03部分完成；未推送、未部署、未改云库。
