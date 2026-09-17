# 成交聊天闭环证据（2026-09-16）

## 已实现

| 代码位置 | 行为 | 验证结果 |
| --- | --- | --- |
| src/modules/chat/chat-trade.service.ts | 校验请求编号、正文摘要；同编号同正文回放，同编号改正文冲突；所有写入同事务 | test/chat-trade.test.ts：重复请求、跨用户隔离、冲突、超卖回滚通过 |
| src/modules/chat/chat-trade.module.ts | 聊天仓储与持仓服务使用同一个事务客户端 | 助手消息/回执插入失败全部回滚；提交成功但确认丢失后重试不增持仓 |
| src/modules/chat/chat-trade.repository.ts | 请求事务锁；保存原始回执 | 清空聊天与更正持仓后旧请求只回放；真实锁等待尚未验证 |
| src/migrations/010_chat_trade_requests.ts；src/database/entities/chat.entities.ts | 用户与 UUID 联合主键，回执独立于聊天删除 | 10 个迁移、51 张表目录核对通过 |
| src/app.ts；src/legacy-routes.ts | 新路由先处理成交；删除旧成交写入分支 | 架构护栏、HTTP 测试通过 |
| zeroquant-web/src/api/chat-requests.ts | 按账号/股票保存未确认正文与编号；存储失败不发送 | 重载复用、账号隔离、损坏拒绝测试通过 |
| zeroquant-web/src/views/Dashboard.vue | 重试复用编号；已确认后的页面失败不恢复成交输入 | 实际发送函数测试通过；构建通过 |

## 边界与剩余缺口

- G01 部分完成：仅成交具备回执幂等；普通研究问答仍可能重复消息，LLM 与历史分页待迁移。
- PGlite 测试使用单连接队列，不证明真实 PostgreSQL 多连接锁、死锁或网络中断行为（G06）。HTTP 测试使用测试身份注入，完整真实浏览器身份链路未验证。
- sessionStorage 保存正文和请求编号；关闭标签或清除存储后可能丢失编号，不提供跨设备重试保证。新编号代表新操作，不按正文去重。
- 旧客户端成交缺 requestId 返回 400，需更新页面。上线必须先执行 010 并配套更新前端；本轮未部署、未推送、未执行云库迁移。
- 回执保留与清理策略尚待定义；清空聊天、撤销成交不能删除幂等证据。当前测试覆盖手动更正持仓后的回放，不等于真实撤销全链路验收。
- 前端 tsc 不替代 vue-tsc；原有约 2.44 MB 包体积告警仍在。
