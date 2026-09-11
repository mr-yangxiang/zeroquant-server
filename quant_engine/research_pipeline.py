#!/usr/bin/env python3
"""Explicit research commands. No command sends orders to a broker."""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import date, datetime
import getpass
import json
import os
from pathlib import Path
import sys

from zeroquant.config import Settings
from zeroquant.research.data import TZ, build_dataset, quality_report, write_json


def main():
    parser=argparse.ArgumentParser(description="ZeroQuant 研究数据、训练与影子交易")
    parser.add_argument("command",choices=("audit","import","backfill","collect","quality","dataset","train","backtest","shadow","promotion-check"))
    parser.add_argument("--input",type=Path,help="原始导入 JSONL 或已生成数据集 JSON")
    parser.add_argument("--output",type=Path,default=Path(__file__).resolve().parent/"research_artifacts")
    parser.add_argument("--contracts",type=Path,help="已核验的供应商时间合同 JSON")
    parser.add_argument("--costs",type=Path,help="券商成本 JSON")
    parser.add_argument("--artifact",type=Path)
    parser.add_argument("--start",type=date.fromisoformat,default=date(2023,1,1))
    parser.add_argument("--end",type=date.fromisoformat,default=datetime.now(TZ).date())
    parser.add_argument("--horizon",type=int,choices=(5,15,30,60),default=15)
    parser.add_argument("--kinds",default="minute,news,dragon_tiger,calendar")
    parser.add_argument("--sources",help="可选，逗号分隔的已核验研究来源白名单；不与公开观察数据混用")
    parser.add_argument("--database",action="store_true",help="显式启用数据库读写（audit 只读）")
    parser.add_argument("--db-host")
    parser.add_argument("--db-port",default="5432")
    parser.add_argument("--db-name",default="zeroquant_db")
    parser.add_argument("--db-user")
    parser.add_argument("--password-prompt",action="store_true")
    args=parser.parse_args()
    Settings._load_dotenv()
    if args.command == "shadow":
        from realtime_monitor_1m import is_continuous_auction
        if not is_continuous_auction(datetime.now(TZ)):
            print(json.dumps({"status":"OUTSIDE_SESSION","note":"非连续竞价时段，无数据库写入"},ensure_ascii=False))
            return 0
    if args.db_host:
        os.environ["PGHOST"]=args.db_host
        os.environ["PGPORT"]=args.db_port
        os.environ["PGDATABASE"]=args.db_name
        if args.db_user:
            os.environ["PGUSER"]=args.db_user
        # Explicit flags take precedence over any unrelated local DATABASE_URL.
        os.environ.pop("DATABASE_URL",None)
    if args.password_prompt:
        os.environ["PGPASSWORD"]=getpass.getpass("数据库密码（不回显）: ")
    contracts=json.loads(args.contracts.read_text()) if args.contracts else {}
    args.output.mkdir(parents=True,exist_ok=True)
    warehouse=None
    try:
        if args.database:
            from zeroquant.research.warehouse import Warehouse,connect_database
            try:
                warehouse=Warehouse(connect_database())
            except Exception as exc:
                report={"status":"BLOCKED_DATABASE_CONNECTION","error_type":type(exc).__name__,
                        "note":"连接失败，未执行数据库写入；请核对监听、防火墙、TLS 和 pg_hba.conf"}
                write_json(args.output/"connection-report.json",report)
                print(json.dumps(report,ensure_ascii=False))
                return 2
        if args.command=="audit":
            if not warehouse:
                raise ValueError("audit 需要 --database")
            result=warehouse.audit()
            write_json(args.output/"database-audit.json",result)
        elif args.command=="collect":
            from zeroquant.research.ingestion import collect_public_recent
            result=collect_public_recent(args.output,warehouse)
        elif args.command=="import":
            from zeroquant.research.ingestion import read_import
            if not args.input:
                raise ValueError("import 需要 --input")
            records=read_import(args.input,contracts)
            write_json(args.output/"normalized-records.json",records)
            result={"status":"IMPORTED" if warehouse else "VALIDATED_LOCAL",
                    "records":len(records),"inserted":warehouse.ingest(records) if warehouse else 0}
        elif args.command=="backfill":
            from zeroquant.research.ingestion import backfill_tushare
            result=backfill_tushare(args.start,args.end,args.output,warehouse,contracts,args.kinds.split(","))
        elif args.command in ("quality","dataset"):
            if warehouse:
                records=warehouse.records(f"{args.start}T00:00:00+08:00",f"{args.end}T23:59:59+08:00")
            elif args.input:
                records=json.loads(args.input.read_text())
            else:
                raise ValueError("需要 --database 或规范化记录 --input")
            if args.sources:
                sources={source.strip() for source in args.sources.split(",") if source.strip()}
                records=[r for r in records if r["source"] in sources]
            if args.command=="quality":
                result=quality_report(records, as_of=datetime.now(TZ))
                write_json(args.output/"quality.json",result)
            else:
                rows,manifest=build_dataset(records,args.horizon)
                write_json(args.output/"dataset.json",{"rows":rows,"manifest":manifest})
                if warehouse:
                    warehouse.save_dataset(rows,manifest)
                result=manifest
        elif args.command=="train":
            from zeroquant.research.training import train_experiment
            if not args.input:
                raise ValueError("train 需要生成的 dataset.json")
            data=json.loads(args.input.read_text())
            from zeroquant.research.training import _validate_rows
            from zeroquant.research.data import digest
            if digest(data["rows"])!=data["manifest"].get("dataset_hash"):
                raise ValueError("训练输入与已冻结的数据集哈希不一致")
            _validate_rows(data["rows"],data["manifest"])
            registration=None
            if warehouse:
                warehouse.save_dataset(data["rows"],data["manifest"])
                registration=warehouse.reserve_experiment(data["rows"],data["manifest"],args.output)
            result=train_experiment(data["rows"],data["manifest"],args.output)
            if warehouse:
                if registration:
                    result["registration"]=registration
                    write_json(args.output/"report.json",result)
                warehouse.save_experiment(result)
        elif args.command=="backtest":
            from zeroquant.research.execution import CostConfig
            from zeroquant.research.backtest import cost_experiment
            if not args.artifact:
                raise ValueError("backtest 需要 --artifact 指向已冻结实验")
            report=json.loads((args.artifact/"report.json").read_text())
            predictions=json.loads((args.artifact/"holdout-oos.json").read_text())
            records=warehouse.records(f"{args.start}T00:00:00+08:00",f"{args.end}T23:59:59+08:00") if warehouse else json.loads(args.input.read_text()) if args.input else []
            records=[r for r in records if r["source"] in report["candidate"].get("data_sources",[])]
            costs=CostConfig(**json.loads(args.costs.read_text())) if args.costs else CostConfig()
            result=cost_experiment(predictions,records,costs,report["candidate"]["file_hash"],report["dataset_hash"])
            write_json(args.output/"cost-backtest.json",result)
        elif args.command=="shadow":
            from zeroquant.research.execution import CostConfig
            from zeroquant.research.shadow import run_shadow
            if not args.artifact or not warehouse:
                raise ValueError("shadow 需要 --artifact 和 --database")
            costs=CostConfig(**json.loads(args.costs.read_text())) if args.costs else CostConfig()
            result=run_shadow(warehouse,args.artifact,costs)
            write_json(args.output/"shadow-latest.json",result)
        else:
            from zeroquant.research.execution import CostConfig,promotion_evidence
            if not args.artifact or not warehouse:
                raise ValueError("promotion-check 需要 --artifact 和 --database")
            report=json.loads((args.artifact/"report.json").read_text())
            costs=CostConfig(**json.loads(args.costs.read_text())) if args.costs else CostConfig()
            candidate=report.get("candidate",{})
            cost_path=args.artifact/"cost-backtest.json"
            if cost_path.exists():
                cost_report=json.loads(cost_path.read_text())
                from zeroquant.research.data import digest
                if (cost_report.get("model_file_hash")==candidate.get("file_hash")
                    and cost_report.get("dataset_hash")==report.get("dataset_hash")
                    and cost_report.get("cost_config_hash")==costs.fingerprint
                    and cost_report.get("prediction_hash")==digest(json.loads((args.artifact/"holdout-oos.json").read_text()))):
                    report["cost_backtest"]=cost_report
            with warehouse.conn.transaction():
                warehouse.conn.execute("SET TRANSACTION READ ONLY")
                saved_report=warehouse.conn.execute(
                    "SELECT report FROM research_runs WHERE run_id=%s AND status='VALIDATED_RESEARCH'",
                    (report.get("registration",{}).get("run_id"),)).fetchone()
            from zeroquant.research.data import canonical
            frozen_report={k:v for k,v in report.items() if k!="cost_backtest"}
            if not saved_report or canonical(saved_report["report"])!=canonical(frozen_report):
                raise ValueError("本地报告与集中登记的实验不一致，不能申请生产资格")
            import hashlib
            if hashlib.sha256((args.artifact/"candidate.joblib").read_bytes()).hexdigest()!=candidate.get("file_hash"):
                raise ValueError("模型工件与已登记报告哈希不一致")
            state=warehouse.reconcile_shadow(candidate.get("model_id"))
            evaluated_at = datetime.now(TZ)
            fresh=quality_report([r for r in warehouse.records() if r["source"] in candidate.get("data_sources",[])],
                                 as_of=evaluated_at, require_current_day=True)
            result=promotion_evidence(report,state,costs,evaluated_at,fresh["production_ready"])
            result["data_quality"] = fresh
            write_json(args.output/"promotion-check.json",result)
        print(json.dumps(result,ensure_ascii=False,default=str))
        return 2 if str(result.get("status","")).startswith(("BLOCKED","INCOMPLETE")) or result.get("approved") is False else 0
    except (ValueError,RuntimeError) as exc:
        report={"status":"BLOCKED","reason":str(exc)}
        write_json(args.output/"blocked.json",report)
        print(json.dumps(report,ensure_ascii=False))
        return 2
    finally:
        if warehouse:
            warehouse.conn.close()
        if args.password_prompt:
            os.environ.pop("PGPASSWORD",None)


if __name__=="__main__":
    sys.exit(main())
