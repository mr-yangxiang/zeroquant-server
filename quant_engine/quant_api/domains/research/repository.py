"""研究库存持久层：执行固定表集合的只读计数，不作业务阶段判断。"""

from sqlalchemy import func, select, table
from sqlalchemy.orm import Session


class ResearchRepository:
    """借用请求 Session；不自行提交、关闭或跨线程共享会话。"""
    def __init__(self, session: Session):
        """注入调用方管理生命周期的只读会话。"""
        self.session = session

    def counts(self) -> dict[str, int]:
        # 表名全部来自固定映射，API 不接收表名输入。
        """在一次 SQL 查询中返回六类行数；表名为代码常量，不接受用户输入。"""
        sources = {"raw_records":"research_raw_records", "datasets":"research_datasets",
                   "feature_snapshots":"feature_snapshots", "training_labels":"training_labels",
                   "models":"model_artifacts", "evaluations":"model_evaluations"}
        # 一次 SQL 汇总六个子查询；精确全表计数可能较慢，受连接的查询超时约束。
        query = select(*(select(func.count()).select_from(table(name)).scalar_subquery().label(label)
                         for label, name in sources.items()))
        return dict(self.session.execute(query).mappings().one())
