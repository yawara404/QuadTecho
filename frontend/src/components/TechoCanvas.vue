<template>
  <div class="quad-techo-container">
    <!-- ヘッダーツールバー -->
    <header class="app-header">
      <div class="brand">
        <div class="brand-icon">📓</div>
        <div class="brand-text">
          <h1 class="app-title">QuadTecho</h1>
          <span class="app-subtitle">大学生活のデコ手帳＆サークル部室</span>
        </div>
      </div>

      <!-- ビュー切り替えタブ -->
      <nav class="view-tabs">
        <button 
          :class="['tab-btn', { active: currentView === 'canvas' }]" 
          @click="currentView = 'canvas'"
        >
          <span>📖</span> 手帳キャンバス
        </button>
        <button 
          :class="['tab-btn', { active: currentView === 'board' }]" 
          @click="switchToBoard"
        >
          <span>📌</span> サークル部室掲示板
        </button>
      </nav>

      <!-- アクションボタン群 -->
      <div class="header-actions">
        <button 
          v-if="currentView === 'canvas'"
          class="btn btn-save" 
          :disabled="isSaving" 
          @click="saveTecho"
        >
          <span v-if="isSaving" class="spinner"></span>
          <span v-else>💾</span>
          {{ isSaving ? '保存中...' : '手帳を保存' }}
        </button>
        <button 
          v-if="currentView === 'board'"
          class="btn btn-refresh" 
          @click="fetchBoardPosts"
        >
          🔄 掲示板を更新
        </button>
      </div>
    </header>

    <!-- 通知バナー -->
    <transition name="fade">
      <div v-if="statusMessage" :class="['status-toast', statusMessage.type]">
        <span class="toast-icon">{{ statusMessage.type === 'success' ? '✅' : '⚠️' }}</span>
        <span>{{ statusMessage.text }}</span>
      </div>
    </transition>

    <!-- メインコンテンツ領域 -->
    <main class="main-content">
      <!-- ============================================== -->
      <!-- 画面1: 手帳キャンバス（個人） -->
      <!-- ============================================== -->
      <div v-show="currentView === 'canvas'" class="canvas-workspace">
        <!-- ツールパレット（サイドバー） -->
        <aside class="tool-palette">
          <div class="palette-section">
            <h2 class="palette-title">✏️ 付箋をつくる</h2>
            <textarea 
              v-model="newNoteText" 
              class="note-input" 
              placeholder="講義メモ、課題締切、今日の日記..."
              rows="3"
            ></textarea>
            
            <div class="color-picker-label">付箋カラー:</div>
            <div class="color-picker">
              <button 
                v-for="c in stickyColors" 
                :key="c.code"
                :style="{ backgroundColor: c.code }"
                :class="['color-dot', { selected: selectedColor === c.code }]"
                :title="c.name"
                @click="selectedColor = c.code"
              ></button>
            </div>

            <button class="btn btn-add-note" @click="addStickyNote">
              ＋ 付箋を貼る
            </button>
          </div>

          <div class="palette-divider"></div>

          <div class="palette-section">
            <h2 class="palette-title">🎨 シールを貼る</h2>
            <p class="section-desc">手持ちの画像や生協シールをデコレーション！</p>
            
            <!-- ファイルアップロード入力 -->
            <label class="file-upload-label">
              <input 
                type="file" 
                ref="fileInputRef" 
                accept="image/png, image/jpeg, image/webp, image/gif" 
                @change="handleFileUpload" 
                class="hidden-file-input"
              />
              <span class="upload-btn-ui">
                <span>📁</span> 画像からシール作成
              </span>
            </label>

            <!-- プリセットシール -->
            <div class="preset-label">学内プリセットシール:</div>
            <div class="preset-stickers-grid">
              <button 
                v-for="sticker in presetStickers" 
                :key="sticker.name" 
                class="preset-sticker-btn"
                :title="sticker.name"
                @click="addPresetSticker(sticker)"
              >
                <img :src="sticker.icon" :alt="sticker.name" class="preset-img" />
                <span class="preset-name">{{ sticker.name }}</span>
              </button>
            </div>
          </div>

          <!-- 選択中アイテムの編集パネル -->
          <div v-if="selectedItem" class="palette-section selected-item-controls">
            <h2 class="palette-title">⚙️ 選択中のアイテム</h2>
            <div class="control-row">
              <label>角度: {{ selectedItem.rotation }}°</label>
              <input 
                type="range" 
                min="-45" 
                max="45" 
                v-model.number="selectedItem.rotation" 
                class="slider"
              />
            </div>
            <div class="item-actions">
              <button 
                v-if="selectedItem.item_type === 'sticky_note'"
                class="btn btn-share" 
                @click="shareStickyToBoard(selectedItem)"
                title="部室掲示板にこの付箋を共有します"
              >
                📌 掲示板へ共有
              </button>
              <button class="btn btn-delete" @click="deleteItem(selectedItem.id)">
                🗑️ 剥がす
              </button>
            </div>
          </div>
        </aside>

        <!-- 手帳キャンバス（白紙・方眼ノート） -->
        <section class="notebook-viewport" ref="viewportRef">
          <!-- ズーム操作ツールバー -->
          <div class="zoom-toolbar">
            <button class="zoom-btn" title="縮小 (Ctrl + ホイール下 / ピンチイン)" @click="zoomOut">－</button>
            <button class="zoom-label" title="クリックで100%にリセット" @click="resetZoom">{{ Math.round(zoomScale * 100) }}%</button>
            <button class="zoom-btn" title="拡大 (Ctrl + ホイール上 / ピンチアウト)" @click="zoomIn">＋</button>
            <span class="zoom-hint">ピンチ / Ctrl+ホイールで拡大縮小</span>
          </div>
          <div
            class="canvas-scaler"
            :style="{ width: `${CANVAS_BASE_W * zoomScale}px`, height: `${canvasScalerHeight}px` }"
          >
            <div
              class="notebook-page"
              ref="canvasRef"
              :style="{ transform: `scale(${zoomScale})` }"
            >
            <!-- 大学ノートの装飾（左とじ・リング穴・インデックス） -->
            <div class="notebook-spine">
              <div v-for="n in 12" :key="n" class="binder-ring"></div>
            </div>
            <div class="notebook-red-margin"></div>

            <div class="notebook-header-rule">
              <span class="notebook-date">Date: {{ todayString }}</span>
              <span class="notebook-subject">Subject: Quad Campus Life</span>
            </div>

            <!-- キャンバス上の配置アイテム群 -->
            <div 
              v-for="item in items" 
              :key="item.id"
              :class="[
                'canvas-item', 
                item.item_type,
                { 'is-selected': selectedItemId === item.id }
              ]"
              :style="{
                left: `${item.x}px`,
                top: `${item.y}px`,
                width: `${item.width}px`,
                height: item.height ? `${item.height}px` : 'auto',
                transform: `rotate(${item.rotation}deg)`,
                zIndex: item.z_index,
                backgroundColor: item.item_type === 'sticky_note' ? item.bg_color : 'transparent',
              }"
              @pointerdown="handlePointerDown($event, item)"
            >
              <!-- 付箋アイテム -->
              <template v-if="item.item_type === 'sticky_note'">
                <div class="masking-tape"></div>
                <div class="sticky-body">
                  <textarea 
                    v-model="item.content" 
                    class="sticky-textarea" 
                    placeholder="文字を入力..."
                    @pointerdown.stop
                  ></textarea>
                </div>
              </template>

              <!-- シールアイテム -->
              <template v-else-if="item.item_type === 'sticker'">
                <div class="sticker-content">
                  <img 
                    :src="getResolvedImageUrl(item.image_url)" 
                    :alt="item.content || 'sticker'" 
                    class="sticker-img" 
                    draggable="false"
                  />
                </div>
              </template>

              <!-- アイテム右上のクイック削除バッジ -->
              <button 
                class="item-quick-remove" 
                title="剥がす" 
                @click.stop="deleteItem(item.id)"
                @pointerdown.stop
              >×</button>
            </div>

            <!-- アイテムが空の時のガイド -->
            <div v-if="items.length === 0" class="empty-canvas-guide">
              <p>📖 手帳にまだアイテムがありません。</p>
              <p>左側のパレットから「付箋」や「シール」を追加して、好きな場所にドラッグ配置してみましょう！</p>
            </div>
            </div><!-- /.notebook-page -->
          </div><!-- /.canvas-scaler -->
        </section>
      </div>

      <!-- ============================================== -->
      <!-- 画面2: サークル部室掲示板（共有） -->
      <!-- ============================================== -->
      <div v-show="currentView === 'board'" class="board-workspace">
        <div class="cork-board">
          <div class="cork-header">
            <h2>🏛️ サークル部室・連絡掲示板</h2>
            <p>手帳の付箋を部室のコルクボードにピン留め！ サークルメンバーと予定やアイデアを共有できます。</p>
          </div>

          <div v-if="isLoadingBoard" class="board-loading">
            掲示板を読み込み中...
          </div>

          <div v-else-if="boardPosts.length === 0" class="board-empty">
            まだ投稿がありません。手帳キャンバスで付箋を選択し、「📌 掲示板へ共有」を押して貼ってみましょう！
          </div>

          <div v-else class="bulletin-cards-grid">
            <article 
              v-for="post in boardPosts" 
              :key="post.id"
              class="bulletin-card"
              :style="{ backgroundColor: post.bg_color || '#ffeaa7' }"
            >
              <div class="pushpin">📌</div>
              <div class="bulletin-card-header">
                <span class="author-tag">👤 {{ post.author_name }} ({{ post.circle_name }})</span>
                <time class="post-time">{{ formatDate(post.created_at) }}</time>
              </div>
              <h3 class="bulletin-title">{{ post.title }}</h3>
              <p class="bulletin-body">{{ post.content }}</p>
              <div v-if="post.sticker_url" class="bulletin-sticker">
                <img :src="getResolvedImageUrl(post.sticker_url)" alt="sticker" />
              </div>
            </article>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'

