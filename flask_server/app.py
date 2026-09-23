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
import unicodedata
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS


def _normalize_login_id(value) -> str:
    """ユーザーIDを正規化する。

    日本語IMEで入力された全角英数字・記号・全角スペース（NFKC）を半角へ揃え、
    前後の空白を除去して小文字化する。これにより「ｙａｙａ＿ｍｏｄｅｒａｔｅ」の
    ような全角入力でも既存アカウントへログインできる。
    """
    if value is None:
        return ""
    return unicodedata.normalize("NFKC", str(value)).strip().lower()


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

# アイコン画像URLの検証。アップロード済みパス（/uploads/...）か data:image、
# 外部URLのみ許可する。空文字・None は「未設定（アイコン解除）」として扱う。
MAX_AVATAR_URL_LEN = 2_000_000  # data URL の上限（約2MB）

def _sanitize_avatar_url(value):
    if value is None:
        return None
    url = str(value).strip()
    if not url:
        return None
    if len(url) > MAX_AVATAR_URL_LEN:
        raise ValueError("アイコン画像が大きすぎます")
    if (url.startswith("/uploads/") or url.startswith("data:image/")
            or url.startswith("http://") or url.startswith("https://")):
        return url
    raise ValueError("アイコンの形式が正しくありません")

# ==========================================================
# 1. ユーザー管理 API
# ==========================================================

@app.route("/api/users", methods=["GET"])
def get_users():
    """登録ユーザー一覧取得（簡単切り替え用）"""
    conn = get_db_connection()
    users = conn.execute("SELECT id, username, display_name, circle_name, circle_id, avatar_url, created_at FROM users ORDER BY id ASC").fetchall()
    conn.close()
    return jsonify({
        "success": True,
        "users": [dict(u) for u in users]
    })

def _link_user_to_circle(cursor, user_id, circle_id):
    """所属サークルを設定し、メンバー登録も行う。circle_id=None は未所属。"""
    if circle_id is None:
        cursor.execute("UPDATE users SET circle_id = NULL, circle_name = '未所属' WHERE id = ?", (user_id,))
        return {"id": None, "name": "未所属"}
    circle = cursor.execute("SELECT id, name FROM circles WHERE id = ?", (circle_id,)).fetchone()
    if not circle:
        raise ValueError("指定のサークルが見つかりません")
    cursor.execute("UPDATE users SET circle_id = ?, circle_name = ? WHERE id = ?",
                   (circle["id"], circle["name"], user_id))
    cursor.execute("INSERT OR IGNORE INTO circle_members (circle_id, user_id) VALUES (?, ?)",
                   (circle["id"], user_id))
    return {"id": circle["id"], "name": circle["name"]}

def _resolve_circle_name(cursor, user_id, circle_id, circle_name):
    """circle_id 優先で所属を解決する。レガシー自由記入は既存サークルと一致すれば紐付ける。"""
    if circle_id is not None:
        return _link_user_to_circle(cursor, user_id, circle_id)
    name = (circle_name or "").strip()
    if not name or name == "未所属":
        return _link_user_to_circle(cursor, user_id, None)
    found = cursor.execute("SELECT id FROM circles WHERE name = ?", (name,)).fetchone()
    if found:
        return _link_user_to_circle(cursor, user_id, found["id"])
    cursor.execute("UPDATE users SET circle_id = NULL, circle_name = ? WHERE id = ?", (name, user_id))
    return {"id": None, "name": name}

