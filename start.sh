#!/bin/bash
# ./start.sh: QuadTecho Flask バックエンドの起動
# 二重起動するとポートと SQLite のロックを取り合うため、
# 先に /api/health で稼働中のサーバーを探してあればそのURLを知らせて終了する。
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE:-$0}")" && pwd)"
cd "$DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
if [[ -x "$DIR/.venv/bin/python" ]]; then
    PYTHON_BIN="$DIR/.venv/bin/python"
fi

"$PYTHON_BIN" -c 'import flask, flask_cors' || {
    echo "Python依存関係が不足しています: pip install -r flask_server/requirements.txt" >&2
    exit 1
}

# 稼働中サーバーの検出（5000〜5003 を /api/health で走査）
FOUND_URL="$("$PYTHON_BIN" - <<'PY'
import json
import urllib.request
for port in (5000, 5001, 5002, 5003):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as res:
            payload = json.load(res)
        if payload.get("service") == "QuadTecho Flask API":
            print(f"http://127.0.0.1:{port}")
            break
    except Exception:
        continue
PY
)"
if [[ -n "$FOUND_URL" ]]; then
    echo "QuadTecho サーバーは既に起動しています: $FOUND_URL"
    echo "二重起動を防ぐため、このまま終了します。再起動はそのプロセスを止めてから実行してください。"
    exit 0
fi

exec "$PYTHON_BIN" flask_server/app.py
