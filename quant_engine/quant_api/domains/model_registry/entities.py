"""既有 model_artifacts 表的 ORM 映射；权威字段目录在 src/database/entities，DDL 在 src/migrations。"""

from datetime import date, datetime
from typing import Any
from sqlalchemy import Date, DateTime, JSON, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from ...shared.database import Base


class ModelArtifact(Base):
    """映射现有模型登记元数据；不能由登记状态推断文件真实、模型有效或获准生产。"""
    __tablename__ = "model_artifacts"
    # 模型登记唯一标识；分页以该字符串的数据库排序为准。
    model_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    # 登记的算法名称，例如 logistic；不表示本服务已具备对应推理器。
    algorithm: Mapped[str] = mapped_column(String(50))
    # 登记版本，用于追踪模型元数据，不是数据库迁移版本。
    version: Mapped[str] = mapped_column(String(50))
    # 训练区间起止日期；仅保存登记值，不能单独证明时点数据合规。
    train_start_date: Mapped[date] = mapped_column(Date)
    train_end_date: Mapped[date] = mapped_column(Date)
    # 特征名称列表：PostgreSQL 使用 JSONB，通用 JSON 便于 SQLite 契约测试。
    features_list: Mapped[list[str]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"))
    # 训练超参数元数据，HTTP 摘要不返回该字段。
    hyperparameters: Mapped[dict[str, Any]] = mapped_column(JSON().with_variant(JSONB(), "postgresql"))
    # 登记的文件摘要；本接口不读取文件或重新计算摘要。
    file_hash: Mapped[str] = mapped_column(String(64))
    # 登记状态不是生产批准；champion 字符串也不能绕过独立验收门禁。
    state: Mapped[str] = mapped_column(String(50))
    # 数据库生成的带时区登记时间，不是行情可用时间。
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
