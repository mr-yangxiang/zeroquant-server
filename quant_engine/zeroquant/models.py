from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class QuoteSnapshot:
    code: str
    full_code: str
    name: str
    timestamp: datetime
    price: float
    previous_close: float
    open_price: float
    high: float
    low: float
    volume: float = 0.0
    amount: float = 0.0

    @property
    def pct_change(self) -> float:
        if self.previous_close <= 0:
            return 0.0
        return (self.price / self.previous_close - 1.0) * 100.0


@dataclass(frozen=True)
class MinuteBar:
    time: str
    price: float
    volume: float = 0.0
    amount: float = 0.0


@dataclass(frozen=True)
class DailyBar:
    date: str
    open_price: float
    close: float
    high: float
    low: float
    volume: float
    amount: float


@dataclass(frozen=True)
class NewsEvent:
    event_id: str
    code: str
    title: str
    published_at: datetime | None
    source: str
    sentiment: float
    relevance: float
    novelty: float
    event_type: str

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["published_at"] = self.published_at.isoformat() if self.published_at else None
        return data


@dataclass(frozen=True)
class FeatureSnapshot:
    values: dict[str, float]
    quality_score: float
    quality_flags: tuple[str, ...]
    observed_at: datetime


@dataclass(frozen=True)
class Regime:
    name: str
    confidence: float
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class HorizonForecast:
    horizon_minutes: int
    p_up: float
    p_flat: float
    p_down: float
    expected_return_pct: float
    q10_return_pct: float
    q50_return_pct: float
    q90_return_pct: float
    confidence: float
    actionable: bool
    reasons: tuple[str, ...]


@dataclass
class ForecastRun:
    run_id: str
    stock_code: str
    stock_name: str
    trade_date: str
    as_of: datetime
    mode: str
    reference_price: float
    previous_close: float
    model_version: str
    model_state: str
    regime: Regime
    features: FeatureSnapshot
    horizons: list[HorizonForecast]
    news_events: list[NewsEvent]
    input_hash: str
    warnings: list[str] = field(default_factory=list)
    legacy_curve: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "stockCode": self.stock_code,
            "stockName": self.stock_name,
            "tradeDate": self.trade_date,
            "asOf": self.as_of.isoformat(),
            "mode": self.mode,
            "referencePrice": self.reference_price,
            "previousClose": self.previous_close,
            "modelVersion": self.model_version,
            "modelState": self.model_state,
            "regime": asdict(self.regime),
            "features": {
                "values": self.features.values,
                "qualityScore": self.features.quality_score,
                "qualityFlags": list(self.features.quality_flags),
                "observedAt": self.features.observed_at.isoformat(),
            },
            "horizons": [
                {
                    "horizonMinutes": h.horizon_minutes,
                    "pUp": h.p_up,
                    "pFlat": h.p_flat,
                    "pDown": h.p_down,
                    "expectedReturnPct": h.expected_return_pct,
                    "q10ReturnPct": h.q10_return_pct,
                    "q50ReturnPct": h.q50_return_pct,
                    "q90ReturnPct": h.q90_return_pct,
                    "confidence": h.confidence,
                    "actionable": h.actionable,
                    "reasons": list(h.reasons),
                }
                for h in self.horizons
            ],
            "newsEvents": [event.to_dict() for event in self.news_events],
            "inputHash": self.input_hash,
            "warnings": self.warnings,
            "legacyCurve": self.legacy_curve,
        }
