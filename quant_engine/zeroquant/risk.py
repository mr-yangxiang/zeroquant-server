from __future__ import annotations

from dataclasses import replace

from .models import FeatureSnapshot, HorizonForecast, QuoteSnapshot


def apply_hard_risk_gates(
    quote: QuoteSnapshot,
    features: FeatureSnapshot,
    forecasts: list[HorizonForecast],
) -> tuple[list[HorizonForecast], list[str]]:
    """Apply deterministic gates that no statistical model may override."""
    gates: list[str] = []
    if abs(quote.pct_change) >= 9.8:
        gates.append("price_limit_proximity")
    if "stale_quote_over_10_minutes" in features.quality_flags:
        gates.append("stale_market_data")
    if features.quality_score < 0.50:
        gates.append("critical_data_quality")
    if not gates:
        return forecasts, gates
    reason = "硬风控禁止交易：" + ",".join(gates)
    return [
        replace(item, actionable=False, reasons=tuple([*item.reasons, reason]))
        for item in forecasts
    ], gates
