from __future__ import annotations

import json
import math
import ssl
import time
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

from .config import StockSpec
from .models import DailyBar, MinuteBar, QuoteSnapshot


SHANGHAI = ZoneInfo("Asia/Shanghai")


class MarketDataError(RuntimeError):
    pass


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def _parse_tencent_timestamp(value: str) -> datetime:
    for fmt in ("%Y%m%d%H%M%S", "%Y%m%d"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=SHANGHAI)
        except ValueError:
            continue
    return datetime.now(SHANGHAI)


class HttpTransport:
    def __init__(self, timeout_seconds: float = 5.0):
        self.timeout_seconds = timeout_seconds
        try:
            import certifi  # type: ignore

            self.ssl_context = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            self.ssl_context = ssl.create_default_context()

    def text(self, url: str, encoding: str = "utf-8") -> str:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ZeroQuant/2.0; point-in-time research)",
                "Accept": "application/json,text/plain,*/*",
            },
        )
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(
                    request,
                    timeout=self.timeout_seconds,
                    context=self.ssl_context,
                ) as response:
                    return response.read().decode(encoding, errors="replace")
            except Exception as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.2 * (attempt + 1))
        raise MarketDataError(f"market data request failed: {url}: {last_error}") from last_error

    def json(self, url: str, encoding: str = "utf-8") -> dict:
        try:
            value = json.loads(self.text(url, encoding=encoding))
        except json.JSONDecodeError as exc:
            raise MarketDataError(f"invalid JSON response: {url}") from exc
        if not isinstance(value, dict):
            raise MarketDataError(f"unexpected JSON response: {url}")
        return value


class TencentMarketDataProvider:
    def __init__(self, transport: HttpTransport):
        self.transport = transport

    def fetch_quotes(self, stocks: tuple[StockSpec, ...]) -> dict[str, QuoteSnapshot]:
        if not stocks:
            return {}
        codes = ",".join(stock.full_code for stock in stocks)
        raw = self.transport.text(f"http://qt.gtimg.cn/q={codes}", encoding="gbk")
        specs = {stock.code: stock for stock in stocks}
        result: dict[str, QuoteSnapshot] = {}
        for line in raw.split(";"):
            fields = line.split("~")
            if len(fields) <= 37:
                continue
            code = fields[2]
            spec = specs.get(code)
            if not spec:
                continue
            price = _safe_float(fields[3])
            previous_close = _safe_float(fields[4])
            if price <= 0 or previous_close <= 0:
                continue
            result[code] = QuoteSnapshot(
                code=code,
                full_code=spec.full_code,
                name=fields[1] or spec.name,
                timestamp=_parse_tencent_timestamp(fields[30]),
                price=price,
                previous_close=previous_close,
                open_price=_safe_float(fields[5], price),
                high=_safe_float(fields[33], price),
                low=_safe_float(fields[34], price),
                volume=_safe_float(fields[6]),
                amount=_safe_float(fields[37]),
            )
        return result

    def fetch_minutes(self, stock: StockSpec) -> list[MinuteBar]:
        payload = self.transport.json(
            f"http://web.ifzq.gtimg.cn/appstock/app/minute/query?code={stock.full_code}"
        )
        rows = (
            payload.get("data", {})
            .get(stock.full_code, {})
            .get("data", {})
            .get("data", [])
        )
        result: list[MinuteBar] = []
        for row in rows if isinstance(rows, list) else []:
            parts = str(row).split()
            if len(parts) < 2:
                continue
            hhmm = parts[0]
            result.append(
                MinuteBar(
                    time=f"{hhmm[:2]}:{hhmm[2:4]}",
                    price=_safe_float(parts[1]),
                    volume=_safe_float(parts[2]) if len(parts) > 2 else 0.0,
                    amount=_safe_float(parts[3]) if len(parts) > 3 else 0.0,
                )
            )
        return [bar for bar in result if bar.price > 0]


class DailyHistoryProvider:
    def __init__(self, transport: HttpTransport):
        self.transport = transport

    def fetch_daily_bars(self, stock: StockSpec, limit: int = 180) -> list[DailyBar]:
        payload = self.transport.json(
            "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
            f"?param={stock.full_code},day,,,{limit},qfq"
        )
        stock_payload = (payload.get("data") or {}).get(stock.full_code, {})
        rows = stock_payload.get("qfqday") or stock_payload.get("day") or []
        result: list[DailyBar] = []
        for row in rows if isinstance(rows, list) else []:
            parts = row if isinstance(row, list) else str(row).split(",")
            if len(parts) < 6:
                continue
            result.append(
                DailyBar(
                    date=parts[0],
                    open_price=_safe_float(parts[1]),
                    close=_safe_float(parts[2]),
                    high=_safe_float(parts[3]),
                    low=_safe_float(parts[4]),
                    volume=_safe_float(parts[5]),
                    amount=_safe_float(parts[6]) if len(parts) > 6 else 0.0,
                )
            )
        return [bar for bar in result if min(bar.open_price, bar.close, bar.high, bar.low) > 0]


# Backward-compatible import for scripts deployed during the first migration.
EastmoneyDailyProvider = DailyHistoryProvider
