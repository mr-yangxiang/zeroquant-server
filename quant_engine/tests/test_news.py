from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from zeroquant.news import (
    AnnouncementClient,
    GlobalNewsClient,
    NewsFusionClient,
    STOCK_NEWS_PROFILES,
    aggregate_news_score,
    classify_title,
)


SHANGHAI = ZoneInfo("Asia/Shanghai")


class FakeTransport:
    def __init__(self, rows):
        self.rows = rows
        self.calls = 0

    def json(self, _url):
        self.calls += 1
        return {"data": {"list": self.rows}}


class FusionTransport:
    def __init__(self, published_at: str):
        self.published_at = published_at
        self.announcement_calls = 0
        self.global_calls = 0

    def json(self, url):
        if "eastmoney" in url:
            self.announcement_calls += 1
            return {"data": {"list": []}}
        self.global_calls += 1
        return {
            "articles": [
                {
                    "title": "Zijin Mining benefits as gold and copper prices hit record highs",
                    "seendate": self.published_at,
                    "url": "https://example.com/story?tracking=1",
                    "domain": "example.com",
                    "language": "English",
                },
                {
                    "title": "Unrelated sports result",
                    "seendate": self.published_at,
                    "url": "https://example.com/sport",
                    "domain": "example.com",
                    "language": "English",
                },
            ]
        }


class RssTransport:
    def text(self, _url):
        return """<?xml version="1.0" encoding="UTF-8"?>
        <rss><channel><item>
          <title>Zijin Mining expands copper output - Reuters</title>
          <link>https://news.google.com/rss/articles/example?oc=5</link>
          <pubDate>Wed, 09 Sep 2026 01:20:00 GMT</pubDate>
          <description>&lt;b&gt;Zijin Mining&lt;/b&gt; copper update</description>
          <source url="https://reuters.com">Reuters</source>
        </item></channel></rss>"""


class NewsTests(unittest.TestCase):
    def test_title_classifier_does_not_add_fixed_price_factor(self):
        event_type, score = classify_title("关于股份回购进展的公告")
        self.assertEqual(event_type, "回购")
        self.assertGreater(score, 0)

    def test_fixed_news_profiles_match_exactly_six_stock_pool(self):
        self.assertEqual(
            set(STOCK_NEWS_PROFILES),
            {"000572", "600362", "600839", "601899", "603366", "603696"},
        )

    def test_future_event_is_excluded_and_cache_is_reused(self):
        rows = [
            {"title_ch": "业绩预增公告", "notice_date": "2026-09-04T08:00:00+08:00"},
            {"title_ch": "股东减持公告", "notice_date": "2026-09-05T08:00:00+08:00"},
        ]
        transport = FakeTransport(rows)
        with tempfile.TemporaryDirectory() as tmp:
            client = AnnouncementClient(transport, Path(tmp), cache_seconds=300)
            as_of = datetime(2026, 9, 4, 9, 20, tzinfo=SHANGHAI)
            first, _ = client.fetch("600839", as_of)
            second, _ = client.fetch("600839", as_of)
            self.assertEqual(transport.calls, 1)
            self.assertEqual(len(first), 1)
            self.assertEqual(first[0].event_type, "业绩预增")
            self.assertEqual(first[0].event_id, second[0].event_id)
            self.assertGreater(aggregate_news_score(first, as_of), 0)

    def test_global_news_is_shared_filtered_and_point_in_time(self):
        as_of = datetime.now(SHANGHAI)
        published = as_of.astimezone(ZoneInfo("UTC")).strftime("%Y%m%dT%H%M%SZ")
        transport = FusionTransport(published)
        with tempfile.TemporaryDirectory() as tmp:
            client = NewsFusionClient(
                transport,
                Path(tmp),
                announcement_cache_seconds=300,
                global_cache_seconds=300,
                global_lookback_hours=36,
                google_rss_enabled=False,
            )
            zijin, flags = client.fetch("601899", as_of)
            jiangxi, _ = client.fetch("600362", as_of)
            self.assertEqual(transport.global_calls, 1)
            self.assertEqual(transport.announcement_calls, 2)
            self.assertEqual(len(zijin), 1)
            self.assertEqual(len(jiangxi), 1)
            self.assertEqual(zijin[0].event_type, "公司相关新闻")
            self.assertEqual(jiangxi[0].event_type, "行业相关新闻")
            self.assertTrue(zijin[0].source.startswith("gdelt:"))
            self.assertEqual(zijin[0].url, "https://example.com/story")
            self.assertTrue(any(flag == "global_news_sources:gdelt" for flag in flags))

    def test_future_global_article_is_never_used(self):
        as_of = datetime.now(SHANGHAI)
        future = (as_of + timedelta(minutes=5)).astimezone(
            ZoneInfo("UTC")
        ).strftime("%Y%m%dT%H%M%SZ")
        transport = FusionTransport(future)
        with tempfile.TemporaryDirectory() as tmp:
            client = NewsFusionClient(
                transport, Path(tmp), global_cache_seconds=300, google_rss_enabled=False
            )
            events, flags = client.fetch("601899", as_of)
            self.assertEqual(events, [])
            self.assertIn("global_news_no_relevant_event", flags)

    def test_google_rss_is_normalized_without_scraping_article_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = GlobalNewsClient(
                RssTransport(), Path(tmp), cache_seconds=60, lookback_hours=36
            )
            rows = client._fetch_google_rss()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["source"], "google_news_rss:Reuters")
            self.assertEqual(rows[0]["content"], "Zijin Mining copper update")
            self.assertEqual(
                rows[0]["url"], "https://news.google.com/rss/articles/example"
            )


if __name__ == "__main__":
    unittest.main()
