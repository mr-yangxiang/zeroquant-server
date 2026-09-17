"""内部 HTTP 路由：声明参数约束和响应契约，将业务处理交给 Service。"""

from fastapi import APIRouter, Depends, Query
from ..domains.research.schemas import ResearchStatus
from ..domains.model_registry.schemas import ModelList
from .dependencies import require_internal_token, research_service, model_service

# 内部业务路由统一挂载鉴权，新增路由应复用该入口。
router = APIRouter(prefix="/internal/v1", dependencies=[Depends(require_internal_token)])


@router.get("/research/status", response_model=ResearchStatus)
def research_status(service=Depends(research_service)):
    """返回研究数据登记统计；同步调用由框架工作线程执行，不代表训练验收通过。"""
    return service.status()


@router.get("/models", response_model=ModelList)
def models(limit: int = Query(default=20, ge=1, le=100),
           after: str | None = Query(default=None, min_length=1, max_length=100),
           service=Depends(model_service)):
    """分页列出模型元数据；after 为排他性 model_id 游标，limit 为每页条数（1～100）。"""
    return service.list_models(after, limit)
