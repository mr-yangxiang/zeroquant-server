"""Synthetic fixtures verify software invariants; never evidence of trading edge."""
import copy
from datetime import datetime, timedelta
import json
from pathlib import Path
import tempfile
import unittest

from zeroquant.research.data import TZ, build_dataset, digest, normalize_record, quality_report
from zeroquant.research.execution import CostConfig,new_account,promotion_evidence,shadow_step,simulate_fill
from zeroquant.research.training import purged_folds,train_experiment,predict_candidate


def bar(at,price=10.,code="600839"):
    return {"kind":"minute","stock_code":code,"source":"test-fixture",
            "event_at":at.isoformat(),"available_at":at.isoformat(),
            "payload":{"open":price,"high":price+.1,"low":price-.1,"close":price,
                       "volume":100000,"amount":price*100000,"volume_unit":"shares",
                       "price_basis":"unadjusted","upper_limit":11.,"lower_limit":9.}}


def daily_records():
    base=datetime(2026,8,3,9,31,tzinfo=TZ)
    records=[]
    contract={"test-fixture":{"availability_verified":True,"evidence_reference":"TEST_ONLY"}}
    for i in range(240):
        at=base+timedelta(minutes=i if i<120 else i+90)
        raw=bar(at,10+i*.001)
        records.append(normalize_record(raw,at+timedelta(seconds=.5),contract))
    return records


class ResearchDataTests(unittest.TestCase):
    def test_backfill_does_not_forge_historical_availability(self):
        at=datetime(2025,1,3,10,0,tzinfo=TZ)
        received=datetime(2026,1,3,10,0,tzinfo=TZ)
        r=normalize_record(bar(at),received)
        self.assertEqual(r["available_at"],received.isoformat())
        self.assertFalse(r["pit_certified"])

    def test_targets_and_features_have_disjoint_time_information(self):
        records=daily_records()
        now=datetime(2026,8,4,tzinfo=TZ)
        rows,manifest=build_dataset(records,build_at=now)
        self.assertGreater(len(rows),20)
        self.assertTrue(all(r["feature_max_available_at"]<=r["decision_time"]<r["label_end_time"] for r in rows))
        self.assertEqual(manifest["dataset_hash"],digest(rows))
        self.assertFalse(manifest["quality"]["production_ready"])
        altered=copy.deepcopy(records)
        altered[-1]["payload"]["close"]=10.9
        new,_=build_dataset(altered,build_at=now)
        self.assertEqual(rows[0]["features"],new[0]["features"])

    def test_missing_minutes_are_not_compressed_into_labels(self):
        records=daily_records()
        rows,_=build_dataset(records,build_at=datetime(2026,8,4,tzinfo=TZ))
        fewer,_=build_dataset(records[:40]+records[41:],build_at=datetime(2026,8,4,tzinfo=TZ))
        self.assertLess(len(fewer),len(rows))

    def test_historical_download_cannot_create_backdated_training_rows(self):
        received=datetime(2026,8,4,tzinfo=TZ)
        records=[normalize_record(bar(datetime(2026,8,3,9,31,tzinfo=TZ)+timedelta(minutes=i)),received) for i in range(60)]
        rows,_=build_dataset(records,build_at=received)
        self.assertEqual(rows,[])

    def test_live_features_do_not_need_future_labels(self):
        records=daily_records()[:45]
        now=datetime(2026,8,3,10,15,1,tzinfo=TZ)
        rows,_=build_dataset(records,stride=1,build_at=now,require_labels=False)
        self.assertGreater(len(rows),0)
        self.assertIsNone(rows[-1]["target_return_pct"])
        self.assertEqual(rows[-1]["decision_time"],now.isoformat())

    def test_quality_empty_is_explicitly_blocked(self):
        report=quality_report([])
        self.assertEqual(report["status"],"BLOCKED")
        self.assertEqual(len(report["coverage"]),6)


def training_rows():
    rows=[]
    base=datetime(2025,1,2,10,0,tzinfo=TZ)
    for day in range(30):
        at=base+timedelta(days=day)
        if at.weekday()>=5:
            continue
        for label_index in range(3):
            for sample in range(4):
                t=at+timedelta(minutes=sample)
                rows.append({"stock_code":("000572","600362","600839")[label_index],
                    "decision_time":t.isoformat(),"label_end_time":(t+timedelta(minutes=15)).isoformat(),
                    "horizon_minutes":15,"target_return_pct":(label_index-1)*.3,
                    "direction_label":("DOWN","FLAT","UP")[label_index],
                    "features":{"return_5":label_index*.002+sample*.0001,"news_score":sample/100,
                                "seat_missing":1.,"book_imbalance":None,"l2_missing":1.},
                    "input_hash":str(day),"feature_max_available_at":t.isoformat()})
    return sorted(rows,key=lambda r:(r["decision_time"],r["stock_code"]))


