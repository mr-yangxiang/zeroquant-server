"""内部 API 的显式配置与校验；SecretStr 用于隐藏展示，不是加密存储。"""

from __future__ import annotations

import os
from pydantic import BaseModel, ConfigDict, SecretStr, field_validator
from sqlalchemy.engine import make_url


class ApiSettings(BaseModel):
    """不可变配置；拒绝未知字段并隐藏校验异常中的原始输入。"""
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)
    # 专用只读数据库连接；不得借用其他业务的通用连接配置。
    database_url: SecretStr
    # 内部服务凭据，禁止记录明文或返回给客户端。
    internal_token: SecretStr
    # 可选诊断缓存；缺失时仍可通过数据库提供统计。
    redis_url: SecretStr | None = None

    @field_validator("database_url")
    @classmethod
    def postgres_only(cls, value: SecretStr) -> SecretStr:
        """验证连接使用 psycopg 驱动且指定数据库名；失败抛出脱敏 ValueError。"""
        try:
            url = make_url(value.get_secret_value())
            if url.drivername != "postgresql+psycopg" or not url.database:
                raise ValueError()
        except Exception:
            raise ValueError("必须显式配置 postgresql+psycopg 数据库连接") from None
        return value

    @field_validator("internal_token")
    @classmethod
    def strong_token(cls, value: SecretStr) -> SecretStr:
        """要求令牌的 UTF-8 编码至少 32 字节；长度不等于随机性，部署时须使用随机令牌。"""
        if len(value.get_secret_value().encode()) < 32:
            raise ValueError("内部访问令牌至少需要 32 字节")
        return value

    @field_validator("redis_url")
    @classmethod
    def redis_scheme(cls, value: SecretStr | None) -> SecretStr | None:
        """允许不配置缓存；配置时要求 redis/rediss 协议和主机名。"""
        if value is not None:
            from urllib.parse import urlparse
            parsed = urlparse(value.get_secret_value())
            if parsed.scheme not in ("redis", "rediss") or not parsed.hostname:
                raise ValueError("Redis 地址格式无效")
        return value

    @classmethod
    def from_env(cls) -> "ApiSettings":
        # 不继承无关 DATABASE_URL，也不隐式读取业务应用的 .env。
        """只读取 ZEROQUANT_PY_API_* 环境变量，不读取 .env 或回退到 DATABASE_URL。"""
        return cls(database_url=os.getenv("ZEROQUANT_PY_API_DATABASE_URL", ""),
                   internal_token=os.getenv("ZEROQUANT_PY_API_TOKEN", ""),
                   redis_url=os.getenv("ZEROQUANT_PY_API_REDIS_URL") or None)