@app.route("/api/users/login", methods=["POST"])
def user_login():
    """ユーザーログイン（未登録の場合は新規自動作成）"""
    data = request.get_json() or {}
    username = _normalize_login_id(data.get("username"))
    display_name = (data.get("display_name") or "").strip()
    circle_name = (data.get("circle_name") or "未所属").strip()
    circle_id = data.get("circle_id")

    if not username:
        return jsonify({"success": False, "error": "ユーザー名を入力してください"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    if circle_id is not None:
        try:
            circle_id = int(circle_id)
        except (TypeError, ValueError):
            conn.close()
            return jsonify({"success": False, "error": "指定のサークルが見つかりません"}), 400
        if not cursor.execute("SELECT id FROM circles WHERE id = ?", (circle_id,)).fetchone():
            conn.close()
            return jsonify({"success": False, "error": "指定のサークルが見つかりません"}), 400

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

        # 所属サークルを反映（選択式。未指定なら未所属）
        _resolve_circle_name(cursor, user_id, circle_id, circle_name)

        conn.commit()
        user = cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        user_dict = dict(user)

    conn.close()
    return jsonify({"success": True, "user": user_dict})

@app.route("/api/users/<int:user_id>", methods=["PUT"])
def update_user(user_id):
    """プロフィール更新（ニックネーム・所属・アイコン。ユーザーIDは変更不可）"""
    data = request.get_json() or {}
    display_name = (data.get("display_name") or "").strip()
    circle_name = (data.get("circle_name") or "").strip() or "未所属"
    has_circle_id = "circle_id" in data
    circle_id = data.get("circle_id")
    has_avatar = "avatar_url" in data

    if not display_name:
        return jsonify({"success": False, "error": "ニックネームを入力してください"}), 400
    if has_circle_id and circle_id is not None:
        try:
            circle_id = int(circle_id)
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "指定のサークルが見つかりません"}), 400

    # アイコンURLの検証（指定時のみ）
    avatar_url = None
    if has_avatar:
        try:
            avatar_url = _sanitize_avatar_url(data.get("avatar_url"))
        except ValueError as e:
            return jsonify({"success": False, "error": str(e)}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    user = cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "error": "ユーザーが見つかりません"}), 404
    if has_avatar:
        cursor.execute(
            "UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?",
            (display_name, avatar_url, user_id),
        )
    else:
        cursor.execute(
            "UPDATE users SET display_name = ? WHERE id = ?",
            (display_name, user_id),
        )
    try:
        if has_circle_id:
            _resolve_circle_name(cursor, user_id, circle_id, circle_name)
        else:
            _resolve_circle_name(cursor, user_id, None, circle_name)
    except ValueError as e:
        conn.rollback()
        conn.close()
        return jsonify({"success": False, "error": str(e)}), 400
    conn.commit()
    user = cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return jsonify({"success": True, "user": dict(user)})

# ==========================================================
# 1b. サークル（部活）管理 API
# ==========================================================

def _circle_with_count(conn, circle_id):
    row = conn.execute("""
        SELECT c.id, c.name, c.description, c.founder_user_id, c.created_at,
               COUNT(m.user_id) AS member_count
        FROM circles c LEFT JOIN circle_members m ON m.circle_id = c.id
        WHERE c.id = ? GROUP BY c.id
    """, (circle_id,)).fetchone()
    return dict(row) if row else None

@app.route("/api/circles", methods=["GET"])
def get_circles():
    """サークル一覧（メンバー数つき。?user_id= で参加状態も返す）"""
    user_id = request.args.get("user_id", type=int)
    conn = get_db_connection()
    try:
        rows = conn.execute("""
            SELECT c.id, c.name, c.description, c.founder_user_id, c.created_at,
                   COUNT(m.user_id) AS member_count
            FROM circles c LEFT JOIN circle_members m ON m.circle_id = c.id
            GROUP BY c.id ORDER BY c.created_at ASC, c.id ASC
        """).fetchall()
        joined = set()
        if user_id:
            joined = {r[0] for r in conn.execute(
                "SELECT circle_id FROM circle_members WHERE user_id = ?", (user_id,))}
        return jsonify({"success": True, "circles": [
            {**dict(r), "joined": (r["id"] in joined)} for r in rows]})
    finally:
        conn.close()