// ==========================================
// 1. 定数・設定
// ==========================================
// バックエンドAPIのベースURL（環境やプロキシに合わせて調整可能）
const API_BASE = import.meta.env?.VITE_API_BASE || 'http://localhost:8000'

// 付箋のカラーバリエーション
const stickyColors = [
  { name: 'カナリアイエロー', code: '#fff9c4' },
  { name: 'サクラピンク', code: '#ffd1dc' },
  { name: 'ミントグリーン', code: '#d4edda' },
  { name: 'スカイブルー', code: '#d1f2fd' },
  { name: 'ラベンダーパープル', code: '#e8d7ff' },
  { name: 'アプリコットオレンジ', code: '#ffe0b2' },
]

// プリセットシール（SVGデータURIで即利用可能）
const presetStickers = [
  {
    name: '☕ カフェ休憩',
    icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%236f4e37"/><text x="50" y="60" font-size="40" text-anchor="middle">☕</text></svg>'
  },
  {
    name: '📝 レポート締切',
    icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%23e74c3c"/><text x="50" y="45" font-size="14" fill="white" font-weight="bold" text-anchor="middle">締切厳守</text><text x="50" y="70" font-size="28" text-anchor="middle">⚠️</text></svg>'
  },
  {
    name: '💯 単位取得！',
    icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%2327ae60"/><text x="50" y="48" font-size="16" fill="white" font-weight="bold" text-anchor="middle">秀 確定</text><text x="50" y="75" font-size="24" text-anchor="middle">💮</text></svg>'
  },
  {
    name: '🎸 部室集合',
    icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%238e44ad"/><text x="50" y="62" font-size="40" text-anchor="middle">🎸</text></svg>'
  },
]

