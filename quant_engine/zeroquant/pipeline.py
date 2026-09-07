from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime

from .config import Settings
from .curve import build_compatible_curve
from .features import extract_features
from .forecast import ModelArtifact, ProbabilityForecastEngine
from .models import DailyBar, ForecastRun, MinuteBar, NewsEvent, QuoteSnapshot
from .regime import detect_regime
from .risk import apply_hard_risk_gates


def _input_hash(
    quote: QuoteSnapshot,
    daily_bars: list[DailyBar],
    minute_bars: list[MinuteBar],
    events: list[NewsEvent],
) -> str:
    payload = {
        "quote": {
            "code": quote.code,
            "timestamp": quote.timestamp.isoformat(),
            "price": quote.price,
            "previousClose": quote.previous_close,
            "open": quote.open_price,
            "high": quote.high,
            "low": quote.low,
            "volume": quote.volume,
            "amount": quote.amount,
        },
        "dailyTail": [bar.__dict__ for bar in daily_bars[-30:]],
        "minuteTail": [bar.__dict__ for bar in minute_bars[-60:]],
        "eventIds": [event.event_id for event in events],
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class ForecastPipeline:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.artifact = ModelArtifact.load(settings.model_path)
        self.engine = ProbabilityForecastEngine(
            self.artifact,
            estimated_round_trip_cost_bps=settings.estimated_round_trip_cost_bps,
            allow_uncalibrated_trading=settings.allow_uncalibrated_trading,
        )

    def run(
        self,
        quote: QuoteSnapshot,
        as_of: datetime,
        mode: str,
        daily_bars: list[DailyBar] | None = None,
        minute_bars: list[MinuteBar] | None = None,
        news_events: list[NewsEvent] | None = None,
        source_flags: list[str] | None = None,
    ) -> ForecastRun:
        daily_bars = daily_bars or []
        minute_bars = minute_bars or []
        news_events = news_events or []
        features = extract_features(
            quote=quote,
            as_of=as_of,
            daily_bars=daily_bars,
            minute_bars=minute_bars,
            news_events=news_events,
            source_flags=source_flags,
        )
        regime = detect_regime(features)
        horizons = (5, 15, 30, 60, 120, 240) if mode == "daily" else (5, 15, 30, 60)
        forecasts = self.engine.predict(quote, features, regime, horizons=horizons)
        forecasts, risk_gates = apply_hard_risk_gates(quote, features, forecasts)
        warnings: list[str] = []
        if not self.artifact.calibrated:
            warnings.append("研究模式：当前 bootstrap 模型未经走样本外训练与概率校准，禁止自动交易")
        if features.quality_score < self.artifact.minimum_quality:
            warnings.append("数据质量未达到生产交易门槛")
        if "true_l2_order_flow_unavailable" in features.quality_flags:
            warnings.append("当前公共行情源不包含可验证的多档委托流，未计算真实 OFI")
        if risk_gates:
            warnings.append("硬风控已触发：" + ",".join(risk_gates))

        run = ForecastRun(
            run_id=str(uuid.uuid4()),
            stock_code=quote.code,
            stock_name=quote.name,
            trade_date=as_of.date().isoformat(),
            as_of=as_of,
            mode=mode,
            reference_price=quote.price,
            previous_close=quote.previous_close,
            model_version=self.artifact.version,
            model_state=self.artifact.state,
            regime=regime,
            features=features,
            horizons=forecasts,
            news_events=news_events,
            input_hash=_input_hash(quote, daily_bars, minute_bars, news_events),
            warnings=warnings,
        )
        if mode == "daily":
            run.legacy_curve = build_compatible_curve(
                reference_price=quote.price,
                previous_close=quote.previous_close,
                forecasts=forecasts,
                stock_code=quote.code,
            )
        return run
