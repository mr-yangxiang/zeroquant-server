"""隔离 HTTP/ORM 契约测试；使用虚构数据和 SQLite，不代表真实 PostgreSQL 或模型验收。"""
import ast
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import create_engine, event, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import OperationalError
from sqlalchemy.pool import StaticPool

from quant_api.app import create_app
from quant_api.api.dependencies import read_session
from quant_api.shared.settings import ApiSettings
from quant_api.shared.database import Base, Database
from quant_api.shared.cache import NoCache, RedisCache
from quant_api.domains.model_registry.entities import ModelArtifact
from quant_api.domains.research.service import ResearchService

# 公开的隔离测试凭据，不可复用于部署。
TOKEN = "isolated-test-token-0123456789-abcdef"
SETTINGS = {"database_url":"postgresql+psycopg://test@localhost/zeroquant_test", "internal_token":TOKEN}
HEADERS = {"X-ZeroQuant-Internal-Token":TOKEN}


class MemoryCache(NoCache):
    """单值缓存替身；不实现 Redis 过期机制，用于验证服务层自身的时效校验。"""
    def __init__(self):
        """初始化空缓存。"""
        self.value = None
    def get(self, key):
        """返回保存的测试值，不按键分区。"""
        return self.value
    def put(self, key, value, ttl):
        """保留测试值，故意不自动执行 ttl 过期。"""
        self.value = value


