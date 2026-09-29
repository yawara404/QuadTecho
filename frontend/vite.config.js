import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// QuadTecho のフロントエンドは、このディレクトリ（frontend/）が Vite の root。
// 公開ディレクトリはリポジトリ直下で、ビルドすると直下の index.html と
// assets/app.js・assets/app.css を更新する（Apache などの Web サーバーは不要）。
const frontendDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(frontendDir, '..')

// 開発サーバーの /api・/uploads は Flask バックエンドへ中継する
const API_ORIGIN = 'http://127.0.0.1:5002'

// 配信中のファイル名は公開 URL（/QuadTecho/assets/app.js など）を変えないよう固定する
const JS_OUTPUT = 'assets/app.js'
const CSS_OUTPUT = 'assets/app.css'

// 本番と同じパスで開発サーバーからも参照できる、リポジトリ直下の公開ファイル
const ROOT_FILES = new Set(['robots.txt', 'sitemap.xml', 'site.webmanifest'])
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/**
 * 開発サーバー（npm run dev）でも、本番と同じ /assets 配下の画像や
 * robots.txt / sitemap.xml を返せるようにする。
 * （公開ファイルはリポジトリ直下にあり、frontend/ は Vite の root のため）
 */
function serveRepoPublicFiles() {
  return {
    name: 'quadtecho-serve-repo-public-files',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const urlPath = decodeURIComponent((req.url || '').split('?')[0])
        if (!urlPath.startsWith('/assets/') && !ROOT_FILES.has(urlPath)) return next()
        const filePath = path.join(repoRoot, urlPath)
        if (!filePath.startsWith(repoRoot + path.sep)) return next()
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next()
        res.setHeader('Content-Type', MIME_TYPES[path.extname(filePath)] || 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

/**
 * ビルド成果物のファイル名を固定しているため、HTML と JS / CSS の取り違えを
 * 防ぐ目的で ?v=<ビルド時刻> を付ける（従来の手動 ?v= 運用の自動化）。
 */
function cacheBustBuiltAssets() {
  const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12) // YYYYMMDDHHmm
  return {
    name: 'quadtecho-cache-bust-built-assets',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replaceAll(`${JS_OUTPUT}"`, `${JS_OUTPUT}?v=${version}"`)
        .replaceAll(`${CSS_OUTPUT}"`, `${CSS_OUTPUT}?v=${version}"`)
    },
  }
}

export default defineConfig(({ command }) => {
  const isBuild = command === 'build'
  return {
    plugins: [vue(), serveRepoPublicFiles(), cacheBustBuiltAssets()],

    // 公開 URL は https://plan.wawa-app.me/QuadTecho/（サブパス配下）。
    // 相対パスにしておくと、サブパスでもサブドメイン直下でも同じ成果物が動く。
    base: isBuild ? './' : '/',

    // 公開ファイル（OGP画像・favicon・robots.txt など）はリポジトリ直下の assets/ を
    // そのまま配信するので、public/ からのコピーは行わない。
    publicDir: false,

    build: {
      outDir: '..', // リポジトリ直下（公開ディレクトリ）
      emptyOutDir: false, // assets/ 内の画像など既存ファイルを消さない
      assetsDir: 'assets',
      rollupOptions: {
        output: {
          entryFileNames: JS_OUTPUT,
          chunkFileNames: 'assets/[name].js',
          assetFileNames: (assetInfo) => {
            const name = assetInfo.names?.[0] || assetInfo.name || ''
            return name.endsWith('.css') ? CSS_OUTPUT : 'assets/[name][extname]'
          },
        },
      },
    },

    server: {
      // 他の道具（Flask・curl・トンネル）と同じく IPv4 の 127.0.0.1 で受ける
      // （既定の localhost は macOS で [::1] のみを掴み、127.0.0.1 で接続できないため）
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': { target: API_ORIGIN, changeOrigin: true },
        '/uploads': { target: API_ORIGIN, changeOrigin: true },
      },
    },
  }
})

