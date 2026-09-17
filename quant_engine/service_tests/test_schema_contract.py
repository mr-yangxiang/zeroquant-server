"""将 Python model_artifacts 映射与既有 TypeScript 权威目录比较；不执行数据库迁移。"""
import json
from pathlib import Path
import subprocess
import unittest

from sqlalchemy import Date, DateTime, JSON, String
from quant_api.domains.model_registry.entities import ModelArtifact


class SchemaContractTests(unittest.TestCase):
    """跨语言契约测试；当前只覆盖已迁入 Python 的 model_artifacts 映射。"""
    def test_existing_table_mapping_matches_authoritative_catalog(self):
        """读取实际 TS 目录输出，逐列核对类型、长度、可空性、默认值及主键。"""
        root = Path(__file__).resolve().parents[2]
        result = subprocess.run(["node", "--import", "tsx", "src/database/schema-verifier.ts", "--expected"],
                                cwd=root, capture_output=True, text=True, check=True, timeout=20)
        catalog=json.loads(result.stdout)
        # 权威目录包括更多表，本测试仅核对当前 Python 映射的 model_artifacts。
        expected=next(t for t in catalog["tables"] if t["name"]=="model_artifacts")
        actual=ModelArtifact.__table__
        self.assertEqual(set(expected["columns"]),set(actual.columns.keys()))
        self.assertEqual(expected["primaryKey"],[c.name for c in actual.primary_key.columns])
        for name, contract in expected["columns"].items():
            column=actual.c[name]
            if isinstance(column.type,DateTime):
                kind="timestamp with time zone" if column.type.timezone else "timestamp without time zone"
            elif isinstance(column.type,Date): kind="date"
            elif isinstance(column.type,String): kind="character varying"
            elif isinstance(column.type,JSON): kind="jsonb"
            else: self.fail("Unverified SQLAlchemy type: "+name)
            self.assertEqual(kind,contract["type"],name)
            self.assertEqual(column.nullable,contract["nullable"],name)
            if isinstance(column.type,String): self.assertEqual(column.type.length,contract["maxLength"],name)
            if "default" in contract:
                self.assertIsNotNone(column.server_default,name)
                self.assertEqual(str(column.server_default.arg),"now()",name)
                self.assertEqual(contract["default"],"now",name)
            else: self.assertIsNone(column.server_default,name)

if __name__ == "__main__": unittest.main()
