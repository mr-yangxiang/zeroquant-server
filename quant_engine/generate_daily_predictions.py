#!/usr/bin/env python3
"""Generate a point-in-time, probabilistic pre-market forecast.

This entry point preserves the scheduler contract of the original script while
delegating all research logic to the side-effect-free ``zeroquant`` package.
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from zeroquant.audit import append_run_jsonl, write_daily_markdown
from zeroquant.config import STOCKS, Settings, StockSpec
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


def _historical_quote(stock: StockSpec, bars, as_of: datetime) -> QuoteSnapshot | None:
    eligible = [bar for bar in bars if bar.date < as_of.date().isoformat()]
    if not eligible:
        return None
    latest = eligible[-1]
    previous = eligible[-2].close if len(eligible) >= 2 else latest.close
    return QuoteSnapshot(
        code=stock.code,
        full_code=stock.full_code,
        name=stock.name,
        timestamp=datetime.combine(date.fromisoformat(latest.date), time(15, 0), SHANGHAI),
        price=latest.close,
        previous_close=previous,
        open_price=latest.close,
        high=latest.close,
        low=latest.close,
        volume=latest.volume,
        amount=latest.amount,
    )


def run_generator(target_date: str | None = None, persist: bool = True) -> list[ForecastRun]:
    settings = Settings.from_env()
    target = date.fromisoformat(target_date) if target_date else datetime.now(SHANGHAI).date()
    now = datetime.now(SHANGHAI)
    as_of = now if target == now.date() else datetime.combine(target, time(9, 20), SHANGHAI)

    transport = HttpTransport(settings.request_timeout_seconds)
    market = TencentMarketDataProvider(transport)
    daily = DailyHistoryProvider(transport)
    news = AnnouncementClient(transport, settings.state_dir / "news", settings.news_cache_seconds)
    pipeline = ForecastPipeline(settings)
    sink = PredictionSink(settings)

    try:
        live_quotes = market.fetch_quotes(STOCKS) if target == now.date() else {}
    except MarketDataError as exc:
        print(f"quote batch unavailable: {exc}", file=sys.stderr)
        live_quotes = {}

    def process(stock: StockSpec) -> ForecastRun:
        bars = daily.fetch_daily_bars(stock)
        quote = live_quotes.get(stock.code) or _historical_quote(stock, bars, as_of)
        if quote is None:
            raise MarketDataError(f"{stock.code}: no point-in-time reference price")
        events, flags = news.fetch(stock.code, as_of)
        if quote.timestamp.date() < as_of.date():
            flags.append("premarket_quote_uses_previous_session")
        return pipeline.run(
            quote=quote,
            as_of=as_of,
            mode="daily",
            daily_bars=bars,
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
        if persist:
            try:
                sink.persist_run(run)
            except Exception as exc:
                print(f"{run.stock_code}: queued in outbox after persistence failure: {exc}", file=sys.stderr)
    if runs:
        report = write_daily_markdown(runs, settings.audit_dir)
        print(f"audit_report={report}")
    if failures:
        print("failures=" + json.dumps(failures, ensure_ascii=False), file=sys.stderr)
    if not runs:
        raise RuntimeError("no stock forecast could be produced")
    print(
        json.dumps(
            {
                "tradeDate": target.isoformat(),
                "modelVersion": pipeline.artifact.version,
                "modelState": pipeline.artifact.state,
                "persisted": persist,
                "stocks": [run.stock_code for run in runs],
                "failures": failures,
            },
            ensure_ascii=False,
        )
    )
    return runs


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate ZeroQuant daily probability forecasts")
    parser.add_argument("target_date", nargs="?", help="YYYY-MM-DD; defaults to today")
    parser.add_argument("--no-persist", action="store_true", help="do not call the server persistence API")
    args = parser.parse_args()
    run_generator(args.target_date, persist=not args.no_persist)


if __name__ == "__main__":
    main()
