"""研究库存业务层：校验短时缓存并生成诊断文案，不执行训练质量或交易批准判断。"""

from datetime import datetime, timezone
from typing import Protocol
from pydantic import ValidationError

from ...shared.contracts import Cache
from .schemas import ResearchCounts, ResearchStatus


class InventoryReader(Protocol):
    """库存读取端口；以结构化接口隔离具体数据库实现。"""
    def counts(self) -> dict[str, int]:
        """返回固定类别名称到实际记录行数的映射。"""
        ...


class ResearchService:
    """协调库存查询和诊断缓存，不依赖 FastAPI 或 SQLAlchemy。"""
    # 键版本用于隔离响应契约变更，数据库命名空间由应用层补充。
    CACHE_KEY = "research_inventory:v1"
    # 有效期单位：秒；仅减少诊断计数查询，不能用于实时交易依据。
    TTL = 15

    def __init__(self, repository: InventoryReader, cache: Cache):
        """注入库存读取端口与缓存端口，便于独立测试业务判断。"""
        self.repository = repository
        self.cache = cache

    def status(self) -> ResearchStatus:
        """返回库存快照；缓存损坏、时间在未来或达到有效期时重新查询。

        数据库失败向上抛出，不伪造零库存；登记数量只用于提示，不授予交易资格。"""
        # 回源查询前记录 UTC 观察时间；耗时查询可能缩短后续可接受缓存窗口。
        now = datetime.now(timezone.utc)
        cached = self.cache.get(self.CACHE_KEY)
        if cached is not None:
            try:
                value = ResearchStatus.model_validate(cached)
                # 同时拒绝未来时间戳与到期缓存，不能只依赖 Redis 的 TTL。
                if 0 <= (now - value.observed_at).total_seconds() < self.TTL:
                    return value.model_copy(update={"cached":True})
            except (ValidationError, ValueError, TypeError):
                pass
        counts = ResearchCounts.model_validate(self.repository.counts())
        # 这些数量只生成提示文案，不证明数据质量、模型表现或发布资格。
        label = ("尚无研究原始数据登记" if counts.raw_records == 0 else
                 "已有研究数据，尚无模型登记" if counts.models == 0 else
                 "已有模型登记，需另行核验样本外表现与生产资格")
        value = ResearchStatus(observed_at=now, counts=counts, stage_label=label)
        self.cache.put(self.CACHE_KEY, value.model_dump(mode="json"), self.TTL)
        return value
