from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from zeroquant.config import ENGINE_DIR, Settings
from zeroquant.curve import build_compatible_curve, build_forward_rolling_curve, trading_time_points
from zeroquant.features import extract_features
from zeroquant.forecast import ModelArtifact, ProbabilityForecastEngine
from zeroquant.models import DailyBar, MinuteBar, NewsEvent, QuoteSnapshot
from zeroquant.pipeline import ForecastPipeline
from zeroquant.regime import detect_regime
from zeroquant.risk import apply_hard_risk_gates


SHANGHAI = ZoneInfo("Asia/Shanghai")


def quote() -> QuoteSnapshot:
    return QuoteSnapshot(
        code="600839",
        full_code="sh600839",
        name="四川长虹",
        timestamp=datetime(2026, 9, 4, 10, 0, tzinfo=SHANGHAI),
        price=10.20,
        previous_close=10.00,
        open_price=10.05,
        high=10.30,
        low=9.95,
        volume=100000,
        amount=102000000,
    )


def daily_bars() -> list[DailyBar]:
    bars = []
    for index in range(60):
        close = 9.0 + index * 0.015
        bars.append(DailyBar(f"2026-{6 + index // 28:02d}-{1 + index % 28:02d}", close - 0.03, close, close + 0.08, close - 0.08, 1000 + index, 1000000 + index))
    return bars


def minute_bars() -> list[MinuteBar]:
    return [MinuteBar(f"09:{30 + index:02d}", 10.0 + index * 0.01, 100 + index * 5, (100 + index * 5) * (10.0 + index * 0.01) * 100) for index in range(25)]