// ==========================================
// 2. リアクティブステート
// ==========================================
const currentView = ref('canvas') // 'canvas' | 'board'
const canvasRef = ref(null)
const viewportRef = ref(null)
const fileInputRef = ref(null)

// ------------------------------------------
// キャンバスズーム（トラックパッドのピンチ対応）
// MacBookのトラックパッドのピンチはブラウザ上では
// Safari: gesturestart/gesturechange/gestureend
// Chrome/Edge: wheel + ctrlKey (+ Safariもwheelを発火)
// として届くため、両方をカーソル中心ズームとして扱う。
// ------------------------------------------
const CANVAS_BASE_W = 900
const CANVAS_BASE_H = 800
const ZOOM_MIN = 0.4
const ZOOM_MAX = 2.5
const zoomScale = ref(1)
const canvasScalerHeight = computed(() => Math.round(CANVAS_BASE_H * zoomScale.value))

// ログインユーザーID（プロトタイプ仮定）
const currentUserId = ref(1)

// 手帳アイテム配列
const items = ref([])
const selectedItemId = ref(null)

// フォーム入力ステート
const newNoteText = ref('')
const selectedColor = ref(stickyColors[0].code)

// 通信状態＆メッセージ
const isSaving = ref(false)
const isLoadingBoard = ref(false)
const statusMessage = ref(null)
const boardPosts = ref([])

// 今日の日付フォーマット
const todayString = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
})

// 選択中アイテムオブジェクト
const selectedItem = computed(() => {
  return items.value.find(i => i.id === selectedItemId.value) || null
})

// ==========================================
// 3. Pointer Eventsによる高精度ドラッグ＆ドロップ
// ==========================================
let dragItem = null
let dragStartX = 0
let dragStartY = 0
let initialItemX = 0
let initialItemY = 0

/**
 * ドラッグ開始（マウス押下 / タッチ開始）
 */
