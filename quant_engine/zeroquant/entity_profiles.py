from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime

from .config import Settings


@dataclass(frozen=True)
class EntityProfileContext:
    """Point-in-time aggregate of verified public trading-seat histories."""

    signal: float = 0.0
    confidence: float = 0.0
    ready_entities: int = 0
    snapshot_as_of: str | None = None
    flags: tuple[str, ...] = ()


class EntityProfileClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def fetch(self, stock_code: str, as_of: datetime) -> EntityProfileContext:
        query = urllib.parse.urlencode({"asOf": as_of.isoformat()})
        url = (
            f"{self.settings.server_url}/api/v1/quant/stocks/"
            f"{stock_code}/entity-profiles?{query}"
        )
        try:
            request = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(
                request, timeout=self.settings.request_timeout_seconds
            ) as response:
                payload = json.loads(response.read().decode("utf-8"))
            data = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(data, dict):
                return EntityProfileContext(flags=("entity_profile_invalid_response",))
            signal = max(-1.0, min(1.0, float(data.get("signal") or 0.0)))
            confidence = max(0.0, min(1.0, float(data.get("confidence") or 0.0)))
            ready_entities = max(0, int(data.get("researchReadyEntityCount") or 0))
            flags: list[str] = []
            if ready_entities == 0:
                flags.append("entity_profile_insufficient_evidence")
            if not data.get("snapshotAsOf"):
                flags.append("entity_profile_snapshot_unavailable")
            else:
                flags.append(f"entity_profile_snapshot_as_of:{data.get('snapshotAsOf')}")
            return EntityProfileContext(
                signal=signal,
                confidence=confidence,
                ready_entities=ready_entities,
                snapshot_as_of=data.get("snapshotAsOf"),
                flags=tuple(flags),
            )
        except Exception:
            return EntityProfileContext(flags=("entity_profile_source_unavailable",))