class ProbabilityCoreTests(unittest.TestCase):
    def test_probabilities_sum_to_one_and_bootstrap_is_not_actionable(self):
        as_of = datetime(2026, 9, 4, 10, 0, tzinfo=SHANGHAI)
        features = extract_features(quote(), as_of, daily_bars(), minute_bars(), [])
        artifact = ModelArtifact.load(ENGINE_DIR / "models" / "bootstrap_probability_v1.json")
        forecasts = ProbabilityForecastEngine(artifact, 18).predict(quote(), features, detect_regime(features))
        for forecast in forecasts:
            self.assertAlmostEqual(forecast.p_up + forecast.p_flat + forecast.p_down, 1.0, places=5)
            self.assertFalse(forecast.actionable)
            self.assertLessEqual(forecast.confidence, 0.60)
        forced = ProbabilityForecastEngine(artifact, 18, allow_uncalibrated_trading=True).predict(
            quote(), features, detect_regime(features)
        )
        self.assertTrue(all(not forecast.actionable for forecast in forced))

    def test_curve_is_legacy_compatible_and_exposes_uncertainty(self):
        as_of = datetime(2026, 9, 4, 10, 0, tzinfo=SHANGHAI)
        features = extract_features(quote(), as_of, daily_bars(), minute_bars(), [])
        artifact = ModelArtifact.load(ENGINE_DIR / "models" / "bootstrap_probability_v1.json")
        forecasts = ProbabilityForecastEngine(artifact, 18).predict(quote(), features, detect_regime(features), (5, 15, 30, 60, 120, 240))
        curve = build_compatible_curve(quote().price, quote().previous_close, forecasts)
        self.assertEqual(len(curve), 242)
        self.assertEqual(len(trading_time_points()), 242)
        self.assertTrue(all(point["lower"] <= point["price"] <= point["upper"] for point in curve))
        self.assertTrue(all(9.0 <= point["price"] <= 11.0 for point in curve))

    def test_curve_does_not_inject_hand_written_stock_profiles(self):
        as_of = datetime(2026, 9, 4, 10, 0, tzinfo=SHANGHAI)
        features = extract_features(quote(), as_of, daily_bars(), minute_bars(), [])
        artifact = ModelArtifact.load(ENGINE_DIR / "models" / "bootstrap_probability_v1.json")
        forecasts = ProbabilityForecastEngine(artifact, 18).predict(
            quote(), features, detect_regime(features), (5, 15, 30, 60, 120, 240)
        )
        first = build_compatible_curve(quote().price, quote().previous_close, forecasts, stock_code="600839")
        second = build_compatible_curve(quote().price, quote().previous_close, forecasts, stock_code="603696")
        self.assertEqual(first, second)

    def test_realtime_curve_contains_only_current_and_future_points(self):
        as_of = datetime(2026, 9, 4, 10, 0, tzinfo=SHANGHAI)
        features = extract_features(quote(), as_of, daily_bars(), minute_bars(), [])
        artifact = ModelArtifact.load(ENGINE_DIR / "models" / "bootstrap_probability_v1.json")
        forecasts = ProbabilityForecastEngine(artifact, 18).predict(quote(), features, detect_regime(features))
        curve = build_forward_rolling_curve(
            stock_code="600839",
            current_time="10:00",
            current_price=10.20,
            previous_close=10.00,
            minute_bars=minute_bars(),
            forecasts=forecasts,
        )
        self.assertEqual(curve[0], {"targetTime": "10:00", "predictedPrice": 10.20, "leadMinutes": 0})
        self.assertEqual(curve[-1]["targetTime"], "15:00")
        self.assertEqual(curve[5]["leadMinutes"], 5)
        self.assertTrue(all(point["targetTime"] >= "10:00" for point in curve))

    def test_pipeline_hash_is_stable_for_identical_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Settings(
                server_url="http://127.0.0.1:3002",
                internal_token="",
                request_timeout_seconds=1,
                news_cache_seconds=90,
                audit_dir=Path(tmp),
                state_dir=Path(tmp),
                model_path=ENGINE_DIR / "models" / "bootstrap_probability_v1.json",
                allow_uncalibrated_trading=False,
                estimated_round_trip_cost_bps=18,
            )
            pipeline = ForecastPipeline(settings)
            as_of = datetime(2026, 9, 4, 10, 0, tzinfo=SHANGHAI)
            first = pipeline.run(quote(), as_of, "realtime", daily_bars(), minute_bars(), [])
            second = pipeline.run(quote(), as_of, "realtime", daily_bars(), minute_bars(), [])
            with_profile = pipeline.run(
                quote(), as_of, "realtime", daily_bars(), minute_bars(), [],
                entity_profile_signal=0.5,
                entity_profile_confidence=0.8,
                entity_profile_snapshot_as_of="2026-09-03T18:25:00+08:00",
            )
            self.assertEqual(first.input_hash, second.input_hash)
            self.assertNotEqual(first.input_hash, with_profile.input_hash)
            self.assertNotEqual(first.run_id, second.run_id)
            self.assertEqual(first.model_state, "untrained_bootstrap")
            self.assertFalse(first.to_dict()["modelCalibrated"])

    def test_entity_profile_feature_is_confidence_shrunk(self):
        as_of = datetime(2026, 9, 4, 10, 0, tzinfo=SHANGHAI)
        features = extract_features(
            quote(),
            as_of,
            daily_bars(),
            minute_bars(),
            [],
            entity_profile_signal=0.8,
            entity_profile_confidence=0.25,
        )
        self.assertAlmostEqual(features.values["entity_behavior_signal"], 0.2)
        self.assertAlmostEqual(features.values["entity_behavior_confidence"], 0.25)

    def test_entity_profile_feature_is_clipped_and_zero_without_confidence(self):
        as_of = datetime(2026, 9, 4, 10, 0, tzinfo=SHANGHAI)
        clipped = extract_features(
            quote(), as_of, daily_bars(), minute_bars(), [],
            entity_profile_signal=3.0, entity_profile_confidence=2.0,
        )
        absent = extract_features(
            quote(), as_of, daily_bars(), minute_bars(), [],
            entity_profile_signal=0.9, entity_profile_confidence=0.0,
        )
        self.assertEqual(clipped.values["entity_behavior_signal"], 1.0)
        self.assertEqual(absent.values["entity_behavior_signal"], 0.0)

    def test_stale_data_hard_gate_overrides_model_actionability(self):
        as_of = datetime(2026, 9, 4, 10, 0, tzinfo=SHANGHAI)
        features = extract_features(quote(), as_of, daily_bars(), minute_bars(), [], ["stale_quote_over_10_minutes"])
        artifact = ModelArtifact.load(ENGINE_DIR / "models" / "bootstrap_probability_v1.json")
        forecasts = ProbabilityForecastEngine(artifact, 18, allow_uncalibrated_trading=True).predict(quote(), features, detect_regime(features))
        gated, reasons = apply_hard_risk_gates(quote(), features, forecasts)
        self.assertIn("stale_market_data", reasons)
        self.assertTrue(all(not item.actionable for item in gated))


if __name__ == "__main__":
    unittest.main()