function handlePointerDown(event, item) {
  // テキストエリア入力や削除ボタンクリック時はドラッグ発動を抑制
  if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'BUTTON') {
    return
  }

  dragItem = item
  selectedItemId.value = item.id

  // z-indexを最前面に更新
  const maxZ = items.value.reduce((max, i) => Math.max(max, i.z_index || 0), 0)
  item.z_index = maxZ + 1

  dragStartX = event.clientX
  dragStartY = event.clientY
  initialItemX = item.x
  initialItemY = item.y

  // ポインターキャプチャ（キャンバス枠外にカーソルが出ても追従が外れない）
  if (event.currentTarget && event.currentTarget.setPointerCapture) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch (e) {
      // 一部環境用フォールバック
    }
  }

  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
}

/**
 * ドラッグ中（座標をリアルタイム更新）
 * ズーム中は画面移動量を論理座標に換算するため zoomScale で割る。
 */
function handlePointerMove(event) {
  if (!dragItem) return

  const deltaX = (event.clientX - dragStartX) / zoomScale.value
  const deltaY = (event.clientY - dragStartY) / zoomScale.value

  let newX = Math.round(initialItemX + deltaX)
  let newY = Math.round(initialItemY + deltaY)

  // キャンバス内に収まるようクランプ（制限）
  // 論理座標系（900x800基準）で計算する
  const maxX = Math.max(100, CANVAS_BASE_W - (dragItem.width || 140))
  const maxY = Math.max(100, CANVAS_BASE_H - (dragItem.height || 140))
  newX = Math.max(20, Math.min(newX, maxX))
  newY = Math.max(20, Math.min(newY, maxY))

  dragItem.x = newX
  dragItem.y = newY
}

/**
 * ドラッグ終了（リスナー解除）
 */
function handlePointerUp() {
  dragItem = null
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
}

// ==========================================
// 4. アイテム操作（追加・削除・回転）
// ==========================================
function getNextId() {
  return items.value.reduce((max, i) => Math.max(max, i.id || 0), 0) + 1
}

function showStatus(text, type = 'success') {
  statusMessage.value = { text, type }
  setTimeout(() => {
    if (statusMessage.value?.text === text) {
      statusMessage.value = null
    }
  }, 3500)
}

/**
 * 新規付箋を追加
 */
function addStickyNote() {
  const text = newNoteText.value.trim()
  const newItem = {
    id: getNextId(),
    user_id: currentUserId.value,
    item_type: 'sticky_note',
    content: text || '新しい付箋メモ',
    image_url: null,
    x: 80 + (items.value.length % 5) * 20,
    y: 90 + (items.value.length % 5) * 20,
    width: 170,
    height: 140,
    rotation: Math.floor(Math.random() * 11) - 5, // -5°〜+5°の自然な傾き
    z_index: items.value.length + 1,
    bg_color: selectedColor.value,
  }

  items.value.push(newItem)
  selectedItemId.value = newItem.id
  newNoteText.value = ''
  showStatus('付箋を手帳に貼りました！')
}

/**
 * プリセットシールを追加
 */
function addPresetSticker(preset) {
  const newItem = {
    id: getNextId(),
    user_id: currentUserId.value,
    item_type: 'sticker',
    content: preset.name,
    image_url: preset.icon,
    x: 100 + (items.value.length % 4) * 30,
    y: 120 + (items.value.length % 4) * 30,
    width: 110,
    height: 110,
    rotation: Math.floor(Math.random() * 15) - 7,
    z_index: items.value.length + 1,
    bg_color: 'transparent',
  }

  items.value.push(newItem)
  selectedItemId.value = newItem.id
  showStatus(`シール「${preset.name}」を貼りました！`)
}

/**
 * 画像アップロードによるシール追加
 */
async function handleFileUpload(event) {
  const file = event.target.files?.[0]
  if (!file) return

  const formData = new FormData()
  formData.append('image', file)

  try {
    showStatus('画像をアップロード中...', 'info')
    const res = await fetch(`${API_BASE}/api/upload.php`, {
      method: 'POST',
      body: formData,
    })

    const result = await res.json()
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'アップロードに失敗しました')
    }

    const newItem = {
      id: getNextId(),
      user_id: currentUserId.value,
      item_type: 'sticker',
      content: result.data.original_name,
      image_url: result.data.url,
      x: 120,
      y: 120,
      width: 130,
      height: 130,
      rotation: Math.floor(Math.random() * 10) - 5,
      z_index: items.value.length + 1,
      bg_color: 'transparent',
    }

    items.value.push(newItem)
    selectedItemId.value = newItem.id
    showStatus('シールを作成して手帳に貼りました！')
  } catch (err) {
    showStatus(err.message, 'error')
  } finally {
    if (fileInputRef.value) {
      fileInputRef.value.value = ''
    }
  }
}

/**
 * アイテムの削除
 */
