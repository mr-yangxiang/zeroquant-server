from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from zeroquant.news import AnnouncementClient, aggregate_news_score, classify_title


SHANGHAI = ZoneInfo("Asia/Shanghai")


class FakeTransport:
    def __init__(self, rows):
        self.rows = rows
        self.calls = 0

    def json(self, _url):
        self.calls += 1
        return {"data": {"list": self.rows}}


class NewsTests(unittest.TestCase):
    def test_title_classifier_does_not_add_fixed_price_factor(self):
        event_type, score = classify_title("关于股份回购进展的公告")
        self.assertEqual(event_type, "回购")
        self.assertGreater(score, 0)

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


if __name__ == "__main__":
    unittest.main()
