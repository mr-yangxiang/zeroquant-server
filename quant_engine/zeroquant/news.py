from __future__ import annotations

import hashlib
import html
import json
import math
import re
import threading
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

from .models import NewsEvent
from .providers import HttpTransport, MarketDataError


SHANGHAI = ZoneInfo("Asia/Shanghai")

# 可审计的 bootstrap 词典特征，不是已训练 NLP 模型。
POSITIVE = {
    "业绩预增": 0.75, "扭亏": 0.70, "回购": 0.55, "增持": 0.50,
    "中标": 0.45, "重大合同": 0.45, "降息": 0.35, "刺激政策": 0.35,
    "分红": 0.25, "beats estimates": 0.65, "record profit": 0.65,
    "profit surge": 0.60, "share buyback": 0.55, "contract win": 0.50,
    "rate cut": 0.35, "stimulus": 0.35, "tariff relief": 0.30,
}
NEGATIVE = {
    "退市风险": -1.00, "立案": -0.85, "处罚": -0.70, "亏损": -0.65,
    "减持": -0.55, "诉讼": -0.50, "制裁": -0.50, "问询": -0.35,
    "风险提示": -0.30, "misses estimates": -0.65,
    "profit warning": -0.65, "investigation": -0.55, "sanctions": -0.50,
    "lawsuit": -0.50, "rate hike": -0.40, "supply disruption": -0.40,
}


STOCK_NEWS_PROFILES: dict[str, dict[str, tuple[str, ...]]] = {
    "000572": {
        "aliases": ("海马汽车", "haima automobile", "haima motor"),
        "themes": ("electric vehicle", "ev market", "china auto", "汽车行业", "新能源汽车"),
    },
    "600362": {
        "aliases": ("江西铜业", "jiangxi copper", "jiangxi copper company"),
        "themes": ("copper price", "copper market", "copper smelter", "铜价", "铜矿"),
    },
    "600839": {
        "aliases": ("四川长虹", "sichuan changhong", "changhong electric"),
        "themes": ("consumer electronics", "home appliance", "display panel", "ai hardware", "家电", "消费电子"),
    },
    "601899": {
        "aliases": ("紫金矿业", "zijin mining", "zijin gold"),
        "themes": ("gold price", "copper price", "gold mining", "copper mining", "金价", "铜价", "矿业"),
    },
    "603366": {
        "aliases": ("日出东方", "solareast", "solar east"),
        "themes": ("solar thermal", "clean energy", "heat pump", "太阳能热", "清洁能源", "热泵"),
    },
    "603696": {
        "aliases": ("安记食品", "anji food", "an kee food"),
        "themes": ("seasoning market", "food prices", "consumer staples", "调味品", "食品价格"),
    },
}

GLOBAL_MARKET_TERMS = (
    "federal reserve", "people's bank of china", "pboc", "china economy",
    "china stocks", "china tariff", "global markets", "geopolitical risk",
)

GDELT_QUERY_TERMS = tuple(dict.fromkeys(
    term
    for profile in STOCK_NEWS_PROFILES.values()
    for group in (profile["aliases"], profile["themes"])
    for term in group
    if term.isascii()
)) + GLOBAL_MARKET_TERMS


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
        pass
    compact = str(value).strip()
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y%m%dT%H%M%S", "%Y%m%d%H%M%S"):
        try:
            return datetime.strptime(compact, fmt).replace(tzinfo=timezone.utc).astimezone(SHANGHAI)
        except ValueError:
            continue
    return None


def _canonical_url(value: object) -> str | None:
    raw = html.unescape(str(value or "").strip())
    if not raw:
        return None
    try:
        parts = urlsplit(raw)
        if parts.scheme not in {"http", "https"} or not parts.netloc:
            return None
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, "", ""))[:1000]
    except ValueError:
        return None


def _normalize_text(value: str) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", html.unescape(value).lower())


def classify_title(title: str) -> tuple[str, float]:
    lowered = html.unescape(title).lower()
    matches: list[tuple[str, float]] = []
    for keyword, score in {**POSITIVE, **NEGATIVE}.items():
        if keyword in lowered:
            matches.append((keyword, score))
    if not matches:
        return "未分类公告", 0.0
    matches.sort(key=lambda item: abs(item[1]), reverse=True)
    return matches[0]


