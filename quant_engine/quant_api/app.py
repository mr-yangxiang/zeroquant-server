"""内部只读 API 应用工厂；组装依赖与生命周期，不接管 Node 业务、迁移或调度。"""

from contextlib import asynccontextmanager
import hashlib

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from .api.dependencies import require_internal_token
from .api.router import router
from .shared.settings import ApiSettings
from .shared.database import Database
from .shared.cache import NoCache, RedisCache


def create_app(settings: ApiSettings | None = None, *, database=None, cache=None) -> FastAPI:
    """创建独立应用，可注入数据库及缓存用于测试。

    应用生命周期负责关闭传入或自行创建的资源；调用方不应跨应用共享这些资源。
    配置校验失败时直接抛错，不使用隐式默认数据库。"""
    settings = settings or ApiSettings.from_env()
    database = database if database is not None else Database(settings.database_url.get_secret_value())
    if cache is None:
        # 按连接配置隔离缓存空间；摘要避免把连接串直接写入键，但不是加密保护。
        namespace = "zeroquant:pyapi:" + hashlib.sha256(settings.database_url.get_secret_value().encode()).hexdigest()[:24]
        cache = RedisCache(settings.redis_url.get_secret_value(), namespace) if settings.redis_url else NoCache()

    @asynccontextmanager
    async def lifespan(app):
        # 启动不运行迁移、调度、模型加载或训练。
        """管理资源退出清理；缓存关闭失败时仍尝试释放数据库连接池。"""
        try:
            yield
        finally:
            try: cache.close()
            finally: database.close()

    # 关闭文档不等于鉴权；生产仍须限制网络入口并使用内部令牌。
    app = FastAPI(title="ZeroQuant 内部量化服务", version="0.1.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings, app.state.database, app.state.cache = settings, database, cache

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, error):
        # 不序列化异常原文，避免暴露连接串与 SQL 参数。
        """将数据库异常统一转换为不含连接串、SQL 或参数的 503 响应。"""
        return JSONResponse(status_code=503, content={"detail":"研究数据库暂不可用，请检查服务端配置与结构版本"})

    @app.get("/health/live")
    def live():
        """仅确认 HTTP 进程存活；不访问数据库，不证明业务可用。"""
        return {"status":"ok", "service":"zeroquant-python-api"}

    @app.get("/health/ready", dependencies=[Depends(require_internal_token)])
    def ready():
        """检查数据库可连接且存在迁移 008 记录；不替代完整结构和生产资格验收。"""
        if not database.ready():
            return JSONResponse(status_code=503, content={"detail":"数据库尚未满足迁移 008 前置条件"})
        return {"status":"ready", "schema_minimum":"008", "signal_eligibility":"not_evaluated"}

    app.include_router(router)
    return app
