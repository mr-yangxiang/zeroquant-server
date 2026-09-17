# 普通聊天与分页增量证据（2026-09-16）

| 代码位置 | 行为与验证 | 剩余缺口 |
| --- | --- | --- |
| src/modules/chat/research-chat.service.ts | 模型调用在事务外；生成后消息两条与回执原子保存；重复提交只持久化一次；生成/写入失败回滚测试通过 | 允许并发重复模型计算；未证明真实 PostgreSQL 多连接行为 |
| src/modules/chat/research-reply.adapter.ts | 从旧 HTTP 路由提取只读上下文与回复；保留门禁和超时；当前用户消息显式加入提示词，不预写数据库 | SQL、提示词、模型调用仍需继续拆分；真实模型未调用，门禁单独回归通过 |
| src/modules/chat/chat-history.repository.ts；chat-history.service.ts | 默认最新50条、上限100条，按 ID 向前翻页；非法游标拒绝；按用户/股票过滤；清空不删除回执 | 已有索引按 created_at；ID分页复合索引及容量验收待办，不能宣称大表查询性能达标 |
| src/modules/chat/chat-trade.routes.ts；src/legacy-routes.ts | 聊天全部路由迁出 legacy；成交与普通问答共享请求键空间 | 名为 chat_trade_requests 的表复用作所有聊天回执；无需新迁移；旧客户端普通问答也须 requestId |
| zeroquant-web/src/views/Dashboard.vue | 加载更早消息；历史乱序、身份/股票切换响应丢弃；发送使旧历史请求失效；清空绑定原股票和身份 | 真实浏览器、滚动体验未验收；清空不会取消正在生成的请求，后续完成可产生新消息 |
| test/chat-trade.test.ts；zeroquant-web/test/frontend-security.test.mjs | 后端42项、前端8项通过；两端构建通过；10迁移/51表通过 | PGlite 队列不是多连接；函数抽取测试不是浏览器E2E |

普通消息默认不再生成带行情的虚拟欢迎消息，空历史返回空数组。不同请求编号仍代表不同消息；关闭标签或清除 sessionStorage 会失去前端待确认编号。已保存回执是当时的回复，重试不重新生成实时行情判断。请求正文保存策略与回执保留期限仍待定义。

未推送、未部署、未修改云库。G01 保持部分完成：消息原子性/请求幂等/分页已验证，适配器分层、容量、并发与浏览器验收仍开放。
