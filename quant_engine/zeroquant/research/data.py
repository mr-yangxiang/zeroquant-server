from __future__ import annotations

import hashlib
import json
import math
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import pstdev
from zoneinfo import ZoneInfo

from ..config import STOCKS

TZ = ZoneInfo("Asia/Shanghai")
CODES = tuple(s.code for s in STOCKS)
FEATURE_VERSION = "pit_minute_v1"
KINDS = ("minute", "news", "dragon_tiger", "l2", "calendar")
QUALITY_POLICY_VERSION = "pit_coverage_v2"
MIN_L2_DECISION_COVERAGE = .95
MAX_L2_MISSING_RUN = 5
BAR_ARRIVAL_GRACE_SECONDS = 60


def instant(value) -> datetime:
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("时间必须包含时区，禁止默认为 UTC 或上海")
    return parsed.astimezone(TZ)


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str, allow_nan=False)


def digest(value) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def session_minute(value: datetime) -> int | None:
    m = value.hour * 60 + value.minute
    if value.second or value.microsecond:
        return None
    if 571 <= m <= 690:  # closed bars stamped 09:31..11:30
        return m - 571
    if 781 <= m <= 900:  # 13:01..15:00, no fabricated noon minutes
        return 120 + m - 781
    return None


def normalize_record(row: dict, received_at: datetime, contracts: dict | None = None) -> dict:
    """Only independently documented vendor availability may precede local receipt."""
    kind, code, source = row.get("kind"), str(row.get("stock_code", "")), str(row.get("source", ""))
    if kind not in KINDS or (code not in CODES and not (kind == "calendar" and code == "MARKET")):
        raise ValueError("类型或股票代码不在固定数据合同内")
    if not source or len(source) > 100:
        raise ValueError("缺少来源")
    received_at = instant(received_at)
    event_at = instant(row["event_at"])
    if event_at > received_at:
        raise ValueError("未来事件不能入库")
    contract = (contracts or {}).get(source, {})
    certified = bool(contract.get("availability_verified") is True and contract.get("evidence_reference"))
    available = instant(row["available_at"]) if certified else received_at
    if available < event_at or available > received_at:
        raise ValueError("数据可用时间不符合事件时间/采集时间约束")
    payload = dict(row["payload"])
    if kind == "minute":
        for key in ("open", "high", "low", "close", "volume", "amount"):
            payload[key] = float(payload[key])
            if not math.isfinite(payload[key]) or payload[key] < 0:
                raise ValueError("分钟行情包含无效价格/成交量")
        if not (0 < payload["low"] <= min(payload["open"], payload["close"])
                <= max(payload["open"], payload["close"]) <= payload["high"]):
            raise ValueError("OHLC 关系错误")
        if session_minute(event_at) is None:
            raise ValueError("只接收已收盘的连续竞价 1 分钟 K 线，集合竞价应单独存储")
        if payload.get("volume_unit") != "shares" or payload.get("price_basis") != "unadjusted":
            raise ValueError("要求未复权价格、股数成交量")
        for key in ("upper_limit", "lower_limit"):
            if payload.get(key) is not None:
                payload[key] = float(payload[key])
                if not math.isfinite(payload[key]) or payload[key] <= 0:
                    raise ValueError("涨跌停价必须为正数或显式缺失")
    if kind == "l2":
        if payload.get("level") != 2:
            raise ValueError("普通盘口不能作为 Level-2")
        for side in ("bids", "asks"):
            if not isinstance(payload.get(side), list) or len(payload[side]) < 5:
                raise ValueError("委托簿至少提供五档并声明真实 Level-2 来源")
            for price, volume in payload[side]:
                if not (math.isfinite(float(price)) and float(price) > 0 and math.isfinite(float(volume)) and float(volume) >= 0):
                    raise ValueError("盘口档位不合法")
    if kind == "news" and not payload.get("title"):
        raise ValueError("缺少新闻标题")
    if kind == "news":
        for key, low, high in (("sentiment", -1, 1), ("relevance", 0, 1)):
            value = float(payload.get(key, 0 if key == "sentiment" else 1))
            if not math.isfinite(value) or not low <= value <= high:
                raise ValueError("新闻情绪或相关度越界")
            payload[key] = value
    if kind == "dragon_tiger":
        if not payload.get("seat_name") or payload.get("side") not in ("BUY", "SELL"):
            raise ValueError("龙虎榜需要席位和买卖方向")
        for key in ("buy_amount", "sell_amount", "net_amount"):
            payload[key] = float(payload[key])
            if not math.isfinite(payload[key]) or (key != "net_amount" and payload[key] < 0):
                raise ValueError("龙虎榜金额不合法")
    if kind == "calendar" and not isinstance(payload.get("is_trading_day"), bool):
        raise ValueError("交易日历必须明确布尔交易日状态")
    if certified:
        payload["_availability_evidence"] = contract["evidence_reference"]
    result = {"kind": kind, "stock_code": code, "source": source,
              "event_at": event_at.isoformat(), "available_at": available.isoformat(),
              "ingested_at": received_at.isoformat(), "pit_certified": certified, "payload": payload}
    # Receipt time excluded: retry is idempotent; changed content is a new version.
    result["record_hash"] = digest({k: result[k] for k in ("kind", "stock_code", "source", "event_at", "payload")})
    return result