class LayeredApiTests(unittest.TestCase):
    """验证分层 API 的鉴权、契约、回源与安全边界；不访问生产数据库。"""
    def setUp(self):
        """为每个测试创建独立内存数据库及应用；建表仅用于隔离测试。"""
        # 仅内存 SQLite；允许测试线程共享连接，不改变生产连接池配置。
        engine = create_engine("sqlite://", connect_args={"check_same_thread":False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)  # 仅测试夹具显式建表，生产启动不得执行。
        with engine.begin() as conn:
            for name in ("research_raw_records","research_datasets","feature_snapshots","training_labels","model_evaluations"):
                conn.execute(text(f"CREATE TABLE {name}(id INTEGER PRIMARY KEY)"))
            conn.execute(text("CREATE TABLE schema_migrations(version TEXT PRIMARY KEY)"))
            conn.execute(text("INSERT INTO schema_migrations VALUES('008')"))
        self.db = Database(SETTINGS["database_url"], engine=engine)
        self.cache = MemoryCache()
        self.app = create_app(ApiSettings(**SETTINGS), database=self.db, cache=self.cache)

    def tearDown(self):
        """清理当前测试的数据库连接池。"""
        self.db.close()

    def seed_models(self):
        """插入三条虚构 champion 登记，验证该字符串不会自动授予生产资格。"""
        with self.db.sessions.begin() as session:
            for index in range(3):
                session.add(ModelArtifact(model_id=f"candidate-{index}",algorithm="logistic",version="test",
                    train_start_date=date(2020,1,1),train_end_date=date(2021,1,1),features_list=["x"],
                    hyperparameters={},file_hash=str(index)*64,state="champion",created_at=datetime.now(timezone.utc)))

    def test_health_does_not_query_database(self):
        """验证存活探针不触发 SQL，且未公开接口文档。"""
        calls=[]
        event.listen(self.db.engine,"before_cursor_execute",lambda *args:calls.append(1))
        with TestClient(self.app) as client:
            self.assertEqual(client.get("/health/live").status_code,200)
            self.assertEqual(client.get("/docs").status_code,404)
            self.assertEqual(client.get("/openapi.json").status_code,404)
        self.assertEqual(calls,[])

    def test_authentication_precedes_repository_access(self):
        """验证缺失或错误令牌在访问会话前即被拒绝。"""
        with patch.object(self.db,"read_session",side_effect=AssertionError("must not connect")):
            with TestClient(self.app) as client:
                for path in ("/internal/v1/research/status","/internal/v1/models","/health/ready"):
                    self.assertEqual(client.get(path).status_code,401)
                    self.assertEqual(client.get(path,headers={"X-ZeroQuant-Internal-Token":"wrong"}).status_code,401)

    def test_status_counts_and_short_lived_cache(self):
        """验证缓存命中保持原始观察时间和未评估资格。"""
        with TestClient(self.app) as client:
            first=client.get("/internal/v1/research/status",headers=HEADERS).json()
            second=client.get("/internal/v1/research/status",headers=HEADERS).json()
            self.assertEqual(first["counts"]["models"],0)
            self.assertEqual(first["signal_eligibility"],"not_evaluated")
            self.assertFalse(first["cached"])
            self.assertTrue(second["cached"])
            self.assertEqual(first["observed_at"],second["observed_at"])

    def test_expired_future_and_corrupt_cache_recomputed(self):
        """验证过期、未来、损坏和伪造已批准资格的缓存均被丢弃。"""
        with TestClient(self.app) as client:
            path="/internal/v1/research/status"
            template=client.get(path,headers=HEADERS).json()
            for value in ({"malformed":True},
                dict(template,observed_at=(datetime.now(timezone.utc)-timedelta(seconds=30)).isoformat()),
                dict(template,observed_at=(datetime.now(timezone.utc)+timedelta(seconds=30)).isoformat()),
                dict(template,signal_eligibility="approved")):
                self.cache.value=value
                result=client.get(path,headers=HEADERS)
                self.assertEqual(result.status_code,200)
                self.assertFalse(result.json()["cached"])
                self.assertEqual(result.json()["signal_eligibility"],"not_evaluated")

    def test_model_pagination_never_grants_production_permission(self):
        """验证分页无重复并避免把 champion 登记当作交易批准。"""
        self.seed_models()
        with TestClient(self.app) as client:
            first=client.get("/internal/v1/models?limit=2",headers=HEADERS).json()
            second=client.get("/internal/v1/models",params={"limit":2,"after":first["next_cursor"]},headers=HEADERS).json()
            self.assertEqual([r["model_id"] for r in first["items"]],["candidate-0","candidate-1"])
            self.assertEqual([r["model_id"] for r in second["items"]],["candidate-2"])
            self.assertIsNone(second["next_cursor"])
            self.assertEqual(first["signal_eligibility"],"not_evaluated")
            self.assertNotIn("hyperparameters",first["items"][0])

    def test_untrusted_query_is_validated_and_parameterized(self):
        """验证参数边界；看似 SQL 的游标仍只作为字符串比较值。"""
        self.seed_models()
        with TestClient(self.app) as client:
            for query in ("limit=0","limit=101","limit=abc","after="+"x"*101):
                self.assertEqual(client.get("/internal/v1/models?"+query,headers=HEADERS).status_code,422)
            response=client.get("/internal/v1/models",params={"after":"' OR 1=1 --"},headers=HEADERS)
            self.assertEqual(response.status_code,200)
            self.assertEqual(len(response.json()["items"]),3)

    def test_sql_errors_are_sanitized(self):
        """验证数据库错误响应不回显内部密码或 SQL。"""
        def broken_session():
            """注入包含敏感标记的故障；保留 yield 以模拟生成器依赖。"""
            raise OperationalError("secret sql",{},Exception("password=DO_NOT_LEAK"))
            yield
        self.app.dependency_overrides[read_session]=broken_session
        with TestClient(self.app) as client:
            response=client.get("/internal/v1/models",headers=HEADERS)
            self.assertEqual(response.status_code,503)
            self.assertNotIn("DO_NOT_LEAK",response.text)

    def test_ready_requires_existing_migration(self):
        """验证就绪探针对迁移 008 登记存在性的检查。"""
        with TestClient(self.app) as client:
            self.assertEqual(client.get("/health/ready",headers=HEADERS).status_code,200)
            with self.db.engine.begin() as conn: conn.execute(text("DELETE FROM schema_migrations"))
            self.assertEqual(client.get("/health/ready",headers=HEADERS).status_code,503)

    def test_redis_outage_falls_back_to_repository(self):
        """用连接失败替身验证数据库回源，不需要真实 Redis。"""
        def down(*args,**kwargs):
            """模拟 Redis 连接失败。"""
            raise RedisConnectionError("offline")
        cache=RedisCache.__new__(RedisCache)
        cache.namespace="test"
        cache.client=SimpleNamespace(get=down,set=down,close=lambda:None)
        self.app.state.cache=cache
        with TestClient(self.app) as client:
            response=client.get("/internal/v1/research/status",headers=HEADERS)
            self.assertEqual(response.status_code,200)
            self.assertFalse(response.json()["cached"])

    def test_session_rollback_and_independence(self):
        """验证 SQLite 测试事务的异常回滚和 Session 独立性，不证明 PG 只读限制。"""
        with self.assertRaises(RuntimeError):
            with self.db.read_session() as session:
                # 仅在 SQLite 夹具中写入以测试回滚；PostgreSQL read_session 应拒绝写入。
                session.execute(text("INSERT INTO research_raw_records VALUES(1)"))
                raise RuntimeError("fixture failure")
        with self.db.read_session() as first, self.db.read_session() as second:
            self.assertIsNot(first,second)
            self.assertEqual(first.execute(text("SELECT count(*) FROM research_raw_records")).scalar_one(),0)

    def test_settings_explicit_and_secrets_hidden(self):
        """验证显式配置、脱敏展示以及禁止继承通用 DATABASE_URL。"""
        with self.assertRaises(ValidationError) as error:
            ApiSettings(database_url="mysql://user:SENSITIVE@host/db",internal_token="tiny")
        self.assertNotIn("SENSITIVE",str(error.exception))
        self.assertNotIn(TOKEN,repr(ApiSettings(**SETTINGS)))
        with patch.dict("os.environ",{"DATABASE_URL":SETTINGS["database_url"]},clear=True):
            with self.assertRaises(ValidationError): ApiSettings.from_env()

    def test_layer_boundaries_and_no_startup_ddl(self):
        """静态检查服务层依赖及 API 包内禁止自动建删表的约束。"""
        root=Path(__file__).resolve().parents[1]/"quant_api"
        for path in root.glob("domains/*/service.py"):
            imports=[n.module for n in ast.walk(ast.parse(path.read_text())) if isinstance(n,ast.ImportFrom)]
            self.assertFalse(any(m and m.split('.')[0] in ("sqlalchemy","fastapi") for m in imports))
        for path in root.rglob("*.py"):
            tree=ast.parse(path.read_text())
            calls=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)]
            self.assertNotIn("create_all",calls)
            self.assertNotIn("drop_all",calls)

    def test_model_mapping_has_postgresql_jsonb_and_complete_columns(self):
        """验证模型映射字段集合、PG JSONB 编译及带时区声明，不连接 PG。"""
        table=ModelArtifact.__table__
        self.assertEqual(set(table.columns.keys()),{"model_id","algorithm","version","train_start_date","train_end_date","features_list","hyperparameters","file_hash","state","created_at"})
        self.assertEqual(str(table.c.features_list.type.compile(dialect=postgresql.dialect())),"JSONB")
        self.assertTrue(table.c.created_at.type.timezone)

if __name__ == "__main__": unittest.main()
