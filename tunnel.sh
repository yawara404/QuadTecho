#!/bin/bash
# ./tunnel.sh: QuadTecho 公開トンネル（Cloudflare Tunnel: plan.wawa-app.me）の管理
#   使い方: ./tunnel.sh start | stop | restart | status
#
# 構成:
#   https://plan.wawa-app.me/QuadTecho/  →（Cloudflare）→ このトンネル
#                                        → http://127.0.0.1:5002（Flask = 画面 + API）
#
# 前提:
#   ・別途 ./start.sh で Flask（5002番）を起動しておくこと。
#   ・ingress は ~/.cloudflared/quadtecho.yml、DNS は次のコマンドで設定済み。
#       cloudflared tunnel route dns quadtecho plan.wawa-app.me
#   ・midair / tunedrop など他プロジェクトのトンネルとは独立している。
#
# 二重起動を防ぐため、PIDファイル（logs/tunnel.pid）で稼働中プロセスを判定する。

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$DIR"

CONFIG="${QUADTECHO_TUNNEL_CONFIG:-$HOME/.cloudflared/quadtecho.yml}"
TUNNEL_NAME="${QUADTECHO_TUNNEL_NAME:-quadtecho}"
LOG_DIR="$DIR/logs"
LOG_FILE="$LOG_DIR/tunnel.log"
PID_FILE="$LOG_DIR/tunnel.pid"
PUBLIC_URL="https://plan.wawa-app.me/QuadTecho/"
HEALTH_URL="https://plan.wawa-app.me/QuadTecho/api/health"

# 稼働中のトンネル PID を返す（無ければ終了コード1）
pid_of() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid="$(cat "$PID_FILE" 2>/dev/null)"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            echo "$pid"
            return 0
        fi
    fi
    return 1
}

start_tunnel() {
    if pid="$(pid_of)"; then
        echo "公開トンネルは既に起動しています (PID $pid) → $PUBLIC_URL"
        return 0
    fi
    if ! command -v cloudflared >/dev/null 2>&1; then
        echo "cloudflared が見つかりません（brew install cloudflared）" >&2
        return 1
    fi
    if [ ! -f "$CONFIG" ]; then
        echo "トンネル設定が見つかりません: $CONFIG" >&2
        return 1
    fi

    mkdir -p "$LOG_DIR"
    nohup cloudflared tunnel --config "$CONFIG" run "$TUNNEL_NAME" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 3

    if pid="$(pid_of)"; then
        echo "公開トンネルを起動しました (PID $pid)"
        echo "公開URL: $PUBLIC_URL"
        echo "ログ   : $LOG_FILE"
        return 0
    fi
    echo "公開トンネルの起動に失敗しました。$LOG_FILE を確認してください。" >&2
    return 1
}

stop_tunnel() {
    if pid="$(pid_of)"; then
        kill "$pid" 2>/dev/null
        # 終了を待ってから PID ファイルを片付ける（残ると次回の起動判定が誤る）
        for _ in 1 2 3 4 5; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 1
        done
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
        echo "公開トンネルを停止しました (PID $pid)"
    else
        echo "公開トンネルは起動していません"
    fi
    rm -f "$PID_FILE"
    return 0
}

show_status() {
    if pid="$(pid_of)"; then
        echo "公開トンネル: 稼働中 (PID $pid)"
    else
        echo "公開トンネル: 停止中"
    fi
    echo -n "ローカル: "
    curl -s -m 3 "http://127.0.0.1:5002/api/health" || echo -n "Flask(5002) に接続できません（./start.sh で起動してください）"
    echo
    echo -n "公開URL : "
    curl -s -m 8 -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo -n "（未接続）"
    echo " $HEALTH_URL"
}

case "${1:-status}" in
    start)   start_tunnel ;;
    stop)    stop_tunnel ;;
    restart) stop_tunnel && start_tunnel ;;
    status)  show_status ;;
    *)
        echo "使い方: ./tunnel.sh start | stop | restart | status" >&2
        exit 1
        ;;
esac