function deleteItem(itemId) {
  items.value = items.value.filter(i => i.id !== itemId)
  if (selectedItemId.value === itemId) {
    selectedItemId.value = null
  }
  showStatus('アイテムを剥がしました')
}

// ==========================================
// 5. バックエンドAPI通信
// ==========================================
function getResolvedImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url
  }
  return `${API_BASE}${url}`
}

/**
 * 手帳アイテムの取得 (GET /api/techo.php)
 */
async function fetchTechoItems() {
  try {
    const res = await fetch(`${API_BASE}/api/techo.php?user_id=${currentUserId.value}`)
    if (res.ok) {
      const data = await res.json()
      if (data.success && Array.isArray(data.items)) {
        items.value = data.items
      }
    }
  } catch (e) {
    console.warn('API接続オフライン。初期ローカルデータで動作します。')
    // デモ用サンプル初期アイテム
    if (items.value.length === 0) {
      items.value = [
        {
          id: 1,
          user_id: 1,
          item_type: 'sticky_note',
          content: '火曜2限：情報工学のレポート提出！\n図書館で本を返却する',
          image_url: null,
          x: 70,
          y: 70,
          width: 180,
          height: 140,
          rotation: -3,
          z_index: 1,
          bg_color: '#fff9c4',
        },
        {
          id: 2,
          user_id: 1,
          item_type: 'sticky_note',
          content: 'サークル部室ミーティング 18:00〜\n議題：新入生歓迎フェスについて',
          image_url: null,
          x: 290,
          y: 90,
          width: 190,
          height: 140,
          rotation: 2,
          z_index: 2,
          bg_color: '#d1f2fd',
        }
      ]
    }
  }
}

/**
 * 手帳アイテムの一括保存 (POST /api/techo.php)
 */
async function saveTecho() {
  isSaving.value = true
  try {
    const payload = {
      user_id: currentUserId.value,
      items: items.value.map(item => ({
        item_type: item.item_type,
        content: item.content,
        image_url: item.image_url,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        z_index: item.z_index,
        bg_color: item.bg_color,
      }))
    }

    const res = await fetch(`${API_BASE}/api/techo.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const result = await res.json()
    if (!res.ok || !result.success) {
      throw new Error(result.error || '保存に失敗しました')
    }

    showStatus('手帳の配置とメモを保存しました！')
  } catch (err) {
    showStatus(`保存エラー: ${err.message}`, 'error')
  } finally {
    isSaving.value = false
  }
}

/**
 * 選択した付箋を部室掲示板へ共有 (POST /api/board.php)
 */
async function shareStickyToBoard(item) {
  if (!item.content) {
    showStatus('共有するメモ本文がありません', 'error')
    return
  }

  try {
    const payload = {
      user_id: currentUserId.value,
      title: item.content.slice(0, 16) + (item.content.length > 16 ? '...' : ''),
      content: item.content,
      bg_color: item.bg_color,
      sticker_url: item.image_url,
    }

    const res = await fetch(`${API_BASE}/api/board.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const result = await res.json()
    if (!res.ok || !result.success) {
      throw new Error(result.error || '共有に失敗しました')
    }

    showStatus('部室掲示板に付箋を共有しました！')
  } catch (err) {
    showStatus(`共有エラー: ${err.message}`, 'error')
  }
}

/**
 * 部室掲示板の投稿一覧取得 (GET /api/board.php)
 */
async function fetchBoardPosts() {
  isLoadingBoard.value = true
  try {
    const res = await fetch(`${API_BASE}/api/board.php`)
    if (res.ok) {
      const data = await res.json()
      if (data.success && Array.isArray(data.posts)) {
        boardPosts.value = data.posts
      }
    }
  } catch (e) {
    console.warn('掲示板の取得に失敗しました')
  } finally {
    isLoadingBoard.value = false
  }
}

function switchToBoard() {
  currentView.value = 'board'
  fetchBoardPosts()
}

function formatDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ==========================================
// 6. キャンバスズーム（ピンチイン/ピンチアウト）
// ==========================================
function clampZoom(v) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))
}

/**
 * カーソル位置を中心にズーム（ドラッグ中の体感ズレを抑えるため
 * ビューポートのスクロール位置も補正する）
 */
