"""依赖装配层：先鉴权，再为请求提供会话、Repository 和领域 Service。"""

from hmac import compare_digest
from fastapi import Depends, Header, HTTPException, Request
from ..domains.research.repository import ResearchRepository
from ..domains.research.service import ResearchService
from ..domains.model_registry.repository import ModelRegistryRepository
from ..domains.model_registry.service import ModelRegistryService


def require_internal_token(request: Request, x_zeroquant_internal_token: str | None = Header(default=None)):
    """校验 X-ZeroQuant-Internal-Token；缺失或不匹配返回 401，不记录令牌。"""
    # 统一转为 UTF-8 字节交给 compare_digest，避免普通字符串相等比较。
    supplied = (x_zeroquant_internal_token or "").encode()
    expected = request.app.state.settings.internal_token.get_secret_value().encode()
    if not compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="内部访问凭据无效")


def read_session(request: Request):
    """向请求借出独立只读会话；请求结束或异常后由数据库上下文回收。"""
    with request.app.state.database.read_session() as session:
        yield session


def research_service(request: Request, session=Depends(read_session)):
    """装配研究库存服务，缓存从应用状态注入，业务层不感知 HTTP。"""
    return ResearchService(ResearchRepository(session), request.app.state.cache)


def model_service(session=Depends(read_session)):
    """装配模型登记服务；不使用缓存，避免缓存登记状态。"""
    return ModelRegistryService(ModelRegistryRepository(session))
