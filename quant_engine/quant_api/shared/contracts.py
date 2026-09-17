"""领域层依赖的缓存协议；不引入 Redis 实现，便于无缓存运行与隔离测试。"""

from typing import Protocol


class Cache(Protocol):
    """诊断统计的可选缓存契约；业务层仍须验证结构、时间戳和用途。"""
    def get(self, key: str) -> dict | None:
        """返回字典；未命中或可容忍的缓存故障返回 None。"""
        ...
    def put(self, key: str, value: dict, ttl: int) -> None:
        """写入可 JSON 序列化的字典；ttl 单位为秒。"""
        ...
    def close(self) -> None:
        """释放缓存实现持有的资源。"""
        ...