function applyZoom(nextScale, centerClientX, centerClientY) {
  const viewport = viewportRef.value
  const canvas = canvasRef.value
  const prev = zoomScale.value
  const next = clampZoom(nextScale)
  if (next === prev) return

  // カーソル中心ズーム: カーソル下の論理座標を求め、
  // スケール変化分だけスクロールを補正すれば同じ点がカーソル下に残る
  //   newScroll = oldScroll + logical * (next - prev)
  let logicalX = null
  let logicalY = null
  if (
    viewport && canvas &&
    typeof centerClientX === 'number' &&
    typeof centerClientY === 'number'
  ) {
    const rect = canvas.getBoundingClientRect()
    logicalX = (centerClientX - rect.left) / prev
    logicalY = (centerClientY - rect.top) / prev
  }

  zoomScale.value = next

  if (viewport && logicalX !== null && logicalY !== null) {
    const dx = logicalX * (next - prev)
    const dy = logicalY * (next - prev)
    // スケーラー寸法のDOM反映を待ってから補正（はみ出しクランプ対策）
    requestAnimationFrame(() => {
      const el = viewportRef.value
      if (!el) return
      el.scrollLeft += dx
      el.scrollTop += dy
    })
  }
}

function zoomIn() {
  applyZoom(zoomScale.value * 1.2)
}

function zoomOut() {
  applyZoom(zoomScale.value / 1.2)
}

function resetZoom() {
  applyZoom(1)
}

/**
 * トラックパッドのピンチ / Ctrl+ホイールによるズーム。
 * macOS Chromeではピンチが ctrlKey=true のwheelとして届く。
 * 通常ホイール（ctrl/metaなし）は縦横スクロールに任せる。
 */
function handleZoomWheel(event) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  // deltaY>0=縮小方向。トラックパッドの微小deltaに追従しつつ感度調整。
  const factor = Math.exp(-event.deltaY * 0.01)
  applyZoom(zoomScale.value * factor, event.clientX, event.clientY)
}

// Safari独自のジェスチャイベント（古いSafari / 一部WebKit用）
let gestureBaseZoom = 1
function handleGestureStart(event) {
  event.preventDefault()
  gestureBaseZoom = zoomScale.value
}
function handleGestureChange(event) {
  event.preventDefault()
  applyZoom(gestureBaseZoom * event.scale, event.clientX, event.clientY)
}
function handleGestureEnd(event) {
  if (event.preventDefault) event.preventDefault()
}

onMounted(() => {
  fetchTechoItems()
  const viewport = viewportRef.value
  if (viewport) {
    // passive:false が必須（ピンチ時のページズーム抑止のためpreventDefaultする）
    viewport.addEventListener('wheel', handleZoomWheel, { passive: false })
    viewport.addEventListener('gesturestart', handleGestureStart, { passive: false })
    viewport.addEventListener('gesturechange', handleGestureChange, { passive: false })
    viewport.addEventListener('gestureend', handleGestureEnd, { passive: false })
  }
})

onBeforeUnmount(() => {
  const viewport = viewportRef.value
  if (viewport) {
    viewport.removeEventListener('wheel', handleZoomWheel)
    viewport.removeEventListener('gesturestart', handleGestureStart)
    viewport.removeEventListener('gesturechange', handleGestureChange)
    viewport.removeEventListener('gestureend', handleGestureEnd)
  }
})
</script>

<style scoped>
/* ==========================================
   全体レイアウト & テーマ
   ========================================== */
.quad-techo-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f3efe6;
  font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'BIZ UDPGothic', sans-serif;
  color: #2d3436;
}

/* ヘッダー */
.app-header {
  height: 64px;
  background: #2c3e50;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 100;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  font-size: 28px;
}

.app-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.app-subtitle {
  font-size: 11px;
  color: #bdc3c7;
}

.view-tabs {
  display: flex;
  gap: 8px;
  background: rgba(0, 0, 0, 0.2);
  padding: 4px;
  border-radius: 8px;
}

.tab-btn {
  border: none;
  background: transparent;
  color: #ecf0f1;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.tab-btn.active {
  background: #ffffff;
  color: #2c3e50;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.header-actions {
  display: flex;
  gap: 12px;
}

.btn {
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: transform 0.1s, opacity 0.2s;
}

.btn:active {
  transform: scale(0.98);
}

.btn-save {
  background: #27ae60;
  color: #ffffff;
}

.btn-save:hover {
  background: #2ecc71;
}

.btn-refresh {
  background: #34495e;
  color: #ffffff;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #fff;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* トースト通知 */
.status-toast {
  position: fixed;
  top: 76px;
  right: 24px;
  padding: 12px 20px;
  border-radius: 8px;
  background: #333;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  z-index: 1000;
}

.status-toast.success {
  background: #27ae60;
}

.status-toast.error {
  background: #e74c3c;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* メインコンテンツ */
.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* ==========================================
   手帳キャンバス ワークスペース
   ========================================== */
.canvas-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* サイドバーパレット */
.tool-palette {
  width: 280px;
  background: #ffffff;
  border-right: 1px solid #e0d8cb;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  box-shadow: 2px 0 6px rgba(0, 0, 0, 0.03);
}

.palette-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 10px 0;
  color: #34495e;
}

.section-desc {
  font-size: 12px;
  color: #7f8c8d;
  margin: 0 0 10px 0;
}

.note-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid #dcdde1;
  border-radius: 6px;
  font-size: 13px;
  resize: vertical;
  font-family: inherit;
}

