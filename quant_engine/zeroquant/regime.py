from __future__ import annotations

from .models import FeatureSnapshot, Regime


def detect_regime(features: FeatureSnapshot) -> Regime:
    value = features.values
    momentum = value.get("momentum_z", 0.0)
    daily_vol = value.get("daily_volatility", 0.0)
    intraday_vol = value.get("intraday_volatility", 0.0)
    news = value.get("news_score", 0.0)
    volume_acceleration = value.get("volume_acceleration", 0.0)

    if abs(news) >= 0.45 and volume_acceleration >= 0.35:
        return Regime(
            "event_driven",
            min(0.85, 0.50 + abs(news) * 0.25 + min(volume_acceleration, 1.0) * 0.15),
            ("公告事件强度较高", "成交活跃度同步上升"),
        )
    if abs(momentum) >= 1.25:
        direction = "up" if momentum > 0 else "down"
        return Regime(
            f"trend_{direction}",
            min(0.85, 0.50 + abs(momentum) * 0.12),
            ("标准化动量超过趋势阈值",),
        )
    if intraday_vol >= 0.006 or daily_vol >= 0.045:
        return Regime(
            "high_volatility",
            min(0.80, 0.50 + max(intraday_vol / 0.02, daily_vol / 0.10) * 0.20),
            ("实现波动率处于高位",),
        )
    return Regime(
        "range_bound",
        min(0.75, 0.52 + max(0.0, 1.0 - abs(momentum)) * 0.15),
        ("动量未达到趋势阈值",),
    )
