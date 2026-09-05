from __future__ import annotations

import json
from pathlib import Path

from .models import ForecastRun


def append_run_jsonl(run: ForecastRun, audit_dir: Path) -> Path:
    run_dir = audit_dir / "prediction_runs"
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / f"{run.trade_date}.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(run.to_dict(), ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
    return path


def write_daily_markdown(runs: list[ForecastRun], audit_dir: Path) -> Path:
    if not runs:
        raise ValueError("cannot write an empty audit report")
    audit_dir.mkdir(parents=True, exist_ok=True)
    path = audit_dir / f"probability_analysis_{runs[0].trade_date}.md"
    lines = [
        f"# ZeroQuant 概率预测审计档案 ({runs[0].trade_date})",
        "",
        f"- 生成时间：{runs[0].as_of.isoformat()}",
        f"- 模型版本：`{runs[0].model_version}`",
        f"- 模型状态：`{runs[0].model_state}`",
        "- 输出性质：研究预测，不构成自动交易指令",
        "- 知识库策略：Markdown 仅作审计材料；未验证经验不会直接注入数值模型",
        "",
    ]
    for run in runs:
        primary = next(item for item in run.horizons if item.horizon_minutes == 15)
        curve_prices = [float(point["price"]) for point in run.legacy_curve]
        lines.extend(
            [
                f"## {run.stock_name} ({run.stock_code})",
                "",
                f"- 输入哈希：`{run.input_hash}`",
                f"- 数据质量：{run.features.quality_score:.1%}",
                f"- 市场状态：`{run.regime.name}`（状态置信度 {run.regime.confidence:.1%}）",
                f"- 15分钟概率：上涨 {primary.p_up:.1%} / 震荡 {primary.p_flat:.1%} / 下跌 {primary.p_down:.1%}",
                f"- 15分钟收益区间：P10 {primary.q10_return_pct:+.2f}% / P50 {primary.q50_return_pct:+.2f}% / P90 {primary.q90_return_pct:+.2f}%",
                f"- 兼容图表区间：¥{min(curve_prices):.2f} ～ ¥{max(curve_prices):.2f}",
                f"- 是否允许自动交易：`{str(primary.actionable).lower()}`",
                f"- 公告事件数：{len(run.news_events)}",
                f"- 数据标记：{', '.join(run.features.quality_flags)}",
            ]
        )
        for warning in run.warnings:
            lines.append(f"- 警告：{warning}")
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
