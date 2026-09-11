"""Safety fixtures only; no production model, order or remote DB writes."""
import copy
from datetime import timedelta
from pathlib import Path
import tempfile
import unittest

from test_research_pipeline import bar, daily_records, training_rows
from zeroquant.research.data import build_dataset, digest, instant, quality_report
from zeroquant.research.execution import CostConfig, new_account, shadow_step, promotion_evidence
from zeroquant.research.training import purged_folds, train_experiment
from zeroquant.research.backtest import replay_oos


class ResearchSafetyTests(unittest.TestCase):
    def test_cost_change_rejected_even_on_retry(self):
        now=instant('2026-08-03T10:00:00+08:00')
        state,_,_=shadow_step(new_account(),[],[],now,'candidate',CostConfig())
        with self.assertRaisesRegex(ValueError,'成本'):
            shadow_step(state,[],[],now,'candidate',CostConfig(slippage_bps=20))

    def test_late_fill_cannot_be_replayed_as_live(self):
        now=instant('2026-08-03T10:00:00+08:00')
        signal={'stock_code':'600839','decision_time':now.isoformat(),'probabilities':[.1,.1,.8],'price':10}
        state,_,_=shadow_step(new_account(),[signal],[],now,'candidate',CostConfig())
        later=now+timedelta(minutes=10)
        delayed=bar(now+timedelta(minutes=1))|{'ingested_at':later.isoformat()}
        state,orders,fills=shadow_step(state,[],[delayed],later,'candidate',CostConfig())
        self.assertFalse(fills)
        self.assertEqual(orders[0]['status'],'CANCELLED')
        self.assertEqual(state['cash'],100000)

    def test_initial_lots_not_mutated_by_account(self):
        lots={'600839':[{'shares':100,'cost':10,'acquired_date':'2026-07-31'}]}
        state=new_account(initial_lots=lots)
        state['lots']['600839'][0]['shares']=0
        self.assertEqual(lots['600839'][0]['shares'],100)

    def test_nan_and_fake_counters_do_not_promote(self):
        report={'status':'VALIDATED_RESEARCH','data_ready':True,'fold_count':3,
                'holdout':{'calibrated':{'sample_count':10000,'brier':float('nan'),'ece':float('nan')},
                           'frequency_benchmark':{'brier':.7}}}
        state=new_account()
        state.update(fills=10000,operations_verified=True,equity=[{'value':float('nan')}])
        evidence=promotion_evidence(report,state,CostConfig(broker_verified=True,evidence_reference='TEST_ONLY'),
                                    instant('2026-09-10T10:00:00+08:00'),True)
        self.assertFalse(evidence['approved'])
        self.assertTrue(any('校准' in issue for issue in evidence['reasons']))

    def test_future_label_release_is_purged(self):
        rows=training_rows()
        late=copy.deepcopy(rows)
        for r in late[:12]:
            r['label_available_at']='2026-01-01T10:00:00+08:00'
        folds=list(purged_folds(late,train_days=5,calibration_days=3,test_days=3,holdout_days=3))
        self.assertTrue(all(not set(range(12)) & set(f['train']) for f in folds))

    def test_missing_holdout_and_future_features_rejected_with_tiny_dataset(self):
        rows=training_rows()[:1]
        with self.assertRaises(ValueError):
            list(purged_folds(rows,holdout_days=0))
        rows[0]['feature_max_available_at']='2030-01-01T00:00:00+08:00'
        with self.assertRaisesRegex(ValueError,'未来特征'):
            list(purged_folds(rows))

    def test_retry_reuses_sealed_report_and_changed_experiment_rejected(self):
        manifest={'dataset_id':'TEST_ONLY','dataset_hash':digest([]),'quality':{'production_ready':False}}
        with tempfile.TemporaryDirectory() as tmp:
            first=train_experiment([],manifest,Path(tmp))
            self.assertEqual(first,train_experiment([],manifest,Path(tmp)))
            with self.assertRaisesRegex(ValueError,'封存'):
                train_experiment([],manifest,Path(tmp),min_folds=4)

    def test_real_label_available_and_integrity_evidence(self):
        records=daily_records()
        rows,_=build_dataset(records)
        self.assertTrue(all(instant(r['label_available_at'])>=instant(r['label_end_time']) for r in rows))
        records[0]['payload']['amount']+=1
        self.assertEqual(quality_report(records)['invalid_evidence_rows'],1)

    def test_backtest_cannot_fill_without_actual_limits(self):
        now=instant('2026-08-03T10:00:00+08:00')
        signal={'stock_code':'600839','decision_time':now.isoformat(),'label_end_time':(now+timedelta(minutes=15)).isoformat(),
                'probabilities':[.1,.1,.8],'input_hash':'TEST_ONLY'}
        record=bar(now+timedelta(minutes=1))|{'pit_certified':True,'ingested_at':now.isoformat()}
        record['payload'].pop('upper_limit')
        result=replay_oos([signal],[record],CostConfig())
        self.assertEqual(result['fill_count'],0)
        self.assertEqual(result['net_return_pct'],0)
        self.assertTrue(result['rejections'])

    def test_backtest_cash_matches_fees_and_cannot_sell_same_day_purchase(self):
        monday=instant('2026-08-03T10:00:00+08:00')
        times=[monday,monday+timedelta(minutes=2),monday+timedelta(days=1)]
        predictions=[]; records=[]
        for i,at in enumerate(times):
            predictions.append({'stock_code':'600839','decision_time':at.isoformat(),
                'label_end_time':(at+timedelta(minutes=15)).isoformat(),
                'probabilities':[.1,.1,.8] if i==0 else [.8,.1,.1],'input_hash':'TEST_ONLY'})
            record=bar(at+timedelta(minutes=1),10+i*.05)
            record.update(pit_certified=True,ingested_at=(at+timedelta(minutes=1,seconds=.5)).isoformat())
            records.append(record)
        result=replay_oos(predictions,records,CostConfig())
        self.assertEqual(result['fill_count'],2)
        self.assertTrue(any('T+1' in reason for reason in result['rejections']))
        buys,sells=result['fills']
        expected=(sells['fill_price']-buys['fill_price'])*100-result['fees_paid']
        self.assertAlmostEqual(result['net_return_pct']/100*100000,expected,places=8)
        self.assertFalse(result['ending_lots']['600839'])
