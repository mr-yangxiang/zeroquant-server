from __future__ import annotations

import math
from datetime import datetime
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
    limit_ratio: float = 0.10,
) -> list[dict[str, float | str]]:
    """Render probability forecasts for the legacy chart without inventing waves.

    The legacy ``price`` field is the median path.  The additional lower/upper
    fields are consumed by newer clients and safely ignored by old clients.
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
    current_time: str | datetime,
    current_price: float,
    previous_close: float,
    forecasts: list[HorizonForecast],
    limit_ratio: float = 0.10,
    vwap: float | None = None,
) -> list[dict[str, float | str]]:
    """Generate forward rolling predictions from current minute to 15:00.

    Does NOT backfill past timestamps:
    - At match_idx (current minute): exact current_price (smooth anchor)
    - Future minutes (match_idx + 1 .. 15:00): forward prediction based on horizon forecast + VWAP reversion
    """
    points = trading_time_points()
    now_str = current_time if isinstance(current_time, str) else current_time.strftime("%H:%M")
    match_idx = next((i for i, t in enumerate(points) if t >= now_str), len(points) - 1)

    q50 = [(0, 0.0)] + [(item.horizon_minutes, item.q50_return_pct) for item in forecasts]
    lower_limit = previous_close * (1.0 - limit_ratio)
    upper_limit = previous_close * (1.0 + limit_ratio)
    target_vwap = vwap if (vwap and vwap > 0) else current_price

    rolling: list[dict[str, float | str]] = []
    for idx in range(match_idx, len(points)):
        label = points[idx]
        if idx == match_idx:
            rolling.append({"targetTime": label, "predictedPrice": round(current_price, 4)})
        else:
            future_mins = idx - match_idx
            ret_pct = _interpolate(q50, min(future_mins, 240))
            forecast_p = current_price * (1.0 + ret_pct / 100.0)

            # VWAP reversion over time
            reversion_weight = min(0.45, (1.0 - math.exp(-future_mins / 30.0)) * 0.5)
            forward_p = forecast_p * (1.0 - reversion_weight) + target_vwap * reversion_weight
            forward_p = max(lower_limit, min(upper_limit, forward_p))
            rolling.append({"targetTime": label, "predictedPrice": round(forward_p, 4)})
    return rolling
