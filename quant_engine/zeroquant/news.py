from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .models import NewsEvent
from .providers import HttpTransport, MarketDataError


SHANGHAI = ZoneInfo("Asia/Shanghai")

POSITIVE = {
    "业绩预增": 0.75,
    "扭亏": 0.70,
    "回购": 0.55,
    "增持": 0.50,
    "中标": 0.45,
    "重大合同": 0.45,
    "分红": 0.25,
}
NEGATIVE = {
    "退市风险": -1.00,
    "立案": -0.85,
    "处罚": -0.70,
    "亏损": -0.65,
    "减持": -0.55,
    "诉讼": -0.50,
    "问询": -0.35,
    "风险提示": -0.30,
}


def _parse_datetime(value: object) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=SHANGHAI)
        return parsed.astimezone(SHANGHAI)
    except ValueError:
        return None


def classify_title(title: str) -> tuple[str, float]:
    matches: list[tuple[str, float]] = []
    for keyword, score in {**POSITIVE, **NEGATIVE}.items():
        if keyword in title:
            matches.append((keyword, score))
    if not matches:
        return "未分类公告", 0.0
    matches.sort(key=lambda item: abs(item[1]), reverse=True)
    return matches[0]


class AnnouncementClient:
    """Point-in-time announcement reader with a persistent short-lived cache.

    This is deliberately an announcement source, not a claim of complete global
    news coverage.  Missing sources are exposed in quality flags downstream.
    """

    def __init__(
        self,
        transport: HttpTransport,
        cache_dir: Path,
        cache_seconds: int = 90,
    ):
        self.transport = transport
        self.cache_dir = cache_dir
        self.cache_seconds = cache_seconds

    def _cache_path(self, code: str) -> Path:
        return self.cache_dir / f"announcements_{code}.json"

    def _read_cache(self, code: str, now: datetime) -> list[dict[str, Any]] | None:
        path = self._cache_path(code)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            fetched_at = _parse_datetime(payload.get("fetchedAt"))
            if not fetched_at:
                return None
            age = (now - fetched_at).total_seconds()
            if age < 0 or age > self.cache_seconds:
                return None
            rows = payload.get("rows")
            return rows if isinstance(rows, list) else None
        except (OSError, json.JSONDecodeError, AttributeError):
            return None

    def _write_cache(self, code: str, now: datetime, rows: list[dict[str, Any]]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = self._cache_path(code)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({"fetchedAt": now.isoformat(), "rows": rows}, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp.replace(path)

    def fetch(self, code: str, as_of: datetime, limit: int = 20) -> tuple[list[NewsEvent], list[str]]:
        now = datetime.now(SHANGHAI)
        rows = self._read_cache(code, now)
        flags: list[str] = ["announcements_only_no_global_news"]
        if rows is None:
            url = (
                "https://np-anotice-stock.eastmoney.com/api/security/ann"
                f"?page_size={limit}&page_index=1&ann_type=A&stock_list={code}"
            )
            try:
                payload = self.transport.json(url)
                raw_rows = (payload.get("data") or {}).get("list", [])
                rows = raw_rows if isinstance(raw_rows, list) else []
                self._write_cache(code, now, rows)
            except (MarketDataError, OSError) as exc:
                flags.append(f"announcement_source_unavailable:{type(exc).__name__}")
                rows = []

        seen_titles: set[str] = set()
        events: list[NewsEvent] = []
        for raw in rows:
            title = str(raw.get("title_ch") or raw.get("title") or "").strip()
            if not title:
                continue
            published_at = _parse_datetime(raw.get("notice_date") or raw.get("display_time"))
            if published_at and published_at > as_of:
                continue
            normalized = "".join(title.split())
            novelty = 0.35 if normalized in seen_titles else 1.0
            seen_titles.add(normalized)
            event_type, sentiment = classify_title(title)
            event_id = hashlib.sha256(
                f"eastmoney|{code}|{published_at}|{normalized}".encode("utf-8")
            ).hexdigest()[:24]
            events.append(
                NewsEvent(
                    event_id=event_id,
                    code=code,
                    title=title,
                    published_at=published_at,
                    source="eastmoney_announcement",
                    sentiment=sentiment,
                    relevance=1.0,
                    novelty=novelty,
                    event_type=event_type,
                )
            )
        return events, flags


def aggregate_news_score(events: list[NewsEvent], as_of: datetime) -> float:
    weighted = 0.0
    total_weight = 0.0
    for event in events:
        age_hours = 24.0
        if event.published_at:
            age_hours = max(0.0, (as_of - event.published_at).total_seconds() / 3600.0)
        decay = math.exp(-age_hours / 48.0)
        weight = event.relevance * event.novelty * decay
        weighted += event.sentiment * weight
        total_weight += weight
    if total_weight <= 0:
        return 0.0
    return max(-1.0, min(1.0, weighted / total_weight))