def _visible_at(record, decision):
    return record["_available"] <= decision and (record.get("pit_certified", False) or record["_ingested"] <= decision)


def _decision_history(by_minute, index, cutoff):
    """Shared decision clock and 31-bar PIT window for features and quality gates."""
    if index not in by_minute:
        return None, [], "missing_current_minute"
    first = by_minute[index][0]
    decision = max(first["_event"] + timedelta(seconds=1), first["_available"])
    if decision > cutoff or decision > first["_event"] + timedelta(seconds=59):
        return None, [], "late_capture"
    selected = []
    for j in range(index - 30, index + 1):
        eligible = [r for r in by_minute.get(j, []) if _visible_at(r, decision)]
        if not eligible:
            return decision, [], "missing_or_unavailable_history"
        selected.append(eligible[-1])
    return decision, selected, None


def _expected_minutes(day, as_of):
    start = instant(f"{day}T09:31:00+08:00")
    return {i for i in range(240) if as_of is None or
            start + timedelta(minutes=i + (90 if i >= 120 else 0),
                              seconds=BAR_ARRIVAL_GRACE_SECONDS) <= as_of}


def _l2_decision_coverage(records, expected, as_of):
    daily, books = defaultdict(lambda: defaultdict(list)), defaultdict(list)
    for raw in records:
        if raw["kind"] not in ("minute", "l2"):
            continue
        r = dict(raw, _event=instant(raw["event_at"]), _available=instant(raw["available_at"]),
                 _ingested=instant(raw["ingested_at"]))
        if r["kind"] == "minute":
            index = session_minute(r["_event"])
            if index is not None:
                daily[(r["stock_code"], r["_event"].date().isoformat())][index].append(r)
        else:
            books[r["stock_code"]].append(r)
    times = {}
    for code, items in books.items():
        items.sort(key=lambda r: (r["_event"], r["_available"], r["record_hash"]))
        times[code] = [r["_event"] for r in items]
    result = {code: {} for code in CODES}
    cutoff = as_of or datetime.max.replace(tzinfo=TZ)
    for (code, day), indices in sorted(expected.items()):
        by_minute = daily[(code, day)]
        for group in by_minute.values():
            group.sort(key=lambda r: (r["_available"], r["_ingested"], r["record_hash"]))
        total = covered = run = longest = 0
        max_delay = None
        for i in sorted(indices):
            if i < 30:
                continue
            total += 1
            decision, selected, reason = _decision_history(by_minute, i, cutoff)
            eligible = []
            if not reason:
                ts = times.get(code, [])
                lo = bisect_left(ts, decision - timedelta(seconds=60))
                hi = bisect_right(ts, decision)
                eligible = [r for r in books[code][lo:hi] if _visible_at(r, decision)]
            if eligible:
                covered += 1
                run = 0
                latest = eligible[-1]
                delay = (latest["_available"] - latest["_event"]).total_seconds()
                max_delay = max(max_delay or 0, delay)
            else:
                run += 1
                longest = max(longest, run)
        ratio = covered / total if total else None
        result[code][day] = {"decision_count": total, "covered_decisions": covered,
                            "coverage_ratio": ratio, "max_missing_run_minutes": longest,
                            "max_used_availability_delay_seconds": max_delay,
                            "passed": not total or (ratio >= MIN_L2_DECISION_COVERAGE and longest <= MAX_L2_MISSING_RUN)}
    return result


