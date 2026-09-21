import sqlite3
import os
from typing import Dict, Any, List

DB_PATH = os.path.join(os.path.dirname(__file__), "quadtecho.db")
# SQLite のロック待ち上限（秒）。Flask 自動保存と掲示板が同時に書き込むため、
# デフォルト(5秒)より余裕を持たせる。環境変数 QUADTECHO_DB_TIMEOUT で上書き可。
DB_TIMEOUT = float(os.environ.get("QUADTECHO_DB_TIMEOUT", "10.0"))

def get_db_connection() -> sqlite3.Connection:
    """SQLite接続を取得し、行を辞書形式で扱えるように設定"""
    conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # 同時書き込み対策（MAMP/Apache 経由とFlask直叩きの併用・自動保存の並行に備える）
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn

def init_db():
    """データベーススキーマの初期化と初期シードデータの投入"""
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. users テーブル
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            circle_name TEXT DEFAULT '未所属',
            avatar_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 2. notebook_folders テーブル（手帳一覧のフォルダ管理）
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notebook_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # 3. notebook_pages テーブル（手帳のページ管理・フォルダ所属付き）
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notebook_pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            page_number INTEGER NOT NULL DEFAULT 1,
            folder_id INTEGER REFERENCES notebook_folders(id) ON DELETE SET NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # notebook_pages 拡張カラムの自動マイグレーション
    # （既存DBに後付けでフォルダ分類フィールドを追加）
    _page_cols = {r[1] for r in cursor.execute("PRAGMA table_info(notebook_pages)").fetchall()}
    if "folder_id" not in _page_cols:
        cursor.execute("ALTER TABLE notebook_pages ADD COLUMN folder_id INTEGER REFERENCES notebook_folders(id) ON DELETE SET NULL")

    # 4. techo_items テーブル（手帳ページ内の配置アイテム）
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS techo_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            item_type TEXT NOT NULL DEFAULT 'sticky_note',
            content TEXT,
            image_url TEXT,
            x REAL NOT NULL DEFAULT 60.0,
            y REAL NOT NULL DEFAULT 60.0,
            width REAL NOT NULL DEFAULT 170.0,
            height REAL NOT NULL DEFAULT 140.0,
            rotation REAL NOT NULL DEFAULT 0.0,
            z_index INTEGER NOT NULL DEFAULT 1,
            bg_color TEXT NOT NULL DEFAULT '#fff9c4',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (page_id) REFERENCES notebook_pages(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # 5. bulletin_posts テーブル（サークル部室掲示板）
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bulletin_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            sticker_url TEXT,
            bg_color TEXT NOT NULL DEFAULT '#ffeaa7',
            is_pinned INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    # bulletin_posts 拡張カラムの自動マイグレーション
    # （既存DBに後付けで手帳ページ共有・シール共有フィールドを追加）
    _cols = {r[1] for r in cursor.execute("PRAGMA table_info(bulletin_posts)").fetchall()}
    if "post_type" not in _cols:
        cursor.execute("ALTER TABLE bulletin_posts ADD COLUMN post_type TEXT NOT NULL DEFAULT 'talk'")
    if "shared_page_data" not in _cols:
        cursor.execute("ALTER TABLE bulletin_posts ADD COLUMN shared_page_data TEXT")
    if "shared_sticker_data" not in _cols:
        cursor.execute("ALTER TABLE bulletin_posts ADD COLUMN shared_sticker_data TEXT")

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS bulletin_likes (
            post_id INTEGER NOT NULL REFERENCES bulletin_posts(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (post_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS bulletin_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL REFERENCES bulletin_posts(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # 初期シードデータの投入（未登録の場合のみ: ゲスト1件）
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
            INSERT INTO users (id, username, display_name, circle_name)
            VALUES
                (1, 'guest', 'ゲスト', '未所属')
        """)

        # ゲストの初期ページ 2枚
        cursor.execute("""
            INSERT INTO notebook_pages (id, user_id, title, page_number)
            VALUES 
                (1, 1, '4月の予定＆履修登録', 1),
                (2, 1, '情報工学レポート構想', 2)
        """)

        # 1ページ目のアイテム
        cursor.execute("""
            INSERT INTO techo_items (page_id, user_id, item_type, content, image_url, x, y, width, height, rotation, z_index, bg_color)
            VALUES 
                (1, 1, 'sticky_note', '火曜2限：情報工学のレポート提出！\n図書館で本を探す 📚', NULL, 80, 80, 190, 140, -3, 1, '#fff9c4'),
                (1, 1, 'sticky_note', '週末サークル部室ミーティング\n議題：新歓フェス準備 🎸', NULL, 320, 100, 190, 140, 2, 2, '#d1f2fd')
        """)

        # 2ページ目のアイテム
        cursor.execute("""
            INSERT INTO techo_items (page_id, user_id, item_type, content, image_url, x, y, width, height, rotation, z_index, bg_color)
            VALUES 
                (2, 1, 'sticky_note', 'アルゴリズム計算量のまとめ\nO(N log N) のソートを実装する', NULL, 120, 100, 200, 150, 1, 1, '#d4edda')
        """)

        # 掲示板の初期投稿
        cursor.execute("""
            INSERT INTO bulletin_posts (user_id, title, content, bg_color, is_pinned)
            VALUES 
                (1, '部室の鍵当番について', '今週金曜日の部室施錠当番はゲストです！ 18時以降よろしくね。', '#fed330', 1),
                (1, '新歓チラシ配布許可', '生協前掲示板の許可取れました。付箋見てね！', '#a8e6cf', 0)
        """)

    # 旧ダミー(campuskun/senpai)が残る既存DBをゲスト1件へ移行
    legacy = [r for r in cursor.execute(
        "SELECT id, username FROM users WHERE username IN ('campuskun', 'senpai')").fetchall()]
    if legacy:
        cursor.execute("SELECT id FROM users WHERE username = 'guest'")
        guest_row = cursor.fetchone()
        if guest_row is None:
            # 最も若いidの旧ダミーをゲストへ付け替え、残りは削除
            legacy_ids = sorted(r[0] for r in legacy)
            guest_id = legacy_ids[0]
            cursor.execute(
                "UPDATE users SET username = 'guest', display_name = 'ゲスト', circle_name = '未所属' WHERE id = ?",
                (guest_id,))
            old_ids = legacy_ids[1:]
        else:
            guest_id = guest_row[0]
            old_ids = [r[0] for r in legacy if r[0] != guest_id]
        for old_id in old_ids:
            # 共有の掲示板データはゲストへ引き継ぐ
            cursor.execute("UPDATE OR IGNORE bulletin_likes SET user_id = ? WHERE user_id = ?", (guest_id, old_id))
            cursor.execute("DELETE FROM bulletin_likes WHERE user_id = ?", (old_id,))
            cursor.execute("UPDATE bulletin_comments SET user_id = ? WHERE user_id = ?", (guest_id, old_id))
            cursor.execute("UPDATE bulletin_posts SET user_id = ? WHERE user_id = ?", (guest_id, old_id))
            # 旧ダミー個人の手帳データは削除する(ユーザー削除時のCASCADEに任せる)
            cursor.execute("DELETE FROM users WHERE id = ?", (old_id,))
        # 旧ダミー名の残骸をゲスト表記へ置換
        try:
            cursor.execute("UPDATE bulletin_posts SET content = REPLACE(content, 'キャンパス君', 'ゲスト')")
        except Exception:
            pass

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")
