from __future__ import annotations

import json
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import Settings
from .models import ForecastRun


class PredictionSink:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _post(self, route: str, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.settings.internal_token:
            headers["X-ZeroQuant-Internal-Token"] = self.settings.internal_token
        request = urllib.request.Request(
            f"{self.settings.server_url}{route}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(
            request, timeout=self.settings.request_timeout_seconds
        ) as response:
            value = json.loads(response.read().decode("utf-8"))
        return value if isinstance(value, dict) else {}

    def persist_run(self, run: ForecastRun) -> None:
        try:
            self._post("/api/v1/quant/prediction-runs", run.to_dict())
        except Exception as exc:
            self._write_outbox(run, exc)
            raise

    def persist_realtime_point(
        self,
        run: ForecastRun,
        real_price: float,
        high_price: float,
        low_price: float,
        pct: float,
        rolling_predictions: list[dict[str, Any]] | None = None,
    ) -> None:
        five_minute = next((item for item in run.horizons if item.horizon_minutes == 5), None)
        predicted_price = real_price * (1.0 + (five_minute.q50_return_pct if five_minute else 0.0) / 100.0)
        target = run.as_of.timestamp() + 5 * 60
        target_time = datetime.fromtimestamp(target, tz=run.as_of.tzinfo).strftime("%H:%M")
        payload: dict[str, Any] = {
            "stockCode": run.stock_code,
            "realPrice": real_price,
            "predictedPrice": round(predicted_price, 4),
            "currentPrice": real_price,
            "pct": pct,
            "highPrice": high_price,
            "lowPrice": low_price,
            "tradeDate": run.trade_date,
            "timestampStr": run.as_of.isoformat(),
            "targetTime": target_time,
        }
        if rolling_predictions:
            payload["rollingPredictions"] = rolling_predictions
        self._post("/api/v1/stocks/sync-point", payload)

    def persist_public_trades(self, records: list[dict[str, Any]]) -> None:
        self._post("/api/v1/quant/public-trades/batch", {"records": records})

    def fetch_base_points(self, stock_code: str, trade_date: str) -> list[dict[str, Any]]:
        try:
            req = urllib.request.Request(f"{self.settings.server_url}/api/v1/stocks/{stock_code}/advanced-history?date={trade_date}")
            with urllib.request.urlopen(req, timeout=self.settings.request_timeout_seconds) as resp:
                data = json.loads(resp.read().decode("utf-8")).get("data", {})
                preds = data.get("predictions", [])
                base = next((p for p in preds if p.get("isBase")), None)
                if base and base.get("timePoints"):
                    return base["timePoints"]
        except Exception:
            pass
        return []

    def _write_outbox(self, run: ForecastRun, error: Exception) -> Path:
        outbox = self.settings.state_dir / "outbox"
        outbox.mkdir(parents=True, exist_ok=True)
        path = outbox / f"{run.run_id}.json"
        payload = run.to_dict()
        payload["persistenceError"] = f"{type(error).__name__}: {error}"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
        return path
