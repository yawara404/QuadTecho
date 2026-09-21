#!/usr/bin/env python3
"""
QuadTecho (クアッド・テチョウ) Flask バックエンドAPIサーバー
- ユーザー管理・認証
- 手帳の複数ページ管理・新規ページ作成
- ページ単位の手帳アイテム配置・保存
- サークル部室掲示板
- 画像アップロード＆静的配信
"""

import os
import uuid
import sqlite3
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS


def _load_dotenv(path: str) -> None:
    """最小の .env ローダー（依存なし）。プロセス環境変数が優先される。"""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip("'").strip('"')
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


_load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from database import get_db_connection, init_db

app = Flask(__name__)
# CORS対応（すべてのオリジンからのリクエストを許可）
CORS(app, resources={r"/*": {"origins": "*"}})

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}

# サーバー起動時にDB初期化
init_db()

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

# ==========================================================
# 1. ユーザー管理 API
# ==========================================================

@app.route("/api/users", methods=["GET"])
def get_users():
    """登録ユーザー一覧取得（簡単切り替え用）"""
    conn = get_db_connection()
    users = conn.execute("SELECT id, username, display_name, circle_name, created_at FROM users ORDER BY id ASC").fetchall()
    conn.close()
    return jsonify({
        "success": True,
        "users": [dict(u) for u in users]
    })

