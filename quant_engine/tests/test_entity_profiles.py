from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from zeroquant.config import ENGINE_DIR, Settings
from zeroquant.entity_profiles import EntityProfileClient


class _Response:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class EntityProfileClientTests(unittest.TestCase):
    def settings(self, root: Path) -> Settings:
        return Settings(
            server_url="http://127.0.0.1:3002",
            internal_token="",
            request_timeout_seconds=1,
            news_cache_seconds=90,
            audit_dir=root,
            state_dir=root,
            model_path=ENGINE_DIR / "models" / "bootstrap_probability_v1.json",
            allow_uncalibrated_trading=False,
            estimated_round_trip_cost_bps=18,
        )

    def test_reads_point_in_time_profile_and_clips_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = {
                "data": {
                    "signal": 2,
                    "confidence": 0.7,
                    "researchReadyEntityCount": 3,
                    "snapshotAsOf": "2026-09-03T18:25:00+08:00",
                }
            }
            with patch("urllib.request.urlopen", return_value=_Response(payload)):
                context = EntityProfileClient(self.settings(Path(tmp))).fetch(
                    "600839", datetime(2026, 9, 4, 9, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
                )
            self.assertEqual(context.signal, 1.0)
            self.assertEqual(context.confidence, 0.7)
            self.assertEqual(context.ready_entities, 3)
            self.assertEqual(
                context.flags,
                ("entity_profile_snapshot_as_of:2026-09-03T18:25:00+08:00",),
            )

    def test_missing_profile_is_explicitly_non_actionable(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = {"data": {"signal": 0, "confidence": 0, "researchReadyEntityCount": 0}}
            with patch("urllib.request.urlopen", return_value=_Response(payload)):
                context = EntityProfileClient(self.settings(Path(tmp))).fetch(
                    "600839", datetime(2026, 9, 4, 9, 20, tzinfo=ZoneInfo("Asia/Shanghai"))
                )
            self.assertEqual(context.signal, 0)
            self.assertIn("entity_profile_insufficient_evidence", context.flags)
            self.assertIn("entity_profile_snapshot_unavailable", context.flags)


if __name__ == "__main__":
    unittest.main()
