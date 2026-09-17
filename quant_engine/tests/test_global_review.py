"""审查回归：不访问真实行情、凭据或数据库。"""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from zeroquant.providers import HttpTransport, MarketDataError, _parse_tencent_timestamp
from zeroquant.sink import PredictionSink


class GlobalReviewTests(unittest.TestCase):
    def test_invalid_vendor_time_is_not_replaced_with_current_time(self):
        for raw in ('', 'not-a-time', '20260230093000', '20260915253000'):
            with self.assertRaises(MarketDataError):
                _parse_tencent_timestamp(raw)
        value = _parse_tencent_timestamp('20260915103000')
        self.assertEqual(value.isoformat(), '2026-09-15T10:30:00+08:00')

    def test_provider_failure_does_not_expose_url_or_exception_credentials(self):
        transport = HttpTransport()
        with patch('urllib.request.urlopen', side_effect=OSError('password=private')), patch('time.sleep'):
            with self.assertRaises(MarketDataError) as caught:
                transport.text('https://example.invalid/quotes?token=private')
        self.assertNotIn('private', str(caught.exception))
        self.assertNotIn('example.invalid', str(caught.exception))
        with patch.object(transport, 'text', return_value='bad-json'):
            with self.assertRaises(MarketDataError) as caught:
                transport.json('https://example.invalid/?token=private')
        self.assertNotIn('private', str(caught.exception))

    def test_sync_uses_observation_time_separately_from_generation_time(self):
        from datetime import datetime
        observed = datetime.fromisoformat('2026-09-17T10:00:00+08:00')
        generated = datetime.fromisoformat('2026-09-17T10:01:00+08:00')
        run = SimpleNamespace(as_of=generated, features=SimpleNamespace(observed_at=observed),
                              horizons=[], stock_code='000572', trade_date='2026-09-17', run_id='fixture')
        sink = PredictionSink(SimpleNamespace())
        with patch.object(sink, '_post') as post:
            sink.persist_realtime_point(run, 10, 11, 9, 1)
        payload = post.call_args.args[1]
        self.assertEqual(payload['observedAt'], observed.isoformat())
        self.assertEqual(payload['timestampStr'], generated.isoformat())

    def test_outbox_contains_error_category_only(self):
        with TemporaryDirectory() as directory:
            sink = PredictionSink(SimpleNamespace(state_dir=Path(directory)))
            run = SimpleNamespace(run_id='test-run', to_dict=lambda: {'runId': 'test-run'})
            path = sink._write_outbox(run, RuntimeError('password=private query=SELECT'))
            payload = json.loads(path.read_text())
            self.assertEqual(payload['persistenceError'], 'RuntimeError')
            self.assertNotIn('private', path.read_text())


if __name__ == '__main__':
    unittest.main()
