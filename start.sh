#!/bin/bash
# ./start.sh: QuadTecho サーバーの起動（Flask = 画面配信 + API）
# bash / zsh のどちらからでも実行できます（source にも対応）。
# 二重起動するとポートと SQLite のロックを取り合うため、
# 先に /api/health で稼働中のサーバーを探してあればそのURLを知らせて終了する。
#
# 画面（Vite のビルド成果物）も Flask が配信するため、Web サーバーの起動は不要。
#   http://127.0.0.1:5002/QuadTecho/   （ローカル確認）
# 公開URL https://plan.wawa-app.me/QuadTecho/ は別途 ./tunnel.sh start で開始する。

# --- このスクリプト自身の場所を bash / zsh 両対応で解決する ---
if [ -n "${BASH_VERSION:-}" ]; then
    _qt_self="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
    # zsh では %x が「現在実行中のファイル」（source 時は読み込み中のファイル）を指す。
    # bash に zsh 専用構文を解釈させないよう eval 経由で展開する。
    eval '_qt_self="${(%):-%x}"'
else
    _qt_self="$0"
fi
DIR="$(cd "$(dirname "$_qt_self")" && pwd)"
cd "$DIR"

# source されているか（= 呼び出し元シェルを exit で閉じてはいけないか）を判定する
if [ -n "${ZSH_VERSION:-}" ]; then
    case "${ZSH_EVAL_CONTEXT:-}" in
        *file*) _qt_sourced=1 ;;
        *)      _qt_sourced=0 ;;
    esac
elif [ -n "${BASH_VERSION:-}" ]; then
    if [ "${BASH_SOURCE[0]}" = "$0" ]; then _qt_sourced=0; else _qt_sourced=1; fi
else
    _qt_sourced=0
fi

_qt_main() {
    PYTHON_BIN="${PYTHON_BIN:-python3}"
    if [ -x "$DIR/.venv/bin/python" ]; then
        PYTHON_BIN="$DIR/.venv/bin/python"
    fi

    "$PYTHON_BIN" -c 'import flask, flask_cors' || {
        echo "Python依存関係が不足しています: pip install -r flask_server/requirements.txt" >&2
        return 1
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
    if [ -n "$FOUND_URL" ]; then
        echo "QuadTecho サーバーは既に起動しています: $FOUND_URL"
        if [ "$FOUND_URL" != "http://127.0.0.1:5002" ]; then
            echo "⚠️  公開トンネル（Cloudflare Tunnel: plan.wawa-app.me）は 5002 へ転送しています。"
            echo "    このままだと https://plan.wawa-app.me/QuadTecho/ にアクセスできません。"
            echo "    一度停止してから ./start.sh を再実行してください（既定で 5002 を使用します）。"
        fi
        echo "二重起動を防ぐため、このまま終了します。再起動はそのプロセスを止めてから実行してください。"
        return 0
    fi

    if [ "$_qt_sourced" = "1" ]; then
        # source 時は exec で呼び出し元シェルを置き換えない
        "$PYTHON_BIN" flask_server/app.py
    else
        exec "$PYTHON_BIN" flask_server/app.py
    fi
}

_qt_main "$@"
_qt_status=$?

if [ "$_qt_sourced" = "1" ]; then
    unset -f _qt_main
    return "$_qt_status"
fi
exit "$_qt_status"
