"""模型登记业务层：限制分页大小、转换响应；不加载模型文件或执行生产晋升。"""

from typing import Protocol, Any
from .schemas import ModelList, ModelRegistration


class ModelReader(Protocol):
    """模型登记读取端口，不向业务层暴露具体 ORM 类型。"""
    def list_models(self, after: str | None, limit: int) -> list[Any]:
        """按排他性游标返回至多 limit 条具备模型登记属性的对象。"""
        ...


class ModelRegistryService:
    """提供只读分页能力；生产门禁必须由独立验收与发布流程判断。"""
    def __init__(self, repository: ModelReader):
        """注入读取端口，避免服务层依赖 SQLAlchemy。"""
        self.repository = repository

    def list_models(self, after: str | None = None, limit: int = 20) -> ModelList:
        """返回登记摘要及下一页游标；页大小不在 1～100 时抛出 ValueError。"""
        if not 1 <= limit <= 100:
            raise ValueError("每页数量必须在 1 到 100 之间")
        # 额外读取一条作为翻页标记，避免另做全表计数；最多读取 101 条。
        rows = self.repository.list_models(after, limit + 1)
        # 只将本页记录转为对外契约，额外一条不泄漏到响应中。
        items = [ModelRegistration.model_validate(row) for row in rows[:limit]]
        return ModelList(items=items, next_cursor=items[-1].model_id if len(rows) > limit else None)