@app.route("/api/circles", methods=["POST"])
def create_circle():
    """立部（サークル新規作成。作成者は自動で入部）"""
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip()
    founder_user_id = data.get("founder_user_id")
    if not name:
        return jsonify({"success": False, "error": "サークル名を入力してください"}), 400
    if len(name) > 40:
        return jsonify({"success": False, "error": "サークル名は40文字以内で入力してください"}), 400
    if len(description) > 500:
        return jsonify({"success": False, "error": "紹介文は500文字以内で入力してください"}), 400
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if cursor.execute("SELECT id FROM circles WHERE name = ?", (name,)).fetchone():
            return jsonify({"success": False, "error": "そのサークル名は既に使われています"}), 400
        founder = None
        if founder_user_id is not None:
            founder = cursor.execute("SELECT id FROM users WHERE id = ?", (founder_user_id,)).fetchone()
            if not founder:
                return jsonify({"success": False, "error": "ユーザーが見つかりません"}), 404
        cursor.execute("INSERT INTO circles (name, description, founder_user_id) VALUES (?, ?, ?)",
                       (name, description, founder_user_id if founder else None))
        circle_id = cursor.lastrowid
        if founder:
            cursor.execute("INSERT OR IGNORE INTO circle_members (circle_id, user_id) VALUES (?, ?)",
                           (circle_id, founder_user_id))
            cursor.execute("UPDATE users SET circle_id = ?, circle_name = ? WHERE id = ?",
                           (circle_id, name, founder_user_id))
        conn.commit()
        return jsonify({"success": True, "circle": _circle_with_count(conn, circle_id)}), 201
    finally:
        conn.close()

@app.route("/api/circles/<int:circle_id>", methods=["GET"])
def get_circle(circle_id):
    """サークル詳細＋メンバー一覧"""
    conn = get_db_connection()
    try:
        circle = _circle_with_count(conn, circle_id)
        if not circle:
            return jsonify({"success": False, "error": "サークルが見つかりません"}), 404
        members = conn.execute("""
            SELECT u.id, u.username, u.display_name, u.circle_name, u.avatar_url, m.joined_at
            FROM circle_members m JOIN users u ON u.id = m.user_id
            WHERE m.circle_id = ? ORDER BY m.joined_at ASC
        """, (circle_id,)).fetchall()
        circle["members"] = [dict(m) for m in members]
        return jsonify({"success": True, "circle": circle})
    finally:
        conn.close()

@app.route("/api/circles/<int:circle_id>/join", methods=["POST"])
def join_circle(circle_id):
    """入部（所属サークルも切り替える）"""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        circle = cursor.execute("SELECT id, name FROM circles WHERE id = ?", (circle_id,)).fetchone()
        if not circle:
            return jsonify({"success": False, "error": "サークルが見つかりません"}), 404
        if not cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
            return jsonify({"success": False, "error": "ユーザーが見つかりません"}), 404
        cursor.execute("INSERT OR IGNORE INTO circle_members (circle_id, user_id) VALUES (?, ?)",
                       (circle_id, user_id))
        cursor.execute("UPDATE users SET circle_id = ?, circle_name = ? WHERE id = ?",
                       (circle_id, circle["name"], user_id))
        conn.commit()
        return jsonify({"success": True, "message": f"「{circle['name']}」に入部しました"})
    finally:
        conn.close()

@app.route("/api/circles/<int:circle_id>/leave", methods=["POST"])
def leave_circle(circle_id):
    """退部（所属がそのサークルなら未所属に戻す。サークル自体は残る）"""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        circle = cursor.execute("SELECT id, name FROM circles WHERE id = ?", (circle_id,)).fetchone()
        if not circle:
            return jsonify({"success": False, "error": "サークルが見つかりません"}), 404
        if not cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
            return jsonify({"success": False, "error": "ユーザーが見つかりません"}), 404
        cursor.execute("DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?", (circle_id, user_id))
        cursor.execute("UPDATE users SET circle_id = NULL, circle_name = '未所属' WHERE id = ? AND circle_id = ?",
                       (user_id, circle_id))
        conn.commit()
        return jsonify({"success": True, "message": f"「{circle['name']}」を退部しました"})
    finally:
        conn.close()

# ==========================================================
# 1e. サークル配布シール API（自作シールの配布・共有）
# ==========================================================

# dataURL を想定した画像サイズ上限（約400KB）
MAX_STICKER_IMAGE_LEN = 400_000

_STICKER_SELECT = """
    SELECT s.id, s.circle_id, s.creator_user_id, s.name, s.image_url, s.category,
           s.downloads_count, s.created_at, u.display_name AS creator_name,
           u.avatar_url AS creator_avatar_url
    FROM circle_stickers s JOIN users u ON u.id = s.creator_user_id
"""