def quality_report(records: list[dict], minimum_days: int = 504, *,
                   as_of: datetime | None = None, require_current_day: bool = False) -> dict:
    as_of = instant(as_of) if as_of is not None else None
    if require_current_day and as_of is None:
        raise ValueError("当前交易日检查必须指定 as_of")
    original_count = len(records)
    if as_of is not None:
        records = [r for r in records if max(instant(r[k]) for k in
                   ("event_at", "available_at", "ingested_at")) <= as_of]
    counts = Counter(r["kind"] for r in records)
    minutes = [r for r in records if r["kind"] == "minute"]
    by_day = defaultdict(set)
    uncertified = 0
    invalid = 0
    conflicts = defaultdict(set)
    for r in minutes:
        at = instant(r["event_at"])
        index = session_minute(at)
        if index is None:
            invalid += 1
        else:
            by_day[(r["stock_code"], at.date().isoformat())].add(index)
        conflicts[(r["stock_code"], at.isoformat())].add(digest(r["payload"]))
        uncertified += not r.get("pit_certified", False) and (instant(r["available_at"])-at).total_seconds() > 60
    calendar_states = defaultdict(set)
    for r in records:
        if r["kind"] == "calendar":
            calendar_states[instant(r["event_at"]).date().isoformat()].add(r["payload"]["is_trading_day"])
    trading_days = {day for day, states in calendar_states.items() if states == {True}}
    all_days = trading_days | {day for _, day in by_day}
    expected = {(code, day): _expected_minutes(day, as_of) for code in CODES for day in all_days}
    coverage = {}
    for code in CODES:
        days = [day for (stock, day) in by_day if stock == code]
        completed = [day for day in days if len(expected[(code, day)]) == 240 and len(by_day[(code, day)]) == 240]
        gaps = {day: sorted(expected[(code, day)] - by_day.get((code, day), set())) for day in all_days}
        coverage[code] = {"days": len(completed), "observed_days": len(days), "first": min(days) if days else None,
                          "last": max(days) if days else None,
                          "incomplete_days": sum(bool(v) for v in gaps.values()),
                          "missing_minutes_by_day": {day: v for day, v in sorted(gaps.items()) if v}}
    issues = []
    if any(len(states) != 1 for states in calendar_states.values()):
        issues.append("交易日历同日状态冲突")
    if any(day not in trading_days for _, day in by_day):
        issues.append("行情日期缺少明确交易日历或与非交易日状态冲突")
    if require_current_day and as_of.date().isoformat() not in calendar_states:
        issues.append("缺少评估当日交易日历，不允许猜测是否开市")
    if any("test" in r["source"].lower() or "synthetic" in r["source"].lower() for r in records):
        issues.append("含测试数据，不能作为生产证据")
    invalid_evidence = sum(r["record_hash"] != digest({k:r[k] for k in
                           ("kind","stock_code","source","event_at","payload")})
                           or instant(r["event_at"]) > instant(r["available_at"])
                           or instant(r["available_at"]) > instant(r["ingested_at"])
                           for r in records)
    if invalid_evidence:
        issues.append("记录内容哈希或时间证据不一致")
    for kind in KINDS:
        if not counts[kind]:
            issues.append(f"缺少 {kind} 数据")
    if any(item["days"] < minimum_days for item in coverage.values()):
        issues.append(f"六只标的尚未分别覆盖至少 {minimum_days} 个交易日")
    if uncertified:
        issues.append("部分历史分钟没有已核验的供应商可用时间，只允许从实际首次采集后使用")
    if invalid:
        issues.append("存在不合法的分钟时间")
    conflict_count = sum(len(v) > 1 for v in conflicts.values())
    if conflict_count:
        issues.append("存在同分钟多源或修订冲突；须按版本可用时间选择")
    if any(item["incomplete_days"] for item in coverage.values()):
        issues.append("已结束交易日或盘中已到期分钟存在缺口；应与停牌及交易日历逐日核对")
    # Calendar detects whole missing days as well as partial-day gaps.
    missing_dates = {code: sorted(day for day in trading_days if expected[(code, day)]
                                  and (code, day) not in by_day) for code in CODES}
    if any(missing_dates.values()):
        issues.append("交易日历中存在完全缺失的标的交易日；须核实停牌")
    l2_days = {code: len({instant(r["event_at"]).date() for r in records
                         if r["kind"] == "l2" and r["stock_code"] == code}) for code in CODES}
    if any(days < minimum_days for days in l2_days.values()):
        issues.append("真实 Level-2 尚未覆盖各标的所需历史交易日")
    decision_coverage = _l2_decision_coverage(records, expected, as_of)
    if any(not day["passed"] for stock in decision_coverage.values() for day in stock.values()):
        issues.append("Level-2 在实际决策时点覆盖不足：逐股逐日须达 95%，连续缺失不得超过 5 个交易分钟")
    auxiliary_late = sum(r["kind"] in ("news","dragon_tiger","l2") and not r.get("pit_certified",False)
                         and (instant(r["available_at"])-instant(r["event_at"])).total_seconds()>60 for r in records)
    if auxiliary_late:
        issues.append("部分历史新闻/席位/盘口缺少当时可用时间证据；不可回填进过去特征")
    return {"status": "PASS" if not issues else "BLOCKED", "production_ready": not issues,
            "quality_policy": QUALITY_POLICY_VERSION, "as_of": as_of.isoformat() if as_of else None,
            "excluded_future_or_unreceived_rows": original_count - len(records),
            "bar_arrival_grace_seconds": BAR_ARRIVAL_GRACE_SECONDS,
            "l2_decision_coverage": decision_coverage,
            "l2_required_ratio": MIN_L2_DECISION_COVERAGE, "l2_max_missing_run_minutes": MAX_L2_MISSING_RUN,
            "counts": dict(counts), "coverage": coverage, "uncertified_minute_rows": uncertified,
            "conflicting_minutes": conflict_count, "missing_calendar_days": missing_dates,
            "issues": issues, "required_days": minimum_days, "l2_coverage_days":l2_days,
            "invalid_evidence_rows":invalid_evidence, "late_auxiliary_rows":auxiliary_late}


