"""可选 JSON 诊断缓存；不得用于价格、模型批准状态或交易信号的权威判断。"""
import json

from redis import Redis
from redis.exceptions import RedisError


class NoCache:
    """空缓存实现：禁用 Redis 时保持相同接口，每次读取回到数据库。"""
    def get(self, key: str):
        """始终返回未命中。"""
        return None
    def put(self, key: str, value: dict, ttl: int):
        """忽略写入，不持久化诊断结果。"""
        pass
    def close(self):
        """无资源需要释放。"""
        pass


class RedisCache:
    """带短超时的 Redis 适配器；故障允许诊断查询回源，不改变生产资格门禁。"""
    def __init__(self, url: str, namespace: str):
        """创建惰性客户端并指定命名空间；连接及读写超时均为 0.5 秒。"""
        self.client = Redis.from_url(url, decode_responses=True, socket_timeout=.5,
                                     socket_connect_timeout=.5, retry_on_timeout=False)
        self.namespace = namespace

    def get(self, key: str):
        """返回合法 JSON 字典，损坏或连接故障返回 None；业务时效性由 Service 校验。"""
        try:
            raw = self.client.get(self.namespace + ":" + key)
            # 上限是解码后的 16384 个字符，并非网络读取字节上限；读取完成后再限制 JSON 解析。
            if not raw or len(raw) > 16384:
                return None
            value = json.loads(raw)
            return value if isinstance(value, dict) else None
        except (RedisError, ValueError, UnicodeError):
            return None

    def put(self, key: str, value: dict, ttl: int):
        """按 ttl 秒保存字典；忽略 Redis 故障，但不掩盖调用方的 JSON 序列化错误。"""
        try:
            self.client.set(self.namespace + ":" + key, json.dumps(value), ex=ttl)
        except RedisError:
            pass

    def close(self):
        """关闭 Redis 客户端并释放其连接资源。"""
        self.client.close()
