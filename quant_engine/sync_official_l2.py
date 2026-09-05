#!/usr/bin/env python3
"""Compatibility entry point for public transaction-print ingestion.

The upstream endpoint exposes transaction prints, not beneficial-owner or
broker-seat identity.  The previous implementation assigned famous seat names
by list position; that fabricated attribution has intentionally been removed.
"""

from __future__ import annotations

import json
from datetime import datetime, time
from zoneinfo import ZoneInfo

from zeroquant.config import STOCKS, Settings
from zeroquant.providers import HttpTransport, MarketDataError
from zeroquant.sink import PredictionSink


SHANGHAI = ZoneInfo("Asia/Shanghai")


def _parse_page(raw: str, stock_code: str, trade_date: str) -> list[dict]:
    if '[0,"' not in raw:
        return []
    encoded = raw.split('[0,"', 1)[1].split('"]', 1)[0]
    records: list[dict] = []
    for item in encoded.split("|"):
        parts = item.split("/")
        if len(parts) < 7:
            continue
        try:
            volume_lots = float(parts[4])
            price = float(parts[2])
            turnover = float(parts[5])
        except ValueError:
            continue
        if price <= 0 or volume_lots <= 0:
            continue
        direction = {"B": "主动买入成交", "S": "主动卖出成交"}.get(parts[6], "中性成交")
        records.append(
            {
                "stockCode": stock_code,
                "tradeDate": trade_date,
                "timeStr": parts[1],
                "type": direction,
                "price": price,
                "volumeLots": volume_lots,
                "note": f"腾讯公开逐笔成交代理数据；成交额 {turnover / 10000:.2f} 万元；不包含席位或账户身份",
            }
        )
    return records


def fetch_and_sync_official_l2(persist: bool = True) -> list[dict]:
    now = datetime.now(SHANGHAI)
    if now.weekday() >= 5 or now.time().replace(tzinfo=None) < time(9, 25):
        print(f"[{now.isoformat()}] public trade ingestion skipped outside eligible session")
        return []
    settings = Settings.from_env()
    transport = HttpTransport(settings.request_timeout_seconds)
    records: list[dict] = []
    for stock in STOCKS:
        for page in range(2):
            url = f"http://stock.gtimg.cn/data/index.php?appn=detail&action=data&c={stock.full_code}&p={page}"
            try:
                records.extend(_parse_page(transport.text(url, encoding="gbk"), stock.code, now.date().isoformat()))
            except MarketDataError as exc:
                print(f"{stock.code}: public trade page unavailable: {exc}")
                break

    if persist and records:
        sink = PredictionSink(settings)
        sink.persist_public_trades(records)
    print(json.dumps({"source": "tencent_public_prints", "records": len(records), "seatIdentity": False}, ensure_ascii=False))
    return records


if __name__ == "__main__":
    fetch_and_sync_official_l2()