def _validate_sticker_input(data):
    """配布シールの入力を検証して (name, image_url, category) を返す。不正なら (None, error)"""
    name = (data.get("name") or "").strip()
    image_url = (data.get("image_url") or "").strip()
    category = (data.get("category") or "オリジナル").strip() or "オリジナル"
    if not name:
        return None, "シール名を入力してください"
    if len(name) > 60:
        return None, "シール名は60文字以内で入力してください"
    if not image_url:
        return None, "シール画像を選んでください"
    if len(image_url) > MAX_STICKER_IMAGE_LEN:
        return None, "シール画像が大きすぎます"
    return (name, image_url, category), None


@app.route("/api/circles/<int:circle_id>/stickers", methods=["GET"])
def get_circle_stickers(circle_id):
    """サークルで配布中のシール一覧（?user_id= で取得済みフラグを付ける）"""
    user_id = request.args.get("user_id", type=int)
    conn = get_db_connection()
    try:
        if not conn.execute("SELECT id FROM circles WHERE id = ?", (circle_id,)).fetchone():
            return jsonify({"success": False, "error": "サークルが見つかりません"}), 404
        rows = conn.execute(_STICKER_SELECT + """
            WHERE s.circle_id = ? ORDER BY s.created_at DESC, s.id DESC
        """, (circle_id,)).fetchall()
        obtained = set()
        if user_id:
            obtained = {r[0] for r in conn.execute(
                "SELECT source_id FROM user_stickers WHERE user_id = ? AND source = 'circle'",
                (user_id,)).fetchall()}
        return jsonify({"success": True, "stickers": [
            {**dict(r), "obtained": (r["id"] in obtained)} for r in rows]})
    finally:
        conn.close()


@app.route("/api/circles/<int:circle_id>/stickers", methods=["POST"])
def create_circle_sticker(circle_id):
    """自作シールをサークルへ配布（参加メンバーのみ）"""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    parsed, error = _validate_sticker_input(data)
    if error:
        return jsonify({"success": False, "error": error}), 400
    name, image_url, category = parsed
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if not cursor.execute("SELECT id FROM circles WHERE id = ?", (circle_id,)).fetchone():
            return jsonify({"success": False, "error": "サークルが見つかりません"}), 404
        if not cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
            return jsonify({"success": False, "error": "ユーザーが見つかりません"}), 404
        if not cursor.execute("SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?",
                              (circle_id, user_id)).fetchone():
            return jsonify({"success": False, "error": "サークルに参加すると配布できます"}), 403
        cursor.execute("""
            INSERT INTO circle_stickers (circle_id, creator_user_id, name, image_url, category)
            VALUES (?, ?, ?, ?, ?)
        """, (circle_id, user_id, name, image_url, category))
        sticker_id = cursor.lastrowid
        # 配布した本人もすぐ使えるようマイシールへ入れておく
        cursor.execute("""
            INSERT OR IGNORE INTO user_stickers (user_id, name, image_url, category, source, source_id)
            VALUES (?, ?, ?, ?, 'circle', ?)
        """, (user_id, name, image_url, category, sticker_id))
        conn.commit()
        row = cursor.execute(_STICKER_SELECT + " WHERE s.id = ?", (sticker_id,)).fetchone()
        return jsonify({"success": True, "sticker": {**dict(row), "obtained": True}}), 201
    finally:
        conn.close()


@app.route("/api/circles/<int:circle_id>/stickers/<int:sticker_id>", methods=["DELETE"])
def delete_circle_sticker(circle_id, sticker_id):
    """配布したシールを取り下げる（配布者のみ）"""
    body = request.get_json(silent=True) or {}
    user_id = request.args.get("user_id", type=int) or body.get("user_id")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        row = cursor.execute(
            "SELECT id, creator_user_id FROM circle_stickers WHERE id = ? AND circle_id = ?",
            (sticker_id, circle_id)).fetchone()
        if not row:
            return jsonify({"success": False, "error": "シールが見つかりません"}), 404
        if user_id is None or int(user_id) != int(row["creator_user_id"]):
            return jsonify({"success": False, "error": "配布した本人だけが取り下げられます"}), 403
        cursor.execute("DELETE FROM circle_stickers WHERE id = ?", (sticker_id,))
        conn.commit()
        return jsonify({"success": True, "message": "シールの配布を取り下げました"})
    finally:
        conn.close()


