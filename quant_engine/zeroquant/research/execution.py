from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
from copy import deepcopy
import math
import re
import uuid

from .data import CODES, QUALITY_POLICY_VERSION, digest, instant, session_minute


SHADOW_LEDGER_VERSION = "realtime_shadow_v2"
VALUATION_POLICY_VERSION = "per_position_marks_v1"
MAX_RECEIPT_DELAY_SECONDS = 60


def _number(value, *, minimum=0):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= minimum)


def _sha256(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


@dataclass(frozen=True)
class CostConfig:
    # Broker-specific example parameters must be confirmed against contract/fills.
    commission_rate: float = .00025
    minimum_commission: float = 5.0
    spread_bps: float = 2.0
    slippage_bps: float = 3.0
    impact_bps_at_full_participation: float = 20.0
    max_participation: float = .01
    broker_verified: bool = False
    evidence_reference: str = ""

    def __post_init__(self):
        numbers = (self.commission_rate,self.minimum_commission,self.spread_bps,
                   self.slippage_bps,self.impact_bps_at_full_participation,self.max_participation)
        if not all(_number(n) for n in numbers) or not 0 < self.max_participation <= .1:
            raise ValueError("无效成本/参与率配置")
        if not isinstance(self.broker_verified, bool) or not isinstance(self.evidence_reference, str):
            raise ValueError("成本核验状态必须为布尔值，证据引用必须为字符串")

    @property
    def fingerprint(self):
        return digest(asdict(self))

    def fees(self, value: float, side: str, day: str) -> dict:
        if not _number(value, minimum=.000001) or side not in ("BUY", "SELL"):
            raise ValueError("成交额必须为正且方向必须为买入/卖出")
        trade_date = date.fromisoformat(day)
        if trade_date < date(2015,8,1):
            raise ValueError("尚未配置 2015-08-01 之前的历史费率")
        stamp = .0005 if trade_date >= date(2023,8,28) else .001
        transfer = .00001 if trade_date >= date(2022,4,29) else .00002
        return {"commission":max(self.minimum_commission,value*self.commission_rate),
                "stamp_duty":value*stamp if side == "SELL" else 0.,
                "transfer_fee":value*transfer}


def new_account(initial_cash=100000.0, initial_lots=None):
    if not _number(initial_cash):
        raise ValueError("初始现金不合法")
    lots = deepcopy(initial_lots or {})
    for code, positions in lots.items():
        if code not in CODES:
            raise ValueError("初始持仓不在固定六只股票池")
        for lot in positions:
            if (not isinstance(lot["shares"], int) or isinstance(lot["shares"], bool)
                    or lot["shares"] <= 0 or not _number(lot["cost"], minimum=.000001)):
                raise ValueError("初始持仓不合法")
            date.fromisoformat(lot["acquired_date"])
    return {"cash":initial_cash,"initial_cash":initial_cash,"lots":lots,
            "pending":[],"processed":[],"last_prices":{},"price_marks":{},"equity":[],"fills":0,
            "started_at":None,"last_processed_at":None,"signal_days":[],
            "data_days":[],"fill_audit":[],"ledger_version":SHADOW_LEDGER_VERSION,
            "execution_mode":"realtime_shadow", "initial_equity":initial_cash + sum(
                lot["shares"]*lot["cost"] for positions in lots.values() for lot in positions)}


def available_shares(state, code, trade_date):
    return sum(lot["shares"] for lot in state["lots"].get(code,[]) if lot["acquired_date"] < trade_date)


def simulate_fill(state, order, bar, costs: CostConfig):
    """One IOC attempt at the NEXT complete minute's close; at most one fill.

    This deliberately reports minute-resolution simulation, not L2 queue replay.
    Spread/slippage/impact are embedded in the fill price, never charged twice.
    """
    at, signal = instant(bar["event_at"]), instant(order["signal_time"])
    submitted = instant(order.get("submitted_at", order["signal_time"]))
    if at <= max(signal, submitted):
        return {"status":"WAIT","reason":"等待信号之后的完整分钟"}
    day = at.date().isoformat()
    p = bar["payload"]
    side,code = order["side"],order["stock_code"]
    if side not in ("BUY","SELL"):
        raise ValueError("仅支持买入/卖出")
    if code not in CODES or bar.get("stock_code") != code:
        return {"status":"REJECTED","reason":"成交分钟与订单标的不符"}
    if session_minute(at) is None or at.weekday() >= 5:
        return {"status":"REJECTED","reason":"不是连续竞价完整分钟"}
    if (not isinstance(order["shares"], int) or isinstance(order["shares"], bool)
            or order["shares"] <= 0 or order["shares"] % 100):
        return {"status":"REJECTED","reason":"仅支持正整数整手订单"}
    if (at-signal).total_seconds() > 120 or at.date() != signal.date():
        return {"status":"CANCELLED","reason":"信号过期或跨交易日"}
    if not all(_number(p.get(k), minimum=.000001) for k in ("upper_limit", "lower_limit")):
        return {"status":"REJECTED","reason":"缺少当日真实涨跌停价"}
    if (not all(_number(p.get(k), minimum=.000001) for k in ("open", "high", "low", "close", "volume"))
            or not p["lower_limit"] <= p["low"] <= min(p["open"], p["close"])
            <= max(p["open"], p["close"]) <= p["high"] <= p["upper_limit"]):
        return {"status":"REJECTED","reason":"成交量、价格或涨跌停边界不合法"}
    if p["high"] == p["low"] and (p["high"] >= p["upper_limit"]-.005 or p["low"] <= p["lower_limit"]+.005):
        return {"status":"REJECTED","reason":"封死涨跌停，无法证实可成交"}
    cap = int(float(p["volume"])*costs.max_participation)//100*100
    requested = int(order["shares"])//100*100
    shares = min(cap,requested)
    if side == "SELL":
        shares = min(shares,available_shares(state,code,day)//100*100)
    if shares <= 0:
        return {"status":"REJECTED","reason":"可卖库存/参与率/整手数量不足（含 T+1）"}
    participation = shares/float(p["volume"])
    impact_bps = costs.impact_bps_at_full_participation*math.sqrt(participation)
    adjustment = (costs.spread_bps/2+costs.slippage_bps+impact_bps)/10000
    raw_price = float(p["close"])*(1+adjustment if side == "BUY" else 1-adjustment)
    price = (math.ceil(raw_price*100) if side == "BUY" else math.floor(raw_price*100))/100
    if not p["lower_limit"] <= price <= p["upper_limit"]:
        return {"status":"REJECTED","reason":"冲击后价格超出涨跌停范围"}
    if not p["low"] <= price <= p["high"]:
        return {"status":"REJECTED","reason":"分钟价格范围不能支持该模拟成交"}
    while shares > 0:
        fees = costs.fees(price*shares,side,day)
        if side == "SELL" or price*shares+sum(fees.values()) <= state["cash"]:
            break
        shares -= 100
    if not shares:
        return {"status":"REJECTED","reason":"现金不足（含全部费用）"}
    fees = costs.fees(price*shares,side,day)
    if side == "BUY":
        state["cash"] -= price*shares+sum(fees.values())
        state["lots"].setdefault(code,[]).append({"shares":shares,"cost":price,"acquired_date":day})
    else:
        state["cash"] += price*shares-sum(fees.values())
        remaining = shares
        for lot in state["lots"].get(code,[]):
            if lot["acquired_date"] < day:
                sold = min(lot["shares"],remaining)
                lot["shares"] -= sold
                remaining -= sold
        state["lots"][code] = [lot for lot in state["lots"].get(code,[]) if lot["shares"]]
    return {"status":"FILLED" if shares == requested else "PARTIAL_CANCELLED",
            "order_id":order["order_id"],"stock_code":code,"side":side,
            "fill_time":at.isoformat(),"fill_price":price,"fill_shares":shares,**fees,
            "slippage":abs(price-float(p["close"]))*shares,
            "impact_cost":float(p["close"])*shares*impact_bps/10000,
            "cost_note":"滑点和冲击为成交价内归因项，现金不重复扣除",
            "resolution":"minute_close_conservative"}


def _fresh_bar(bar, now):
    """A historical vendor timestamp cannot turn a delayed local capture live."""
    try:
        event = instant(bar["event_at"])
        received = instant(bar["ingested_at"])
        available = instant(bar["available_at"])
        return (bar.get("kind") == "minute" and bar.get("stock_code") in CODES
                and session_minute(event) is not None and event.weekday() < 5
                and event <= available <= received <= now
                and (received-event).total_seconds() <= MAX_RECEIPT_DELAY_SECONDS
                and (now-received).total_seconds() <= MAX_RECEIPT_DELAY_SECONDS
                and (now-event).total_seconds() <= 120
                and _number(bar["payload"]["close"], minimum=.000001))
    except (KeyError, TypeError, ValueError):
        return False


def _valuation_point(state, now):
    positions = {code: sum(lot["shares"] for lot in lots)
                 for code, lots in state["lots"].items() if any(lot["shares"] for lot in lots)}
    marks = {code: deepcopy(state.get("price_marks", {}).get(code)) for code in positions}
    missing = sorted(code for code, mark in marks.items() if mark is None)
    stale = sorted(code for code, mark in marks.items() if mark is not None and not _fresh_bar(mark, now))
    # Keep an explicitly unverified estimate for diagnostics; never certify cost
    # fallback or another symbol's quote as this position's market valuation.
    estimate = state["cash"] + sum(lot["shares"] * state["last_prices"].get(code, lot["cost"])
                                  for code, lots in state["lots"].items() for lot in lots)
    verified = not missing and not stale
    value = state["cash"] + sum(shares * marks[code]["payload"]["close"]
                                for code, shares in positions.items()) if verified else estimate
    return {"at": now.isoformat(), "value": value, "cash": state["cash"],
            "fresh_prices": verified, "valuation_policy": VALUATION_POLICY_VERSION,
            "valuation_status": "VERIFIED" if verified else "UNVERIFIED_ESTIMATE",
            "positions": positions, "marks": marks, "missing_symbols": missing, "stale_symbols": stale}


def _valid_valuation(point, at):
    """Recheck immutable per-position evidence, not the historical boolean flag."""
    try:
        at = instant(at)
        if (point.get("valuation_policy") != VALUATION_POLICY_VERSION
                or point.get("valuation_status") != "VERIFIED" or not _number(point["cash"])):
            return False
        positions, marks = point["positions"], point["marks"]
        if set(positions) != set(marks):
            return False
        value = point["cash"]
        for code, shares in positions.items():
            mark = marks[code]
            if (code not in CODES or not isinstance(shares, int) or isinstance(shares, bool) or shares <= 0
                    or not isinstance(mark, dict) or mark.get("stock_code") != code
                    or not mark.get("source") or not _sha256(mark.get("record_hash")) or not _fresh_bar(mark, at)):
                return False
            if mark["record_hash"] != digest({k: mark[k] for k in
                                             ("kind", "stock_code", "source", "event_at", "payload")}):
                return False
            value += shares * mark["payload"]["close"]
        return _number(point["value"]) and math.isclose(value, point["value"], rel_tol=1e-10, abs_tol=.000001)
    except (KeyError, TypeError, ValueError):
        return False


def shadow_step(state, signals, bars, now, model_id, costs, *,
                model_file_hash=None, dataset_hash=None, holdout_end=None):
    """Pure state transition. Caller locks and commits state/orders/fills atomically."""
    now = instant(now)
    if state.get("ledger_version") != SHADOW_LEDGER_VERSION:
        raise ValueError("旧影子账本缺少实时证据，必须单独归档并建立新候选账本")
    binding = {"model_id":model_id, "cost_config_hash":costs.fingerprint,
               "model_file_hash":model_file_hash, "dataset_hash":dataset_hash,
               "holdout_end":instant(holdout_end).isoformat() if holdout_end else None}
    if state.get("binding") is not None and state["binding"] != binding:
        raise ValueError("模型、成本或训练数据版本已改变，禁止混合影子成绩；请建立新候选账本")
    if not state.get("binding"):
        state["binding"] = binding
    if holdout_end and now <= instant(holdout_end):
        raise ValueError("影子运行必须严格晚于独立留出集")
    if state.get("last_processed_at") and now <= instant(state["last_processed_at"]):
        return state,[],[]
    if state["started_at"] is None:
        state["started_at"] = now.isoformat()
    orders, fills, pending = [], [], []
    live_bars = [b for b in bars if _fresh_bar(b, now)]
    for order in state["pending"]:
        if (now-instant(order["signal_time"])).total_seconds() > 120:
            orders.append(order|{"status":"CANCELLED","reason":"未在实时窗口内执行，禁止回补历史成交"})
            continue
        candidates = [b for b in live_bars if b["stock_code"] == order["stock_code"]
                      and max(instant(order["signal_time"]), instant(order.get("submitted_at", order["signal_time"])))
                      < instant(b["event_at"]) <= now]
        if not candidates:
            if (now-instant(order["signal_time"])).total_seconds() > 120:
                orders.append(order|{"status":"CANCELLED","reason":"没有按时取得完整成交分钟"})
            else:
                pending.append(order)
            continue
        bar = min(candidates,key=lambda b:instant(b["event_at"]))
        result = simulate_fill(state,order,bar,costs)
        orders.append(order|result)
        if result["status"] in ("FILLED","PARTIAL_CANCELLED"):
            fills.append(result)
            state["fills"] += 1
            state["fill_audit"].append(result|{"observed_at":now.isoformat(),
                "bar_record_hash":bar.get("record_hash"),
                "bar_received_at":bar["ingested_at"],"bar_available_at":bar["available_at"],
                "signal_time":order["signal_time"],"submitted_at":order.get("submitted_at", order["signal_time"]),
                "cost_config_hash":costs.fingerprint})
    processed = set(state["processed"])
    for s in signals:
        at = instant(s["decision_time"])
        if (at > now or (now-at).total_seconds()>60 or at < instant(state["started_at"])
                or s.get("stock_code") not in CODES or at.weekday() >= 5
                or not _number(s.get("price"), minimum=.000001)):
            continue
        if s.get("feature_max_available_at") and instant(s["feature_max_available_at"]) > at:
            continue
        p = s["probabilities"]
        if len(p)!=3 or any(not _number(v) or v>1 for v in p) or abs(sum(p)-1)>1e-5:
            continue
        side = "BUY" if p[2] >= .62 else "SELL" if p[0] >= .62 else None
        if side is None:
            continue
        key = str(uuid.uuid5(uuid.NAMESPACE_URL,f"{model_id}|{s['stock_code']}|{s['decision_time']}"))
        if key in processed:
            continue
        order={"order_id":key,"stock_code":s["stock_code"],"signal_time":at.isoformat(),
               "submitted_at":now.isoformat(), "side":side,"shares":100,"target_price":float(s["price"]),"status":"PENDING"}
        pending.append(order); orders.append(order); processed.add(key)
        day = at.date().isoformat()
        if day not in state["signal_days"]:
            state["signal_days"].append(day)
    marks = state.setdefault("price_marks", {})
    for b in sorted(live_bars,key=lambda b:(instant(b["event_at"]), instant(b["ingested_at"]))):
        code = b["stock_code"]
        previous = marks.get(code)
        if previous is None or (instant(b["event_at"]), instant(b["ingested_at"])) >= (
                instant(previous["event_at"]), instant(previous["ingested_at"])):
            marks[code] = {k: deepcopy(b[k]) for k in
                          ("kind", "stock_code", "source", "event_at", "available_at", "ingested_at", "payload", "record_hash")
                          if k in b}
            state["last_prices"][code] = b["payload"]["close"]
        day = instant(b["event_at"]).date().isoformat()
        if day not in state["data_days"]:
            state["data_days"].append(day)
    state["equity"].append(_valuation_point(state, now))
    state.update(pending=pending,processed=sorted(processed),last_processed_at=now.isoformat())
    return state,orders,fills


def promotion_evidence(report, state, costs, evaluation_now, fresh_data_ready):
    """No shortcut from model.state or a good in-sample metric."""
    now = instant(evaluation_now)
    holdout = report.get("holdout",{})
    issues=[]
    if report.get("status")!="VALIDATED_RESEARCH" or report.get("data_ready") is not True or fresh_data_ready is not True:
        issues.append("历史数据或样本外验证未通过")
    if report.get("quality_policy") != QUALITY_POLICY_VERSION:
        issues.append("训练报告未通过当前时点覆盖质量规则；旧质量结论不能自动继承")
    if not _number(report.get("fold_count"),minimum=3):
        issues.append("样本外验证不足三个窗口")
    cal,base = holdout.get("calibrated",{}),holdout.get("frequency_benchmark",{})
    if (not _number(cal.get("sample_count"),minimum=1000)
        or not all(_number(v) for v in (cal.get("brier"),base.get("brier"),cal.get("ece")))
        or cal["brier"]>=base["brier"] or cal["ece"]>.05):
        issues.append("独立留出集概率准确性/校准未达门槛")
    if not costs.broker_verified or not costs.evidence_reference:
        issues.append("券商成本参数未经真实交割单确认")
    candidate = report.get("candidate",{})
    binding = state.get("binding",{})
    if (state.get("ledger_version")!=SHADOW_LEDGER_VERSION or state.get("execution_mode")!="realtime_shadow"
        or not _sha256(candidate.get("file_hash")) or not _sha256(report.get("dataset_hash"))
        or binding.get("model_file_hash")!=candidate.get("file_hash")
        or binding.get("dataset_hash")!=report.get("dataset_hash")
        or binding.get("model_id")!=candidate.get("model_id")
        or binding.get("cost_config_hash")!=costs.fingerprint):
        issues.append("影子账本未绑定本模型、数据集和成本版本")
    try:
        started = instant(state["started_at"])
        if started <= instant(candidate["holdout_end"]) or started > now:
            raise ValueError("影子日期与留出集不隔离")
        days = set(state.get("signal_days",[])) & set(state.get("data_days",[]))
        if any(not started.date() <= date.fromisoformat(d) <= now.date() or date.fromisoformat(d).weekday()>=5 for d in days):
            raise ValueError("影子交易日期不合法")
        enough_days = (now-started).days>=28 and len(days)>=20
    except (KeyError,TypeError,ValueError):
        enough_days = False
    if not enough_days:
        issues.append("实时影子验证不足 20 个有信号交易日及 28 个自然日")
    audit = state.get("fill_audit",[])
    ids = {r.get("order_id") for r in audit}
    if not _number(state.get("fills"),minimum=100) or len(audit)!=state.get("fills") or len(ids)!=len(audit):
        issues.append("实时影子成交不足 100 笔")
    invalid_fills = False
    for fill in audit:
        try:
            signal, submitted, filled, received, observed = (instant(fill[k]) for k in
                ("signal_time","submitted_at","fill_time","bar_received_at","observed_at"))
            if (not signal <= submitted < filled <= received <= observed <= now
                or (observed-signal).total_seconds()>120 or (received-filled).total_seconds()>60
                or fill.get("cost_config_hash")!=costs.fingerprint):
                invalid_fills = True
        except (KeyError,TypeError,ValueError):
            invalid_fills = True
    if invalid_fills:
        issues.append("成交审计存在迟到回补、时间矛盾或成本混用")
    points=state.get("equity",[])
    equity=[x.get("value") for x in points]
    valid_equity = bool(equity) and all(_number(v,minimum=.000001) for v in equity)
    if not valid_equity or not _number(state.get("initial_equity"),minimum=.000001) or equity[-1]<=state["initial_equity"]:
        issues.append("含成本影子净收益未为正")
    if not valid_equity:
        equity=[]
    try:
        at_times = [instant(p["at"]) for p in points]
        if (not at_times or any(a>=b for a,b in zip(at_times,at_times[1:]))
            or not 0 <= (now-at_times[-1]).total_seconds() <= 120
            or not points[-1].get("fresh_prices")):
            issues.append("影子净值不连续、估值陈旧或无最新行情")
    except (KeyError,TypeError,ValueError):
        issues.append("影子净值时间证据不合法")
    current_positions = {code: sum(lot["shares"] for lot in lots)
                         for code, lots in state.get("lots", {}).items() if any(lot["shares"] for lot in lots)}
    invalid_valuation = (not points or not all(_valid_valuation(p, p.get("at")) for p in points)
            or not _valid_valuation(points[-1], now) or points[-1].get("positions") != current_positions
            or points[-1].get("cash") != state.get("cash"))
    if invalid_valuation:
        issues.append("持仓逐股估值证据缺失或陈旧；旧净值/成本估算不能作为收益及回撤证据")
    peak=state.get("initial_equity",1) if _number(state.get("initial_equity"),minimum=.000001) else 1
    drawdown=0.
    for v in equity:
        peak=max(peak,v)
        drawdown=max(drawdown,(peak-v)/peak if peak else 0)
    if drawdown>.1:
        issues.append("影子最大回撤超过 10%")
    # Feature drift, account reconciliation and capacity evidence remain explicit.
    operations=state.get("operations_attestation",{})
    if not all(operations.get(k) is True for k in ("drift_checked","ledger_reconciled","capacity_checked","feature_parity_checked")) or not operations.get("evidence_reference"):
        issues.append("尚未核验漂移、账本对账和实盘容量")
    if report.get("cost_backtest",{}).get("approved") is not True:
        issues.append("未通过独立样本外含成本及加压成本实验")
    if not report.get("registration",{}).get("run_id") or state.get("database_reconciled") is not True:
        issues.append("缺少集中实验登记或数据库原始成交对账证据")
    return {"approved":not issues,"policy_version":"production_v2","reasons":issues,
            "quality_policy":QUALITY_POLICY_VERSION,"valuation_policy":VALUATION_POLICY_VERSION,
            "evaluated_at":now.isoformat(),"max_drawdown":None if invalid_valuation else drawdown,
            "valuation_evidence_valid":not invalid_valuation,
            "model_file_hash":report.get("candidate",{}).get("file_hash"),
            "dataset_hash":report.get("dataset_hash"),
            "cost_config":asdict(costs)}
