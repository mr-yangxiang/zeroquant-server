from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
import uuid

from .data import CODES, TZ, canonical, digest, instant


def connect_database():
    import psycopg
    from psycopg.rows import dict_row
    # libpq supports PGPASSFILE, PGHOST, PGUSER, etc. Never print a DSN on failure.
    dsn = os.getenv("DATABASE_URL", "")
    options = {"connect_timeout":10,"row_factory":dict_row,"sslmode":os.getenv("PGSSLMODE","require"),
               "options":"-c statement_timeout=60000 -c lock_timeout=5000",
               "application_name":"zeroquant_research"}
    return psycopg.connect(dsn, **options)


class Warehouse:
    def __init__(self, conn):
        self.conn = conn

    def audit(self):
        result={}
        with self.conn.transaction():
            self.conn.execute("SET TRANSACTION READ ONLY")
            result["identity"] = self.conn.execute(
                "SELECT current_database() AS database, current_timestamp AS checked_at").fetchone()
            tables = {r["table_name"] for r in self.conn.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public'")}
            result["tables"] = sorted(tables)
            for table,time in (("minute_bars","bar_time"),("news_articles","published_at"),
                               ("dragon_tiger_seats","trade_date"),("order_book_snapshots","snapshot_time"),
                               ("feature_snapshots","as_of"),("training_labels","decision_time"),
                               ("model_artifacts","created_at"),("shadow_orders","signal_time"),
                               ("research_raw_records","event_at")):
                if table not in tables:
                    result[table]={"missing":True}
                    continue
                # Identifiers come only from this fixed internal tuple.
                result[table] = self.conn.execute(
                    f'SELECT count(*) AS count,min({time}) AS first,max({time}) AS last FROM {table}').fetchone()
            if "minute_bars" in tables:
                result["minute_coverage"] = self.conn.execute(
                    """SELECT stock_code,count(*) AS rows,count(DISTINCT trade_date) AS days,
                       min(trade_date) AS first,max(trade_date) AS last
                       FROM minute_bars WHERE stock_code=ANY(%s) GROUP BY stock_code ORDER BY stock_code""",
                    (list(CODES),)).fetchall()
        return result

    def ingest(self, records):
        from psycopg.types.json import Jsonb
        accepted = 0
        with self.conn.transaction():
            self.conn.execute("SELECT pg_advisory_xact_lock(987654326)")
            for r in records:
                inserted=self.conn.execute(
                    """INSERT INTO research_raw_records
                       (record_hash,kind,stock_code,source,event_at,available_at,ingested_at,pit_certified,payload)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT(record_hash) DO NOTHING RETURNING record_hash""",
                    (r["record_hash"],r["kind"],r["stock_code"],r["source"],r["event_at"],
                     r["available_at"],r["ingested_at"],r["pit_certified"],Jsonb(r["payload"]))).fetchone()
                if not inserted:
                    continue
                accepted += 1
                p = r["payload"]
                # Raw revisions remain append-only; canonical business tables keep
                # their first value so research never relies on a later overwrite.
                if r["kind"] == "minute":
                    self.conn.execute(
                        """INSERT INTO minute_bars
                           (stock_code,trade_date,bar_time,open,high,low,close,volume,amount,
                            upper_limit,lower_limit,source,ingested_at)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT(stock_code,bar_time) DO NOTHING""",
                        (r["stock_code"],instant(r["event_at"]).date(),r["event_at"],
                         p["open"],p["high"],p["low"],p["close"],p["volume"],p["amount"],
                         p.get("upper_limit"),p.get("lower_limit"),r["source"][:50],r["ingested_at"]))
                elif r["kind"] == "news":
                    fingerprint = __import__("hashlib").sha256(
                        f'{r["source"]}|{p.get("url","")}|{p["title"]}|{r["event_at"]}'.encode()).hexdigest()
                    row=self.conn.execute(
                        """INSERT INTO news_articles
                           (title,content,url,source,published_at,ingested_at,fingerprint,sentiment_score)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT(fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id""",
                        (p["title"][:500],p.get("content",""),p.get("url"),r["source"],
                         r["event_at"],r["ingested_at"],fingerprint,p.get("sentiment",0))).fetchone()
                    self.conn.execute(
                        """INSERT INTO news_stock_relations(news_id,stock_code,relevance_score,ingested_at)
                           VALUES (%s,%s,%s,%s) ON CONFLICT(news_id,stock_code) DO NOTHING""",
                        (row["id"],r["stock_code"],p.get("relevance",1),r["ingested_at"]))
                elif r["kind"] == "l2":
                    self.conn.execute(
                        """INSERT INTO order_book_snapshots(stock_code,snapshot_time,bids,asks,received_at,source)
                           VALUES (%s,%s,%s,%s,%s,%s)""",
                        (r["stock_code"],r["event_at"],Jsonb(p["bids"]),Jsonb(p["asks"]),r["ingested_at"],r["source"][:50]))
                elif r["kind"] == "dragon_tiger" and p.get("rank") and p.get("disclosed_at"):
                    self.conn.execute(
                        """INSERT INTO dragon_tiger_seats(stock_code,trade_date,side,rank,seat_name,
                           buy_amount,sell_amount,net_amount,source,disclosed_at,ingested_at)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT(stock_code,trade_date,side,rank) DO NOTHING""",
                        (r["stock_code"],p["trade_date"],p["side"],p["rank"],p["seat_name"],
                         p["buy_amount"],p["sell_amount"],p["net_amount"],r["source"],
                         p["disclosed_at"],r["ingested_at"]))
                elif r["kind"] == "calendar":
                    self.conn.execute(
                        """INSERT INTO trading_calendar(trade_date,is_trading_day,notes) VALUES (%s,%s,%s)
                           ON CONFLICT(trade_date) DO NOTHING""",
                        (instant(r["event_at"]).date(),p["is_trading_day"],r["source"]))
        return accepted

    def records(self,start=None,end=None):
        # Fetch only the fixed pool plus the market calendar; incremental callers
        # use start/end. Research CLI runs a bounded explicit range.
        with self.conn.transaction():
            self.conn.execute("SET TRANSACTION READ ONLY")
            rows=self.conn.execute(
                """SELECT * FROM research_raw_records WHERE stock_code=ANY(%s)
                   AND (%s::timestamptz IS NULL OR event_at >= %s::timestamptz)
                   AND (%s::timestamptz IS NULL OR event_at <= %s::timestamptz)
                   ORDER BY event_at,record_hash""",
                (list(CODES)+["MARKET"],start,start,end,end)).fetchall()
        return [{**r,**{k:r[k].isoformat() for k in ("event_at","available_at","ingested_at")}} for r in rows]

    def live_records(self, now):
        """Bound live inference IO: do not scan a month of minute/L2 history."""
        from datetime import timedelta
        today=now.replace(hour=0,minute=0,second=0,microsecond=0)
        batches=[]
        with self.conn.transaction():
            self.conn.execute("SET TRANSACTION READ ONLY")
            for kind,since in (("minute",today),("calendar",today),("news",now-timedelta(days=2)),
                               ("dragon_tiger",now-timedelta(days=30)),("l2",now-timedelta(minutes=2))):
                batches.extend(self.conn.execute(
                    "SELECT * FROM research_raw_records WHERE kind=%s AND stock_code=ANY(%s) AND event_at>=%s AND event_at<=%s AND ingested_at<=%s",
                    (kind,list(CODES)+["MARKET"],since,now,now)).fetchall())
        return [{**r,**{k:r[k].isoformat() for k in ("event_at","available_at","ingested_at")}} for r in batches]

    def save_dataset(self,rows,manifest):
        from psycopg.types.json import Jsonb
        if manifest.get("dataset_hash")!=digest(rows) or manifest.get("row_count",len(rows))!=len(rows):
            raise ValueError("数据集内容或数量与清单不一致，拒绝写入数据库")
        with self.conn.transaction():
            self.conn.execute("SELECT pg_advisory_xact_lock(987654327)")
            self.conn.execute(
                """INSERT INTO research_datasets(dataset_id,feature_version,horizon_minutes,row_count,content_hash,manifest)
                   VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT(dataset_id) DO NOTHING""",
                (manifest["dataset_id"],manifest["feature_version"],manifest["horizon_minutes"],
                 len(rows),manifest["dataset_hash"],Jsonb(manifest)))
            for r in rows:
                prior=self.conn.execute(
                    "SELECT features,input_hash FROM feature_snapshots WHERE stock_code=%s AND as_of=%s AND feature_version=%s",
                    (r["stock_code"],r["decision_time"],manifest["feature_version"])).fetchone()
                if prior and (prior["input_hash"]!=r["input_hash"] or canonical(prior["features"])!=canonical(r["features"])):
                    raise ValueError("既有特征快照冲突；禁止以回填或代码修订覆盖原预测输入，应使用新特征版本")
                self.conn.execute(
                    """INSERT INTO feature_snapshots(stock_code,as_of,feature_version,features,input_hash)
                       VALUES (%s,%s,%s,%s,%s) ON CONFLICT(stock_code,as_of,feature_version) DO NOTHING""",
                    (r["stock_code"],r["decision_time"],manifest["feature_version"],Jsonb(r["features"]),r["input_hash"]))
                existing=self.conn.execute(
                    """SELECT target_return_pct,direction_label FROM training_labels
                       WHERE stock_code=%s AND decision_time=%s AND horizon_minutes=%s""",
                    (r["stock_code"],r["decision_time"],r["horizon_minutes"])).fetchone()
                if existing and (abs(existing["target_return_pct"]-r["target_return_pct"])>1e-8
                                 or existing["direction_label"]!=r["direction_label"]):
                    raise ValueError("既有标签与新数据/阈值冲突，拒绝覆盖；需要独立的标签版本迁移")
                self.conn.execute(
                    """INSERT INTO training_labels(stock_code,decision_time,horizon_minutes,target_return_pct,
                       direction_label,max_favorable_excursion,max_adverse_excursion)
                       VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(stock_code,decision_time,horizon_minutes) DO NOTHING""",
                    (r["stock_code"],r["decision_time"],r["horizon_minutes"],r["target_return_pct"],
                     r["direction_label"],r["max_favorable_excursion"],r["max_adverse_excursion"]))

    def reserve_experiment(self, rows, manifest, artifact_dir):
        """Central holdout ledger: changing a local directory cannot reset it.

        This claim intentionally survives interrupted training. Resumption is
        permitted only from a complete matching local artifact, not re-fitting.
        """
        from psycopg.types.json import Jsonb
        from .training import TRAINING_VERSION
        import hashlib
        days=sorted({instant(r["decision_time"]).date() for r in rows})
        if len(days)<220:
            return None  # Default CLI cannot fit a model with this many dates.
        holdout=days[-20:]
        start=min(instant(r["decision_time"]) for r in rows if instant(r["decision_time"]).date() in holdout)
        end=max(instant(r.get("label_available_at",r["label_end_time"])) for r in rows)
        fingerprint=digest({"dataset_hash":manifest["dataset_hash"],"training_version":TRAINING_VERSION,
                            "fixed_cli_policy":"120/20/20/20/60/3/all_algorithms"})
        with self.conn.transaction():
            self.conn.execute("SELECT pg_advisory_xact_lock(987654328)")
            overlaps=self.conn.execute(
                """SELECT run_id,status,report FROM research_runs WHERE report ? 'registration'
                   AND (report->'registration'->>'holdout_start')::timestamptz<=%s
                   AND (report->'registration'->>'holdout_end')::timestamptz>=%s""",(end,start)).fetchall()
            if overlaps:
                local=artifact_dir/"report.json"
                saved=json.loads(local.read_text()) if local.exists() else {}
                registration=saved.get("registration",{})
                match=next((r for r in overlaps if str(r["run_id"])==registration.get("run_id")
                    and r["report"]["registration"].get("fingerprint")==fingerprint),None)
                artifact=artifact_dir/"candidate.joblib"
                if (match and saved.get("status")=="VALIDATED_RESEARCH" and artifact.exists()
                    and saved.get("dataset_hash")==manifest["dataset_hash"]
                    and hashlib.sha256(artifact.read_bytes()).hexdigest()==saved.get("candidate",{}).get("file_hash")):
                    return registration
                raise ValueError("最终留出时间段已被集中登记；禁止换目录、改参数或换数据版本重复测试。需取回已完成的原模型工件，或使用全新的未来留出区间")
            registration={"run_id":str(uuid.uuid4()),"fingerprint":fingerprint,
                          "holdout_start":start.isoformat(),"holdout_end":end.isoformat()}
            self.conn.execute(
                "INSERT INTO research_runs(run_id,dataset_id,status,report) VALUES (%s,%s,'RESERVED',%s)",
                (registration["run_id"],manifest["dataset_id"],Jsonb({"registration":registration})))
        return registration

    def reconcile_shadow(self, model_id):
        """Recompute counts and cash from committed DB fills, not JSON counters."""
        with self.conn.transaction():
            self.conn.execute("SET TRANSACTION READ ONLY")
            saved=self.conn.execute("SELECT state FROM research_shadow_state WHERE model_id=%s",(model_id,)).fetchone()
            if not saved:
                return {}
            state=saved["state"]
            fills=self.conn.execute(
                """SELECT o.order_id,o.stock_code,o.action_type AS side,o.signal_time,o.order_time,
                    f.fill_time,f.fill_price,f.fill_shares,f.commission,f.stamp_duty,f.transfer_fee,f.slippage,f.impact_cost
                    FROM shadow_orders o JOIN shadow_fills f ON f.order_id=o.order_id
                    WHERE o.model_id=%s ORDER BY f.fill_time,o.order_id""",(model_id,)).fetchall()
            audit={r["order_id"]:r for r in state.get("fill_audit",[])}
            matched=len(fills)==state.get("fills")==len(audit)
            # Current runtime starts empty. Seeded inventory requires a separate
            # audited ledger implementation, not silently inferred free shares.
            cash=float(state.get("initial_cash",0))
            quantities={}
            matched=matched and state.get("initial_equity")==cash
            for fill in fills:
                r=audit.get(str(fill["order_id"]),{})
                matched=matched and all(r.get(k)==fill[k] for k in
                    ("stock_code","side","fill_price","fill_shares","commission","stamp_duty","transfer_fee","slippage","impact_cost"))
                matched=matched and all(r.get(k) and instant(r[k])==fill[k] for k in ("signal_time","fill_time"))
                matched=matched and bool(r.get("submitted_at")) and instant(r["submitted_at"])==fill["order_time"]
                raw=self.conn.execute("SELECT event_at,available_at,ingested_at FROM research_raw_records WHERE record_hash=%s",
                                      (r.get("bar_record_hash",""),)).fetchone()
                matched=matched and bool(raw) and raw["event_at"]==fill["fill_time"]
                if raw:
                    matched=matched and instant(r.get("bar_received_at"))==raw["ingested_at"] and instant(r.get("bar_available_at"))==raw["available_at"]
                signed=fill["fill_shares"] if fill["side"]=="BUY" else -fill["fill_shares"]
                quantities[fill["stock_code"]]=quantities.get(fill["stock_code"],0)+signed
                cash-=signed*fill["fill_price"]+fill["commission"]+fill["stamp_duty"]+fill["transfer_fee"]
            actual_quantities={code:sum(lot["shares"] for lot in lots) for code,lots in state.get("lots",{}).items() if lots}
            matched=matched and {k:v for k,v in quantities.items() if v}==actual_quantities and abs(cash-state.get("cash",0))<.005
            state["database_reconciled"]=bool(matched)
            state["database_fill_count"]=len(fills)
        return state

    def save_experiment(self,report):
        from psycopg.types.json import Jsonb
        with self.conn.transaction():
            registration=report.get("registration")
            if registration:
                updated=self.conn.execute(
                    """UPDATE research_runs SET status=%s,report=%s WHERE run_id=%s
                       AND report->'registration'->>'fingerprint'=%s RETURNING run_id""",
                    (report["status"],Jsonb(report),registration["run_id"],registration["fingerprint"])).fetchone()
                if not updated:
                    raise ValueError("集中实验登记不匹配，拒绝注册模型")
            else:
                self.conn.execute(
                    "INSERT INTO research_runs(run_id,dataset_id,status,report) VALUES (%s,%s,%s,%s)",
                    (uuid.uuid4(),report.get("dataset_id"),report["status"],Jsonb(report)))
            m=report.get("candidate")
            if m:
                self.conn.execute(
                    """INSERT INTO model_artifacts(model_id,algorithm,version,train_start_date,train_end_date,
                       features_list,hyperparameters,file_hash,state)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'CALIBRATED') ON CONFLICT(model_id) DO NOTHING""",
                    (m["model_id"],m["algorithm"].upper(),m["feature_version"],instant(m["train_start"]).date(),
                     instant(m["train_end"]).date(),Jsonb(m["feature_names"]),Jsonb(report["configuration"]),m["file_hash"]))
                metrics=report["holdout"]["calibrated"]
                self.conn.execute(
                    """INSERT INTO model_evaluations(model_id,eval_window_start,eval_window_end,
                       brier_score,log_loss,ece,sample_count,metrics)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (m["model_id"],instant(m["holdout_start"]).date(),instant(m["holdout_end"]).date(),
                     metrics["brier"],metrics["log_loss"],metrics["ece"],metrics["sample_count"],Jsonb(report["holdout"])))
