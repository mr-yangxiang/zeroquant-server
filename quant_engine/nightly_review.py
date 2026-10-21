#!/usr/bin/env python3
"""Evaluate completed daily forecasts and dynamic rolling predictions without mutating the champion model."""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from zeroquant.config import STOCKS, Settings
from zeroquant.providers import DailyHistoryProvider, HttpTransport, MarketDataError, TencentMarketDataProvider


SHANGHAI = ZoneInfo("Asia/Shanghai")


def _load_all_runs(path: Path) -> list[dict]:
    runs: list[dict] = []
    if not path.exists():
        return runs
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            run = json.loads(line)
            runs.append(run)
        except json.JSONDecodeError:
            continue
    return runs


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
    all_runs = _load_all_runs(run_path)
    daily_runs = {str(r["stockCode"]): r for r in all_runs if r.get("mode") == "daily" and r.get("stockCode")}
    realtime_runs = [r for r in all_runs if r.get("mode") == "realtime" and r.get("stockCode")]

    if not daily_runs and not realtime_runs:
        summary = {
            "taskStatus": "NORMAL_SKIP",
            "status": "SKIPPED",
            "tradeDate": target.isoformat(),
            "reason": f"no daily or realtime forecast run found for {target.isoformat()}",
        }
        print("ZEROQUANT_TASK_STATUS=SKIPPED")
        print(json.dumps(summary, ensure_ascii=False))
        return summary

    transport = HttpTransport(settings.request_timeout_seconds)
    provider = DailyHistoryProvider(transport)
    market = TencentMarketDataProvider(transport)
    rows: list[dict] = []
    failures: list[str] = []

    # 1. 盘前基线预测与收盘结果比对
    for stock in STOCKS:
        run = daily_runs.get(stock.code)
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

    # 2. 盘中动态预测按时点与周期逐分钟匹配复盘
    rolling_eval_records: list[dict] = []
    minute_bars_cache: dict[str, dict[str, float]] = {}
    for stock in STOCKS:
        try:
            today_minutes = market.fetch_today_minute_bars(stock)
            minute_bars_cache[stock.code] = {b.bar_time.strftime("%H:%M"): b.close for b in today_minutes}
        except Exception:
            minute_bars_cache[stock.code] = {}

    for r in realtime_runs:
        code = str(r.get("stockCode"))
        min_map = minute_bars_cache.get(code, {})
        if not min_map:
            continue
        as_of_raw = r.get("asOf")
        if not as_of_raw:
            continue
        try:
            as_of_dt = datetime.fromisoformat(as_of_raw)
        except ValueError:
            continue
        ref_price = float(r.get("referencePrice") or 0)
        if ref_price <= 0:
            continue

        for h in r.get("horizons", []):
            lead = int(h.get("horizonMinutes", 0))
            target_dt = as_of_dt + timedelta(minutes=lead)
            target_hhmm = target_dt.strftime("%H:%M")
            if target_hhmm in min_map:
                actual_p = min_map[target_hhmm]
                realized_ret = (actual_p / ref_price - 1.0) * 100.0
                expected_ret = float(h.get("expectedReturnPct") or h.get("q50ReturnPct") or 0)
                q10 = float(h.get("q10ReturnPct", -999))
                q90 = float(h.get("q90ReturnPct", 999))
                rolling_eval_records.append({
                    "stockCode": code,
                    "horizonMinutes": lead,
                    "forecastTime": as_of_dt.strftime("%H:%M"),
                    "targetTime": target_hhmm,
                    "expectedReturnPct": expected_ret,
                    "realizedReturnPct": realized_ret,
                    "errorPct": abs(realized_ret - expected_ret),
                    "insideP10P90": q10 <= realized_ret <= q90,
                })

    rolling_summary: dict = {
        "totalEvaluatedPoints": len(rolling_eval_records),
        "meanAbsoluteErrorPct": round(sum(item["errorPct"] for item in rolling_eval_records) / len(rolling_eval_records), 4) if rolling_eval_records else None,
        "p10P90Coverage": round(sum(1 for item in rolling_eval_records if item["insideP10P90"]) / len(rolling_eval_records), 4) if rolling_eval_records else None,
    }

    status = "VALID_COMPLETE" if rows and len(rows) == len(STOCKS) and not failures else "PARTIAL_COMPLETE" if rows else "NORMAL_SKIP"
    summary = {
        "taskStatus": status,
        "tradeDate": target.isoformat(),
        "evaluatedAt": datetime.now(SHANGHAI).isoformat(),
        "dailySampleSize": len(rows),
        "meanBrierScore": round(sum(row["brierScore"] for row in rows) / len(rows), 6) if rows else 0,
        "meanAbsoluteReturnErrorPct": round(sum(row["absoluteReturnErrorPct"] for row in rows) / len(rows), 6) if rows else 0,
        "p10P90Coverage": round(sum(bool(row["insideP10P90"]) for row in rows) / len(rows), 6) if rows else 0,
        "rollingEvaluation": rolling_summary,
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
        f"# ZeroQuant 收盘后预测评估与动态复盘 ({target.isoformat()})",
        "",
        "## 1. 盘前基线预测评估",
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

    cov_str = f"{rolling_summary['p10P90Coverage']:.1%}" if rolling_summary["p10P90Coverage"] is not None else "N/A"
    
    # 3. 统计各标的日内有效分钟点位采集完整度（以 240 分钟为基准）
    data_gaps: list[dict] = []
    for stock in STOCKS:
        count_mins = len(minute_bars_cache.get(stock.code, {}))
        missing_count = max(0, 240 - count_mins)
        data_gaps.append({
            "stockCode": stock.code,
            "stockName": stock.name,
            "recordedMinutes": count_mins,
            "missingMinutes": missing_count,
            "hasGap": missing_count > 0,
        })
    total_missing = sum(item["missingMinutes"] for item in data_gaps)

    markdown.extend([
        "",
        "## 2. 盘中动态预测逐分钟时点复盘",
        f"- 评估预测点总数：{rolling_summary['totalEvaluatedPoints']}",
        f"- 动态平均绝对误差：{rolling_summary['meanAbsoluteErrorPct'] if rolling_summary['meanAbsoluteErrorPct'] is not None else 'N/A'}%",
        f"- 动态 P10-P90 覆盖率：{cov_str}",
        "",
        "## 3. 日内数据点位完整度与缺口核查 (连续 7 天观察项)",
        f"- 总体数据完整状态：{'✅ 全标的 240 分钟完整无缺口' if total_missing == 0 else f'⚠️ 存在 {total_missing} 个分钟槽缺口待跟踪'}",
        "| 标的代码 | 标的名称 | 实测分钟点数 | 缺失点数 | 状态 |",
        "| :--- | :--- | ---: | ---: | :--- |",
    ])
    for item in data_gaps:
        gap_status = "✅ 完整 (240/240)" if item["missingMinutes"] == 0 else f"⚠️ 缺失 {item['missingMinutes']} 点"
        markdown.append(f"| {item['stockCode']} | {item['stockName']} | {item['recordedMinutes']} | {item['missingMinutes']} | {gap_status} |")

    md_path = review_dir / f"review_{target.isoformat()}.md"
    md_path.write_text("\n".join(markdown) + "\n", encoding="utf-8")
    print(json.dumps({"taskStatus": status, "review": str(json_path), "markdown": str(md_path), **{k: v for k, v in summary.items() if k != "rows"}}, ensure_ascii=False))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate completed ZeroQuant daily forecasts")
    parser.add_argument("target_date", nargs="?", help="YYYY-MM-DD; defaults to today")
    args = parser.parse_args()
    review(args.target_date)


if __name__ == "__main__":
    main()
