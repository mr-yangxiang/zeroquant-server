"""模型登记响应契约；只公开必要元数据，不输出特征清单、超参数或模型文件。"""

from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict


class ModelRegistration(BaseModel):
    """从 ORM 属性构造的登记摘要；训练日期和文件摘要均是登记值，未在此验证。"""
    model_config = ConfigDict(from_attributes=True, extra="forbid")
    model_id: str
    algorithm: str
    version: str
    train_start_date: date
    train_end_date: date
    file_hash: str
    # 原样展示登记状态，不转换为可买卖结论。
    state: str
    created_at: datetime


class ModelList(BaseModel):
    """游标分页结果；即使 state 为 champion，本接口也不授予交易信号资格。"""
    items: list[ModelRegistration]
    # 有下一页时取当前页最后一个 model_id；None 表示本次查询没有后续记录。
    next_cursor: str | None = None
    # 固定未评估；列表响应不具备批准交易权限。
    signal_eligibility: Literal["not_evaluated"] = "not_evaluated"
    note: str = "登记状态不是生产批准；本接口不加载模型文件、不产生买卖指令。"
