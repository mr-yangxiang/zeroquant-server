from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ENGINE_DIR = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class StockSpec:
    code: str
    full_code: str
    secid: str
    name: str


STOCKS: tuple[StockSpec, ...] = (
    StockSpec("000572", "sz000572", "0.000572", "海马汽车"),
    StockSpec("600362", "sh600362", "1.600362", "江西铜业"),
    StockSpec("600839", "sh600839", "1.600839", "四川长虹"),
    StockSpec("601899", "sh601899", "1.601899", "紫金矿业"),
    StockSpec("603366", "sh603366", "1.603366", "日出东方"),
    StockSpec("603696", "sh603696", "1.603696", "安记食品"),
)


@dataclass(frozen=True)
class Settings:
    server_url: str
    internal_token: str
    request_timeout_seconds: float
    news_cache_seconds: int
    audit_dir: Path
    state_dir: Path
    model_path: Path
    allow_uncalibrated_trading: bool
    estimated_round_trip_cost_bps: float

    @classmethod
    def _load_dotenv(cls) -> None:
        env_file = ENGINE_DIR.parent / ".env"
        if not env_file.exists():
            return
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = value
        except Exception:
            pass

    @classmethod
    def from_env(cls) -> "Settings":
        cls._load_dotenv()
        def configured_path(name: str, default: Path) -> Path:
            raw = os.getenv(name)
            if not raw:
                return default
            path = Path(raw)
            return path if path.is_absolute() else ENGINE_DIR.parent / path

        state_dir = configured_path("ZEROQUANT_STATE_DIR", ENGINE_DIR / "state")
        return cls(
            server_url=os.getenv("ZEROQUANT_SERVER_URL", "http://127.0.0.1:3002").rstrip("/"),
            internal_token=os.getenv("ZEROQUANT_INTERNAL_TOKEN", ""),
            request_timeout_seconds=float(os.getenv("ZEROQUANT_REQUEST_TIMEOUT_SECONDS", "5")),
            news_cache_seconds=int(os.getenv("ZEROQUANT_NEWS_CACHE_SECONDS", "90")),
            audit_dir=configured_path("ZEROQUANT_AUDIT_DIR", ENGINE_DIR / "daily_analysis_logs"),
            state_dir=state_dir,
            model_path=configured_path(
                "ZEROQUANT_MODEL_PATH", ENGINE_DIR / "models" / "bootstrap_probability_v1.json"
            ),
            allow_uncalibrated_trading=os.getenv(
                "ZEROQUANT_ALLOW_UNCALIBRATED_TRADING", "false"
            ).lower()
            in {"1", "true", "yes"},
            estimated_round_trip_cost_bps=float(
                os.getenv("ZEROQUANT_ESTIMATED_ROUND_TRIP_COST_BPS", "18")
            ),
        )
