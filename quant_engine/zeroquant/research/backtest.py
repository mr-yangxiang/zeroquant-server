"""Frozen OOS signals, chronological minute-close fills. Never real-time evidence."""
from collections import Counter, defaultdict
from dataclasses import asdict, replace
import math

from .data import CODES, digest, instant
from .execution import CostConfig, new_account, simulate_fill


def replay_oos(predictions, records, costs: CostConfig):
    if not predictions:
        return {"status":"BLOCKED_NO_OOS_SIGNALS","fill_count":0,"net_return_pct":None}
    events=defaultdict(lambda:{"signals":[],"bars":[]})
    keys=set()
    first=min(instant(p["decision_time"]) for p in predictions)
    last=max(instant(p["label_end_time"]) for p in predictions)
    for p in predictions:
        at=instant(p["decision_time"])
        key=(p["stock_code"],at)
        probabilities=p.get("probabilities",[])
        if (key in keys or p["stock_code"] not in CODES or not p.get("input_hash")
            or len(probabilities)!=3 or any(not isinstance(x,(float,int)) or not math.isfinite(x) or not 0<=x<=1 for x in probabilities)
            or abs(sum(probabilities)-1)>1e-5):
            raise ValueError("样本外信号缺少身份、重复或概率不合法")
        keys.add(key)
        events[at]["signals"].append(p)
    # First revision only, at its historical availability. Late backfills cannot
    # be traded at the original price/time without independent PIT evidence.
    versions={}
    for r in records:
        if r["kind"]!="minute":
            continue
        event,available=instant(r["event_at"]),instant(r["available_at"])
        if not first<=event<=last or not event<=available or (available-event).total_seconds()>60:
            continue
        if not r.get("pit_certified") and instant(r["ingested_at"])>available:
            continue
        key=(r["stock_code"],event)
        if key not in versions or available<instant(versions[key]["available_at"]):
            versions[key]=r
    for r in versions.values():
        events[instant(r["available_at"])]["bars"].append(r)
    state=new_account()
    state["execution_mode"]="historical_oos_replay"
    pending=[]; fills=[]; rejected=Counter(); peak=state["initial_equity"]; drawdown=0.
    for at,batch in sorted(events.items()):
        carry=[]
        for order in pending:
            bars=[r for r in batch["bars"] if r["stock_code"]==order["stock_code"]
                  and instant(r["event_at"])>instant(order["signal_time"])]
            if (at-instant(order["signal_time"])).total_seconds()>120:
                rejected["没有及时取得可成交分钟"]+=1
            elif bars:
                result=simulate_fill(state,order,min(bars,key=lambda r:instant(r["event_at"])),costs)
                if result["status"] in ("FILLED","PARTIAL_CANCELLED"):
                    fills.append(result)
                else:
                    rejected[result.get("reason",result["status"])]+=1
            else:
                carry.append(order)
        pending=carry
        for r in batch["bars"]:
            state["last_prices"][r["stock_code"]]=r["payload"]["close"]
        for p in batch["signals"]:
            side="BUY" if p["probabilities"][2]>=.62 else "SELL" if p["probabilities"][0]>=.62 else None
            if side:
                pending.append({"order_id":digest({"code":p["stock_code"],"at":p["decision_time"]}),
                    "stock_code":p["stock_code"],"signal_time":p["decision_time"],"submitted_at":p["decision_time"],
                    "shares":100,"side":side})
        value=state["cash"]+sum(lot["shares"]*state["last_prices"].get(code,lot["cost"])
            for code,lots in state["lots"].items() for lot in lots)
        peak=max(peak,value); drawdown=max(drawdown,(peak-value)/peak)
        state["equity"].append({"at":at.isoformat(),"value":value})
    final=state["equity"][-1]["value"]
    return {"status":"REPLAYED_RESEARCH_ONLY","fill_count":len(fills),"net_return_pct":(final/state["initial_equity"]-1)*100,
        "max_drawdown_pct":drawdown*100,"fees_paid":sum(f[k] for f in fills for k in ("commission","stamp_duty","transfer_fee")),
        "rejections":dict(rejected),"unfilled_at_end":len(pending),"fills":fills,"equity":state["equity"],
        "ending_lots":state["lots"],"initial_cash":state["initial_cash"],"initial_positions":"empty",
        "limitation":"分钟收盘保守模拟，未重放真实委托队列；期末持仓按市值计价，并非已平仓收益"}


def cost_experiment(predictions, records, costs, model_hash, dataset_hash):
    variants={}
    for multiplier in (1,2,3):
        stressed=replace(costs,commission_rate=costs.commission_rate*multiplier,
            minimum_commission=costs.minimum_commission*multiplier,spread_bps=costs.spread_bps*multiplier,
            slippage_bps=costs.slippage_bps*multiplier,impact_bps_at_full_participation=costs.impact_bps_at_full_participation*multiplier)
        variants[str(multiplier)]=replay_oos(predictions,records,stressed)
    ready=costs.broker_verified and bool(costs.evidence_reference) and all(
        v["fill_count"]>=100 and (v["net_return_pct"] or 0)>0 and v.get("max_drawdown_pct",100)<=10 for v in variants.values())
    return {"status":"COMPLETED_RESEARCH" if predictions else "BLOCKED_NO_OOS_SIGNALS", "approved":bool(ready),
        "model_file_hash":model_hash,"dataset_hash":dataset_hash,"prediction_hash":digest(predictions),
        "cost_config_hash":costs.fingerprint,"cost_config":asdict(costs),"variants":variants,
        "policy":"固定上涨/下跌概率阈值 0.62、每笔100股；1/2/3倍成本；不允许看结果后调阈值再复用留出集"}
