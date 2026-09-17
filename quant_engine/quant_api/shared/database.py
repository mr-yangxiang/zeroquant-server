"""SQLAlchemy 会话基础设施；PostgreSQL 只读事务，DDL 仍由 src/migrations 管理。"""

from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    """仅提供 ORM 映射基类；应用启动不得调用 create_all 或创建第二套迁移体系。"""
    pass


class Database:
    """持有进程内连接池及会话工厂；每个请求独立使用 Session。"""
    def __init__(self, url: str, *, engine: Engine | None = None):
        """配置惰性连接池与只读连接参数；注入 engine 仅用于复用明确指定的引擎（如测试）。"""
        parsed = make_url(url)
        # 默认引擎的池最多 2 个连接；池等待 3 秒、连接超时 5 秒，多进程部署需累加预算。
        self.engine = engine if engine is not None else create_engine(
            parsed, pool_pre_ping=True, pool_size=2, max_overflow=0, pool_timeout=3,
            hide_parameters=True,
            connect_args={"connect_timeout":5,
                          # 默认 require 要求加密，但不等同 verify-full 的证书/主机名验证；允许 URL 显式覆盖。
                          "sslmode":parsed.query.get("sslmode", "require"),
                          "application_name":"zeroquant_python_read_api",
                          # 服务端默认只读；statement_timeout=5000 毫秒，lock_timeout=1000 毫秒。
                          "options":"-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000"})
        # Session 不可跨请求/线程共享；关闭查询前自动 flush 不等于禁止写入，仍依赖 PG 只读事务。
        self.sessions = sessionmaker(self.engine, expire_on_commit=False, autoflush=False)

    @contextmanager
    def read_session(self):
        # 每个请求独立会话与事务，严禁跨线程共享。
        """提供独立事务会话，正常退出完成事务，异常时回滚，最后关闭会话。

        PostgreSQL 使用可重复读、只读事务及固定 search_path。
        SQLite 测试跳过这些语句，因此不能证明 PostgreSQL 的只读隔离行为。"""
        with self.sessions() as session:
            with session.begin():
                if self.engine.dialect.name == "postgresql":
                    session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
                    session.execute(text("SET LOCAL search_path = public, pg_catalog"))
                yield session

    def ready(self) -> bool:
        """返回迁移 008 是否登记；连接或查询错误由应用统一异常处理器处理。"""
        with self.read_session() as session:
            return session.execute(text("SELECT version FROM schema_migrations WHERE version = '008'")).scalar_one_or_none() == "008"

    def close(self):
        """释放连接池持有的空闲连接；不负责停止任务或强行终止其他会话。"""
        self.engine.dispose()
