from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from .data import TZ, build_dataset, instant
from .execution import CostConfig, new_account, shadow_step
from .training import predict_candidate


def run_shadow(warehouse,artifact_dir:Path,costs:CostConfig,now=None):
    from psycopg.types.json import Jsonb
    now = instant(now or datetime.now(TZ))
    minute = now.hour * 60 + now.minute
    if 570 <= minute < 572 or 780 <= minute < 782:
        # Wait for the new session's first closed bar plus the quality gate's
        # 60s arrival grace. Never append overnight/noon stale marks as equity.
        return {"status":"WAITING_FOR_FIRST_CLOSED_MINUTE",
                "note":"等待本交易时段首根完整分钟及 60 秒到达宽限，不写入估值或成交",
                "production_approved":False}
    metadata=json.loads((artifact_dir/"candidate.json").read_text())
    if not metadata.get("data_sources"):
        raise ValueError("模型缺少冻结数据源范围，不能进行线上影子推理")
    if now<=instant(metadata["holdout_end"]):
        raise ValueError("影子交易必须发生在训练/验证结束之后")
    model_id=metadata["model_id"]
    records=warehouse.live_records(now)
    records=[r for r in records if r["source"] in metadata["data_sources"]]
    if not any(r["kind"]=="calendar" and r["payload"].get("is_trading_day") is True for r in records):
        return {"status":"WAITING_FOR_CONFIRMED_TRADING_CALENDAR","production_approved":False}
    latest,_=build_dataset(records,horizon=metadata["horizon_minutes"],stride=1,build_at=now,require_labels=False)
    signals=[]
    for r in latest:
        if 0 <= (now-instant(r["decision_time"])).total_seconds()<=60:
            probabilities=predict_candidate(artifact_dir,r["features"],metadata["file_hash"])
            signals.append({**r,"probabilities":probabilities,"price":r["reference_price"]})
    bars=[r for r in records if r["kind"]=="minute" and (now-instant(r["event_at"])).total_seconds()<=180]
    with warehouse.conn.transaction():
        warehouse.conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))",("shadow:"+model_id,))
        model=warehouse.conn.execute("SELECT file_hash,state FROM model_artifacts WHERE model_id=%s",(model_id,)).fetchone()
        if not model or model["file_hash"]!=metadata["file_hash"] or model["state"] not in ("CALIBRATED","SHADOW"):
            raise ValueError("模型未注册/哈希不符或不处于影子候选状态")
        saved=warehouse.conn.execute("SELECT state FROM research_shadow_state WHERE model_id=%s FOR UPDATE",(model_id,)).fetchone()
        state=saved["state"] if saved else new_account()
        state,orders,fills=shadow_step(state,signals,bars,now,model_id,costs,
            model_file_hash=metadata["file_hash"],dataset_hash=metadata["dataset_hash"],holdout_end=metadata["holdout_end"])
        for o in orders:
            warehouse.conn.execute(
                """INSERT INTO shadow_orders(order_id,stock_code,signal_time,order_time,action_type,
                   target_price,target_shares,model_id,status,reason)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT(order_id) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason""",
                (o["order_id"],o["stock_code"],o["signal_time"],now,o["side"],o["target_price"],
                 o["shares"],model_id,o["status"],o.get("reason","分钟级保守模拟")))
        for f in fills:
            warehouse.conn.execute(
                """INSERT INTO shadow_fills(order_id,fill_time,fill_price,fill_shares,commission,
                   stamp_duty,transfer_fee,slippage,impact_cost) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                tuple(f[k] for k in ("order_id","fill_time","fill_price","fill_shares","commission",
                                     "stamp_duty","transfer_fee","slippage","impact_cost")))
        warehouse.conn.execute(
            """INSERT INTO research_shadow_state(model_id,state) VALUES (%s,%s)
               ON CONFLICT(model_id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW()""",
            (model_id,Jsonb(state)))
        warehouse.conn.execute("UPDATE model_artifacts SET state='SHADOW' WHERE model_id=%s",(model_id,))
    return {"status":"RUNNING" if signals or orders else "WAITING_FOR_FRESH_SIGNALS",
            "model_id":model_id,"signals":len(signals),"orders":len(orders),"fills":len(fills),
            "cash":state["cash"],"valuation":state["equity"][-1] if state["equity"] else None,
            "production_approved":False}