@app.route("/api/users/login", methods=["POST"])
def user_login():
    """ユーザーログイン（未登録の場合は新規自動作成）"""
    data = request.get_json() or {}
    username = (data.get("username") or "").strip().lower()
    display_name = (data.get("display_name") or "").strip()
    circle_name = (data.get("circle_name") or "未所属").strip()

    if not username:
        return jsonify({"success": False, "error": "ユーザー名を入力してください"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    user = cursor.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if user:
        user_dict = dict(user)
    else:
        # 新規作成
        if not display_name:
            display_name = username
        cursor.execute("""
            INSERT INTO users (username, display_name, circle_name)
            VALUES (?, ?, ?)
        """, (username, display_name, circle_name))
        user_id = cursor.lastrowid

        # 新規ユーザー用の初期ページ（1枚目）を自動作成
        cursor.execute("""
            INSERT INTO notebook_pages (user_id, title, page_number)
            VALUES (?, ?, ?)
        """, (user_id, "表紙・はじめのページ", 1))

        conn.commit()
        user = cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        user_dict = dict(user)

    conn.close()
    return jsonify({"success": True, "user": user_dict})

@app.route("/api/users/<int:user_id>", methods=["PUT"])
def update_user(user_id):
    """プロフィール更新（ニックネーム・所属。ユーザーIDは変更不可）"""
    data = request.get_json() or {}
    display_name = (data.get("display_name") or "").strip()
    circle_name = (data.get("circle_name") or "").strip() or "未所属"

    if not display_name:
        return jsonify({"success": False, "error": "ニックネームを入力してください"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    user = cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "error": "ユーザーが見つかりません"}), 404
    cursor.execute(
        "UPDATE users SET display_name = ?, circle_name = ? WHERE id = ?",
        (display_name, circle_name, user_id),
    )
    conn.commit()
    user = cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return jsonify({"success": True, "user": dict(user)})

# ==========================================================
# 2. 手帳ページ管理 API（複数ページ・新規ページ作成）
# ==========================================================

@app.route("/api/pages", methods=["GET"])
def get_pages():
    """指定ユーザーの手帳ページ一覧を取得（なければ初期ページ作成）"""
    user_id = request.args.get("user_id", type=int, default=1)
    folder_id = request.args.get("folder_id", type=int)
    conn = get_db_connection()
    cursor = conn.cursor()

    has_folder_col = any(r[1] == "folder_id" for r in cursor.execute("PRAGMA table_info(notebook_pages)").fetchall())
    where = "WHERE user_id = ?"
    params = [user_id]
    if folder_id is not None and has_folder_col:
        if folder_id == 0:
            where += " AND folder_id IS NULL"
        else:
            where += " AND folder_id = ?"
            params.append(folder_id)

    pages = cursor.execute(f"""
        SELECT id, user_id, title, page_number{", folder_id" if has_folder_col else ""}, created_at, updated_at
        FROM notebook_pages
        {where}
        ORDER BY page_number ASC, id ASC
    """, tuple(params)).fetchall()

    # ページが1枚もない場合はデフォルトページを作成
    if not pages:
        cursor.execute("""
            INSERT INTO notebook_pages (user_id, title, page_number)
            VALUES (?, ?, 1)
        """, (user_id, "1ページ目：大学生活スタート"))
        conn.commit()
        pages = cursor.execute(f"""
            SELECT id, user_id, title, page_number{", folder_id" if has_folder_col else ""}, created_at, updated_at
            FROM notebook_pages
            WHERE user_id = ?
            ORDER BY page_number ASC, id ASC
        """, (user_id,)).fetchall()

    conn.close()
    return jsonify({
        "success": True,
        "user_id": user_id,
        "pages": [dict(p) for p in pages]
    })

@app.route("/api/pages", methods=["POST"])
def create_page():
    """手帳の新規ページを作成（所属フォルダ指定可）"""
    data = request.get_json() or {}
    user_id = data.get("user_id", 1)
    title = (data.get("title") or "").strip()
    folder_id = data.get("folder_id")

    if not title:
        title = f"新しいページ ({datetime.now().strftime('%m/%d')})"

    conn = get_db_connection()
    cursor = conn.cursor()

    has_folder_col = any(r[1] == "folder_id" for r in cursor.execute("PRAGMA table_info(notebook_pages)").fetchall())
    folder_value = None
    if folder_id is not None and has_folder_col:
        owner = cursor.execute("SELECT user_id FROM notebook_folders WHERE id = ?", (folder_id,)).fetchone()
        if not owner or owner["user_id"] != user_id:
            conn.close()
            return jsonify({"success": False, "error": "指定のフォルダが見つかりません"}), 404
        folder_value = folder_id

    # 現在の最大ページ番号を取得
    max_num_row = cursor.execute("SELECT MAX(page_number) FROM notebook_pages WHERE user_id = ?", (user_id,)).fetchone()
    next_page_num = (max_num_row[0] or 0) + 1

    if has_folder_col:
        cursor.execute(
            "INSERT INTO notebook_pages (user_id, title, page_number, folder_id) VALUES (?, ?, ?, ?)",
            (user_id, title, next_page_num, folder_value))
    else:
        cursor.execute(
            "INSERT INTO notebook_pages (user_id, title, page_number) VALUES (?, ?, ?)",
            (user_id, title, next_page_num))
    page_id = cursor.lastrowid
    conn.commit()

    new_page = cursor.execute("SELECT * FROM notebook_pages WHERE id = ?", (page_id,)).fetchone()
    conn.close()

    return jsonify({
        "success": True,
        "message": "手帳に新しいページを追加しました！",
        "page": dict(new_page)
    }), 201

@app.route("/api/pages/<int:page_id>", methods=["PUT"])
def update_page(page_id: int):
    """手帳ページのタイトル・所属フォルダを更新"""
    data = request.get_json() or {}
    title = (data.get("title") or "").strip() if "title" in data else None
    wants_folder = "folder_id" in data
    folder_id = data.get("folder_id")
    if title is not None and not title:
        return jsonify({"success": False, "error": "ページタイトルは必須です"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    has_folder_col = any(r[1] == "folder_id" for r in cursor.execute("PRAGMA table_info(notebook_pages)").fetchall())
    page = cursor.execute("SELECT user_id FROM notebook_pages WHERE id = ?", (page_id,)).fetchone()
    if not page:
        conn.close()
        return jsonify({"success": False, "error": "ページが見つかりません"}), 404
    if wants_folder and has_folder_col and folder_id is not None:
        owner = cursor.execute("SELECT user_id FROM notebook_folders WHERE id = ?", (folder_id,)).fetchone()
        if not owner or owner["user_id"] != page["user_id"]:
            conn.close()
            return jsonify({"success": False, "error": "指定のフォルダが見つかりません"}), 404
    if title is not None:
        cursor.execute("""
            UPDATE notebook_pages
            SET title = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (title, page_id))
    if wants_folder and has_folder_col:
        cursor.execute("""
            UPDATE notebook_pages
            SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (folder_id, page_id))
    conn.commit()
    conn.close()

    return jsonify({"success": True, "message": "ページを更新しました"})

@app.route("/api/pages/<int:page_id>", methods=["DELETE"])
def delete_page(page_id: int):
    """手帳ページを削除（配下のアイテムもカスケード削除）"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM notebook_pages WHERE id = ?", (page_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "ページを削除しました"})

# ==========================================================
# 3. ページ内アイテム取得＆一括保存 API
# ==========================================================

@app.route("/api/folders", methods=["GET"])
def get_folders():
    """指定ユーザーのフォルダ一覧を取得（件数つき・表示順）"""
    user_id = request.args.get("user_id", type=int, default=1)
    conn = get_db_connection()
    try:
        rows = conn.execute("""
            SELECT f.id, f.user_id, f.name, f.sort_order, f.created_at, f.updated_at,
                   COUNT(p.id) AS page_count
            FROM notebook_folders f
            LEFT JOIN notebook_pages p ON p.folder_id = f.id
            WHERE f.user_id = ?
            GROUP BY f.id
            ORDER BY f.sort_order ASC, f.id ASC
        """, (user_id,)).fetchall()
        return jsonify({"success": True, "folders": [dict(r) for r in rows]})
    finally:
        conn.close()


@app.route("/api/folders", methods=["POST"])
def create_folder():
    """フォルダを新規作成（名前必須・上限50文字）"""
    data = request.get_json() or {}
    user_id = data.get("user_id", 1)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "フォルダ名を入力してください"}), 400
    if len(name) > 50:
        return jsonify({"success": False, "error": "フォルダ名は50文字以内で入力してください"}), 400
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        max_row = cursor.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM notebook_folders WHERE user_id = ?",
            (user_id,)).fetchone()
        next_order = (max_row[0] if max_row else -1) + 1
        cursor.execute(
            "INSERT INTO notebook_folders (user_id, name, sort_order) VALUES (?, ?, ?)",
            (user_id, name, next_order))
        folder_id = cursor.lastrowid
        conn.commit()
        folder = cursor.execute("SELECT * FROM notebook_folders WHERE id = ?", (folder_id,)).fetchone()
        return jsonify({"success": True, "folder": dict(folder)}), 201
    finally:
        conn.close()


@app.route("/api/folders/<int:folder_id>", methods=["PUT"])
def rename_folder(folder_id):
    """フォルダ名を変更（他ユーザーのフォルダは不可）"""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "フォルダ名を入力してください"}), 400
    if len(name) > 50:
        return jsonify({"success": False, "error": "フォルダ名は50文字以内で入力してください"}), 400
    conn = get_db_connection()
    try:
        folder = conn.execute("SELECT * FROM notebook_folders WHERE id = ?", (folder_id,)).fetchone()
        if not folder:
            return jsonify({"success": False, "error": "フォルダが見つかりません"}), 404
        if user_id and folder["user_id"] != user_id:
            return jsonify({"success": False, "error": "編集権限がありません"}), 403
        conn.execute(
            "UPDATE notebook_folders SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (name, folder_id))
        conn.commit()
        return jsonify({"success": True, "message": "フォルダ名を変更しました"})
    finally:
        conn.close()


@app.route("/api/folders/<int:folder_id>", methods=["DELETE"])
def delete_folder(folder_id):
    """フォルダを削除（中の手帳は「未分類」に戻る・消えない）"""
    user_id = request.args.get("user_id", type=int)
    conn = get_db_connection()
    try:
        folder = conn.execute("SELECT * FROM notebook_folders WHERE id = ?", (folder_id,)).fetchone()
        if not folder:
            return jsonify({"success": False, "error": "フォルダが見つかりません"}), 404
        if user_id and folder["user_id"] != user_id:
            return jsonify({"success": False, "error": "削除権限がありません"}), 403
        conn.execute("UPDATE notebook_pages SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
        conn.execute("DELETE FROM notebook_folders WHERE id = ?", (folder_id,))
        conn.commit()
        return jsonify({"success": True, "message": "フォルダを削除しました（中の手帳は未分類に移動）"})
    finally:
        conn.close()


@app.route("/api/pages/<int:page_id>/items", methods=["GET"])
def get_page_items(page_id: int):
    """指定ページに配置されたアイテム一覧を取得"""
    conn = get_db_connection()
    items = conn.execute("""
        SELECT id, page_id, user_id, item_type, content, image_url, x, y, width, height, rotation, z_index, bg_color
        FROM techo_items
        WHERE page_id = ?
        ORDER BY z_index ASC, id ASC
    """, (page_id,)).fetchall()
    conn.close()

    return jsonify({
        "success": True,
        "page_id": page_id,
        "count": len(items),
        "items": [dict(it) for it in items]
    })

@app.route("/api/pages/<int:page_id>/items", methods=["POST"])
def save_page_items(page_id: int):
    """指定ページのアイテムを一括保存（トランザクション）"""
    data = request.get_json() or {}
    user_id = data.get("user_id", 1)
    items = data.get("items", [])

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        # 既存アイテムのリフレッシュ
        cursor.execute("DELETE FROM techo_items WHERE page_id = ?", (page_id,))

        for idx, item in enumerate(items):
            cursor.execute("""
                INSERT INTO techo_items (
                    page_id, user_id, item_type, content, image_url,
                    x, y, width, height, rotation, z_index, bg_color
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                page_id,
                user_id,
                item.get("item_type", "sticky_note"),
                item.get("content"),
                item.get("image_url"),
                float(item.get("x", 60.0)),
                float(item.get("y", 60.0)),
                float(item.get("width", 170.0)),
                float(item.get("height", 140.0)),
                float(item.get("rotation", 0.0)),
                int(item.get("z_index", idx + 1)),
                item.get("bg_color", "#fff9c4")
            ))

        # ページのupdated_atを更新
        cursor.execute("UPDATE notebook_pages SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (page_id,))

        conn.commit()
        return jsonify({
            "success": True,
            "message": "ページの内容をサーバーに保存しました！",
            "page_id": page_id,
            "saved_count": len(items)
        })
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        conn.close()

# ==========================================================
# 4. サークル部室掲示板 API
# ==========================================================

@app.route("/api/board", methods=["GET"])
def get_board():
    """部室掲示板の一覧取得"""
    conn = get_db_connection()
    post_cols = {r[1] for r in conn.execute("PRAGMA table_info(bulletin_posts)").fetchall()}
    sel_extra = ""
    if "post_type" in post_cols:
        sel_extra += ", b.post_type"
    if "shared_page_data" in post_cols:
        sel_extra += ", b.shared_page_data"
    if "shared_sticker_data" in post_cols:
        sel_extra += ", b.shared_sticker_data"
    posts = conn.execute(f"""
        SELECT 
            b.id,
            b.user_id,
            u.display_name AS author_name,
            u.circle_name,
            b.title,
            b.content,
            b.sticker_url,
            b.bg_color,
            b.is_pinned,
            b.created_at{sel_extra}
        FROM bulletin_posts b
        INNER JOIN users u ON b.user_id = u.id
        ORDER BY b.is_pinned DESC, b.created_at DESC, b.id DESC
    """).fetchall()
    result = []
    for row in posts:
        post = dict(row)
        post.setdefault("post_type", "talk")
        if not post.get("post_type"):
            post["post_type"] = "talk"
        for _k in ("shared_page_data", "shared_sticker_data"):
            if _k in post:
                _v = post.get(_k)
                if isinstance(_v, str) and _v.strip():
                    try:
                        import json as _json
                        post[_k] = _json.loads(_v)
                    except Exception:
                        post[_k] = None
                else:
                    post[_k] = post.get(_k) or None
            else:
                post[_k] = None
        post["likes"] = [r[0] for r in conn.execute(
            "SELECT user_id FROM bulletin_likes WHERE post_id = ?", (post["id"],))]
        post["comments"] = [dict(r) for r in conn.execute("""
            SELECT c.id, c.user_id, c.content, c.created_at, u.display_name AS author_name
            FROM bulletin_comments c JOIN users u ON u.id = c.user_id
            WHERE c.post_id = ? ORDER BY c.id
        """, (post["id"],))]
        result.append(post)
    conn.close()
    return jsonify({"success": True, "posts": result})

@app.route("/api/board", methods=["POST"])
def create_board_post():
    """部室掲示板への新規投稿"""
    data = request.get_json() or {}
    user_id = data.get("user_id", 1)
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    bg_color = data.get("bg_color", "#ffeaa7")
    sticker_url = data.get("sticker_url")
    post_type = (data.get("post_type") or "talk").strip() or "talk"
    if post_type not in ("talk", "techo_page", "sticker"):
        post_type = "talk"
    import json as _json
    def _dump(v):
        if v is None:
            return None
        if isinstance(v, str):
            return v
        try:
            return _json.dumps(v, ensure_ascii=False)
        except Exception:
            return None
    shared_page_data = _dump(data.get("shared_page_data"))
    shared_sticker_data = _dump(data.get("shared_sticker_data"))

    if not title or not content or len(title) > 100 or len(content) > 2000:
        return jsonify({"success": False, "error": "タイトルは100文字、本文は2000文字以内で入力してください"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    if not cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
        conn.close()
        return jsonify(success=False, error="ユーザーが見つかりません"), 404
    cols = {r[1] for r in cursor.execute("PRAGMA table_info(bulletin_posts)").fetchall()}
    if "post_type" in cols:
        cursor.execute("""
            INSERT INTO bulletin_posts (user_id, title, content, sticker_url, bg_color, post_type, shared_page_data, shared_sticker_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (user_id, title, content, sticker_url, bg_color, post_type, shared_page_data, shared_sticker_data))
    else:
        cursor.execute("""
            INSERT INTO bulletin_posts (user_id, title, content, sticker_url, bg_color)
            VALUES (?, ?, ?, ?, ?)
        """, (user_id, title, content, sticker_url, bg_color))
    post_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": "部室掲示板に付箋をピン留めしました！",
        "post_id": post_id
    }), 201

def board_actor(conn, post_id, user_id):
    return (conn.execute("SELECT id FROM bulletin_posts WHERE id = ?", (post_id,)).fetchone()
            and conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone())


@app.route("/api/board/<int:post_id>/likes", methods=["PUT"])
def set_board_like(post_id):
    data = request.get_json() or {}
    user_id = data.get("user_id")
    if not isinstance(data.get("liked"), bool):
        return jsonify(success=False, error="いいねの状態が必要です"), 400
    conn = get_db_connection()
    try:
        if not board_actor(conn, post_id, user_id):
            return jsonify(success=False, error="投稿またはユーザーが見つかりません"), 404
        if data["liked"]:
            conn.execute("INSERT OR IGNORE INTO bulletin_likes VALUES (?, ?)", (post_id, user_id))
        else:
            conn.execute("DELETE FROM bulletin_likes WHERE post_id = ? AND user_id = ?", (post_id, user_id))
        conn.commit()
        return jsonify(success=True)
    finally:
        conn.close()


@app.route("/api/board/<int:post_id>/comments", methods=["POST"])
def create_board_comment(post_id):
    data = request.get_json() or {}
    content = (data.get("content") or "").strip()
    if not content or len(content) > 500:
        return jsonify(success=False, error="返信は1〜500文字で入力してください"), 400
    conn = get_db_connection()
    try:
        if not board_actor(conn, post_id, data.get("user_id")):
            return jsonify(success=False, error="投稿またはユーザーが見つかりません"), 404
        cursor = conn.execute("INSERT INTO bulletin_comments (post_id, user_id, content) VALUES (?, ?, ?)",
                              (post_id, data["user_id"], content))
        conn.commit()
        return jsonify(success=True, comment_id=cursor.lastrowid), 201
    finally:
        conn.close()


@app.route("/api/board/<int:post_id>", methods=["DELETE"])
def delete_board_post(post_id):
    """掲示板の投稿を削除"""
    user_id = request.args.get("user_id", type=int)
    conn = get_db_connection()
    try:
        post = conn.execute("SELECT user_id FROM bulletin_posts WHERE id = ?", (post_id,)).fetchone()
        if not post:
            return jsonify(success=False, error="投稿が見つかりません"), 404
        if user_id and post["user_id"] != user_id:
            return jsonify(success=False, error="削除権限がありません"), 403
        conn.execute("DELETE FROM bulletin_posts WHERE id = ?", (post_id,))
        conn.execute("DELETE FROM bulletin_likes WHERE post_id = ?", (post_id,))
        conn.execute("DELETE FROM bulletin_comments WHERE post_id = ?", (post_id,))
        conn.commit()
        return jsonify(success=True, message="投稿を削除しました")
    finally:
        conn.close()



# ==========================================================
# 5. 画像アップロード＆静的配信 API
# ==========================================================

@app.route("/api/upload", methods=["POST"])
def upload_image():
    """画像ファイルをアップロードしてURLを返却"""
    if "image" not in request.files:
        return jsonify({"success": False, "error": "画像ファイルが選択されていません"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"success": False, "error": "ファイル名が空です"}), 400

    if file and allowed_file(file.filename):
        ext = file.filename.rsplit(".", 1)[1].lower()
        unique_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.{ext}"
        save_path = os.path.join(UPLOAD_FOLDER, unique_name)
        file.save(save_path)

        url = f"/uploads/{unique_name}"
        return jsonify({
            "success": True,
            "message": "画像を保存しました",
            "url": url,
            "filename": unique_name
        }), 201

    return jsonify({"success": False, "error": "許可されていない画像形式です"}), 400

@app.route("/uploads/<path:filename>")
def serve_upload(filename: str):
    """アップロードされた画像ファイルを配信"""
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.route("/api/health", methods=["GET"])
def health():
    """ヘルスチェック"""
    return jsonify({"status": "healthy", "service": "QuadTecho Flask API", "time": datetime.now().isoformat()})

def find_available_port(start_port=5000, max_tries=10):
    import socket
    for p in range(start_port, start_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', p)) != 0:
                return p
    return start_port

if __name__ == "__main__":
    # 開始ポートは環境変数 QUADTECHO_PORT で上書き可（既定 5000）
    try:
        start_port = int(os.environ.get("QUADTECHO_PORT", "5000"))
    except ValueError:
        start_port = 5000
    port = find_available_port(start_port)
    print("==================================================")
    print(f" 📓 QuadTecho サーバー起動中: http://127.0.0.1:{port}")
    print(" (本番用 WSGI サーバー Waitress にて稼働中)")
    print(" 終了するには Ctrl + C を押してください")
    print("==================================================")

    try:
        from waitress import serve
        serve(app, host="127.0.0.1", port=port)
    except ImportError:
        from wsgiref.simple_server import make_server
        httpd = make_server("127.0.0.1", port, app)
        httpd.serve_forever()


