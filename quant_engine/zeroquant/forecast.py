from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

from .models import FeatureSnapshot, HorizonForecast, QuoteSnapshot, Regime


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _sigmoid(value: float) -> float:
    if value >= 0:
        z = math.exp(-value)
        return 1.0 / (1.0 + z)
    z = math.exp(value)
    return z / (1.0 + z)


@dataclass(frozen=True)
class ModelArtifact:
    version: str
    state: str
    calibrated: bool
    weights: dict[str, float]
    regime_adjustments: dict[str, float]
    minimum_quality: float
    minimum_confidence: float

    @classmethod
    def load(cls, path: Path) -> "ModelArtifact":
        payload = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            version=str(payload["version"]),
            state=str(payload.get("state", "untrained_bootstrap")),
            calibrated=bool(payload.get("calibrated", False)),
            weights={str(k): float(v) for k, v in payload.get("weights", {}).items()},
            regime_adjustments={
                str(k): float(v) for k, v in payload.get("regimeAdjustments", {}).items()
            },
            minimum_quality=float(payload.get("minimumQuality", 0.80)),
            minimum_confidence=float(payload.get("minimumConfidence", 0.62)),
        )


class ProbabilityForecastEngine:
    """Auditable bootstrap model behind a versioned artifact.

    The bundled artifact is intentionally marked untrained and uncalibrated. It
    provides honest, deterministic probability plumbing while preventing the
    application from presenting research output as an executable trading edge.
    A walk-forward validated champion artifact can later replace it without
    changing the surrounding data contract.
    """

    def __init__(
        self,
        artifact: ModelArtifact,
        estimated_round_trip_cost_bps: float,
        allow_uncalibrated_trading: bool = False,
    ):
        self.artifact = artifact
        self.cost_pct = estimated_round_trip_cost_bps / 100.0
        self.allow_uncalibrated_trading = allow_uncalibrated_trading

    def _score(self, features: FeatureSnapshot, regime: Regime) -> tuple[float, list[str]]:
        contributions: list[tuple[str, float]] = []
        score = self.artifact.regime_adjustments.get(regime.name, 0.0)
        for name, weight in self.artifact.weights.items():
            contribution = weight * features.values.get(name, 0.0)
            score += contribution
            if abs(contribution) >= 0.03:
                contributions.append((name, contribution))
        contributions.sort(key=lambda item: abs(item[1]), reverse=True)
        reasons = [f"{name}={value:+.3f}" for name, value in contributions[:4]]
        if not reasons:
            reasons.append("有效方向信号较弱")
        return _clip(score, -4.0, 4.0), reasons

    def predict(
        self,
        quote: QuoteSnapshot,
        features: FeatureSnapshot,
        regime: Regime,
        horizons: tuple[int, ...] = (5, 15, 30, 60),
    ) -> list[HorizonForecast]:
        base_score, base_reasons = self._score(features, regime)
        minute_vol = features.values.get("intraday_volatility", 0.0)
        if minute_vol <= 0:
            minute_vol = features.values.get("daily_volatility", 0.0) / math.sqrt(240.0)
        minute_vol = max(minute_vol, 0.00035)
        average_range = max(features.values.get("average_daily_range", 0.0), minute_vol * math.sqrt(240.0))

        forecasts: list[HorizonForecast] = []
        for horizon in horizons:
            horizon_scale = math.sqrt(max(1.0, horizon) / 15.0)
            score = _clip(base_score * horizon_scale, -4.0, 4.0)
            directional_up = _sigmoid(score)
            flat = _clip(0.18 + 0.34 * math.exp(-abs(score)), 0.12, 0.55)
            p_up = (1.0 - flat) * directional_up
            p_down = (1.0 - flat) * (1.0 - directional_up)

            sigma_pct = minute_vol * math.sqrt(horizon) * 100.0
            range_floor_pct = average_range * math.sqrt(horizon / 240.0) * 100.0
            sigma_pct = max(sigma_pct, range_floor_pct, 0.08)
            expected_abs_move = sigma_pct * 0.80
            expected = (p_up - p_down) * expected_abs_move
            q50 = expected
            q10 = q50 - 1.2816 * sigma_pct
            q90 = q50 + 1.2816 * sigma_pct

            raw_confidence = (0.42 + min(abs(score), 2.0) * 0.12) * features.quality_score
            confidence_cap = 0.92 if self.artifact.calibrated else 0.60
            confidence = _clip(raw_confidence, 0.05, confidence_cap)
            clears_cost = abs(expected) > self.cost_pct * 1.25
            trusted_model = self.artifact.calibrated or self.allow_uncalibrated_trading
            actionable = (
                trusted_model
                and features.quality_score >= self.artifact.minimum_quality
                and confidence >= self.artifact.minimum_confidence
                and clears_cost
            )
            reasons = list(base_reasons)
            if not self.artifact.calibrated:
                reasons.append("模型尚未通过样本外概率校准")
            if not clears_cost:
                reasons.append("预期波动未覆盖估算交易成本安全边际")
            forecasts.append(
                HorizonForecast(
                    horizon_minutes=horizon,
                    p_up=round(p_up, 6),
                    p_flat=round(flat, 6),
                    p_down=round(p_down, 6),
                    expected_return_pct=round(expected, 6),
                    q10_return_pct=round(q10, 6),
                    q50_return_pct=round(q50, 6),
                    q90_return_pct=round(q90, 6),
                    confidence=round(confidence, 6),
                    actionable=actionable,
                    reasons=tuple(reasons),
                )
            )
        return forecasts
