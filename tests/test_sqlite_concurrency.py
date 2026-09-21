"""Run with: python3 -m unittest discover -s tests

Tunedrop の sqlite-concurrency テストに相当:
- WAL モードで開かれていること
- 複数スレッドからの同時書き込みが 'database is locked' なく完走すること
一時DBを使うため実データは変更しない。
"""
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'flask_server'))
import database


class SqliteConcurrencyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.original_path = database.DB_PATH
        database.DB_PATH = str(Path(cls.temp.name) / 'concurrency.db')
        database.init_db()

    @classmethod
    def tearDownClass(cls):
        database.DB_PATH = cls.original_path
        cls.temp.cleanup()

    def test_wal_mode_enabled(self):
        conn = database.get_db_connection()
        try:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(mode.lower(), "wal")

    def test_concurrent_board_writes(self):
        errors = []
        writers = 8
        posts_per_writer = 10

        def write_posts(n):
            try:
                for i in range(posts_per_writer):
                    conn = database.get_db_connection()
                    try:
                        conn.execute(
                            "INSERT INTO bulletin_posts (user_id, title, content) VALUES (1, ?, ?)",
                            (f"同時投稿 {n}-{i}", "同時書き込みテスト"),
                        )
                        conn.commit()
                    finally:
                        conn.close()
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=write_posts, args=(n,)) for n in range(writers)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)

        self.assertEqual(errors, [])
        conn = database.get_db_connection()
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM bulletin_posts WHERE content = '同時書き込みテスト'"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, writers * posts_per_writer)


if __name__ == "__main__":
    unittest.main()
