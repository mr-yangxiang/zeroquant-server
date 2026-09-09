# 全球实时新闻接入与数据口径

## 当前范围

股票池固定为以下 6 只，不做自动扩容：

- 海马汽车 `000572`
- 江西铜业 `600362`
- 四川长虹 `600839`
- 紫金矿业 `601899`
- 日出东方 `603366`
- 安记食品 `603696`

新闻管道由三层组成：

1. **东财公告**：公司公告，相关度 `1.0`，可信等级 `HIGH`；
2. **GDELT DOC 2.0**：默认开启的全球多语种新闻索引；
3. **Google News RSS**：默认开启的免密钥备用索引；它不是有服务等级承诺的正式 API，系统会标记 `global_news_google_rss_unofficial` 并降低质量分；
4. **Finnhub Market News**：配置 `ZEROQUANT_FINNHUB_API_KEY` 后开启的可选金融新闻补充源。

连续竞价脚本每分钟执行新闻检查。GDELT 请求在 6 只股票之间共享，并至少缓存 60 秒，因此一次调度最多请求一次 GDELT，而不是每只股票各请求一次。GDELT 自身通常以约 15 分钟粒度更新；系统不会把一分钟轮询误写成一分钟源数据时效。

## 关联与权重

- 标题或摘要命中公司中英文别名：相关度 `0.92~1.0`；
- 命中该公司的行业主题：相关度 `0.52~0.78`；
- 仅命中全球宏观主题：相关度 `0.26`；
- 无关联：不进入该股票的特征，也不入该股票关系表。

新闻分数还会乘以来源可信度、重复度和 48 小时时间衰减。跨源同标题会降低重复新闻的新颖度，不能因转载次数多而机械放大信号。

特征快照同时保存综合新闻分数、公司级、行业级、宏观级分数，以及事件数和来源数。当前未训练的 bootstrap 模型只消费原有综合分数；新增分层变量先作为训练候选，不人为填写“看起来合理”的生产权重。

## Point-in-time 约束

- `published_at > as_of` 的文章强制剔除；
- 实时 API 不用于历史日期回测；历史训练必须从 PostgreSQL 同时按 `published_at <= as_of` 与 `ingested_at <= as_of` 回放；
- `news_articles.ingested_at` 保存本系统首次接收时间；
- 上游不可用时写质量标记并降低数据质量，不使用虚构或缓存超期新闻填充。

## 重要限制

当前情绪分类仍是可审计关键词基线，质量标记为 `news_sentiment_lexicon_unvalidated`。它尚未经过 A 股事件样本训练与走样本外校准，因此不会让 `untrained_bootstrap` 变为可交易模型。生产晋级仍需购买或取得有历史授权的新闻数据、保存正文/修订记录，并训练事件分类、相关度和影响方向模型。

## 生产配置

```dotenv
ZEROQUANT_GLOBAL_NEWS_ENABLED=true
ZEROQUANT_GLOBAL_NEWS_CACHE_SECONDS=60
ZEROQUANT_GLOBAL_NEWS_LOOKBACK_HOURS=36
ZEROQUANT_GOOGLE_NEWS_RSS_ENABLED=true
ZEROQUANT_FINNHUB_API_KEY=
```

若配置 Finnhub，密钥只能通过部署环境注入，禁止提交到 Git。
