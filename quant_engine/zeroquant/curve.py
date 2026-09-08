from __future__ import annotations

import math
from datetime import datetime
from typing import Any
from .models import HorizonForecast


def trading_time_points() -> list[str]:
    points: list[str] = []
    for hour, start, end in ((9, 30, 59), (10, 0, 59), (11, 0, 30)):
        points.extend(f"{hour:02d}:{minute:02d}" for minute in range(start, end + 1))
    for hour, start, end in ((13, 0, 59), (14, 0, 59), (15, 0, 0)):
        points.extend(f"{hour:02d}:{minute:02d}" for minute in range(start, end + 1))
    return points


def _interpolate(anchors: list[tuple[int, float]], minute: int) -> float:
    if minute <= anchors[0][0]:
        return anchors[0][1]
    if minute >= anchors[-1][0]:
        return anchors[-1][1]
    for left, right in zip(anchors, anchors[1:]):
        if left[0] <= minute <= right[0]:
            ratio = (minute - left[0]) / max(1, right[0] - left[0])
            return left[1] + (right[1] - left[1]) * ratio
    return anchors[-1][1]


def build_compatible_curve(
    reference_price: float,
    previous_close: float,
    forecasts: list[HorizonForecast],
    stock_code: str | None = None,
    limit_ratio: float = 0.10,
) -> list[dict[str, float | str]]:
    """Render the model quantiles without injecting hand-written stock waves.

    ``stock_code`` remains in the signature for compatibility with callers. A
    genuine intraday seasonal profile may only be added after it is estimated
    point-in-time from versioned historical data and validated out of sample.
    """
    points = trading_time_points()
    q10 = [(0, 0.0)] + [(item.horizon_minutes, item.q10_return_pct) for item in forecasts]
    q50 = [(0, 0.0)] + [(item.horizon_minutes, item.q50_return_pct) for item in forecasts]
    q90 = [(0, 0.0)] + [(item.horizon_minutes, item.q90_return_pct) for item in forecasts]
    lower_limit = previous_close * (1.0 - limit_ratio)
    upper_limit = previous_close * (1.0 + limit_ratio)

    curve: list[dict[str, float | str]] = []
    for minute, label in enumerate(points):
        low = reference_price * (1.0 + _interpolate(q10, minute) / 100.0)
        median = reference_price * (1.0 + _interpolate(q50, minute) / 100.0)
        high = reference_price * (1.0 + _interpolate(q90, minute) / 100.0)

        low = max(lower_limit, min(upper_limit, low))
        median = max(lower_limit, min(upper_limit, median))
        high = max(lower_limit, min(upper_limit, high))
        curve.append(
            {
                "time": label,
                "price": round(median, 2),
                "lower": round(min(low, median), 2),
                "upper": round(max(high, median), 2),
            }
        )
    return curve


def build_forward_rolling_curve(
    stock_code: str,
    current_time: str | datetime,
    current_price: float,
    previous_close: float,
    base_points: list[dict[str, Any]] | None = None,
    minute_bars: list[Any] | None = None,
    forecasts: list[HorizonForecast] | None = None,
    limit_ratio: float = 0.10,
) -> list[dict[str, float | str]]:
    """Generate dynamic rolling predictions from 09:30 to 15:00.

    1. Past timestamps (09:30 .. current_minute - 1):
       - Strictly preserves original historical prediction trajectory (does NOT rewrite history, does NOT delete).
    2. Current timestamp:
       - Smoothly anchors to current real-time market price.
    3. Future timestamps (current_minute + 1 .. 15:00):
       - Dynamically reshapes future path by combining:
         a) Base model's relative wave movement from now to future minute
         b) Real-time 15-minute price momentum with exponential decay
         c) Real-time VWAP mean-reversion pull
    """
    points = trading_time_points()
    total_pts = len(points)
    now_str = current_time if isinstance(current_time, str) else current_time.strftime("%H:%M")
    match_idx = next((i for i, t in enumerate(points) if t >= now_str), total_pts - 1)

    lower_limit = previous_close * (1.0 - limit_ratio)
    upper_limit = previous_close * (1.0 + limit_ratio)

    if not base_points or len(base_points) < total_pts:
        base_points = build_compatible_curve(
            reference_price=current_price,
            previous_close=previous_close,
            forecasts=forecasts or [],
            stock_code=stock_code,
            limit_ratio=limit_ratio,
        )

    # 1. 计算近 15 分钟价格动量斜率 (momentum_slope)
    momentum_slope = 0.0
    vwap = current_price
    if minute_bars and len(minute_bars) >= 1:
        lookback = min(15, len(minute_bars))
        if lookback > 1:
            p_end = float(getattr(minute_bars[-1], "price", current_price))
            p_start = float(getattr(minute_bars[-lookback], "price", current_price))
            momentum_slope = (p_end - p_start) / float(lookback)

        # 计算日内实际 VWAP (若数据异常则回退至现价)
        total_vol = sum(float(getattr(b, "volume", 0)) for b in minute_bars)
        total_amt = sum(float(getattr(b, "amount", 0)) for b in minute_bars)
        if total_vol > 0 and total_amt > 0:
            calc_vwap = total_amt / (total_vol * 100.0)
            if abs(calc_vwap - current_price) / current_price < 0.15:
                vwap = calc_vwap

    base_at_match = float(base_points[match_idx].get("price", current_price))

    rolling: list[dict[str, float | int | str]] = []

    # 铁律：严禁虚假补充历史数据！
    # 数据库没有落盘真实数据就返回没有，空在那里，图表里也断开缺失，绝不允许虚假捏造补齐！
    # 动态重塑线仅从当前分钟锚点 (match_idx) 起向未来生成真实的动态重塑走势
    for idx in range(match_idx, total_pts):
        label = points[idx]
        if idx == match_idx:
            # 当前时间点平滑锚定在实盘最新成交价
            rolling.append({"targetTime": label, "predictedPrice": round(current_price, 2), "leadMinutes": 0})
        else:
            # 未来时间段：动态前向重塑！
            future_step = idx - match_idx
            base_future = float(base_points[idx].get("price", current_price))
            wave_diff = base_future - base_at_match

            # 即时动量外推与指数衰减；外推距离随预测步数增长，避免首个未来点突然跳变。
            decay = math.exp(-future_step / 18.0)
            trend_extrap = momentum_slope * future_step * decay

            # 向可观察的日内 VWAP 回归，不假定任何“主力筹码重心”。
            reversion_weight = (1.0 - math.exp(-future_step / 35.0)) * 0.40
            reversion = (vwap - current_price) * reversion_weight

            raw_forward_p = current_price + wave_diff + trend_extrap + reversion
            forward_p = max(lower_limit, min(upper_limit, raw_forward_p))
            rolling.append({"targetTime": label, "predictedPrice": round(forward_p, 2), "leadMinutes": future_step})

    return rolling
