"""启动真实本机 HTTP 子进程验证接入及失败路径；不连接外部数据库或 Redis。"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ServerSmokeTests(unittest.TestCase):
    """验证 Uvicorn 应用工厂可启动；不是 PostgreSQL 成功链路或生产端到端验收。"""
    def test_factory_liveness_authentication_and_database_failure(self):
        """使用回环监听和不可用数据库地址验证存活、401、脱敏 503，并回收自有子进程。"""
        root=Path(__file__).resolve().parents[2]
        token="local-smoke-token-not-a-real-secret-012345"
        # 覆盖专用变量，故意指向本机不可用端口；不读取或连接生产数据源。
        environment={**os.environ,"PYTHONPATH":str(root/"quant_engine"),"PYTHONDONTWRITEBYTECODE":"1",
                     "ZEROQUANT_PY_API_DATABASE_URL":"postgresql+psycopg://fixture:fixture@127.0.0.1:1/zeroquant_e2e",
                     "ZEROQUANT_PY_API_TOKEN":token,"ZEROQUANT_PY_API_REDIS_URL":""}
        with socket.socket() as sock:
            # 由操作系统分配端口并将已监听文件描述符传给子进程，避免先释放再绑定的竞争。
            sock.bind(("127.0.0.1",0)); sock.listen(16)
            address=f"http://127.0.0.1:{sock.getsockname()[1]}"
            process=subprocess.Popen([sys.executable,"-m","uvicorn","quant_api.app:create_app","--factory",
                                      "--fd",str(sock.fileno()),"--log-level","error"],
                                     cwd=root,env=environment,pass_fds=(sock.fileno(),),
                                     stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                # 启动等待上限 15 秒，使用单调时钟防止系统校时影响超时判断。
                deadline=time.monotonic()+15
                while True:
                    try:
                        with urlopen(address+"/health/live",timeout=.5) as response:
                            self.assertEqual(json.load(response)["status"],"ok")
                        break
                    except (URLError,TimeoutError):
                        if process.poll() is not None or time.monotonic()>deadline:
                            self.fail("Isolated Python API did not become live")
                        time.sleep(.1)
                with self.assertRaises(HTTPError) as unauthorized:
                    urlopen(address+"/internal/v1/models",timeout=2)
                self.assertEqual(unauthorized.exception.code,401)
                request=Request(address+"/health/ready",headers={"X-ZeroQuant-Internal-Token":token})
                with self.assertRaises(HTTPError) as unavailable:
                    urlopen(request,timeout=8)
                self.assertEqual(unavailable.exception.code,503)
                body=unavailable.exception.read().decode()
                self.assertNotIn("fixture",body)
                self.assertNotIn(token,body)
            finally:
                # 只回收本测试创建的子进程，不影响已有 API 服务。
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)

if __name__ == "__main__": unittest.main()
