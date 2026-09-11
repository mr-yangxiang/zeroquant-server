# ZeroQuant 数据库实体总目录

这个目录是当前代码版本期望的 PostgreSQL 最终结构清单。所有业务表必须在这里定义，迁移文件仍负责把旧版本数据库升级到该结构。

## 文件分组

| 文件 | 表数量 | 范围 |
|---|---:|---|
| `system.entities.ts` | 1 | 数据库迁移版本 |
| `application.entities.ts` | 14 | 用户、股票、持仓、成交、对话和预测运行 |
| `market-data.entities.ts` | 15 | 行情、委托流、新闻、公告、股东与龙虎榜 |
| `research.entities.ts` | 13 | 数据质量、特征标签、模型评估、影子交易、原始版本、数据集、实验与批准证据 |
| `profile.entities.ts` | 4 | 机构/活跃席位身份、画像、股票关联与刷新审计 |
| 合计 | 47 | `public` schema 全部预期表 |

每张表都定义：

- 字段名、PostgreSQL 类型、是否允许为空、字符长度和默认值；
- 主键和唯一约束；
- 代码依赖的外键；
- 代码依赖的命名索引及字段顺序。

## 查看代码期望的完整结构

```bash
cd /usr/local/zeroquant-server
npm run schema:expected
```

检查是否有迁移新增了表、却忘记同步实体目录：

```bash
npm run schema:catalog-check
```

需要保存成文件进行人工对比时：

```bash
npm run schema:expected > /tmp/zeroquant-expected-schema.json
```

## 只读核验线上数据库

确认当前终端的 `DATABASE_URL` 指向需要核验的数据库，然后运行：

```bash
cd /usr/local/zeroquant-server
npm run schema:verify
```

核验器使用只读事务，不会建表、改字段或写入数据。返回值含义：

- `0`：没有结构错误；
- `1`：发现缺表、缺字段、类型、默认值、主键、唯一约束、外键或索引差异；
- `2`：无法连接或读取数据库结构。

机器可读结果：

```bash
npm run schema:verify:json
```

发现数据库中存在实体清单未定义的表或字段时会报告警告；不会自动删除任何内容。

## 维护规则

以后新增或修改表结构时，必须同时完成：

1. 新增一份只前进的 migration；
2. 修改本目录中对应实体；
3. 执行 `npm run build`；
4. 执行 `npm run schema:catalog-check`；
5. 在隔离测试库执行 `npm run migrate:up`；
6. 执行 `npm run schema:verify`，直到结构完全一致。

不要在线上手写 SQL 绕过迁移和实体清单。旧的重复建表入口 `src/quant-schema.ts` 已删除，避免出现两套结构定义。
