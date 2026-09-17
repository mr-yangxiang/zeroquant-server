"""研究库存的输入输出契约；数量与展示文案不得被解释为生产资格。"""

from typing import Literal
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class ResearchCounts(BaseModel):
    """六类登记记录的非负行数；不是交易日数、数据覆盖率或有效样本数。"""
    model_config = ConfigDict(extra="forbid")
    # 原始登记表行数，不保证每行对应一条行情或一个独立事件。
    raw_records: int = Field(ge=0)
    # 数据集登记数量，不代表均可用于训练。
    datasets: int = Field(ge=0)
    # 特征快照行数；本接口不核验 Point-in-time 合规性。
    feature_snapshots: int = Field(ge=0)
    # 训练标签行数；本接口不核验标签覆盖与未来信息泄漏。
    training_labels: int = Field(ge=0)
    # 模型登记数量，不是有效模型或已批准模型数量。
    models: int = Field(ge=0)
    # 评估记录数量，不是通过生产门槛的评估次数。
    evaluations: int = Field(ge=0)


class ResearchStatus(BaseModel):
    """库存统计快照；缓存命中保留原始观察时间，资格固定为尚未评估。"""
    model_config = ConfigDict(extra="forbid")
    # 带时区的统计观察时间；不是行情时间或精确的数据库事务快照时刻。
    observed_at: AwareDatetime
    counts: ResearchCounts
    # 仅供诊断展示的粗粒度文案，不是训练发布状态机。
    stage_label: str
    # 表示此次响应来自缓存；缓存命中不得刷新 observed_at。
    cached: bool = False
    # 固定为尚未评估，避免将非零库存误判为允许交易。
    signal_eligibility: Literal["not_evaluated"] = "not_evaluated"
    note: str = "仅反映数据与模型登记情况，不代表数据合格、预测有效或已获交易信号资格。"
