# QuadTecho（クアッド・テチョウ）

[![公開サイト](https://img.shields.io/badge/site-plan.wawa--app.me%2FQuadTecho-22313f?style=flat-square)](https://plan.wawa-app.me/QuadTecho/)
[![Vue 3](https://img.shields.io/badge/Vue-3-42b883?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![Vite 5](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Flask](https://img.shields.io/badge/Flask-3-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![SQLite](https://img.shields.io/badge/SQLite-DB-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://sqlite.org/)

> **お試し公開URL**: https://plan.wawa-app.me/QuadTecho/
> （Cloudflare Tunnelによる公開のため、サーバー停止中はアクセスできません）

付箋やシールで自由にデコレーションできる、シンプルで使いやすい**学生風手帳サイト**です。

> **本リポジトリについて**: 開発成果物の紹介（サイト説明・技術説明）を目的としており、オープンソースとしてのセットアップ手順の提供・再利用・再配布は想定していません。

### 🧱 技術構成

| 層 | 使用技術 | 説明 |
|---|---|---|
| 画面 | **Vue 3 + Vite 5**（`frontend/`） | `frontend/src/App.vue`（テンプレート）と `frontend/src/app.js`（ロジック）、`frontend/src/styles/app.css`（スタイル）。ビルドするとリポジトリ直下の `index.html` / `assets/app.js` / `assets/app.css` を生成する |
| サーバー | **Flask + Waitress + SQLite**（`flask_server/`） | API に加えて、ビルド済みの画面（`/QuadTecho/`）と画像・CSS・JS（`assets/`）も配信する |
| 公開 | **Cloudflare Tunnel**（`tunnel.sh`） | `https://plan.wawa-app.me/QuadTecho/` を 127.0.0.1:5002 へ転送する |

---

## 🌟 主な機能

### 1. 🏠 ホーム画面（手帳管理ダッシュボード）
- 自分が持っている手帳・ノートが本棚風のカード（表紙カラー、タイトル、ページ番号、メモ数）で一覧表示されます。
- 「＋ 新しい手帳を作る」でいつでも新しい手帳を作成可能。
- カードをクリックするとその手帳を開いて編集画面へ移動します。
- **モバイルの一覧レイアウト**: 幅900px以下ではフォルダが上に積まれ、手帳カードは画面幅いっぱい（最大520px）に伸びて中央にそろいます。左右の余白が等しくなるため、大きめのスマホや横向きでもカードが左に寄ることはありません。
- 最近の付箋メモや共有掲示板の最新トピックもホームでまとめて確認できます。

### 2. 🎛️ 手帳コントロールバー（快適なデコレーション操作）
手帳キャンバスの直上に使い勝手を高めるコントロールバーを新設：
- **🏠 ホームに戻る**: いつでも手帳一覧へ戻れます。
- **クイック付箋投下**: 黄・桃・緑・青の丸ボタンを押すだけで、ノート中央にパッと付箋を配置。
- **選択アイテムの手元操作**:
  - `⤴️ 前面` / `⤵️ 背面`（レイヤー重なり順の変更）
  - `🔄 水平`（傾きを0°にリセット）
  - `📏 サイズ`（付箋・画像・シールを選択すると、上部のスライダーで大きさを変更。縦横比を維持）
  - `🔤 文字`（付箋の文字サイズ。付箋の大きさに自動連動。スライダーのほか数値欄をクリックして直接入力でき、キーボードの矢印キーでも操作可能）
  - `↺ サイズ`（付箋の大きさだけを初期サイズへ戻す。文字サイズは維持）
  - `📋 複製`（付箋のワンタップコピー）
  - `🗑️ 剥がす`
- **用紙スタイル切り替え**:
  - `📐 方眼ノート` / `📝 横罫線` / `📄 白紙・無地` を瞬時に切り替え。
- **ズーム機能**: 画面右固定の縦スライダーと＋／−で30〜200%に拡大・縮小。「100%」で等倍、「全体」で並べたページを整列します。
- **画像**: 左パレットの「写真・画像を貼る」、ページへのファイルドロップ、画像のコピー＆ペーストに対応（PNG/JPEG/WebP/GIF、1枚10MB以内）。画像は軽量化して静止画として保存し、縦横比を維持して配置します。選択すると上部スライダーで大きさを変更できます。
- **複数ページの配置**: タブを机へドラッグ、またはタブの＋で追加表示。手帳画面の「新規ページ」も横に追加します。ページの見出しをドラッグして個別に移動し、背景ドラッグで机全体を移動できます。
- **編集ページの選択**: 並べたページの「このページを編集」か上部タブで編集対象を変更します。×で机から閉じてもページは削除されません。配置位置は同じブラウザタブ内で再読み込み後も復元されます。
- 画像追加時は自動保存します。移動・サイズ変更などの編集後は「ページ保存」を押してください（ページ切り替え時も保存されます）。
- **モバイルの保存**: 編集画面の右下に「💾 保存」のフローティングボタンを常時表示します。ヘッダーの保存ボタンはモバイルでは隠しています。未保存の変更があるとボタンの色が変わり●が付きます。
- **モバイルのページ操作バー**: ノート内の上部バー（ページ名・「このページを編集」・✎・×）は、モバイルでは文字とボタンを大きく表示して押しやすく・見やすくしています。
- **モバイルのページタブ**: 編集画面上部のページ切替タブ（PAGE 1 など）は横スワイプで送れるようにし、はみ出したタブを見切れさせません。選択中のタブは切り替え時や復元時に自動で中央へ寄せます。
- **画面サイズ変更への追従**: デスクトップ⇔モバイルの切り替えや端末の回転時は、表示倍率（%）を保ったまま新しい画面サイズへ再フィットします。前の画面サイズの倍率が残ってノートが巨大・小さすぎになるのを防ぎます。
- **キーボード操作**: 付箋・シールを選んでいるときは、`Delete`／`Backspace` で剥がす、矢印キーで1pxずつ（`Shift`併用で10px）微調整、`⌘D`／`Ctrl+D` で複製ができます。`⌘S`／`Ctrl+S` はブラウザ標準の保存ダイアログを止めて「このページを保存」を実行します。`Esc` は選択解除と、開いているモーダル・パレット・メニューの閉じるをまとめて行います。
- **未保存のインジケータ**: ページの内容が保存済みの状態と変わると、保存ボタンがオレンジに変わります（モバイルのフローティング保存ボタンは●付き）。未保存のままタブを閉じる／再読み込みするとブラウザ標準の確認が出るため、編集内容を失いません。
- **キーで送れる投稿**: 掲示板の投稿・返信、サークルチャットの送信、パレットの付箋作成は `⌘/Ctrl + Enter` で実行できます。モーダルの入力欄は `Enter` で確定します（タイトル変更・フォルダ作成・手帳の新規作成など）。

### 3. 📌 共有掲示板（コミュニティ）
- タイトルと本文を投稿して、タイムラインで近況・相談・募集を共有できます。
- ユーザーごとのいいねと返信、投稿・ユーザーの検索、新着順・いいね順に対応。
- 「自分の投稿」「いいねした投稿」で絞り込めます。
- 自分の投稿は右上の三点メニュー（⋮）から削除できます。サークルチャットも同様に、自分の発言を右上の三点メニューから削除できます。
- Flask接続時は投稿・いいね・返信をSQLiteに保存し、ほかのユーザーは「最新に更新」で取得できます。
- サーバー未接続時はこのブラウザ内だけに保存します。ローカル投稿のサーバーへの自動同期は行いません。
- 既存のユーザー切り替え方式を使用します（公開SNS向けの本人認証は未実装）。

### 手帳のタブ切り替え
- ページ移動前に編集を保存し、連続クリックによる保存・読み込みの競合を防止します。
- 同じブラウザタブを再読み込みしても、表示タブとユーザーごとの選択ページを復元します。

### 4. 🐍 本番用サーバー（Flask + Waitress / 画面配信も担当）
- Python + Waitress + Flask + SQLite による高速・安定稼働。
- **画面（Vite のビルド成果物）もこの Flask が配信する**ため、Apache など別の Web サーバーは不要。`https://plan.wawa-app.me/QuadTecho/` はトンネルから 1 か所（127.0.0.1:5002）だけを見ればよい。
- 画面側のソースは `frontend/`（Vite）にあり、`npm run build` でリポジトリ直下の `index.html` / `assets/app.js` / `assets/app.css` を更新する。
- ポート競合自動回避（5000使用時は自動で5001へシフト）を内蔵。

---

## 🚀 起動方法

```bash
# ① 画面のビルド（ソースを変更したとき）
cd frontend && npm install && npm run build   # 開発中は npm run dev（http://127.0.0.1:5173）
                                              # ビルド先はリポジトリ直下（index.html / assets/app.*）

# ② サーバーの起動（画面配信 + API）
./start.sh                                    # または python3 flask_server/app.py
                                              # → http://127.0.0.1:5002/QuadTecho/

# ③ 公開（Cloudflare Tunnel: https://plan.wawa-app.me/QuadTecho/）
./tunnel.sh start                             # 状態確認: ./tunnel.sh status / 停止: ./tunnel.sh stop
```

> `./start.sh` は自動的に空きポート（既定は 5002）で起動し、SQLite データベースに保存します。
> 公開トンネルは 5002 を見ているため、公開する場合は 5002 で起動してください（`QUADTECHO_PORT` で変更可）。

## 更新後の反映と確認

- 画面（`frontend/`）を変更したときは `npm run build` でビルドし直します（`index.html` の `?v=` はビルド時刻に自動更新され、ブラウザキャッシュのずれを防ぎます）。
- 掲示板APIを更新した場合はFlaskサーバーを再起動してください。新しいテーブルは起動時に自動作成されます。

```bash
python3 -m unittest discover -s tests
node tests/frontend.cjs      # Vite 側のソース（frontend/src/app.js）を直接検証する
```

テストは一時DBとメモリ内ストレージを使い、実データを変更しません。

## 🔍 Google Search Console 対応

検索エンジンへの登録・クロール設定は次のとおりです。

### 1. 所有権確認（プロパティ登録）
1. [Google Search Console](https://search.google.com/search-console) で「**URL プレフィックス**」プロパティとして `https://plan.wawa-app.me/QuadTecho/` を登録します。
2. 確認方法は「**HTML タグ**」を使用し、発行された値を `frontend/index.html` の
   `<meta name="google-site-verification" content="..." />` に設定します（ビルドすると直下の `index.html` へ反映されます）。
3. 公開してから画面の「確認」を押します。

> **ホスト変更時の注意**: 所有権確認トークンはプロパティ（ホスト）ごとに発行されるため、`music.wawa-app.me` から `plan.wawa-app.me` へ変更したときは、Search Console で新しいプロパティを登録して発行された値へ差し替えてください。

### 2. クロール設定ファイル
| ファイル | 公開先 | 用途 |
|---|---|---|
| `sitemap.xml` | https://plan.wawa-app.me/QuadTecho/sitemap.xml | Search Console の「サイトマップ」で送信 |
| `robots.txt` | https://plan.wawa-app.me/robots.txt | クロール制御（API を除外、サイトマップを案内） |

- **robots.txt は「ホスト直下」で配信された場合だけ Google に読まれます。** Google が見るのは `https://plan.wawa-app.me/robots.txt` のみで、`/QuadTecho/robots.txt` は参照されません。本サイトは Flask（サーバー）がホスト直下のパスでも `robots.txt` / `sitemap.xml` を返すようにしてあるため、そのまま有効です。
- 配置後は `https://plan.wawa-app.me/robots.txt` と `https://plan.wawa-app.me/QuadTecho/sitemap.xml` をブラウザで開き、内容が表示されるか確認してください。

### 3. インデックスの仕様（把握しておく点）
- 画面の切り替えは `#home` / `#canvas` / `#board` などの**ハッシュ**で行うため、Google が索引するのは `https://plan.wawa-app.me/QuadTecho/` の**1件のみ**です。各タブは独立したページとして索引されません（sitemap も1件）。
- 本文は JavaScript で描画されるため、`<noscript>` に説明文を、`<head>` に description・canonical・OGP・JSON-LD を用意しています。
- 変更を公開したら、Search Console の「**URL 検査**」→「**インデックス登録をリクエスト**」で再クロールを促せます。

### 4. 公開（Cloudflare Tunnel）側の確認
- 公開は `./tunnel.sh start`（Cloudflare Tunnel `quadtecho` → 127.0.0.1:5002）が担当します。状態は `./tunnel.sh status` で確認できます。
- Cloudflare の **Bot Fight Mode** が有効だと Googlebot が 403 になり、Search Console で「取得できません」になります。Security → Bots で Googlebot を許可するか、Bot Fight Mode を無効にしてください。
- サーバー（`./start.sh`）やトンネルが停止中は公開URLへアクセスできないため、確認・インデックス登録は稼働中に行ってください。

### 5. サイトアイコン（favicon）
- サイトアイコンは **OGP画像 `assets/ogp.png` 内のアプリアイコン部分を正方形に切り出して生成**しています（バナー(1200×630)をそのまま使うと 16px のタブでは潰れるため）。
- 生成物: `assets/icons/` に `favicon-16/32/48/96.png`・`icon-144/192/512.png`・`apple-touch-icon.png`(180)・`icon-maskable-512.png`(Android のマスク対応)
- `frontend/index.html` の `<link rel="icon">` で 48 の倍数（Google が優先して拾うサイズ）を指定し、Android/PWA 用に `site.webmanifest` も配置しています（ビルドすると直下の `index.html` へ反映されます）。
- 再生成（OGP画像を差し替えたとき）: `python3 tools/make_site_icons.py`（Pillow や ImageMagick が無くても動きます）

## 注意

- 本リポジトリはオープンソースではありません。セットアップ手順・内部運用情報は含めていません。
- 公開サーバーとして運用する場合は、十分なセキュリティ設定を行った上で自己責任でお願いします。