class ResearchTrainingTests(unittest.TestCase):
    def test_purge_and_global_stock_split(self):
        rows=training_rows()
        folds=list(purged_folds(rows,train_days=5,calibration_days=3,test_days=3,holdout_days=3))
        self.assertGreaterEqual(len(folds),2)
        for f in folds:
            self.assertTrue(set(f["train"]).isdisjoint(f["test"]))
            self.assertTrue(set(f["calibration"]).isdisjoint(f["test"]))
            self.assertLess(max(rows[i]["label_end_time"] for i in f["train"]),f["calibration_start"])
            self.assertLess(max(rows[i]["label_end_time"] for i in f["calibration"]),f["test_start"])

    def test_all_three_train_calibrate_ablate_and_reload_on_test_fixtures(self):
        rows=training_rows()
        manifest={"dataset_id":"SYNTHETIC_TEST_ONLY","dataset_hash":digest(rows),
                  "feature_version":"TEST_ONLY","quality":{"production_ready":False}}
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)
            report=train_experiment(rows,manifest,output,train_days=5,calibration_days=3,
                                    test_days=3,holdout_days=3,min_folds=2)
            self.assertEqual(report["status"],"VALIDATED_RESEARCH")
            for algorithm in ("logistic","lightgbm","catboost"):
                self.assertEqual(report["models"][algorithm]["status"],"VALIDATED_RESEARCH",
                                 report["models"][algorithm])
                self.assertIn("without_news",report["models"][algorithm]["variants"])
            self.assertFalse(report["production_approved"])
            self.assertFalse(report["data_ready"])
            p=predict_candidate(output,rows[-1]["features"])
            self.assertAlmostEqual(sum(p),1)
            with self.assertRaises(ValueError):
                predict_candidate(output,{},expected_hash="invalid")

    def test_empty_data_never_creates_model_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            result=train_experiment([],{"dataset_id":"empty","dataset_hash":digest([]),
                "quality":{"production_ready":False}},Path(tmp))
            self.assertEqual(result["status"],"BLOCKED")
            self.assertFalse((Path(tmp)/"candidate.joblib").exists())


class ResearchExecutionTests(unittest.TestCase):
    def setUp(self):
        self.at=datetime(2026,8,3,10,0,tzinfo=TZ)
        self.order={"order_id":"test","stock_code":"600839","signal_time":self.at.isoformat(),
                    "side":"BUY","shares":100,"target_price":10}
        self.cost=CostConfig()

    def test_next_bar_and_t_plus_one(self):
        state=new_account()
        b=bar(self.at)
        self.assertEqual(simulate_fill(state,self.order,b,self.cost)["status"],"WAIT")
        b=bar(self.at+timedelta(minutes=1))
        buy=simulate_fill(state,self.order,b,self.cost)
        self.assertEqual(buy["status"],"FILLED")
        sell=simulate_fill(state,self.order|{"side":"SELL"},b,self.cost)
        self.assertEqual(sell["status"],"REJECTED")
        self.assertAlmostEqual(state["cash"],100000-buy["fill_price"]*100-buy["commission"]-buy["transfer_fee"])

    def test_limit_locked_and_missing_limits_reject(self):
        for limits in (False,True):
            b=bar(self.at+timedelta(minutes=1),11.)
            b["payload"].update(open=11.,high=11.,low=11.,close=11.)
            if not limits:
                b["payload"].pop("upper_limit")
            self.assertEqual(simulate_fill(new_account(),self.order,b,self.cost)["status"],"REJECTED")

    def test_shadow_duplicate_retry_does_not_repeat_order(self):
        state=new_account()
        signal={"stock_code":"600839","decision_time":self.at.isoformat(),"probabilities":[.1,.1,.8],"price":10}
        state,orders,_=shadow_step(state,[signal],[],self.at,"test-model",self.cost)
        self.assertEqual(len(orders),1)
        state,orders,_=shadow_step(state,[signal],[],self.at,"test-model",self.cost)
        self.assertEqual(orders,[])
        self.assertEqual(len(state["pending"]),1)

    def test_no_promotion_from_state_string_or_fake_profit(self):
        result=promotion_evidence({"state":"CHAMPION"},new_account(),self.cost,self.at,False)
        self.assertFalse(result["approved"])
        self.assertGreater(len(result["reasons"]),4)

    def test_fee_effective_dates_and_sell_only_tax(self):
        self.assertEqual(self.cost.fees(10000,"BUY","2026-01-01")["stamp_duty"],0)
        self.assertEqual(self.cost.fees(10000,"SELL","2026-01-01")["stamp_duty"],5)
        self.assertEqual(self.cost.fees(10000,"SELL","2023-01-01")["stamp_duty"],10)


if __name__=="__main__":
    unittest.main()
