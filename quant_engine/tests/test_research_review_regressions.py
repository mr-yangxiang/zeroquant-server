"""Isolated fixtures for the 2026-09-11 audit. Never persisted or production evidence.

The neutral provider name deliberately avoids the separate test-source gate so
these tests exercise coverage PASS/BLOCKED, with a one-day test-only requirement.
"""
import copy
from datetime import timedelta
from pathlib import Path
import unittest

from test_research_pipeline import bar
from zeroquant.research.data import CODES, build_dataset, instant, normalize_record, quality_report
from zeroquant.research.execution import CostConfig, _valid_valuation, new_account, promotion_evidence, shadow_step
from zeroquant.research.shadow import run_shadow


PROVIDER = "isolated-coverage-provider"
CONTRACT = {PROVIDER: {"availability_verified": True, "evidence_reference": "ISOLATED_TEST_ONLY"}}


def fixture(kind, code, at, payload, delay=0):
    available = at + timedelta(seconds=delay)
    return normalize_record({"kind": kind, "stock_code": code, "source": PROVIDER,
                             "event_at": at.isoformat(), "available_at": available.isoformat(),
                             "payload": payload}, available + timedelta(seconds=.5), CONTRACT)


def fixture_day(day, count=240, l2_delay=0):
    start = instant(f"{day}T09:31:00+08:00")
    records = [fixture("calendar", "MARKET", start.replace(hour=0, minute=0), {"is_trading_day": True})]
    for code in CODES:
        for i in range(count):
            at = start + timedelta(minutes=i + (90 if i >= 120 else 0))
            records.append(fixture("minute", code, at, bar(at, code=code)["payload"]))
            records.append(fixture("l2", code, at, {"level": 2,
                "bids": [[10 - j*.01, 100] for j in range(5)],
                "asks": [[10.01 + j*.01, 100] for j in range(5)]}, delay=l2_delay))
        records.append(fixture("news", code, start, {"title": "ISOLATED_TEST_ONLY"}))
        records.append(fixture("dragon_tiger", code, start, {"seat_name": "ISOLATED_TEST_ONLY", "side": "BUY",
                                                               "buy_amount": 100, "sell_amount": 0, "net_amount": 100}))
    return records


class CoverageRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.history = fixture_day("2026-09-10")

    def test_dense_books_pass_and_match_generated_features(self):
        quality = quality_report(self.history, minimum_days=1)
        self.assertTrue(quality["production_ready"], quality["issues"])
        rows, manifest = build_dataset(self.history, build_at=instant("2026-09-11T08:00:00+08:00"))
        self.assertEqual(len(rows), 234)
        self.assertTrue(all(r["features"]["l2_missing"] == 0 for r in rows))
        self.assertEqual(manifest["quality"]["quality_policy"], "pit_coverage_v2")
        for code in CODES:
            coverage = quality["l2_decision_coverage"][code]["2026-09-10"]
            self.assertEqual(coverage["decision_count"], 210)
            self.assertEqual(coverage["coverage_ratio"], 1)

    def test_one_book_per_day_cannot_pass(self):
        sparse = [r for r in self.history if r["kind"] != "l2" or "09:31:00" in r["event_at"]]
        quality = quality_report(sparse, minimum_days=1)
        self.assertFalse(quality["production_ready"])
        self.assertTrue(any("实际决策时点" in issue for issue in quality["issues"]))
        rows, _ = build_dataset(sparse, build_at=instant("2026-09-11T08:00:00+08:00"))
        self.assertTrue(all(r["features"]["l2_missing"] == 1 for r in rows))
        self.assertTrue(all(n == 1 for n in quality["l2_coverage_days"].values()))

    def test_late_books_cannot_backfill_decisions(self):
        late = fixture_day("2026-09-10", l2_delay=10)
        quality = quality_report(late, minimum_days=1)
        self.assertFalse(quality["production_ready"])
        rows, _ = build_dataset(late, build_at=instant("2026-09-11T08:00:00+08:00"))
        self.assertTrue(rows)
        self.assertTrue(all(r["features"]["l2_missing"] == 1 for r in rows))

    def test_one_symbol_gap_not_hidden_by_other_symbols_or_daily_ratio(self):
        records = [r for r in self.history if not (r["kind"] == "l2" and r["stock_code"] == CODES[0]
                   and "10:01:00" <= r["event_at"][11:19] <= "10:06:00")]
        quality = quality_report(records, minimum_days=1)
        bad = quality["l2_decision_coverage"][CODES[0]]["2026-09-10"]
        self.assertGreater(bad["coverage_ratio"], .95)
        self.assertEqual(bad["max_missing_run_minutes"], 6)
        self.assertFalse(bad["passed"])
        self.assertFalse(quality["production_ready"])

    def test_partial_day_passes_without_counting_as_completed_history(self):
        records = self.history + fixture_day("2026-09-11", count=60)
        quality = quality_report(records, minimum_days=1, as_of=instant("2026-09-11T10:30:01+08:00"), require_current_day=True)
        self.assertTrue(quality["production_ready"], quality["issues"])
        self.assertTrue(all(c["days"] == 1 and c["observed_days"] == 2 for c in quality["coverage"].values()))
        self.assertFalse(quality_report(records, minimum_days=2, as_of=instant("2026-09-11T10:30:01+08:00"))["production_ready"])
        self.assertFalse(quality_report(records, minimum_days=1)["production_ready"])

    def test_elapsed_missing_minute_still_blocks(self):
        current = [r for r in fixture_day("2026-09-11", count=60)
                   if not (r["kind"] == "minute" and r["stock_code"] == CODES[0] and "10:29:00" in r["event_at"])]
        quality = quality_report(self.history + current, minimum_days=1, as_of=instant("2026-09-11T10:30:01+08:00"))
        self.assertFalse(quality["production_ready"])
        self.assertEqual(quality["coverage"][CODES[0]]["missing_minutes_by_day"]["2026-09-11"], [58])

    def test_ingestion_grace_expires_after_sixty_seconds(self):
        records = self.history + fixture_day("2026-09-11", count=59)
        self.assertTrue(quality_report(records, minimum_days=1, as_of=instant("2026-09-11T10:30:01+08:00"))["production_ready"])
        self.assertFalse(quality_report(records, minimum_days=1, as_of=instant("2026-09-11T10:31:00+08:00"))["production_ready"])

    def test_lunch_and_preopen_do_not_require_future_bars(self):
        lunch = self.history + fixture_day("2026-09-11", count=120)
        for at in ("12:30:00", "13:00:30"):
            report = quality_report(lunch, minimum_days=1, as_of=instant(f"2026-09-11T{at}+08:00"))
            self.assertTrue(report["production_ready"], report["issues"])
        preopen = self.history + fixture_day("2026-09-11", count=0)
        report = quality_report(preopen, minimum_days=1, as_of=instant("2026-09-11T09:20:00+08:00"), require_current_day=True)
        self.assertTrue(report["production_ready"], report["issues"])

    def test_after_close_requires_full_session(self):
        partial = self.history + fixture_day("2026-09-11", count=239)
        self.assertFalse(quality_report(partial, minimum_days=1, as_of=instant("2026-09-11T15:01:00+08:00"))["production_ready"])
        complete = self.history + fixture_day("2026-09-11")
        self.assertTrue(quality_report(complete, minimum_days=2, as_of=instant("2026-09-11T15:01:00+08:00"))["production_ready"])

    def test_current_calendar_required_and_future_receipts_excluded(self):
        now = instant("2026-09-11T10:30:01+08:00")
        quality = quality_report(self.history, minimum_days=1, as_of=now, require_current_day=True)
        self.assertTrue(any("当日交易日历" in i for i in quality["issues"]))
        current = fixture_day("2026-09-11", count=60)
        for r in current:
            if r["kind"] == "minute" and "10:29:00" in r["event_at"]:
                r["ingested_at"] = (now + timedelta(minutes=1)).isoformat()
        quality = quality_report(self.history + current, minimum_days=1, as_of=now)
        self.assertEqual(quality["excluded_future_or_unreceived_rows"], 6)
        self.assertFalse(quality["production_ready"])

    def test_explicit_nontrading_day_does_not_require_bars(self):
        at = instant("2026-09-12T00:00:00+08:00")
        holiday = fixture("calendar", "MARKET", at, {"is_trading_day": False})
        report = quality_report(self.history + [holiday], minimum_days=1,
                                as_of=at + timedelta(hours=10), require_current_day=True)
        self.assertTrue(report["production_ready"], report["issues"])