.note-input:focus {
  outline: none;
  border-color: #3498db;
}

.color-picker-label, .preset-label {
  font-size: 12px;
  color: #7f8c8d;
  margin: 10px 0 6px 0;
  font-weight: 600;
}

.color-picker {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.color-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  transition: transform 0.15s;
}

.color-dot:hover {
  transform: scale(1.15);
}

.color-dot.selected {
  border-color: #2c3e50;
  transform: scale(1.15);
}

.btn-add-note {
  width: 100%;
  background: #f1c40f;
  color: #2c3e50;
  justify-content: center;
}

.palette-divider {
  height: 1px;
  background: #ece7de;
}

.hidden-file-input {
  display: none;
}

.file-upload-label {
  display: block;
  cursor: pointer;
  margin-bottom: 12px;
}

.upload-btn-ui {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: #edf2f7;
  border: 1px dashed #cbd5e0;
  border-radius: 6px;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #4a5568;
  transition: background 0.2s;
}

.upload-btn-ui:hover {
  background: #e2e8f0;
}

.preset-stickers-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.preset-sticker-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: #faf8f5;
  border: 1px solid #ebdcd0;
  border-radius: 8px;
  padding: 8px 4px;
  cursor: pointer;
  transition: transform 0.15s, background 0.15s;
}

.preset-sticker-btn:hover {
  transform: translateY(-2px);
  background: #fff;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
}

.preset-img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.preset-name {
  font-size: 11px;
  color: #555;
}

.selected-item-controls {
  background: #f8fafc;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.control-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #4a5568;
  margin-bottom: 8px;
}

.slider {
  width: 100%;
}

.item-actions {
  display: flex;
  gap: 6px;
}

.btn-share {
  flex: 1;
  background: #3498db;
  color: #fff;
  font-size: 12px;
  padding: 6px 8px;
  justify-content: center;
}

.btn-delete {
  background: #e74c3c;
  color: #fff;
  font-size: 12px;
  padding: 6px 10px;
}

/* ==========================================
   手帳ノート本体（キャンバス）
   ========================================== */
.notebook-viewport {
  flex: 1;
  padding: 30px;
  padding-top: 58px;
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  position: relative;
  /* トラックパッドのピンチジェスチャをブラウザ任せにせず自前ズームで扱う */
  touch-action: pan-x pan-y;
  overscroll-behavior: contain;
}

/* ズーム操作ツールバー（ビューポート左上に固定） */
.zoom-toolbar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #e0d8cb;
  border-radius: 999px;
  padding: 4px 12px 4px 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
  z-index: 60;
  backdrop-filter: blur(4px);
}

.zoom-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid #dcd3c3;
  background: #fff;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #2c3e50;
}

.zoom-btn:hover {
  background: #f3efe6;
}

.zoom-label {
  border: none;
  background: transparent;
  min-width: 56px;
  font-size: 13px;
  font-weight: 700;
  color: #2c3e50;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.zoom-label:hover {
  background: #f3efe6;
}

.zoom-hint {
  font-size: 11px;
  color: #95a5a6;
  white-space: nowrap;
}

/* ズーム用スケーラー（transform分のレイアウト崩れを吸収） */
.canvas-scaler {
  flex-shrink: 0;
  margin: 0 auto;
}