@app.route("/api/circles/<int:circle_id>/stickers/<int:sticker_id>/obtain", methods=["POST"])
def obtain_circle_sticker(circle_id, sticker_id):
    """配布シールを入手してマイシールへ追加（手帳で使えるようにする）"""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if not cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
            return jsonify({"success": False, "error": "ユーザーが見つかりません"}), 404
        row = cursor.execute(
            "SELECT id, name, image_url, category FROM circle_stickers WHERE id = ? AND circle_id = ?",
            (sticker_id, circle_id)).fetchone()
        if not row:
            return jsonify({"success": False, "error": "シールが見つかりません"}), 404
        already = cursor.execute("SELECT id FROM user_stickers WHERE user_id = ? AND image_url = ?",
                                 (user_id, row["image_url"])).fetchone()
        cursor.execute("""
            INSERT OR IGNORE INTO user_stickers (user_id, name, image_url, category, source, source_id)
            VALUES (?, ?, ?, ?, 'circle', ?)
        """, (user_id, row["name"], row["image_url"], row["category"], row["id"]))
        if not already:
            cursor.execute(
                "UPDATE circle_stickers SET downloads_count = downloads_count + 1 WHERE id = ?",
                (row["id"],))
        conn.commit()
        count = cursor.execute("SELECT downloads_count FROM circle_stickers WHERE id = ?",
                               (row["id"],)).fetchone()[0]
        return jsonify({
            "success": True,
            "already": bool(already),
            "downloads_count": count,
            "message": "すでにマイシールにあります" if already else f"「{row['name']}」をマイシールに追加しました",
            "sticker": {"id": row["id"], "name": row["name"], "image_url": row["image_url"],
                        "category": row["category"]}
        })
    finally:
        conn.close()


# ==========================================================
# 1f. マイシール（入手したシール）API
# ==========================================================

@app.route("/api/users/<int:user_id>/stickers", methods=["GET"])
def get_user_stickers(user_id):
    """手帳で使えるマイシール一覧"""
    conn = get_db_connection()
    try:
        rows = conn.execute("""
            SELECT id, user_id, name, image_url, category, source, source_id, created_at
            FROM user_stickers WHERE user_id = ? ORDER BY created_at DESC, id DESC
        """, (user_id,)).fetchall()
        return jsonify({"success": True, "stickers": [dict(r) for r in rows]})
    finally:
        conn.close()