class ValuationRegressionTests(unittest.TestCase):
    def setUp(self):
        self.now = instant("2026-09-11T10:30:01+08:00")
        self.costs = CostConfig()

    def account(self):
        return new_account(initial_lots={"600839": [{"shares": 100, "cost": 10., "acquired_date": "2026-09-10"}]})

    def quote(self, code="600839", price=10., now=None):
        at = (now or self.now).replace(second=0)
        return fixture("minute", code, at, bar(at, code=code, price=price)["payload"])

    def reasons(self, state, now=None):
        return promotion_evidence({}, state, self.costs, now or self.now, True)["reasons"]

    def test_other_symbol_does_not_refresh_held_position(self):
        state = self.account()
        state["last_prices"]["600839"] = 10.
        state, _, _ = shadow_step(state, [], [self.quote("000572", 20.)], self.now, "isolated", self.costs)
        point = state["equity"][-1]
        self.assertEqual(point["value"], 101000)
        self.assertFalse(point["fresh_prices"])
        self.assertEqual(point["missing_symbols"], ["600839"])
        self.assertEqual(point["valuation_status"], "UNVERIFIED_ESTIMATE")
        self.assertTrue(any("逐股估值" in r for r in self.reasons(state)))

    def test_fresh_marks_expire_individually_at_evaluation_time(self):
        state, _, _ = shadow_step(self.account(), [], [self.quote()], self.now, "isolated", self.costs)
        self.assertTrue(_valid_valuation(state["equity"][-1], self.now))
        self.assertFalse(any("逐股估值" in r for r in self.reasons(state)))
        later = self.now + timedelta(seconds=61)
        # The point itself is <120s old, but its held-symbol receipt is stale.
        self.assertTrue(any("逐股估值" in r for r in self.reasons(state, later)))
        original = copy.deepcopy(state["equity"][0])
        state, _, _ = shadow_step(state, [], [self.quote("000572", now=later)], later, "isolated", self.costs)
        self.assertEqual(state["equity"][-1]["stale_symbols"], ["600839"])
        self.assertEqual(state["equity"][0], original)

    def test_old_unproven_points_are_not_repaired_by_fresh_final_point(self):
        state = self.account()
        state["equity"] = [{"at": (self.now - timedelta(minutes=1)).isoformat(), "value": 101000, "fresh_prices": True}]
        state, _, _ = shadow_step(state, [], [self.quote()], self.now, "isolated", self.costs)
        self.assertTrue(state["equity"][-1]["fresh_prices"])
        self.assertTrue(any("逐股估值" in r for r in self.reasons(state)))

    def test_cash_only_account_needs_no_unrelated_quote(self):
        state, _, _ = shadow_step(new_account(), [], [], self.now, "isolated", self.costs)
        point = state["equity"][-1]
        self.assertEqual(point["positions"], {})
        self.assertTrue(point["fresh_prices"])
        self.assertTrue(_valid_valuation(point, self.now))

    def test_tampered_mark_or_omitted_position_blocks(self):
        state, _, _ = shadow_step(self.account(), [], [self.quote()], self.now, "isolated", self.costs)
        point = state["equity"][-1]
        point["marks"]["600839"]["payload"]["close"] = 11.
        point["value"] = 101100
        self.assertFalse(_valid_valuation(point, self.now))
        point.update(positions={}, marks={}, value=point["cash"])
        self.assertTrue(any("逐股估值" in r for r in self.reasons(state)))

    def test_open_and_resumption_wait_before_writing_any_valuation(self):
        # None warehouse and nonexistent artifact prove no database or model IO.
        for time in ("09:30:00", "09:31:59", "13:00:00", "13:01:59"):
            result = run_shadow(None, Path("/nonexistent-isolated-artifact"), self.costs,
                                instant(f"2026-09-11T{time}+08:00"))
            self.assertEqual(result["status"], "WAITING_FOR_FIRST_CLOSED_MINUTE")
            self.assertFalse(result["production_approved"])

    def test_malformed_historical_timestamp_fails_closed(self):
        state, _, _ = shadow_step(self.account(), [], [self.quote()], self.now, "isolated", self.costs)
        state["equity"][0]["at"] = "not-a-time"
        self.assertTrue(any("时间证据" in r for r in self.reasons(state)))

    def test_old_quality_approval_cannot_inherit_new_policy(self):
        result = promotion_evidence({"data_ready": True}, new_account(), self.costs, self.now, True)
        self.assertFalse(result["approved"])
        self.assertEqual(result["policy_version"], "production_v2")
        self.assertTrue(any("旧质量结论" in r for r in result["reasons"]))


if __name__ == "__main__":
    unittest.main()