.notebook-page {
  position: relative;
  width: 900px;
  min-height: 800px;
  transform-origin: 0 0;
  flex-shrink: 0;
  background-color: #fdfdf9;
  /* 方眼ノート風のグリッド背景 */
  background-image: 
    linear-gradient(#f0ebe1 1px, transparent 1px),
    linear-gradient(90deg, #f0ebe1 1px, transparent 1px);
  background-size: 20px 20px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  user-select: none;
  overflow: hidden;
}

/* ノートのリングとじ */
.notebook-spine {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 36px;
  background: #f5f1e8;
  border-right: 1px solid #e2dacd;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  align-items: center;
  z-index: 10;
}

.binder-ring {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e2dacd;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
}

/* 赤マージン線 */
.notebook-red-margin {
  position: absolute;
  left: 54px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #f1a9a0;
  z-index: 9;
}

/* ノートの上部ヘッダー罫線 */
.notebook-header-rule {
  margin-left: 60px;
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  border-bottom: 2px solid #dcd3c3;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  color: #7f8c8d;
}

/* キャンバス配置アイテム共通 */
.canvas-item {
  position: absolute;
  touch-action: none; /* Pointer Eventsでスクロール競合を抑止 */
  cursor: grab;
  transition: box-shadow 0.15s;
}

.canvas-item:active {
  cursor: grabbing;
}

.canvas-item.is-selected {
  outline: 2px dashed #3498db;
  outline-offset: 4px;
}

/* 付箋スタイル */
.canvas-item.sticky_note {
  border-radius: 2px;
  box-shadow: 2px 4px 10px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
}

.masking-tape {
  width: 50px;
  height: 14px;
  background: rgba(255, 255, 255, 0.65);
  margin: -7px auto 0 auto;
  box-shadow: 0 1px 2px rgba(0,0,0,0.1);
  border-left: 2px dashed rgba(0,0,0,0.15);
  border-right: 2px dashed rgba(0,0,0,0.15);
}

.sticky-body {
  flex: 1;
  padding: 8px 12px;
}

.sticky-textarea {
  width: 100%;
  height: 100%;
  background: transparent;
  border: none;
  resize: none;
  font-size: 13px;
  line-height: 1.5;
  color: #2d3436;
  font-family: inherit;
  cursor: text;
}

.sticky-textarea:focus {
  outline: none;
}

/* シールスタイル */
.canvas-item.sticker {
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(2px 4px 6px rgba(0, 0, 0, 0.2));
}

.sticker-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sticker-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
}

/* クイック削除ボタン */
.item-quick-remove {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #e74c3c;
  color: #ffffff;
  border: 1px solid #fff;
  font-size: 13px;
  font-weight: bold;
  line-height: 1;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.canvas-item:hover .item-quick-remove,
.canvas-item.is-selected .item-quick-remove {
  display: flex;
}

.empty-canvas-guide {
  position: absolute;
  top: 40%;
  left: 55%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: #95a5a6;
  font-size: 14px;
  pointer-events: none;
}

/* ==========================================
   サークル部室掲示板 ワークスペース
   ========================================== */
.board-workspace {
  flex: 1;
  padding: 30px;
  overflow: auto;
}

.cork-board {
  max-width: 1000px;
  margin: 0 auto;
  min-height: 700px;
  background-color: #d2a679;
  background-image: 
    radial-gradient(#bc8f5c 15%, transparent 16%),
    radial-gradient(#b88752 15%, transparent 16%);
  background-size: 30px 30px;
  background-position: 0 0, 15px 15px;
  border: 14px solid #8c5828;
  border-radius: 12px;
  box-shadow: inset 0 4px 12px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.15);
  padding: 24px;
}

.cork-header {
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(4px);
  padding: 16px 20px;
  border-radius: 8px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.cork-header h2 {
  margin: 0 0 6px 0;
  font-size: 18px;
  color: #2c3e50;
}

.cork-header p {
  margin: 0;
  font-size: 13px;
  color: #555;
}

.board-loading, .board-empty {
  text-align: center;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  margin-top: 80px;
}

.bulletin-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 24px;
}

.bulletin-card {
  position: relative;
  padding: 16px;
  border-radius: 4px;
  box-shadow: 2px 6px 14px rgba(0, 0, 0, 0.25);
  transform: rotate(-1deg);
  transition: transform 0.2s;
}

.bulletin-card:nth-child(2n) {
  transform: rotate(1.5deg);
}

.bulletin-card:hover {
  transform: scale(1.03) rotate(0deg);
  z-index: 5;
}

.pushpin {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 20px;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3));
}

.bulletin-card-header {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #555;
  margin-bottom: 8px;
  border-bottom: 1px dashed rgba(0,0,0,0.15);
  padding-bottom: 4px;
}

.author-tag {
  font-weight: 600;
}

.post-time {
  color: #777;
}

.bulletin-title {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 700;
  color: #222;
}

.bulletin-body {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #333;
  white-space: pre-wrap;
}

.bulletin-sticker {
  margin-top: 10px;
  text-align: right;
}

.bulletin-sticker img {
  width: 44px;
  height: 44px;
  object-fit: contain;
}

/* スマホ・レスポンシブ対応 */
@media (max-width: 768px) {
  .canvas-workspace {
    flex-direction: column;
  }
  .tool-palette {
    width: 100%;
    max-height: 240px;
    border-right: none;
    border-bottom: 1px solid #e0d8cb;
  }
  /* 固定論理サイズ(900px)を維持してズーム計算を単純化。
     狭い画面では横スクロール + ピンチ縮小(最小40%)で全体を見渡せる */
  .notebook-page {
    width: 900px;
    min-height: 600px;
  }
  .zoom-hint {
    display: none;
  }
}
</style>
