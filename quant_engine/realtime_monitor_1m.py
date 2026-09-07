#!/usr/bin/env python3
"""One-minute probability updater for observable live market data.

No broker seat or beneficial-owner identity is inferred from public prints. The
script emits a five-minute median forecast plus calibration-ready probability
records and never rewrites historical observations.
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from zeroquant.audit import append_run_jsonl
from zeroquant.config import STOCKS, Settings, StockSpec
from zeroquant.curve import build_forward_rolling_curve
from zeroquant.models import ForecastRun, QuoteSnapshot
from zeroquant.news import AnnouncementClient
from zeroquant.pipeline import ForecastPipeline
from zeroquant.providers import (
    DailyHistoryProvider,
    HttpTransport,
    MarketDataError,
    TencentMarketDataProvider,
)
from zeroquant.sink import PredictionSink


SHANGHAI = ZoneInfo("Asia/Shanghai")


def is_continuous_auction(now: datetime) -> bool:
    if now.weekday() >= 5:
        return False
    current = now.time().replace(tzinfo=None)
    return time(9, 30) <= current <= time(11, 30) or time(13, 0) <= current <= time(15, 0)


def run_1m_check(debug: bool = False, persist: bool = True) -> list[ForecastRun]:
    settings = Settings.from_env()
    now = datetime.now(SHANGHAI)
    if not debug and not is_continuous_auction(now):
        print(f"[{now.isoformat()}] outside continuous auction; no fetch and no write")
        return []

    transport = HttpTransport(settings.request_timeout_seconds)
    market = TencentMarketDataProvider(transport)
    daily = DailyHistoryProvider(transport)
    news = AnnouncementClient(transport, settings.state_dir / "news", settings.news_cache_seconds)
    pipeline = ForecastPipeline(settings)
    sink = PredictionSink(settings)
    try:
        quotes = market.fetch_quotes(STOCKS)
    except MarketDataError as exc:
        print(f"live quote batch unavailable; all fallbacks will be stale and non-actionable: {exc}", file=sys.stderr)
        quotes = {}

    def stale_daily_quote(stock: StockSpec, bars) -> QuoteSnapshot:
        if not bars:
            raise MarketDataError(f"{stock.code}: no reference price source")
        latest = bars[-1]
        previous = bars[-2].close if len(bars) >= 2 else latest.close
        return QuoteSnapshot(
            code=stock.code,
            full_code=stock.full_code,
            name=stock.name,
            timestamp=datetime.combine(date.fromisoformat(latest.date), time(15, 0), SHANGHAI),
            price=latest.close,
            previous_close=previous,
            open_price=latest.open_price,
            high=latest.high,
            low=latest.low,
            volume=latest.volume,
            amount=latest.amount,
        )

    minutes_map: dict[str, Any] = {}

    def process(stock: StockSpec) -> ForecastRun:
        flags: list[str] = []
        try:
            daily_bars = daily.fetch_daily_bars(stock, limit=90)
        except MarketDataError:
            daily_bars = []
            flags.append("daily_history_source_unavailable")
        quote = quotes.get(stock.code) or stale_daily_quote(stock, daily_bars)
        if stock.code not in quotes:
            flags.append("live_quote_source_unavailable_using_daily_close")
        try:
            minutes = market.fetch_minutes(stock)
            minutes_map[stock.code] = minutes
        except MarketDataError:
            minutes = []
            flags.append("intraday_minute_source_unavailable")
        events, news_flags = news.fetch(stock.code, now)
        flags.extend(news_flags)
        if abs((now - quote.timestamp).total_seconds()) > 10 * 60:
            flags.append("stale_quote_over_10_minutes")
        return pipeline.run(
            quote=quote,
            as_of=now,
            mode="realtime",
            daily_bars=daily_bars,
            minute_bars=minutes,
            news_events=events,
            source_flags=flags,
        )

    runs: list[ForecastRun] = []
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(process, stock): stock for stock in STOCKS}
        for future in as_completed(futures):
            stock = futures[future]
            try:
                runs.append(future.result())
            except Exception as exc:
                failures.append(f"{stock.code}:{type(exc).__name__}:{exc}")
    runs.sort(key=lambda item: item.stock_code)

    for run in runs:
        append_run_jsonl(run, settings.audit_dir)
        if not persist:
            continue
        try:
            sink.persist_run(run)
            quote = quotes.get(run.stock_code)
            if quote is None:
                continue
            
            # 实时生成从 09:30 保留历史预判、当前分钟平滑锚定、未来动态重塑至 15:00 的全天趋势线 (黄虚线)
            current_hhmm = now.strftime("%H:%M")
            base_points = sink.fetch_base_points(run.stock_code, run.trade_date)
            rolling_curve = build_forward_rolling_curve(
                stock_code=run.stock_code,
                current_time=current_hhmm,
                current_price=quote.price,
                previous_close=quote.previous_close,
                base_points=base_points,
                minute_bars=minutes_map.get(run.stock_code, []),
                forecasts=run.horizons,
            )
            sink.persist_realtime_point(
                run,
                real_price=quote.price,
                high_price=quote.high,
                low_price=quote.low,
                pct=quote.pct_change,
                rolling_predictions=rolling_curve,
            )
        except Exception as exc:
            print(f"{run.stock_code}: persistence failed: {exc}", file=sys.stderr)

    result = {
        "asOf": now.isoformat(),
        "mode": "debug" if debug else "live",
        "persisted": persist,
        "modelVersion": pipeline.artifact.version,
        "stocks": [run.stock_code for run in runs],
        "failures": failures,
    }
    print(json.dumps(result, ensure_ascii=False))
    if not runs and failures:
        raise RuntimeError("no realtime forecast could be produced")
    return runs


def main() -> None:
    parser = argparse.ArgumentParser(description="Run ZeroQuant one-minute probability update")
    parser.add_argument("--debug", action="store_true", help="run outside continuous auction")
    parser.add_argument("--no-persist", action="store_true", help="do not call persistence APIs")
    args = parser.parse_args()
    run_1m_check(debug=args.debug, persist=not args.no_persist)


if __name__ == "__main__":
    main()
