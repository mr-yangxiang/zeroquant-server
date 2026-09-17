"""模型登记持久层；使用参数化 SQLAlchemy 查询读取既有元数据。"""

from sqlalchemy import select
from sqlalchemy.orm import Session
from .entities import ModelArtifact


class ModelRegistryRepository:
    """借用只读会话查询模型；事务生命周期由基础设施管理。"""
    def __init__(self, session: Session):
        """保存当前请求会话，不自行建立连接或提交事务。"""
        self.session = session

    def list_models(self, after: str | None, limit: int):
        """按数据库字符串排序读取 model_id 大于 after 的记录，最多 limit 条。

        服务可能多取一条作为翻页标记；这里不判断登记状态是否符合生产标准。"""
        # 字符串顺序不是训练日期顺序；多次分页请求不共享同一历史快照。
        query = select(ModelArtifact).order_by(ModelArtifact.model_id).limit(limit)
        if after is not None:
            # 游标作为绑定参数，不拼接进 SQL。
            query = query.where(ModelArtifact.model_id > after)
        return self.session.scalars(query).all()