def _relation(code: str, text: str) -> tuple[float, str] | None:
    profile = STOCK_NEWS_PROFILES.get(code)
    if not profile:
        return None
    lowered = html.unescape(text).lower()
    direct = sum(1 for alias in profile["aliases"] if alias in lowered)
    if direct:
        return min(1.0, 0.92 + 0.04 * (direct - 1)), "公司相关新闻"
    themes = sum(1 for term in profile["themes"] if term in lowered)
    if themes:
        return min(0.78, 0.52 + 0.08 * (themes - 1)), "行业相关新闻"
    if any(term in lowered for term in GLOBAL_MARKET_TERMS):
        return 0.26, "全球宏观新闻"
    return None


class AnnouncementClient:
    """Point-in-time Eastmoney announcement reader."""

    def __init__(self, transport: HttpTransport, cache_dir: Path, cache_seconds: int = 90):
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
        tmp.write_text(json.dumps({"fetchedAt": now.isoformat(), "rows": rows}, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    def fetch(self, code: str, as_of: datetime, limit: int = 20) -> tuple[list[NewsEvent], list[str]]:
        now = datetime.now(SHANGHAI)
        rows = self._read_cache(code, now)
        flags: list[str] = []
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
            if not published_at or published_at > as_of:
                continue
            normalized = _normalize_text(title)
            novelty = 0.35 if normalized in seen_titles else 1.0
            seen_titles.add(normalized)
            event_type, sentiment = classify_title(title)
            event_id = hashlib.sha256(
                f"eastmoney|{code}|{published_at.isoformat()}|{normalized}".encode("utf-8")
            ).hexdigest()[:24]
            events.append(NewsEvent(
                event_id=event_id, code=code, title=title, published_at=published_at,
                source="eastmoney_announcement", sentiment=sentiment, relevance=1.0,
                novelty=novelty, event_type=event_type, trust_level="HIGH", language="zh",
            ))
        return events, flags


class GlobalNewsClient:
    """Shared global-news fetcher for the fixed six-stock universe."""

    def __init__(
        self,
        transport: HttpTransport,
        cache_dir: Path,
        cache_seconds: int,
        lookback_hours: int,
        google_rss_enabled: bool = True,
        finnhub_api_key: str = "",
    ):
        self.transport = transport
        self.cache_dir = cache_dir
        self.cache_seconds = max(60, cache_seconds)
        self.lookback_hours = max(1, min(72, lookback_hours))
        self.google_rss_enabled = google_rss_enabled
        self.finnhub_api_key = finnhub_api_key
        self._lock = threading.Lock()

    @property
    def _cache_path(self) -> Path:
        return self.cache_dir / "global_news_pool.json"

    def _read_cache(self, now: datetime) -> tuple[list[dict[str, Any]], list[str]] | None:
        try:
            payload = json.loads(self._cache_path.read_text(encoding="utf-8"))
            fetched_at = _parse_datetime(payload.get("fetchedAt"))
            if not fetched_at:
                return None
            age = (now - fetched_at).total_seconds()
            if age < 0 or age > self.cache_seconds:
                return None
            rows, flags = payload.get("rows"), payload.get("flags")
            if not isinstance(rows, list) or not isinstance(flags, list):
                return None
            return rows, [str(flag) for flag in flags]
        except (OSError, json.JSONDecodeError, AttributeError):
            return None

    def _write_cache(self, now: datetime, rows: list[dict[str, Any]], flags: list[str]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = self._cache_path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"fetchedAt": now.isoformat(), "rows": rows, "flags": flags}, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._cache_path)

    def _fetch_gdelt(self, as_of: datetime) -> list[dict[str, Any]]:
        query = "(" + " OR ".join(f'\"{term}\"' for term in GDELT_QUERY_TERMS) + ")"
        end_utc = as_of.astimezone(timezone.utc)
        start_utc = end_utc - timedelta(hours=self.lookback_hours)
        params = urlencode({
            "query": query, "mode": "artlist", "maxrecords": 250,
            "sort": "datedesc", "format": "json",
            "startdatetime": start_utc.strftime("%Y%m%d%H%M%S"),
            "enddatetime": end_utc.strftime("%Y%m%d%H%M%S"),
        })
        payload = self.transport.json(f"https://api.gdeltproject.org/api/v2/doc/doc?{params}")
        articles = payload.get("articles", [])
        if not isinstance(articles, list):
            raise MarketDataError("GDELT response does not contain an article list")
        normalized: list[dict[str, Any]] = []
        for raw in articles:
            if not isinstance(raw, dict):
                continue
            title = html.unescape(str(raw.get("title") or "")).strip()
            published_at = _parse_datetime(raw.get("seendate"))
            if not title or not published_at:
                continue
            domain = str(raw.get("domain") or "unknown").strip().lower()[:80]
            normalized.append({
                "title": title, "content": "",
                "url": _canonical_url(raw.get("url") or raw.get("url_mobile")),
                "source": f"gdelt:{domain}", "publishedAt": published_at.isoformat(),
                "language": str(raw.get("language") or "").strip()[:30] or None,
                "trustLevel": "NORMAL",
            })
        return normalized

    def _fetch_finnhub(self) -> list[dict[str, Any]]:
        params = urlencode({"category": "general", "minId": 0, "token": self.finnhub_api_key})
        raw_payload = json.loads(self.transport.text(f"https://finnhub.io/api/v1/news?{params}"))
        if not isinstance(raw_payload, list):
            raise MarketDataError("Finnhub response does not contain a news list")
        normalized: list[dict[str, Any]] = []
        for raw in raw_payload:
            if not isinstance(raw, dict):
                continue
            title = html.unescape(str(raw.get("headline") or "")).strip()
            try:
                published_at = datetime.fromtimestamp(float(raw.get("datetime")), tz=timezone.utc).astimezone(SHANGHAI)
            except (TypeError, ValueError, OSError):
                published_at = None
            if not title or not published_at:
                continue
            normalized.append({
                "title": title,
                "content": html.unescape(str(raw.get("summary") or "")).strip()[:4000],
                "url": _canonical_url(raw.get("url")),
                "source": f"finnhub:{str(raw.get('source') or 'market').strip()[:80]}",
                "publishedAt": published_at.isoformat(), "language": "en", "trustLevel": "NORMAL",
            })
        return normalized

    def _fetch_google_rss(self) -> list[dict[str, Any]]:
        query = "(" + " OR ".join(f'\"{term}\"' for term in GDELT_QUERY_TERMS) + ")"
        params = urlencode({
            "q": query,
            "hl": "en-US",
            "gl": "US",
            "ceid": "US:en",
        })
        payload = self.transport.text(f"https://news.google.com/rss/search?{params}")
        try:
            root = ET.fromstring(payload)
        except ET.ParseError as exc:
            raise MarketDataError("Google News RSS returned invalid XML") from exc
        normalized: list[dict[str, Any]] = []
        for item in root.findall("./channel/item"):
            title = html.unescape((item.findtext("title") or "").strip())
            link = item.findtext("link") or ""
            published_text = item.findtext("pubDate") or ""
            try:
                published_at = parsedate_to_datetime(published_text).astimezone(SHANGHAI)
            except (TypeError, ValueError, OverflowError):
                published_at = None
            if not title or not published_at:
                continue
            source_node = item.find("source")
            publisher = (
                html.unescape((source_node.text or "").strip())
                if source_node is not None else "unknown"
            )[:75]
            description = html.unescape(item.findtext("description") or "")
            description = re.sub(r"<[^>]+>", " ", description)
            description = re.sub(r"\s+", " ", description).strip()[:4000]
            normalized.append({
                "title": title,
                "content": description,
                "url": _canonical_url(link),
                "source": f"google_news_rss:{publisher}",
                "publishedAt": published_at.isoformat(),
                "language": "en",
                "trustLevel": "NORMAL",
            })
        return normalized

    def _fetch_rows(self, as_of: datetime) -> tuple[list[dict[str, Any]], list[str]]:
        rows: list[dict[str, Any]] = []
        flags: list[str] = []
        successful: list[str] = []
        providers: dict[str, Any] = {"gdelt": lambda: self._fetch_gdelt(as_of)}
        if self.google_rss_enabled:
            providers["google_rss"] = self._fetch_google_rss
        if self.finnhub_api_key:
            providers["finnhub"] = self._fetch_finnhub
        with ThreadPoolExecutor(max_workers=len(providers)) as executor:
            futures = {executor.submit(fetch): name for name, fetch in providers.items()}
            for future in as_completed(futures):
                name = futures[future]
                try:
                    provider_rows = future.result()
                    rows.extend(provider_rows)
                    successful.append(name)
                except Exception as exc:
                    flags.append(f"global_news_{name}_unavailable:{type(exc).__name__}")
        successful.sort()
        if "google_rss" in successful:
            flags.append("global_news_google_rss_unofficial")
        flags.append(
            "global_news_sources:" + ",".join(successful)
            if successful else "global_news_all_sources_unavailable"
        )
        return rows, flags

    def fetch(self, code: str, as_of: datetime) -> tuple[list[NewsEvent], list[str]]:
        now = datetime.now(SHANGHAI)
        # 历史训练必须从仓库同时按 published_at 与 ingested_at 回放，不能事后调用实时 API。
        if as_of < now - timedelta(minutes=15):
            return [], ["global_news_historical_replay_requires_warehouse"]
        with self._lock:
            cached = self._read_cache(now)
            if cached is None:
                rows, flags = self._fetch_rows(as_of)
                self._write_cache(now, rows, flags)
            else:
                rows, flags = cached

        events: list[NewsEvent] = []
        cutoff = as_of - timedelta(hours=self.lookback_hours)
        for raw in rows:
            published_at = _parse_datetime(raw.get("publishedAt"))
            if not published_at or published_at > as_of or published_at < cutoff:
                continue
            title, content = str(raw.get("title") or "").strip(), str(raw.get("content") or "").strip()
            relation = _relation(code, f"{title}\n{content}")
            if not relation:
                continue
            relevance, relation_type = relation
            keyword, sentiment = classify_title(f"{title} {content}")
            event_type = relation_type if keyword == "未分类公告" else keyword
            source = str(raw.get("source") or "global_news")[:100]
            url = _canonical_url(raw.get("url"))
            event_id = hashlib.sha256(
                f"{source}|{url or ''}|{published_at.isoformat()}|{_normalize_text(title)}".encode("utf-8")
            ).hexdigest()[:24]
            events.append(NewsEvent(
                event_id=event_id, code=code, title=title, published_at=published_at,
                source=source, sentiment=sentiment, relevance=relevance, novelty=1.0,
                event_type=event_type, content=content, url=url,
                trust_level=str(raw.get("trustLevel") or "NORMAL"),
                language=str(raw.get("language") or "").strip() or None,
            ))
        return events, list(flags)


class NewsFusionClient:
    """Merge official announcements and global market news without hiding gaps."""

    def __init__(
        self,
        transport: HttpTransport,
        cache_dir: Path,
        announcement_cache_seconds: int = 90,
        global_cache_seconds: int = 60,
        global_lookback_hours: int = 36,
        global_enabled: bool = True,
        google_rss_enabled: bool = True,
        finnhub_api_key: str = "",
    ):
        self.announcements = AnnouncementClient(transport, cache_dir, announcement_cache_seconds)
        self.global_enabled = global_enabled
        self.global_news = GlobalNewsClient(
            transport,
            cache_dir,
            global_cache_seconds,
            global_lookback_hours,
            google_rss_enabled,
            finnhub_api_key,
        )

    def fetch(self, code: str, as_of: datetime) -> tuple[list[NewsEvent], list[str]]:
        announcement_events, flags = self.announcements.fetch(code, as_of)
        global_events: list[NewsEvent] = []
        if self.global_enabled:
            global_events, global_flags = self.global_news.fetch(code, as_of)
            flags.extend(global_flags)
        else:
            flags.append("global_news_disabled")

        merged = announcement_events + global_events
        merged.sort(key=lambda event: event.published_at or datetime.min.replace(tzinfo=SHANGHAI), reverse=True)
        seen: set[str] = set()
        result: list[NewsEvent] = []
        for event in merged:
            key = _normalize_text(event.title)
            novelty = 0.35 if key in seen else event.novelty
            seen.add(key)
            result.append(event if novelty == event.novelty else replace(event, novelty=novelty))
        if not global_events and self.global_enabled and any(flag.startswith("global_news_sources:") for flag in flags):
            flags.append("global_news_no_relevant_event")
        if result:
            flags.append("news_sentiment_lexicon_unvalidated")
        return result, list(dict.fromkeys(flags))


def aggregate_news_score(events: list[NewsEvent], as_of: datetime) -> float:
    weighted = 0.0
    total_weight = 0.0
    trust_weights = {"HIGH": 1.0, "NORMAL": 0.8, "LOW": 0.45}
    for event in events:
        if not event.published_at or event.published_at > as_of:
            continue
        age_hours = max(0.0, (as_of - event.published_at).total_seconds() / 3600.0)
        decay = math.exp(-age_hours / 48.0)
        trust = trust_weights.get(event.trust_level.upper(), 0.6)
        weight = event.relevance * event.novelty * decay * trust
        weighted += event.sentiment * weight
        total_weight += weight
    if total_weight <= 0:
        return 0.0
    return max(-1.0, min(1.0, weighted / total_weight))
