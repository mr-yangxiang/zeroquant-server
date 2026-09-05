#!/usr/bin/env python3
"""Evaluate completed daily forecasts without mutating the champion model."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from zeroquant.config import STOCKS, Settings
from zeroquant.providers import DailyHistoryProvider, HttpTransport, MarketDataError


SHANGHAI = ZoneInfo("Asia/Shanghai")


def _load_daily_runs(path: Path) -> dict[str, dict]:
    selected: dict[str, dict] = {}
    if not path.exists():
        return selected
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            run = json.loads(line)
        except json.JSONDecodeError:
            continue
        if run.get("mode") == "daily" and run.get("stockCode"):
            selected[str(run["stockCode"])] = run
    return selected


def _outcome_bucket(realized_pct: float, cost_pct: float) -> str:
    if realized_pct > cost_pct:
        return "up"
    if realized_pct < -cost_pct:
        return "down"
    return "flat"


def review(target_date: str | None = None) -> dict:
    settings = Settings.from_env()
    target = date.fromisoformat(target_date) if target_date else datetime.now(SHANGHAI).date()
    run_path = settings.audit_dir / "prediction_runs" / f"{target.isoformat()}.jsonl"
    runs = _load_daily_runs(run_path)
    if not runs:
        raise RuntimeError(f"no daily forecast run found for {target.isoformat()}")

    provider = DailyHistoryProvider(HttpTransport(settings.request_timeout_seconds))
    rows: list[dict] = []
    failures: list[str] = []
    for stock in STOCKS:
        run = runs.get(stock.code)
        if not run:
            continue
        try:
            bars = provider.fetch_daily_bars(stock, limit=30)
        except MarketDataError as exc:
            failures.append(f"{stock.code}:data_source:{exc}")
            continue
        actual = next((bar for bar in bars if bar.date == target.isoformat()), None)
        if not actual:
            failures.append(f"{stock.code}:actual_close_unavailable")
            continue
        reference = float(run.get("referencePrice") or 0)
        if reference <= 0:
            continue
        terminal = max(run.get("horizons", []), key=lambda item: int(item.get("horizonMinutes", 0)))
        realized = (actual.close / reference - 1.0) * 100.0
        bucket = _outcome_bucket(realized, settings.estimated_round_trip_cost_bps / 100.0)
        actual_vector = {"up": 0.0, "flat": 0.0, "down": 0.0}
        actual_vector[bucket] = 1.0
        probabilities = {
            "up": float(terminal["pUp"]),
            "flat": float(terminal["pFlat"]),
            "down": float(terminal["pDown"]),
        }
        brier = sum((probabilities[key] - actual_vector[key]) ** 2 for key in actual_vector) / 3.0
        q10 = float(terminal["q10ReturnPct"])
        q90 = float(terminal["q90ReturnPct"])
        rows.append(
            {
                "stockCode": stock.code,
                "stockName": stock.name,
                "runId": run["runId"],
                "modelVersion": run["modelVersion"],
                "referencePrice": reference,
                "actualClose": actual.close,
                "realizedReturnPct": round(realized, 6),
                "outcome": bucket,
                "brierScore": round(brier, 6),
                "absoluteReturnErrorPct": round(abs(realized - float(terminal["q50ReturnPct"])), 6),
                "insideP10P90": q10 <= realized <= q90,
            }
        )

    if not rows:
        raise RuntimeError(f"actual close is not available for {target.isoformat()}")
    summary = {
        "tradeDate": target.isoformat(),
        "evaluatedAt": datetime.now(SHANGHAI).isoformat(),
        "sampleSize": len(rows),
        "meanBrierScore": round(sum(row["brierScore"] for row in rows) / len(rows), 6),
        "meanAbsoluteReturnErrorPct": round(sum(row["absoluteReturnErrorPct"] for row in rows) / len(rows), 6),
        "p10P90Coverage": round(sum(bool(row["insideP10P90"]) for row in rows) / len(rows), 6),
        "promotionDecision": "NO_CHANGE_INSUFFICIENT_EVIDENCE",
        "modelMutation": False,
        "failures": failures,
        "rows": rows,
    }
    review_dir = settings.audit_dir / "reviews"
    review_dir.mkdir(parents=True, exist_ok=True)
    json_path = review_dir / f"review_{target.isoformat()}.json"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    markdown = [
        f"# ZeroQuant 收盘后预测评估 ({target.isoformat()})",
        "",
        f"- 样本数：{len(rows)}",
        f"- 平均 Brier Score：{summary['meanBrierScore']:.4f}",
        f"- 平均绝对收益误差：{summary['meanAbsoluteReturnErrorPct']:.3f}%",
        f"- P10-P90 覆盖率：{summary['p10P90Coverage']:.1%}",
        f"- 数据失败数：{len(failures)}",
        "- 模型晋级：否；单日样本不足以修改生产模型",
        "- 知识库写入：否；该报告先进入候选证据池",
        "",
        "| 标的 | 实际收益 | 结果类别 | Brier | P10-P90覆盖 |",
        "| --- | ---: | --- | ---: | --- |",
    ]
    for row in rows:
        markdown.append(
            f"| {row['stockName']} ({row['stockCode']}) | {row['realizedReturnPct']:+.2f}% | {row['outcome']} | {row['brierScore']:.4f} | {'是' if row['insideP10P90'] else '否'} |"
        )
    md_path = review_dir / f"review_{target.isoformat()}.md"
    md_path.write_text("\n".join(markdown) + "\n", encoding="utf-8")
    print(json.dumps({"review": str(json_path), "markdown": str(md_path), **{k: v for k, v in summary.items() if k != "rows"}}, ensure_ascii=False))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate completed ZeroQuant daily forecasts")
    parser.add_argument("target_date", nargs="?", help="YYYY-MM-DD; defaults to today")
    args = parser.parse_args()
    review(args.target_date)


if __name__ == "__main__":
    main()