def build_dataset(records: list[dict], horizon: int = 15, neutral_bps: float = 18,
                  stride: int = 5, build_at: datetime | None = None,
                  require_labels: bool = True) -> tuple[list[dict], dict]:
    if horizon not in (5, 15, 30, 60) or not isinstance(stride,int) or stride < 1 or not math.isfinite(neutral_bps) or neutral_bps < 0:
        raise ValueError("horizon/stride 不合法")
    build_at = instant(build_at or datetime.now(TZ))
    daily = defaultdict(list)
    auxiliary = defaultdict(list)
    for raw in records:
        r = dict(raw)
        r["_event"] = instant(r["event_at"])
        r["_available"] = instant(r["available_at"])
        r["_ingested"] = instant(r["ingested_at"])
        if r["_event"] > build_at or r["_ingested"] > build_at:
            continue
        if r["kind"] == "minute":
            daily[(r["stock_code"], r["_event"].date())].append(r)
        elif r["kind"] != "calendar":
            auxiliary[(r["stock_code"],r["kind"])].append(r)
    auxiliary_times = {}
    for key,items in auxiliary.items():
        items.sort(key=lambda x: (x["_event"],x["_available"],x["record_hash"]))
        auxiliary_times[key] = [r["_event"] for r in items]
    def available_window(code,kind,decision,seconds):
        key=(code,kind)
        times=auxiliary_times.get(key,[])
        low=bisect_left(times,decision-timedelta(seconds=seconds))
        high=bisect_right(times,decision)
        return [r for r in auxiliary[key][low:high] if _visible_at(r, decision)]
    rows, skipped = [], Counter()
    feature_names = None
    for (code, day), versions in sorted(daily.items()):
        by_minute = defaultdict(list)
        for r in versions:
            index = session_minute(r["_event"])
            if index is not None:
                by_minute[index].append(r)
        for group in by_minute.values():
            group.sort(key=lambda x: (x["_available"], x["_ingested"], x["record_hash"]))
        for i in range(30, 240-horizon if require_labels else 240, stride):
            if i not in by_minute:
                continue
            # Decision is just after this minute closes. Intraday ingestion lag is
            # handled below; we never backdate availability for a historical pull.
            decision, selected, reason = _decision_history(by_minute, i, build_at)
            if reason:
                skipped[reason] += 1
                continue
            # Targets use first observable versions; gaps are never compressed
            # into a falsely shorter horizon, including the lunch break.
            future = [by_minute[j][0] for j in range(i + 1, i + horizon + 1) if j in by_minute] if require_labels else []
            if require_labels and (len(future) != horizon or any(r["_available"] > build_at for r in future)):
                skipped["unmatured_or_missing_label"] += 1
                continue
            prices = [r["payload"]["close"] for r in selected]
            volumes = [r["payload"]["volume"] for r in selected]
            logret = [math.log(b / a) for a, b in zip(prices, prices[1:])]
            recent_volume = sum(volumes[-5:])
            previous_volume = sum(volumes[-10:-5])
            news = available_window(code,"news",decision,172800)
            seats = available_window(code,"dragon_tiger",decision,30*86400)
            # The same seat may appear in buy/sell lists and several listing
            # reasons. It is one disclosed account aggregate, not repeated flow.
            unique_seats = {}
            for seat in seats:
                key = (seat["_event"].date(), seat["payload"].get("seat_name"))
                unique_seats[key] = seat
            seats = list(unique_seats.values())
            books = available_window(code,"l2",decision,60)
            news_weight = sum(float(r["payload"].get("relevance", 1)) for r in news)
            news_score = sum(float(r["payload"].get("sentiment", 0))*float(r["payload"].get("relevance", 1)) for r in news)
            book_imbalance = None
            if books:
                book = max(books, key=lambda r:r["_event"])["payload"]
                bv, av = sum(float(v) for _, v in book["bids"]), sum(float(v) for _, v in book["asks"])
                book_imbalance = (bv-av)/(bv+av) if bv+av else 0.0
            total_volume = sum(volumes)
            vwap = sum(r["payload"]["amount"] for r in selected)/total_volume if total_volume else prices[-1]
            f = {
                "return_5": prices[-1]/prices[-6]-1, "return_15":prices[-1]/prices[-16]-1,
                "volatility_30":pstdev(logret), "vwap_gap":prices[-1]/vwap-1 if vwap > 0 else 0,
                "volume_ratio_5":recent_volume/previous_volume if previous_volume else 0,
                "minute_fraction":i/239, "news_score":news_score/news_weight if news_weight else 0,
                "news_count":len(news), "news_missing":float(not news),
                "seat_net_amount":sum(float(r["payload"].get("net_amount", 0)) for r in seats),
                "seat_missing":float(not seats),
                "book_imbalance":book_imbalance, "l2_missing":float(not books),
            }
            end = future[-1] if require_labels else selected[-1]
            target = (end["payload"]["close"]/prices[-1]-1)*100 if require_labels else None
            label = ("UP" if target > neutral_bps/100 else "DOWN" if target < -neutral_bps/100 else "FLAT") if require_labels else None
            inputs = [r["record_hash"] for r in selected + news + seats + books]
            # Include auxiliary records and target rule in the reproducible hash.
            feature_names = sorted(f)
            rows.append({"stock_code":code, "decision_time":decision.isoformat(),
                         "label_end_time":end["_event"].isoformat(), "horizon_minutes":horizon,
                         "label_available_at":max(r["_available"] for r in future).isoformat() if require_labels else None,
                         "target_return_pct":target, "direction_label":label, "features":f,
                         "reference_price":prices[-1],
                         "max_favorable_excursion":max(r["payload"]["high"]/prices[-1]-1 for r in future)*100 if require_labels else None,
                         "max_adverse_excursion":min(r["payload"]["low"]/prices[-1]-1 for r in future)*100 if require_labels else None,
                         "input_hash":digest(inputs), "quality_flags":[k for k in ("news_missing","seat_missing","l2_missing") if f[k]],
                         "feature_max_available_at":max(r["_available"] for r in selected + news + seats + books).isoformat()})
    rows.sort(key=lambda r: (r["decision_time"],r["stock_code"]))
    manifest = {"feature_version":FEATURE_VERSION, "horizon_minutes":horizon,
                "data_sources":sorted({r["source"] for r in records}),
                "neutral_bps":neutral_bps, "stride":stride, "row_count":len(rows),
                "features":feature_names or [], "dataset_hash":digest(rows),
                "quality":quality_report(records, as_of=build_at), "skipped":dict(skipped),
                "build_at":build_at.isoformat(), "status":"READY" if rows else "BLOCKED_NO_PIT_SAMPLES"}
    manifest["dataset_id"] = "pit-" + manifest["dataset_hash"][:24]
    return rows, manifest


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str, allow_nan=False)+"\n", encoding="utf-8")
    temporary.replace(path)