@app.route("/api/users/<int:user_id>/stickers", methods=["POST"])
def add_user_sticker(user_id):
    """入手したシールをマイシールへ保存（掲示板シェアの取り込みなど）"""
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()[:60] or "オリジナルシール"
    image_url = (data.get("image_url") or "").strip()
    category = (data.get("category") or "オリジナル").strip() or "オリジナル"
    source = (data.get("source") or "upload").strip() or "upload"
    source_id = data.get("source_id")
    if not image_url:
        return jsonify({"success": False, "error": "シール画像がありません"}), 400
    if len(image_url) > MAX_STICKER_IMAGE_LEN:
        return jsonify({"success": False, "error": "シール画像が大きすぎます"}), 400
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if not cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
            return jsonify({"success": False, "error": "ユーザーが見つかりません"}), 404
        existing = cursor.execute("SELECT id FROM user_stickers WHERE user_id = ? AND image_url = ?",
                                  (user_id, image_url)).fetchone()
        if existing:
            return jsonify({"success": True, "already": True, "sticker": dict(cursor.execute(
                "SELECT id, user_id, name, image_url, category, source, source_id FROM user_stickers WHERE id = ?",
                (existing["id"],)).fetchone())})
        cursor.execute("""
            INSERT INTO user_stickers (user_id, name, image_url, category, source, source_id)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (user_id, name, image_url, category, source, source_id))
        sticker_id = cursor.lastrowid
        conn.commit()
        return jsonify({"success": True, "already": False, "sticker": dict(cursor.execute(
            "SELECT id, user_id, name, image_url, category, source, source_id FROM user_stickers WHERE id = ?",
            (sticker_id,)).fetchone())}), 201
    finally:
        conn.close()


# ==========================================================
# 1g. サークルチャット API（サークル専用ページ）
# ==========================================================

@app.route("/api/circles/<int:circle_id>/messages", methods=["GET"])
def get_circle_messages(circle_id):
    """サークルのチャット履歴（新しい順に取得して古い順へ並べ直す）"""
    limit = request.args.get("limit", default=100, type=int) or 100
    limit = max(1, min(limit, 200))
    conn = get_db_connection()
    try:
        if not conn.execute("SELECT id FROM circles WHERE id = ?", (circle_id,)).fetchone():
            return jsonify({"success": False, "error": "サークルが見つかりません"}), 404
        rows = conn.execute("""
            SELECT m.id, m.circle_id, m.user_id, m.content, m.created_at,
                   u.display_name AS author_name, u.avatar_url AS author_avatar_url
            FROM circle_messages m JOIN users u ON u.id = m.user_id
            WHERE m.circle_id = ? ORDER BY m.id DESC LIMIT ?
        """, (circle_id, limit)).fetchall()
        return jsonify({"success": True, "messages": [dict(r) for r in reversed(rows)]})
    finally:
        conn.close()


@app.route("/api/circles/<int:circle_id>/messages", methods=["POST"])
def create_circle_message(circle_id):
    """チャットへ投稿（参加メンバーのみ）"""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"success": False, "error": "メッセージを入力してください"}), 400
    if len(content) > 500:
        return jsonify({"success": False, "error": "メッセージは500文字以内で入力してください"}), 400
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if not cursor.execute("SELECT id FROM circles WHERE id = ?", (circle_id,)).fetchone():
            return jsonify({"success": False, "error": "サークルが見つかりません"}), 404
        if not cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone():
            return jsonify({"success": False, "error": "ユーザーが見つかりません"}), 404
        if not cursor.execute("SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?",
                              (circle_id, user_id)).fetchone():
            return jsonify({"success": False, "error": "入部するとチャットに参加できます"}), 403
        cursor.execute("INSERT INTO circle_messages (circle_id, user_id, content) VALUES (?, ?, ?)",
                       (circle_id, user_id, content))
        message_id = cursor.lastrowid
        conn.commit()
        row = cursor.execute("""
            SELECT m.id, m.circle_id, m.user_id, m.content, m.created_at,
                   u.display_name AS author_name, u.avatar_url AS author_avatar_url
            FROM circle_messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
        """, (message_id,)).fetchone()
        return jsonify({"success": True, "chat_message": dict(row)}), 201
    finally:
        conn.close()


@app.route("/api/circles/<int:circle_id>/messages/<int:message_id>", methods=["DELETE"])
def delete_circle_message(circle_id, message_id):
    """チャットメッセージを削除（投稿者本人のみ）"""
    user_id = request.args.get("user_id", type=int)
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT user_id FROM circle_messages WHERE id = ? AND circle_id = ?",
            (message_id, circle_id)).fetchone()
        if not row:
            return jsonify({"success": False, "error": "メッセージが見つかりません"}), 404
        if user_id and row["user_id"] != user_id:
            return jsonify({"success": False, "error": "削除権限がありません"}), 403
        conn.execute("DELETE FROM circle_messages WHERE id = ?", (message_id,))
        conn.commit()
        return jsonify({"success": True, "message": "メッセージを削除しました"})
    finally:
        conn.close()


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
            u.avatar_url AS author_avatar_url,
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
            SELECT c.id, c.user_id, c.content, c.created_at, u.display_name AS author_name,
                   u.avatar_url AS author_avatar_url
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

def _port_is_free(port: int) -> bool:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) != 0

# 既定の優先ポート。MAMP Apache の ProxyPass が 5002 を指しているため、
# ここを先頭にしないと公開URL（/QuadTecho/api/）が 503 になる。
DEFAULT_PORT_ORDER = (5002, 5000, 5001, 5003)

def resolve_port() -> int:
    """起動ポートを決める。QUADTECHO_PORT があればそれを優先。"""
    env_port = os.environ.get("QUADTECHO_PORT")
    if env_port:
        try:
            return find_available_port(int(env_port))
        except ValueError:
            pass
    for p in DEFAULT_PORT_ORDER:
        if _port_is_free(p):
            return p
    return find_available_port(DEFAULT_PORT_ORDER[0])

if __name__ == "__main__":
    port = resolve_port()
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


