from __future__ import annotations

import math
import statistics
from datetime import datetime

from .models import DailyBar, FeatureSnapshot, MinuteBar, NewsEvent, QuoteSnapshot
from .news import aggregate_news_score


def _returns(prices: list[float]) -> list[float]:
    result: list[float] = []
    for previous, current in zip(prices, prices[1:]):
        if previous > 0 and current > 0:
            result.append(math.log(current / previous))
    return result


def _std(values: list[float]) -> float:
    return statistics.pstdev(values) if len(values) >= 2 else 0.0


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def extract_features(
    quote: QuoteSnapshot,
    as_of: datetime,
    daily_bars: list[DailyBar] | None = None,
    minute_bars: list[MinuteBar] | None = None,
    news_events: list[NewsEvent] | None = None,
    source_flags: list[str] | None = None,
) -> FeatureSnapshot:
    daily_bars = daily_bars or []
    minute_bars = minute_bars or []
    news_events = news_events or []
    flags = list(source_flags or [])
    values: dict[str, float] = {}

    filtered_daily = [bar for bar in daily_bars if bar.date < as_of.date().isoformat()]
    daily_prices = [bar.close for bar in filtered_daily]
    daily_returns = _returns(daily_prices)
    daily_vol = _std(daily_returns[-20:])
    values["daily_volatility"] = daily_vol
    values["daily_momentum_5"] = (
        daily_prices[-1] / daily_prices[-6] - 1.0 if len(daily_prices) >= 6 else 0.0
    )
    values["daily_momentum_20"] = (
        daily_prices[-1] / daily_prices[-21] - 1.0 if len(daily_prices) >= 21 else 0.0
    )
    ranges = [
        (bar.high - bar.low) / bar.close
        for bar in filtered_daily[-20:]
        if bar.close > 0 and bar.high >= bar.low
    ]
    values["average_daily_range"] = sum(ranges) / len(ranges) if ranges else 0.0

    minute_prices = [bar.price for bar in minute_bars if bar.price > 0]
    minute_returns = _returns(minute_prices)
    values["intraday_return_1"] = (
        minute_prices[-1] / minute_prices[-2] - 1.0 if len(minute_prices) >= 2 else 0.0
    )
    values["intraday_return_5"] = (
        minute_prices[-1] / minute_prices[-6] - 1.0 if len(minute_prices) >= 6 else 0.0
    )
    values["intraday_return_15"] = (
        minute_prices[-1] / minute_prices[-16] - 1.0 if len(minute_prices) >= 16 else 0.0
    )
    intraday_vol = _std(minute_returns[-30:])
    values["intraday_volatility"] = intraday_vol

    total_volume = sum(max(0.0, bar.volume) for bar in minute_bars)
    total_amount = sum(max(0.0, bar.amount) for bar in minute_bars)
    vwap = total_amount / (total_volume * 100.0) if total_volume > 0 and total_amount > 0 else 0.0
    if not (quote.price * 0.8 <= vwap <= quote.price * 1.2):
        vwap = statistics.fmean(minute_prices) if minute_prices else quote.price
        if minute_bars:
            flags.append("provider_vwap_unavailable_using_price_mean")
    values["vwap_gap"] = quote.price / vwap - 1.0 if vwap > 0 else 0.0

    day_range = max(0.0, quote.high - quote.low)
    values["intraday_range"] = day_range / quote.previous_close if quote.previous_close > 0 else 0.0
    values["range_position"] = (
        _clip(2.0 * (quote.price - quote.low) / day_range - 1.0, -1.0, 1.0)
        if day_range > 0
        else 0.0
    )
    values["opening_gap"] = (
        quote.open_price / quote.previous_close - 1.0 if quote.previous_close > 0 else 0.0
    )

    recent_volumes = [max(0.0, bar.volume) for bar in minute_bars[-20:] if bar.volume > 0]
    if len(recent_volumes) >= 10:
        first = statistics.fmean(recent_volumes[: len(recent_volumes) // 2])
        second = statistics.fmean(recent_volumes[len(recent_volumes) // 2 :])
        values["volume_acceleration"] = _clip(second / first - 1.0, -2.0, 3.0) if first > 0 else 0.0
    else:
        values["volume_acceleration"] = 0.0

    base_vol = intraday_vol if intraday_vol > 1e-6 else daily_vol / math.sqrt(240.0)
    momentum = values["intraday_return_15"] if len(minute_prices) >= 16 else values["daily_momentum_5"] / math.sqrt(5.0)
    values["momentum_z"] = _clip(momentum / max(base_vol * math.sqrt(15.0), 0.001), -4.0, 4.0)
    values["vwap_gap_z"] = _clip(values["vwap_gap"] / max(base_vol * 2.0, 0.001), -4.0, 4.0)
    values["momentum_volume"] = values["momentum_z"] * max(0.0, values["volume_acceleration"])
    values["news_score"] = aggregate_news_score(news_events, as_of)
    values["order_flow_imbalance"] = 0.0
    flags.append("true_l2_order_flow_unavailable")

    if len(filtered_daily) < 40:
        flags.append("insufficient_daily_history")
    if minute_bars and len(minute_bars) < 16:
        flags.append("insufficient_intraday_history")
    if not news_events:
        flags.append("no_point_in_time_news_event")

    quality = 1.0
    quality -= 0.20 if len(filtered_daily) < 40 else 0.0
    quality -= 0.15 if minute_bars and len(minute_bars) < 16 else 0.0
    quality -= 0.15  # no true L2 OFI in the current public feed
    quality -= 0.10 if any(flag.startswith("announcement_source_unavailable") for flag in flags) else 0.0
    quality -= 0.05 if "provider_vwap_unavailable_using_price_mean" in flags else 0.0
    return FeatureSnapshot(
        values=values,
        quality_score=round(_clip(quality, 0.0, 1.0), 4),
        quality_flags=tuple(dict.fromkeys(flags)),
        observed_at=quote.timestamp,
    )
