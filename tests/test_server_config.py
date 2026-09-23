"""サーバー起動設定の回帰テスト

Run with: python3 -m unittest discover -s tests
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'flask_server'))
import database


class ServerConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 他テストと同じく一時DBへ切り替える。
        # （app.py は import 時に init_db() を呼ぶため、DB_PATH を先に差し替える）
        cls.temp = tempfile.TemporaryDirectory()
        cls.original_path = database.DB_PATH
        database.DB_PATH = str(Path(cls.temp.name) / 'test_server.db')
        import app
        database.init_db()
        cls.app = app
        cls.client = app.app.test_client()

    @classmethod
    def tearDownClass(cls):
        database.DB_PATH = cls.original_path
        cls.temp.cleanup()

    def test_default_port_prefers_apache_proxy_target(self):
        """公開URLは MAMP Apache が 5002 へ ProxyPass しているため、
        既定で 5002 を最優先にしないと /QuadTecho/api/ が 503 になる。"""
        self.assertEqual(self.app.DEFAULT_PORT_ORDER[0], 5002)
        self.assertEqual(self.app.DEFAULT_PORT_ORDER, (5002, 5000, 5001, 5003))

    def test_health_endpoint_identifies_service(self):
        """フロントの接続判定は service 名で QuadTecho のAPIかを確認する。"""
        res = self.client.get('/api/health')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json['service'], 'QuadTecho Flask API')
        self.assertEqual(res.json['status'], 'healthy')

    def test_resolve_port_returns_int(self):
        port = self.app.resolve_port()
        self.assertIsInstance(port, int)
        self.assertGreaterEqual(port, 5000)


if __name__ == '__main__':
    unittest.main()
