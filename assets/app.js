    const { createApp, ref, computed, onMounted, watch, nextTick } = Vue;

    createApp({
      setup() {
        // Flaskサーバー候補ポート (5000, 5001, 5002) を自動検出
        // 公開URL https://music.wawa-app.me/QuadTecho/ 対応:
        // サブパス配下では同オリジンの /QuadTecho/api/* を使う。
        let activeFlaskUrl = ((window.location.pathname || '').indexOf('/QuadTecho') === 0) ? '/QuadTecho' : '';
        const isFlaskOnline = ref(false);

        // ナビゲーションタブ: URLハッシュ (#canvas 等) または localStorage から復元
        const hashTab = window.location.hash ? window.location.hash.replace('#', '') : null;
        const savedTab = hashTab || localStorage.getItem('quadtecho_tab') || sessionStorage.getItem('quadtecho_tab');
        const currentTab = ref(['home', 'list', 'canvas', 'board'].includes(savedTab) ? savedTab : 'home');
        watch(currentTab, tab => {
          localStorage.setItem('quadtecho_tab', tab);
          sessionStorage.setItem('quadtecho_tab', tab);
          // タブ移動時はモバイルのポップアップメニューを閉じる
          mobileMenuOpen.value = false;
          mobilePaletteOpen.value = false;
          try {
            if (window.location.hash !== '#' + tab) {
              history.replaceState(null, '', '#' + tab);
            }
          } catch (e) { }
        }, { flush: 'sync' });

        // 手帳キャンバスへ切り替わったら初期表示を整える（モバイル=100%／デスクトップ=収まるよう縮小）
        watch(currentTab, tab => {
          if (tab === 'canvas') {
            fitInitialView();
          }
        });

        /* ハンバーガーメニューの開閉 */
        const mobileMenuOpen = ref(false);
        function toggleMobileMenu() {
          mobileMenuOpen.value = !mobileMenuOpen.value;
        }
        function openMobileTab(tab) {
          if (tab === '__board') {
            mobileMenuOpen.value = false;
            switchToBoard();
          } else {
            currentTab.value = tab;
            mobileMenuOpen.value = false;
          }
        }

        const notebookRef = ref(null);
        const deskRef = ref(null);
        const tabbarRef = ref(null);
        const toast = ref(null);

        // 手帳ステージの画面中央配置 ＆ 自由移動（パン）
        const stagePos = ref({ x: 0, y: 0 });
        const isDraggingStage = ref(false);
        const isPaletteCollapsed = ref(false);
        const mobilePaletteOpen = ref(false);
        function toggleMobilePalette() {
          mobilePaletteOpen.value = !mobilePaletteOpen.value;
          if (mobilePaletteOpen.value) isPaletteCollapsed.value = false;
        }

        // コントロールバー設定
        const paperStyle = ref('grid'); // 'grid' | 'lines' | 'blank'
        const zoomLevel = ref(1.0);
        // 「画面に収まる」倍率を100%として表示するための基準倍率
        const fitScale = ref(1.0);

        // ================= ↩ 戻る / ↪ やり直す (Undo / Redo) =================
        const historyStack = ref([]);
        const redoStack = ref([]);
        const canUndo = computed(() => historyStack.value.length > 0);
        const canRedo = computed(() => redoStack.value.length > 0);

        function recordHistory() {
          const snapshot = JSON.stringify(items.value);
          if (historyStack.value.length > 0 && historyStack.value[historyStack.value.length - 1] === snapshot) {
            return;
          }
          historyStack.value.push(snapshot);
          if (historyStack.value.length > 40) {
            historyStack.value.shift();
          }
          redoStack.value = [];
        }

        function undo() {
          if (historyStack.value.length === 0) return;
          const currentSnapshot = JSON.stringify(items.value);
          redoStack.value.push(currentSnapshot);
          const prevSnapshot = historyStack.value.pop();
          items.value = JSON.parse(prevSnapshot);
          selectedId.value = null;
          triggerToast('元に戻しました (Undo) ↩', 'info', '↩');
        }

        function redo() {
          if (redoStack.value.length === 0) return;
          const currentSnapshot = JSON.stringify(items.value);
          historyStack.value.push(currentSnapshot);
          const nextSnapshot = redoStack.value.pop();
          items.value = JSON.parse(nextSnapshot);
          selectedId.value = null;
          triggerToast('やり直しました (Redo) ↪', 'info', '↪');
        }

        function resetItemRotation(item) {
          if (!item) return;
          recordHistory();
          item.rotation = 0;
          triggerToast('傾きを水平(0°)に戻しました 🔄');
        }

        // キーボードショートカット (⌘Z / ⌘⇧Z / Ctrl+Z / Ctrl+Y)
        function handleKeyDown(e) {
          const isInput = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT';
          if (isInput) return; // テキスト入力中はブラウザネイティブのテキストUndoを妨げない

          const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
          const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

          if (isCmdOrCtrl && !e.altKey) {
            if (e.key === 'z' || e.key === 'Z') {
              e.preventDefault();
              if (e.shiftKey) {
                redo();
              } else {
                undo();
              }
            } else if (e.key === 'y' || e.key === 'Y') {
              e.preventDefault();
              redo();
            }
          }
        }

        // ユーザー状態
        const showUserModal = ref(false);
        const showSignupModal = ref(false);
        // 旧ダミーアカウントは一覧・復元・ログイン対象から除外する
        const LEGACY_DUMMY_USERNAMES = ['campuskun', 'senpai'];
        function isLegacyDummyUsername(name) {
          return LEGACY_DUMMY_USERNAMES.includes((name || '').trim().toLowerCase());
        }
        const currentUser = ref({ id: 1, username: 'guest', display_name: 'ゲスト', circle_name: '未所属' });
        const usersList = ref([
          { id: 1, username: 'guest', display_name: 'ゲスト', circle_name: '未所属' }
        ]);
        // ログイン中はゲスト・旧ダミー・テスト名義を隠し、ユニークアカウントだけ表示する。
        function isTestAccount(user) {
          if (!user) return false;
          if ((user.username || '').trim().toLowerCase() === 'guest') return true;
          if (isLegacyDummyUsername(user.username)) return true;
          const hay = `${user.username || ''} ${user.display_name || ''}`.toLowerCase();
          return hay.includes('test') || hay.includes('テスト');
        }
        const modalUsers = computed(() => {
          if (!currentUser.value || currentUser.value.username === 'guest') return usersList.value;
          return usersList.value.filter(u => u.id === currentUser.value.id || !isTestAccount(u));
        });
        const newUserForm = ref({ username: '', display_name: '', circle_name: '' });
        const loginUsername = ref('');
        const showProfileModal = ref(false);
        const profileForm = ref({ display_name: '', circle_name: '' });

        // 手帳ページ管理状態
        const pages = ref([
          { id: 1, user_id: 1, title: '4月の予定＆履修登録', page_number: 1 },
          { id: 2, user_id: 1, title: '情報工学レポート構想', page_number: 2 }
        ]);
        function restoredPageId() {
          const saved = Number(localStorage.getItem(`quadtecho_page_${currentUser.value.id}`) || sessionStorage.getItem(`quadtecho_page_${currentUser.value.id}`));
          return pages.value.some(p => p.id === saved) ? saved : (pages.value[0]?.id || 1);
        }
        const currentPageId = ref(restoredPageId());
        const isSwitchingPage = ref(false);
        function rememberPage() {
          localStorage.setItem(`quadtecho_page_${currentUser.value.id}`, String(currentPageId.value));
          sessionStorage.setItem(`quadtecho_page_${currentUser.value.id}`, String(currentPageId.value));
        }

        // アクティブなページタブがタブバー内に常に見えるよう、切り替え時に横スクロールで追従
        function scrollActiveTabIntoView() {
          const bar = tabbarRef.value;
          if (!bar || typeof bar.scrollTo !== 'function') return;
          const active = bar.querySelector('.goodnotes-tab.active');
          if (!active) return;
          const barRect = bar.getBoundingClientRect();
          const tabRect = active.getBoundingClientRect();
          const target = bar.scrollLeft + (tabRect.left - barRect.left) - (bar.clientWidth / 2) + (tabRect.width / 2);
          const clamped = Math.max(0, Math.min(target, bar.scrollWidth - bar.clientWidth));
          try { bar.scrollTo({ left: clamped, behavior: 'smooth' }); }
          catch (_) { bar.scrollLeft = clamped; }
        }
        watch(currentPageId, () => nextTick(scrollActiveTabIntoView));
        const showNewPageModal = ref(false);
        const newPageTitle = ref('');
        const showAddSheetModal = ref(false);
        const showRenameModal = ref(false);
        const renameTitle = ref('');
        const targetRenamePage = ref(null);

        // 手帳検索クエリ
        const techoSearchQuery = ref('');
        // フォルダ分類（手帳一覧の左サイドバー）
        const folders = ref([]);
        const activeFolderId = ref('all'); // 'all' | 'none' | number
        const newPageFolderId = ref('none'); // 新規手帳の保存先フォルダ選択値
        const showNewFolderModal = ref(false);
        const newFolderName = ref('');
        const showRenameFolderModal = ref(false);
        const renameFolderName = ref('');
        const targetRenameFolder = ref(null);
        const dragOverFolderId = ref(null);
        function persistFoldersLocal() {
          localStorage.setItem(`quadtecho_folders_user_${currentUser.value.id}`, JSON.stringify(folders.value));
        }
        async function loadFolders(userId) {
          if (isFlaskOnline.value) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/folders?user_id=${userId}`);
              const data = await res.json();
              if (data.success) {
                folders.value = data.folders;
                return;
              }
            } catch (_) { }
          }
          const key = `quadtecho_folders_user_${userId}`;
          const saved = localStorage.getItem(key);
          if (saved) {
            try { folders.value = JSON.parse(saved); } catch (_) { folders.value = []; }
          } else {
            folders.value = [];
          }
        }
        function folderNameById(id) {
          if (id == null) return '未分類';
          return folders.value.find(f => f.id === id)?.name || '未分類';
        }
        function getFolderPageCount(folderId) {
          if (folderId === 'all') return pages.value.length;
          if (folderId === 'none') return pages.value.filter(p => p.folder_id == null).length;
          return pages.value.filter(p => p.folder_id === folderId).length;
        }
        function selectFolder(id) { activeFolderId.value = id; }
        function openNewFolderModal() { newFolderName.value = ''; showNewFolderModal.value = true; }
        async function confirmCreateFolder() {
          const name = newFolderName.value.trim();
          if (!name) return;
          if (isFlaskOnline.value) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/folders`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.value.id, name })
              });
              const data = await res.json();
              if (data.success) {
                folders.value.push(data.folder);
                persistFoldersLocal();
                showNewFolderModal.value = false;
                activeFolderId.value = data.folder.id;
                triggerToast(`フォルダ「${name}」を作成しました 📁`);
                return;
              }
            } catch (_) { }
          }
          const folder = { id: Date.now(), user_id: currentUser.value.id, name, page_count: 0 };
          folders.value.push(folder);
          persistFoldersLocal();
          showNewFolderModal.value = false;
          activeFolderId.value = folder.id;
          triggerToast(`フォルダ「${name}」を作成しました 📁`);
        }
        function openRenameFolderModal(folder) {
          targetRenameFolder.value = folder;
          renameFolderName.value = folder?.name || '';
          showRenameFolderModal.value = true;
        }
        async function confirmRenameFolder() {
          const name = renameFolderName.value.trim();
          const target = targetRenameFolder.value;
          if (!name || !target) return;
          target.name = name;
          if (isFlaskOnline.value) {
            try {
              await fetch(`${activeFlaskUrl}/api/folders/${target.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
              });
            } catch (_) { }
          }
          persistFoldersLocal();
          showRenameFolderModal.value = false;
          triggerToast('フォルダ名を変更しました 📁');
        }
        async function deleteFolder(folder) {
          if (!confirm(`フォルダ「${folder.name}」を削除しますか？\n中の手帳は「未分類」に移動します。`)) return;
          if (isFlaskOnline.value) {
            try { await fetch(`${activeFlaskUrl}/api/folders/${folder.id}`, { method: 'DELETE' }); } catch (_) { }
          }
          pages.value.forEach(p => { if (p.folder_id === folder.id) p.folder_id = null; });
          localStorage.setItem(`quadtecho_pages_user_${currentUser.value.id}`, JSON.stringify(pages.value));
          folders.value = folders.value.filter(f => f.id !== folder.id);
          persistFoldersLocal();
          if (activeFolderId.value === folder.id) activeFolderId.value = 'all';
          triggerToast('フォルダを削除しました', 'info', '🗑️');
        }
        async function movePageToFolder(page, folderId) {
          const nextId = (folderId === 'none' || folderId === '' || folderId == null) ? null : Number(folderId);
          page.folder_id = nextId;
          if (isFlaskOnline.value) {
            try {
              await fetch(`${activeFlaskUrl}/api/pages/${page.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_id: nextId })
              });
            } catch (_) { }
          }
          localStorage.setItem(`quadtecho_pages_user_${currentUser.value.id}`, JSON.stringify(pages.value));
          triggerToast(`「${page.title}」を「${folderNameById(nextId)}」に移動しました 📁`);
        }
        function onFolderDragOver(event, folderId) {
          event.preventDefault();
          dragOverFolderId.value = folderId;
        }
        async function onFolderDrop(event, folderId) {
          event.preventDefault();
          dragOverFolderId.value = null;
          const raw = event.dataTransfer.getData('application/x-quadtecho-page');
          const id = Number(raw);
          if (!id) return;
          const page = pages.value.find(p => p.id === id);
          if (!page) return;
          const target = folderId === 'all' ? null : (folderId === 'none' ? null : folderId);
          if (folderId === 'all' && page.folder_id == null) return;
          if (page.folder_id === target && folderId !== 'all') return;
          await movePageToFolder(page, target);
        }

        // ページ詳細プレビュー生成（付箋メモ抜粋＆シール）
        function getPagePreview(pageId) {
          let pageItems = [];
          if (pageId === currentPageId.value) {
            pageItems = items.value;
          } else {
            const saved = localStorage.getItem(`quadtecho_items_page_${pageId}`);
            if (saved) {
              try { pageItems = JSON.parse(saved); } catch (_) { }
            }
          }
          const stickies = pageItems.filter(i => i.item_type === 'sticky_note' && (i.content || '').trim());
          const stickers = pageItems.filter(i => i.item_type === 'sticker' && i.image_url);
          return { stickies, stickers };
        }

        // 検索クエリで手帳一覧をリアルタイム絞り込み
        const filteredPages = computed(() => {
          const q = techoSearchQuery.value.trim().toLowerCase();
          let base = pages.value;
          if (activeFolderId.value !== 'all') {
            base = activeFolderId.value === 'none'
              ? base.filter(p => p.folder_id == null)
              : base.filter(p => p.folder_id === activeFolderId.value);
          }
          if (!q) return base;
          return base.filter(p => {
            if ((p.title || '').toLowerCase().includes(q)) return true;
            const preview = getPagePreview(p.id);
            return preview.stickies.some(s => (s.content || '').toLowerCase().includes(q));
          });
        });

        const currentPage = computed(() => pages.value.find(p => p.id === currentPageId.value) || pages.value[0] || null);

        // カラーパレット
        const stickyColors = [
          { name: 'カナリアイエロー', color: '#fff9c4' },
          { name: 'サクラピンク', color: '#ffd1dc' },
          { name: 'ミントグリーン', color: '#d4edda' },
          { name: 'スカイブルー', color: '#d1f2fd' },
          { name: 'ラベンダーパープル', color: '#e8d7ff' },
          { name: 'アプリコットオレンジ', color: '#ffe0b2' },
        ];
        const selectedColor = ref(stickyColors[0].color);
        const newStickyContent = ref('');

        // プリセットシール
        const presetStickers = [
          { name: '☕ カフェ', icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="%236f4e37"/><text x="50" y="62" font-size="44" text-anchor="middle">☕</text></svg>' },
          { name: '📝 締切厳守', icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="%23e74c3c"/><text x="50" y="44" font-size="14" fill="white" font-weight="bold" text-anchor="middle">課題締切</text><text x="50" y="74" font-size="30" text-anchor="middle">⚠️</text></svg>' },
          { name: '💯 単位取得', icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="%2327ae60"/><text x="50" y="46" font-size="15" fill="white" font-weight="bold" text-anchor="middle">秀 確定</text><text x="50" y="76" font-size="26" text-anchor="middle">💮</text></svg>' },
          { name: '🎸 音楽・部活', icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="%238e44ad"/><text x="50" y="64" font-size="44" text-anchor="middle">🎸</text></svg>' },
          { name: '💤 お休み', icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="%233498db"/><text x="50" y="46" font-size="15" fill="white" font-weight="bold" text-anchor="middle">おやすみ</text><text x="50" y="74" font-size="26" text-anchor="middle">🎉</text></svg>' },
          { name: '📚 図書館', icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="%23e67e22"/><text x="50" y="64" font-size="42" text-anchor="middle">📖</text></svg>' },
        ];

        // アイテム群
        const items = ref([]);
        const selectedId = ref(null);
        const activeItem = computed(() => items.value.find(i => i.id === selectedId.value) || null);

        const sheetPlaneRef = ref(null);
        const sheetCache = ref({});
        const workspace = ref({});
        try { workspace.value = JSON.parse(sessionStorage.getItem('quadtecho_workspace') || '{}'); } catch (_) { }
        const draggedPageId = ref(null);
        const tabDragPoint = ref({ x: 0, y: 0 });
        let suppressTabClickUntil = 0;
        // 机の重なり順：最後に触ったシートを最前面へ（currentPageId=編集対象とは分離）
        const topSheetId = ref(null);
        const draggingSheetId = ref(null);
        function touchSheet(id) { topSheetId.value = id; }
        function focusSheet(id) { touchSheet(id); }
        function sheetZ(id) {
          if (draggingSheetId.value === id) return 20;
          if (topSheetId.value === id) return 5;
          return 1;
        }
        // 新規ページを重ならない位置へ（既存の右端＋段差）
        function nextFreeSpot() {
          const placed = visibleSheets.value;
          if (!placed.length) return { x: 0, y: 0 };
          const right = Math.max(...placed.map(s => s.x));
          const row = placed.filter(s => s.x === right).length;
          return { x: right + 940, y: (row % 3) * 60 };
        }
        function clickPageTab(id) {
          if (Date.now() >= suppressTabClickUntil) {
            switchPage(id);
          }
        }
        function startTabPointerDrag(event, id) {
          if (event.button !== 0 || event.target.closest('button') || isSwitchingPage.value || imageBusy.value) return;
          const target = event.currentTarget;
          const origin = { x: event.clientX, y: event.clientY };
          try { target.setPointerCapture(event.pointerId); } catch (_) { }
          let moved = false;
          function move(e) {
            if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 8 && !moved) return;
            moved = true;
            draggedPageId.value = id;
            tabDragPoint.value = { x: e.clientX, y: e.clientY };
          }
          async function stop(e) {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', stop);
            target.removeEventListener('pointercancel', stop);
            target.removeEventListener('lostpointercapture', stop);
            try {
              if (target.hasPointerCapture && target.hasPointerCapture(event.pointerId)) {
                target.releasePointerCapture(event.pointerId);
              }
            } catch (_) { }
            draggedPageId.value = null;
            if (!moved) {
              // 移動しなかった＝通常のタブクリック
              switchPage(id);
              return;
            }
            suppressTabClickUntil = Date.now() + 400;
            if (e.type !== 'pointerup') return;
            const desk = deskRef.value.getBoundingClientRect();
            if (e.clientX < desk.left || e.clientX > desk.right || e.clientY < desk.top || e.clientY > desk.bottom) return;
            const plane = sheetPlaneRef.value.getBoundingClientRect();
            updatePlacement(id, (e.clientX - plane.left) / zoomLevel.value, (e.clientY - plane.top) / zoomLevel.value);
            await switchPage(id);
          }
          target.addEventListener('pointermove', move);
          target.addEventListener('pointerup', stop);
          target.addEventListener('pointercancel', stop);
          target.addEventListener('lostpointercapture', stop);
        }
        const imageBusy = ref(false);
        const placements = computed(() => workspace.value[currentUser.value.id] || []);
        const visibleSheets = computed(() => {
          const placed = placements.value.filter(s => pages.value.some(p => p.id === s.id));
          return placed.some(s => s.id === currentPageId.value) ? placed : [...placed, { id: currentPageId.value, x: 0, y: 0 }];
        });
        function persistWorkspace() { sessionStorage.setItem('quadtecho_workspace', JSON.stringify(workspace.value)); }
        function updatePlacement(id, x, y) {
          const all = visibleSheets.value.map(s => ({ ...s }));
          const sheet = all.find(s => s.id === id);
          if (sheet) Object.assign(sheet, { x, y }); else all.push({ id, x, y });
          workspace.value[currentUser.value.id] = all;
          persistWorkspace();
          touchSheet(id);
        }
        function sheetItems(id) {
          if (id === currentPageId.value) return items.value;
          if (sheetCache.value[id]) return sheetCache.value[id];
          try { return JSON.parse(localStorage.getItem(`quadtecho_items_page_${id}`) || '[]'); } catch (_) { return []; }
        }
        function clampZoom(value) {
          const number = Number(value);
          if (!Number.isFinite(number)) return zoomLevel.value;
          return Math.min(2, Math.max(.3, number));
        }
        function setZoom(value) {
          zoomLevel.value = clampZoom(value);
        }
        function resizeImage(item, width) {
          const ratio = item.height / item.width;
          item.width = Math.min(600, 660 / ratio, Math.max(50, Number(width)));
          item.height = Math.round(item.width * ratio);
          item.x = Math.max(20, Math.min(item.x, 900 - item.width));
          item.y = Math.max(70, Math.min(item.y, 760 - item.height));
        }
        function startPageTabDrag(event, id) {
          if (isSwitchingPage.value || imageBusy.value) { event.preventDefault(); return; }
          draggedPageId.value = id;
          event.dataTransfer.setData('application/x-quadtecho-page', String(id));
          event.dataTransfer.effectAllowed = 'copy';
        }
        function onDeskDragOver(event) {
          event.dataTransfer.dropEffect = 'copy';
        }
        async function onDeskDrop(event) {
          const id = Number(event.dataTransfer.getData('application/x-quadtecho-page'));
          if (id && pages.value.some(p => p.id === id)) {
            if (isSwitchingPage.value || imageBusy.value) return;
            const rect = sheetPlaneRef.value.getBoundingClientRect();
            updatePlacement(id, (event.clientX - rect.left) / zoomLevel.value, (event.clientY - rect.top) / zoomLevel.value);
            await switchPage(id);
          } else {
            await importImages(event.dataTransfer.files);
          }
          draggedPageId.value = null;
        }
        async function dropImageOnSheet(event, id) {
          if (event.dataTransfer.getData('application/x-quadtecho-page')) { await onDeskDrop(event); return; }
          if (isSwitchingPage.value || imageBusy.value) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const point = { x: (event.clientX - rect.left) / zoomLevel.value, y: (event.clientY - rect.top) / zoomLevel.value };
          await switchPage(id);
          await importImages(event.dataTransfer.files, point);
        }
        async function placePageBeside(id) {
          if (isSwitchingPage.value || imageBusy.value) return;
          const spot = nextFreeSpot();
          updatePlacement(id, spot.x, spot.y);
          await switchPage(id);
          arrangeSheets();
        }
        function openAddSheetModal() {
          showAddSheetModal.value = true;
        }
        function addSheetFromList(id) {
          if (isSwitchingPage.value || imageBusy.value) return;
          if (!pages.value.some(p => p.id === id)) return;
          if (isSheetOpen(id)) {
            triggerToast('その手帳はすでに机に並んでいます', 'info', '📑');
            return;
          }
          const spot = nextFreeSpot();
          updatePlacement(id, spot.x, spot.y);
          triggerToast('机に並べました', 'success', '📚');
        }
        function arrangeSheets() {
          workspace.value[currentUser.value.id] = visibleSheets.value.map((s, i) => ({ id: s.id, x: i * 940, y: 0 }));
          const width = visibleSheets.value.length * 940 - 40;
          const deskWidth = deskRef.value?.clientWidth || 1200;
          const deskHeight = deskRef.value?.clientHeight || 900;
          setZoom(Math.floor(Math.min(1, (deskWidth - 110) / width, (deskHeight - 180) / 760) * 20) / 20);
          fitScale.value = zoomLevel.value;
          isPaletteCollapsed.value = true;
          stagePos.value = { x: -(width - 900) * zoomLevel.value / 2, y: 0 };
          persistWorkspace();
        }

        function isMobileDevice() {
          try {
            const fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)');
            const coarse = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)');
            const nav = (typeof navigator !== 'undefined') ? navigator : {};
            const hasTouch = ('ontouchstart' in window) || (nav.maxTouchPoints > 0) || (nav.msMaxTouchPoints > 0);
            return (coarse && coarse.matches) || (hasTouch && (!fine || !fine.matches));
          } catch (_) {
            return false;
          }
        }

        // 初期表示：ページ全体が画面内に収まるよう縮小・中央寄せ（その倍率を100%とする）
        function fitInitialView() {
          if (!pages.value.length) return;
          nextTick(() => {
            const desk = deskRef.value;
            if (!desk) return;
            const deskW = desk.clientWidth || 1200;
            const deskH = desk.clientHeight || 800;
            if (deskW <= 0 || deskH <= 0) return;

            // 開いているページ全体の外接矩形を画面内に収める（等倍を上限に縮小）
            const sheets = visibleSheets.value;
            if (!sheets.length) return;
            const sheetW = 940, sheetH = 800;
            const minX = Math.min(...sheets.map(s => s.x));
            const minY = Math.min(...sheets.map(s => s.y));
            const totalW = Math.max(1, Math.max(...sheets.map(s => s.x + sheetW)) - minX);
            const totalH = Math.max(1, Math.max(...sheets.map(s => s.y + sheetH)) - minY);
            const marginX = isMobileDevice() ? 32 : 48;
            const marginY = isMobileDevice() ? 48 : 64;
            const fit = Math.min(1, (deskW - marginX) / totalW, (deskH - marginY) / totalH);
            const scale = Math.floor(clampZoom(fit) * 20) / 20;
            fitScale.value = scale;
            zoomLevel.value = scale;
            stagePos.value = { x: 0, y: 0 };

            // 実測してページ全体がデスク中央に来るよう補正
            const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn) => setTimeout(fn, 30);
            raf(() => {
              const deskEl = deskRef.value;
              if (!deskEl) return;
              const sheetEls = deskEl.querySelectorAll('.desk-sheet');
              if (!sheetEls.length) return;
              let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
              sheetEls.forEach(el => {
                const r = el.getBoundingClientRect();
                minL = Math.min(minL, r.left); minT = Math.min(minT, r.top);
                maxR = Math.max(maxR, r.right); maxB = Math.max(maxB, r.bottom);
              });
              const dr = deskEl.getBoundingClientRect();
              if (minL === Infinity || !dr.width) return;
              stagePos.value = {
                x: Math.round(stagePos.value.x + (dr.left + dr.width / 2) - (minL + (maxR - minL) / 2)),
                y: Math.round(stagePos.value.y + (dr.top + dr.height / 2) - (minT + (maxB - minT) / 2)),
              };
            });
          });
        }
        async function closeSheet(id) {
          if (isSwitchingPage.value || imageBusy.value) return;
          const open = visibleSheets.value.some(s => s.id === id);
          if (!open) return;
          const remaining = visibleSheets.value.filter(s => s.id !== id);
          if (!remaining.length) {
            // 全部閉じたら手帳一覧へ（ページ自体は削除されない）
            workspace.value[currentUser.value.id] = [];
            persistWorkspace();
            topSheetId.value = null;
            currentTab.value = 'list';
            triggerToast('タブをすべて閉じました（ページは削除されていません）', 'info', '📚');
            return;
          }
          if (id === currentPageId.value) await switchPage(remaining[0].id);
          if (topSheetId.value === id) topSheetId.value = remaining[remaining.length - 1].id;
          workspace.value[currentUser.value.id] = remaining;
          persistWorkspace();
          triggerToast('タブを閉じました（ページは削除されていません）', 'info', '📑');
        }
        function isSheetOpen(id) {
          return visibleSheets.value.some(s => s.id === id);
        }
        // タブバー表示用：机に並んでいる手帳だけ（配置順）
        const openTabs = computed(() =>
          visibleSheets.value
            .map(s => pages.value.find(p => p.id === s.id))
            .filter(Boolean)
        );
        function startSheetDrag(event, sheet) {
          if (event.button !== 0 || event.target.closest('button')) return;
          event.preventDefault();
          const start = { x: event.clientX, y: event.clientY, sheetX: sheet.x, sheetY: sheet.y, zoom: zoomLevel.value };
          const target = event.currentTarget;
          draggingSheetId.value = sheet.id;
          touchSheet(sheet.id);
          try { target.setPointerCapture(event.pointerId); } catch (_) { }
          function move(e) {
            updatePlacement(sheet.id, Math.round(start.sheetX + (e.clientX - start.x) / start.zoom), Math.round(start.sheetY + (e.clientY - start.y) / start.zoom));
          }
          function stop() {
            draggingSheetId.value = null;
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', stop);
            target.removeEventListener('pointercancel', stop);
            target.removeEventListener('lostpointercapture', stop);
          }
          target.addEventListener('pointermove', move);
          target.addEventListener('pointerup', stop);
          target.addEventListener('pointercancel', stop);
          target.addEventListener('lostpointercapture', stop);
        }

        // 共有掲示板
        const boardPosts = ref([]);
        const showNewBoardModal = ref(false);
        const newBoardTitle = ref('');
        const newBoardContent = ref('');

        // ホーム用サマリー計算
        const totalItemCount = computed(() => {
          let count = items.value.length;
          pages.value.forEach(p => {
            if (p.id !== currentPageId.value) {
              const saved = localStorage.getItem(`quadtecho_items_page_${p.id}`);
              if (saved) {
                try { count += JSON.parse(saved).length; } catch (_) { }
              }
            }
          });
          return count;
        });

        function getPageItemCount(pageId) {
          if (pageId === currentPageId.value) return items.value.length;
          const saved = localStorage.getItem(`quadtecho_items_page_${pageId}`);
          if (saved) {
            try { return JSON.parse(saved).length; } catch (_) { }
          }
          return 0;
        }

        const recentStickyNotes = computed(() => {
          const res = [];
          items.value.forEach(it => {
            if (it.item_type === 'sticky_note' && it.content) {
              res.push({
                id: it.id,
                page_id: currentPageId.value,
                page_title: currentPage.value?.title || '手帳ノート',
                content: it.content,
                bg_color: it.bg_color
              });
            }
          });
          return res.slice(0, 3);
        });

        function openTechoFromHome(pageId) {
          switchPage(pageId);
          currentTab.value = 'canvas';
        }

        function triggerToast(text, type = 'success', icon = '✅') {
          toast.value = { text, type, icon };
          setTimeout(() => { if (toast.value?.text === text) toast.value = null; }, 3200);
        }

        // ================= 手帳ステージの自由移動（ドラッグ・パン ＆ ピンチズーム） =================
        // ポインタIDごとのアクティブな座標を保持（1本指＝パン、2本指＝ピンチズーム）
        const activePointers = new Map();
        let stageStartPanX = 0, stageStartPanY = 0;
        let stageOrigX = 0, stageOrigY = 0;
        let stageStartDistance = 0;
        let stageStartZoom = 1;
        let pinchMidX = 0, pinchMidY = 0;
        let pinchStageOrigX = 0, pinchStageOrigY = 0;
        let pinchMoved = false;

        function startStageDrag(e) {
          // テキスト入力欄、ボタン、ドラッグアイテム、インデックスタブ等の操作時はステージ移動を発火させない
          if (e.target.closest('.techo-draggable-item') ||
            e.target.closest('textarea') ||
            e.target.closest('input') ||
            e.target.closest('select') ||
            e.target.closest('.stationery-palette') ||
            e.target.closest('.mobile-toolbar') ||
            e.target.closest('.page-index-container') ||
            (e.target.closest('button') && !e.target.closest('.stage-move-handle'))) {
            return;
          }

          if (e.pointerType === 'mouse' && e.button !== 0) return;

          activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

          if (e.pointerType !== 'mouse') {
            // デスク全体でジェスチャーを受け取る（ブラウザのスクロール/ピンチを抑止）
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { }
          } else if (e.currentTarget?.setPointerCapture && e.pointerId !== undefined) {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { }
          }

          if (activePointers.size === 1) {
            isDraggingStage.value = true;
            const p = activePointers.get(e.pointerId);
            stageStartPanX = p.x; stageStartPanY = p.y;
            stageOrigX = stagePos.value.x; stageOrigY = stagePos.value.y;
            pinchMoved = false;
          } else if (activePointers.size === 2) {
            pinchMoved = false;
            const pts = [...activePointers.values()];
            stageStartDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
            pinchMidX = (pts[0].x + pts[1].x) / 2;
            pinchMidY = (pts[0].y + pts[1].y) / 2;
            stageStartZoom = zoomLevel.value;
            pinchStageOrigX = stagePos.value.x;
            pinchStageOrigY = stagePos.value.y;
          }

          window.addEventListener('pointermove', onStageDrag);
          window.addEventListener('pointerup', stopStageDrag);
          window.addEventListener('pointercancel', stopStageDrag);
        }

        function onStageDrag(e) {
          if (!activePointers.has(e.pointerId)) return;
          activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

          if (activePointers.size === 1 && !pinchMoved) {
            // 1本指 or マウス：パン
            if (!isDraggingStage.value) return;
            stagePos.value.x = Math.round(stageOrigX + (e.clientX - stageStartPanX));
            stagePos.value.y = Math.round(stageOrigY + (e.clientY - stageStartPanY));
          } else if (activePointers.size === 2) {
            // 2本指：ピンチズーム。ピンチ中点の下にあるコンテンツを追従させる
            const pts = [...activePointers.values()];
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
            const newZoom = clampZoom(stageStartZoom * (dist / stageStartDistance));
            const midX = (pts[0].x + pts[1].x) / 2;
            const midY = (pts[0].y + pts[1].y) / 2;
            pinchMoved = true;
            if (newZoom !== zoomLevel.value) {
              setZoomAt(newZoom, midX, midY);
            } else {
              // ズーム変化がなくても、2本指の中点移動はパンとして反映
              stagePos.value.x = Math.round(pinchStageOrigX + (midX - pinchMidX));
              stagePos.value.y = Math.round(pinchStageOrigY + (midY - pinchMidY));
            }
          }
        }

        function stopStageDrag(e) {
          activePointers.delete(e.pointerId);

          if (activePointers.size === 0) {
            isDraggingStage.value = false;
            window.removeEventListener('pointermove', onStageDrag);
            window.removeEventListener('pointerup', stopStageDrag);
            window.removeEventListener('pointercancel', stopStageDrag);
          } else if (activePointers.size === 1 && pinchMoved) {
            // 2本指→1本指に戻った：残った指でパンを継続
            const p = [...activePointers.values()][0];
            stageStartPanX = p.x; stageStartPanY = p.y;
            stageOrigX = stagePos.value.x; stageOrigY = stagePos.value.y;
            isDraggingStage.value = true;
          }
        }

        function resetStagePos() {
          stagePos.value = { x: 0, y: 0 };
          triggerToast('手帳の位置を画面中央に戻しました！🎯', 'info', '🎯');
        }

        // ==== Safari トラックパッドピンチ（gesture イベント）対応 ====
        let safariPinchStarted = false;
        let safariPinchStartZoom = 1;
        let safariPinchAnchorX = 0, safariPinchAnchorY = 0;
        let lastGesturePinchAt = 0;

        function onGestureStart(e) {
          // gesturechange は非標準・preventDefault 必須
          try { e.preventDefault(); } catch (_) { }
          const desk = deskRef.value;
          if (!desk) return;
          safariPinchStarted = true;
          safariPinchStartZoom = zoomLevel.value;
          const rect = desk.getBoundingClientRect();
          // 画面中央をズーム基準点に（Safari gesture には座標が無いため）
          safariPinchAnchorX = rect.left + rect.width / 2;
          safariPinchAnchorY = rect.top + rect.height / 2;
        }

        function onGestureChange(e) {
          if (!safariPinchStarted) return;
          try { e.preventDefault(); } catch (_) { }
          const currentScale = (typeof e.scale === 'number' && e.scale > 0) ? e.scale : 1;
          const next = clampZoom(safariPinchStartZoom * currentScale);
          if (next !== zoomLevel.value) {
            setZoomAt(next, safariPinchAnchorX, safariPinchAnchorY);
          }
          lastGesturePinchAt = Date.now();
        }

        function onGestureEnd(e) {
          if (!safariPinchStarted) return;
          try { e.preventDefault(); } catch (_) { }
          safariPinchStarted = false;
          lastGesturePinchAt = Date.now();
        }

        // ================= トラックパッドジェスチャー（ホイールでパン／cmd(ctrl)+ホイールでズーム） =================
        function onDeskWheel(e) {
          // テキスト入力欄・パレット上のホイールは通常スクロールに任せる
          const wheelTarget = (e.target && typeof e.target.closest === 'function') ? e.target : null;
          if (wheelTarget && (wheelTarget.closest('textarea') || wheelTarget.closest('.stationery-palette'))) return;

          // トラックパッド／ホイール自前処理なので、ブラウザ標準のスクロール・ページズームを抑止
          if (e.cancelable !== false) { try { e.preventDefault(); } catch (_) { } }

          // deltaMode をピクセル単位へ正規化（0=pixel, 1=line, 2=page）
          const lineHeight = 16, pageHeight = 800;
          let dx = e.deltaX || 0;
          let dy = e.deltaY || 0;
          if (e.deltaMode === 1) { dx *= lineHeight; dy *= lineHeight; }
          else if (e.deltaMode === 2) { dx *= pageHeight; dy *= pageHeight; }

          if (e.ctrlKey || e.metaKey) {
            // Safari ではトラックパッドピンチが gesture イベントと同時に
            // ctrlKey 付き wheel としても届くため、進行中の gesture ピンチは無視して二重ズームを防ぐ
            if (safariPinchStarted || (Date.now() - lastGesturePinchAt < 120)) return;

            // ピンチ（cmd/ctrl + ホイール）→ 拡大縮小。マウス座標を基準に追従
            // 微小なdeltaでも蓄積できるよう丸めず連続値で保持（表示・スライダーは別途丸め）
            const factor = Math.exp(-dy * 0.0018);
            const next = clampZoom(zoomLevel.value * factor);
            if (next !== zoomLevel.value) {
              setZoomAt(next, e.clientX, e.clientY);
            }
          } else {
            // 2本指スクロール／トラックパッドパン → ステージ移動
            stagePos.value.x = Math.round(stagePos.value.x - dx);
            stagePos.value.y = Math.round(stagePos.value.y - dy);
          }
        }

        // 指定した画面座標を基準にズーム（ピンチ／トラックパッド共通）
        function setZoomAt(newZoom, screenX, screenY) {
          const prevZoom = zoomLevel.value;
          const planeRect = sheetPlaneRef.value?.getBoundingClientRect();
          let originX = screenX, originY = screenY;
          if (planeRect) {
            originX = planeRect.left + planeRect.width / 2;
            originY = planeRect.top;
          }
          const ratio = newZoom / prevZoom;
          // transform-origin(top center) 固定アンカーを基準に、screenX/Y 下のコンテンツを保つ
          stagePos.value.x = Math.round(screenX - originX + stagePos.value.x - (screenX - originX) * ratio);
          stagePos.value.y = Math.round(screenY - originY + stagePos.value.y - (screenY - originY) * ratio);
          zoomLevel.value = newZoom;
        }

        // ================= ドラッグ＆ドロップ（付箋・シール） =================
        let draggingItem = null;
        let startClientX = 0, startClientY = 0;
        let origX = 0, origY = 0;
        let dragInitialSnapshot = '';

        function startDrag(e, item) {
          if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
          draggingItem = item;
          selectedId.value = item.id;
          dragInitialSnapshot = JSON.stringify(items.value);
          // レイヤーバグ修正：ドラッグ開始で勝手に最前面化しない（レイヤー操作は前面/背面ボタンに一本化）
          startClientX = e.clientX; startClientY = e.clientY;
          origX = item.x; origY = item.y;
          if (e.currentTarget?.setPointerCapture) {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { }
          }
          window.addEventListener('pointermove', onDragging);
          window.addEventListener('pointerup', stopDrag);
          window.addEventListener('pointercancel', stopDrag);
        }

        function onDragging(e) {
          if (!draggingItem) return;
          const dx = (e.clientX - startClientX) / zoomLevel.value;
          const dy = (e.clientY - startClientY) / zoomLevel.value;

          let nx = Math.round(origX + dx);
          let ny = Math.round(origY + dy);
          if (notebookRef.value) {
            const rect = notebookRef.value.getBoundingClientRect();
            nx = Math.max(20, Math.min(nx, (rect.width / zoomLevel.value) - (draggingItem.width || 140)));
            ny = Math.max(70, Math.min(ny, (rect.height / zoomLevel.value) - (draggingItem.height || 140)));
          }
          draggingItem.x = nx;
          draggingItem.y = ny;
        }

        function stopDrag() {
          if (draggingItem && dragInitialSnapshot) {
            const currentSnap = JSON.stringify(items.value);
            if (currentSnap !== dragInitialSnapshot) {
              historyStack.value.push(dragInitialSnapshot);
              if (historyStack.value.length > 40) historyStack.value.shift();
              redoStack.value = [];
            }
          }
          draggingItem = null;
          window.removeEventListener('pointermove', onDragging);
          window.removeEventListener('pointerup', stopDrag);
          window.removeEventListener('pointercancel', stopDrag);
        }

        function getNextId() {
          return items.value.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1;
        }

        // ================= コントロールバー操作 =================
        function quickDropSticky(color) {
          recordHistory();
          const newItem = {
            id: getNextId(),
            page_id: currentPageId.value,
            user_id: currentUser.value.id,
            item_type: 'sticky_note',
            content: '',
            image_url: null,
            x: 340 + (items.value.length % 4) * 15,
            y: 200 + (items.value.length % 4) * 15,
            width: 170,
            height: 140,
            rotation: Math.floor(Math.random() * 9) - 4,
            z_index: items.value.length + 1,
            bg_color: color
          };
          items.value.push(newItem);
          selectedId.value = newItem.id;
          triggerToast('付箋を手帳中央に配置しました！');
        }

        // z_index の暴走（増え続ける）を防ぐ：ページ内だけ1始まりに詰め直す
        function normalizeZ(pageId) {
          const pid = pageId ?? currentPageId.value;
          const list = items.value.filter(i => (i.page_id ?? currentPageId.value) === pid)
            .sort((a, b) => (a.z_index || 0) - (b.z_index || 0));
          list.forEach((it, idx) => { it.z_index = idx + 1; });
        }

        function bringToFront(item) {
          recordHistory();
          const peers = items.value.filter(i => (i.page_id ?? currentPageId.value) === (item.page_id ?? currentPageId.value));
          const maxZ = peers.reduce((m, it) => Math.max(m, it.z_index || 0), 0);
          item.z_index = maxZ + 1;
          normalizeZ(item.page_id);
        }

        function sendToBack(item) {
          recordHistory();
          const peers = items.value.filter(i => (i.page_id ?? currentPageId.value) === (item.page_id ?? currentPageId.value));
          const minZ = peers.reduce((m, it) => Math.min(m, it.z_index || 1), 1);
          item.z_index = Math.max(1, minZ - 1);
          normalizeZ(item.page_id);
        }

        function duplicateItem(item) {
          recordHistory();
          const newItem = {
            ...JSON.parse(JSON.stringify(item)),
            id: getNextId(),
            x: item.x + 25,
            y: item.y + 25,
            z_index: items.value.length + 1
          };
          items.value.push(newItem);
          selectedId.value = newItem.id;
          triggerToast('付箋を複製しました！📋');
        }

        function addSticky() {
          recordHistory();
          const content = newStickyContent.value.trim() || '新しい付箋メモ';
          const newItem = {
            id: getNextId(),
            page_id: currentPageId.value,
            user_id: currentUser.value.id,
            item_type: 'sticky_note',
            content,
            image_url: null,
            x: 80 + (items.value.length % 5) * 20,
            y: 80 + (items.value.length % 5) * 20,
            width: 170,
            height: 140,
            rotation: Math.floor(Math.random() * 11) - 5,
            z_index: items.value.length + 1,
            bg_color: selectedColor.value
          };
          items.value.push(newItem);
          selectedId.value = newItem.id;
          newStickyContent.value = '';
          triggerToast('付箋を貼りました！');
        }

        function addPreset(preset) {
          recordHistory();
          const newItem = {
            id: getNextId(),
            page_id: currentPageId.value,
            user_id: currentUser.value.id,
            item_type: 'sticker',
            content: preset.name,
            image_url: preset.icon,
            x: 100 + (items.value.length % 4) * 30,
            y: 110 + (items.value.length % 4) * 30,
            width: 110,
            height: 110,
            rotation: Math.floor(Math.random() * 15) - 7,
            z_index: items.value.length + 1,
            bg_color: 'transparent'
          };
          items.value.push(newItem);
          selectedId.value = newItem.id;
          triggerToast(`シール「${preset.name}」を貼りました！`);
        }

        async function handleImageFile(event) {
          const files = [...(event.target.files || [])];
          event.target.value = '';
          await importImages(files);
        }
        async function importImages(files, point = { x: 120, y: 120 }) {
          if (imageBusy.value || isSwitchingPage.value || !files?.length) return;
          imageBusy.value = true;
          const pageId = currentPageId.value;
          const userId = currentUser.value.id;
          let added = 0;
          try {
            for (const file of Array.from(files)) {
              if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
                triggerToast('PNG・JPEG・WebP・GIFの10MB以下の画像を選んでください', 'error');
                continue;
              }
              const url = URL.createObjectURL(file);
              let picture;
              try {
                picture = await new Promise((resolve, reject) => {
                  const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('画像を読み込めません')); img.src = url;
                });
                const canvas = document.createElement('canvas');
                const factor = Math.min(1, 1400 / Math.max(picture.naturalWidth, picture.naturalHeight));
                canvas.width = Math.max(1, Math.round(picture.naturalWidth * factor));
                canvas.height = Math.max(1, Math.round(picture.naturalHeight * factor));
                canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
                let imageUrl = canvas.toDataURL('image/webp', .85);
                if (isFlaskOnline.value) {
                  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .85));
                  const form = new FormData(); form.append('image', blob, 'photo.webp');
                  const response = await fetch(`${activeFlaskUrl}/api/upload`, { method: 'POST', body: form });
                  const data = await response.json();
                  if (!response.ok || !data.success) throw new Error('画像の保存に失敗しました');
                  imageUrl = `${activeFlaskUrl}${data.url}`;
                }
                if (currentPageId.value !== pageId || currentUser.value.id !== userId) throw new Error('ページが切り替わりました。画像をもう一度追加してください');
                if (!added) recordHistory();
                const scale = Math.min(1, 320 / picture.naturalWidth, 320 / picture.naturalHeight);
                const width = Math.round(picture.naturalWidth * scale), height = Math.round(picture.naturalHeight * scale);
                const item = {
                  id: getNextId(), page_id: pageId, user_id: userId, item_type: 'sticker', content: file.name,
                  image_url: imageUrl, x: Math.max(20, Math.min(point.x + added * 20, 900 - width)),
                  y: Math.max(70, Math.min(point.y + added * 20, 760 - height)), width, height,
                  rotation: 0, z_index: items.value.reduce((z, i) => Math.max(z, i.z_index || 0), 0) + 1, bg_color: 'transparent'
                };
                items.value.push(item); selectedId.value = item.id; added++;
              } finally { URL.revokeObjectURL(url); }
            }
            if (added) { await saveCurrentPage(false); triggerToast(`${added}枚の画像を貼りました。ドラッグで移動できます。`); }
          } catch (error) { triggerToast(error.message || '画像を追加できませんでした', 'error'); }
          finally { imageBusy.value = false; }
        }
        function pasteImage(event) {
          if (currentTab.value !== 'canvas' || event.target.closest('input, textarea, [contenteditable="true"]')) return;
          const files = Array.from(event.clipboardData?.files || []);
          if (files.length) { event.preventDefault(); importImages(files); }
        }

        function removeItem(id) {
          recordHistory();
          items.value = items.value.filter(i => i.id !== id);
          if (selectedId.value === id) selectedId.value = null;
          triggerToast('アイテムを剥がしました', 'info', '🗑️');
        }

        // ================= 手帳ページ管理 =================
        async function loadPages(userId) {
          await loadFolders(userId);
          if (isFlaskOnline.value) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/pages?user_id=${userId}`);
              const data = await res.json();
              if (data.success && data.pages.length > 0) {
                pages.value = data.pages;
                currentPageId.value = restoredPageId();
                await loadPageItems(currentPageId.value);
                return;
              }
            } catch (_) { }
          }

          const key = `quadtecho_pages_user_${userId}`;
          const saved = localStorage.getItem(key);
          if (saved) {
            pages.value = JSON.parse(saved);
          } else {
            pages.value = [
              { id: 1, user_id: userId, title: '4月の予定＆履修登録', page_number: 1 },
              { id: 2, user_id: userId, title: '情報工学レポート構想', page_number: 2 }
            ];
          }
          currentPageId.value = restoredPageId() || 1;
          loadPageItems(currentPageId.value);
        }

        async function loadPageItems(pageId) {
          selectedId.value = null;
          if (isFlaskOnline.value) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/pages/${pageId}/items`);
              const data = await res.json();
              if (data.success) {
                items.value = data.items;
                return;
              }
            } catch (_) { }
          }

          const key = `quadtecho_items_page_${pageId}`;
          const saved = localStorage.getItem(key);
          if (saved) {
            items.value = JSON.parse(saved);
          } else if (pageId === 1) {
            items.value = [
              { id: 1, page_id: 1, user_id: currentUser.value.id, item_type: 'sticky_note', content: '火曜2限：レポート提出！\n図書館で本を探す 📚', x: 80, y: 80, width: 190, height: 140, rotation: -3, z_index: 1, bg_color: '#fff9c4' },
              { id: 2, page_id: 1, user_id: currentUser.value.id, item_type: 'sticky_note', content: '週末ミーティング 18:00〜\n議題：発表準備について 🎸', x: 320, y: 100, width: 190, height: 140, rotation: 2, z_index: 2, bg_color: '#d1f2fd' }
            ];
          } else {
            items.value = [];
          }
        }

        async function switchPage(targetPageId) {
          if (imageBusy.value || isSwitchingPage.value || !pages.value.some(p => p.id === targetPageId)) return;
          currentTab.value = 'canvas';
          touchSheet(targetPageId);
          if (targetPageId === currentPageId.value) return;
          isSwitchingPage.value = true;
          try {
            const prevPageId = currentPageId.value;
            // 直前の手帳内容をローカルキャッシュへ即座に退避
            sheetCache.value[prevPageId] = JSON.parse(JSON.stringify(items.value));
            localStorage.setItem(`quadtecho_items_page_${prevPageId}`, JSON.stringify(items.value));
            localStorage.setItem(`quadtecho_pages_user_${currentUser.value.id}`, JSON.stringify(pages.value));

            // サーバー保存はバックグラウンドで行い、画面遷移のブロックやLive Server自動リロードを回避
            if (isFlaskOnline.value) {
              fetch(`${activeFlaskUrl}/api/pages/${prevPageId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.value.id, items: items.value })
              }).catch(() => { });
            }

            // 移動先ページをセット＆永続化
            currentPageId.value = targetPageId;
            rememberPage();

            await loadPageItems(targetPageId);
            historyStack.value = [];
            redoStack.value = [];
          } finally {
            isSwitchingPage.value = false;
          }
        }

        function openNewPageModal() {
          newPageTitle.value = '';
          newPageFolderId.value = activeFolderId.value === 'all' || activeFolderId.value === 'none' ? 'none' : activeFolderId.value;
          showNewPageModal.value = true;
        }

        async function confirmCreatePage() {
          if (isSwitchingPage.value || imageBusy.value) return;
          const arrangeNewPage = currentTab.value === 'canvas';
          const title = newPageTitle.value.trim() || `新しい手帳 (${pages.value.length + 1})`;
          const folderId = (newPageFolderId.value === 'none' || newPageFolderId.value === '' || newPageFolderId.value == null) ? null : Number(newPageFolderId.value);
          if (isFlaskOnline.value) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/pages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.value.id, title, folder_id: folderId })
              });
              const data = await res.json();
              if (data.success) {
                pages.value.push(data.page);
                showNewPageModal.value = false;
                if (arrangeNewPage) { const spot = nextFreeSpot(); updatePlacement(data.page.id, spot.x, spot.y); }
                await switchPage(data.page.id);
                if (arrangeNewPage) arrangeSheets();
                currentTab.value = 'canvas';
                triggerToast(`新しい手帳「${title}」を作成しました！`);
                return;
              }
            } catch (_) { }
          }

          const newId = Date.now();
          const newPage = {
            id: newId,
            user_id: currentUser.value.id,
            title,
            page_number: pages.value.length + 1,
            folder_id: folderId
          };
          pages.value.push(newPage);
          localStorage.setItem(`quadtecho_pages_user_${currentUser.value.id}`, JSON.stringify(pages.value));
          showNewPageModal.value = false;
          if (arrangeNewPage) { const spot = nextFreeSpot(); updatePlacement(newId, spot.x, spot.y); }
          await switchPage(newId);
          if (arrangeNewPage) arrangeSheets();
          currentTab.value = 'canvas';
          triggerToast(`新しい手帳「${title}」を作成しました！`);
        }

        function openTechoFromList(pageId) {
          switchPage(pageId);
          currentTab.value = 'canvas';
        }

        async function duplicatePage(page) {
          let sourceItems = [];
          if (page.id === currentPageId.value) {
            sourceItems = JSON.parse(JSON.stringify(items.value));
          } else {
            const saved = localStorage.getItem(`quadtecho_items_page_${page.id}`);
            if (saved) {
              try { sourceItems = JSON.parse(saved); } catch (_) { }
            }
          }

          const newTitle = `${page.title} (コピー)`;
          if (isFlaskOnline.value) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/pages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.value.id, title: newTitle, folder_id: page.folder_id ?? null })
              });
              const data = await res.json();
              if (data.success) {
                const newPage = data.page;
                pages.value.push(newPage);
                localStorage.setItem(`quadtecho_items_page_${newPage.id}`, JSON.stringify(sourceItems));
                if (sourceItems.length > 0) {
                  await fetch(`${activeFlaskUrl}/api/pages/${newPage.id}/items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: currentUser.value.id, items: sourceItems })
                  });
                }
                triggerToast(`「${newTitle}」を手帳一覧に複製しました！📋`);
                return;
              }
            } catch (_) { }
          }

          const newId = Date.now();
          const newPage = {
            id: newId,
            user_id: currentUser.value.id,
            title: newTitle,
            page_number: pages.value.length + 1,
            folder_id: page.folder_id ?? null
          };
          pages.value.push(newPage);
          localStorage.setItem(`quadtecho_pages_user_${currentUser.value.id}`, JSON.stringify(pages.value));
          localStorage.setItem(`quadtecho_items_page_${newId}`, JSON.stringify(sourceItems));
          triggerToast(`「${newTitle}」を手帳一覧に複製しました！📋`);
        }

        function openRenameModal(page) {
          targetRenamePage.value = page || currentPage.value;
          renameTitle.value = targetRenamePage.value?.title || '';
          showRenameModal.value = true;
        }

        async function confirmRenamePage() {
          if (!renameTitle.value.trim() || !targetRenamePage.value) return;
          const target = targetRenamePage.value;
          target.title = renameTitle.value.trim();

          if (isFlaskOnline.value) {
            try {
              await fetch(`${activeFlaskUrl}/api/pages/${target.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: target.title })
              });
            } catch (_) { }
          }

          localStorage.setItem(`quadtecho_pages_user_${currentUser.value.id}`, JSON.stringify(pages.value));
          showRenameModal.value = false;
          triggerToast('手帳タイトルを変更しました');
        }

        async function deleteCurrentPage(pageId) {
          if (imageBusy.value || isSwitchingPage.value) return;
          if (pages.value.length <= 1) {
            triggerToast('最後の手帳は削除できません', 'error');
            return;
          }
          if (!confirm('この手帳ノートと中のメモを完全に削除しますか？（元に戻せません）')) return;

          if (isFlaskOnline.value) {
            try {
              await fetch(`${activeFlaskUrl}/api/pages/${pageId}`, { method: 'DELETE' });
            } catch (_) { }
          }

          pages.value = pages.value.filter(p => p.id !== pageId);
          localStorage.setItem(`quadtecho_pages_user_${currentUser.value.id}`, JSON.stringify(pages.value));
          localStorage.removeItem(`quadtecho_items_page_${pageId}`);
          delete sheetCache.value[pageId];

          // 机の上からも取り除く（残り配置だけを保存）
          try {
            const kept = (workspace.value[currentUser.value.id] || []).filter(s => s.id !== pageId);
            workspace.value[currentUser.value.id] = kept;
            persistWorkspace();
          } catch (_) { }
          if (topSheetId.value === pageId) topSheetId.value = null;
          if (targetRenamePage.value?.id === pageId) {
            targetRenamePage.value = null;
            showRenameModal.value = false;
          }

          const nextId = pages.value[0].id;
          currentPageId.value = nextId;
          await loadPageItems(nextId);
          triggerToast('手帳を削除しました', 'info');
        }

        async function deleteRenamingPage() {
          if (!targetRenamePage.value) return;
          await deleteCurrentPage(targetRenamePage.value.id);
        }

        async function saveCurrentPage(showNotice = true) {
          const pageId = currentPageId.value;
          rememberPage();
          sheetCache.value[pageId] = JSON.parse(JSON.stringify(items.value));
          localStorage.setItem(`quadtecho_items_page_${pageId}`, JSON.stringify(items.value));
          localStorage.setItem(`quadtecho_pages_user_${currentUser.value.id}`, JSON.stringify(pages.value));

          if (isFlaskOnline.value) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/pages/${pageId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: currentUser.value.id, items: items.value })
              });
              const data = await res.json();
              if (data.success && showNotice) {
                triggerToast('Flaskサーバーに保存しました！');
                return;
              }
            } catch (_) { }
          }

          if (showNotice) {
            triggerToast('現在のページを保存しました！');
          }
        }

        // ================= ユーザー切り替え =================
        async function selectUser(user) {
          if (imageBusy.value || isSwitchingPage.value) return;
          if (user.id === currentUser.value.id) {
            showUserModal.value = false;
            showSignupModal.value = false;
            return;
          }
          await saveCurrentPage(false);
          currentUser.value = user;
          localStorage.setItem('quadtecho_active_user', JSON.stringify(user));
          await loadPages(user.id);
          showUserModal.value = false;
          showSignupModal.value = false;
          triggerToast(`「${user.display_name}」の手帳に切り替えました`);
        }

        async function loginByUsername() {
          const username = (loginUsername.value || '').trim().toLowerCase();
          if (!username) {
            triggerToast('ユーザーIDを入力してください', 'error');
            return;
          }
          if (isLegacyDummyUsername(username)) {
            triggerToast('そのアカウントは旧ダミーのため利用できません。ゲストでご利用ください', 'error');
            return;
          }
          const found = usersList.value.find(u => (u.username || '').toLowerCase() === username);
          if (found) {
            loginUsername.value = '';
            await selectUser(found);
            return;
          }
          if (isFlaskOnline.value) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/users`);
              const data = await res.json();
              if (data.success && Array.isArray(data.users)) {
                const match = data.users.find(u => (u.username || '').toLowerCase() === username);
                if (match) {
                  if (!usersList.value.some(u => u.id === match.id)) usersList.value.push(match);
                  loginUsername.value = '';
                  await selectUser(match);
                  return;
                }
              }
            } catch (_) { }
          }
          triggerToast(`ユーザー「${username}」が見つかりません。アカウント作成から登録してください`, 'error');
        }

        // ================= ログアウト =================
        // 保存済みセッションを破棄し、ゲストに戻してログイン画面を開く。
        async function logout() {
          if (imageBusy.value || isSwitchingPage.value) return;
          await saveCurrentPage(false);
          try { localStorage.removeItem('quadtecho_active_user'); } catch (_) { }
          const guest = usersList.value.find(u => u.username === 'guest') || usersList.value[0] || null;
          if (guest) {
            currentUser.value = guest;
            await loadPages(guest.id);
          }
          loginUsername.value = '';
          showSignupModal.value = false;
          showUserModal.value = true;
          triggerToast('ログアウトしました');
        }

        function openSignupModal() {
          newUserForm.value = { username: '', display_name: '', circle_name: '' };
          showUserModal.value = false;
          showSignupModal.value = true;
        }

        function backToLoginModal() {
          showSignupModal.value = false;
          showUserModal.value = true;
        }

        // ================= プロフィール編集 =================
        function openProfileModal() {
          profileForm.value = {
            display_name: currentUser.value?.display_name || '',
            circle_name: currentUser.value?.circle_name || ''
          };
          showUserModal.value = false;
          showSignupModal.value = false;
          showProfileModal.value = true;
        }

        function applyProfileLocally(displayName, circleName) {
          const updated = {
            ...currentUser.value,
            display_name: displayName,
            circle_name: circleName
          };
          currentUser.value = updated;
          const idx = usersList.value.findIndex(u => u.id === updated.id);
          if (idx >= 0) usersList.value[idx] = { ...usersList.value[idx], ...updated };
          try {
            localStorage.setItem('quadtecho_active_user', JSON.stringify(updated));
            localStorage.setItem('quadtecho_users', JSON.stringify(usersList.value));
          } catch (_) { }
        }

        async function saveProfile() {
          const displayName = (profileForm.value.display_name || '').trim();
          const circleName = (profileForm.value.circle_name || '').trim() || '未所属';
          if (!displayName) {
            triggerToast('ニックネームを入力してください', 'error');
            return;
          }
          if (isFlaskOnline.value && currentUser.value?.id != null) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/users/${currentUser.value.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name: displayName, circle_name: circleName })
              });
              const data = await res.json();
              if (res.ok && data.success && data.user) {
                currentUser.value = data.user;
                const idx = usersList.value.findIndex(u => u.id === data.user.id);
                if (idx >= 0) usersList.value[idx] = data.user;
                try { localStorage.setItem('quadtecho_active_user', JSON.stringify(data.user)); } catch (_) { }
                showProfileModal.value = false;
                triggerToast('プロフィールを更新しました');
                return;
              }
            } catch (_) { }
          }
          // サーバー未接続時やサーバー側に存在しないIDの場合はローカル更新
          applyProfileLocally(displayName, circleName);
          showProfileModal.value = false;
          triggerToast('プロフィールを更新しました');
        }

        async function createNewUser() {
          const { username, display_name, circle_name } = newUserForm.value;
          if (!username.trim()) {
            triggerToast('ユーザーIDを入力してください', 'error');
            return;
          }

          if (isFlaskOnline.value) {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/users/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  username: username.trim(),
                  display_name: display_name.trim() || username.trim(),
                  circle_name: circle_name.trim() || '未所属'
                })
              });
              const data = await res.json();
              if (data.success) {
                usersList.value.push(data.user);
                await selectUser(data.user);
                newUserForm.value = { username: '', display_name: '', circle_name: '' };
                return;
              }
            } catch (_) { }
          }

          const newId = Date.now();
          const userObj = {
            id: newId,
            username: username.trim(),
            display_name: display_name.trim() || username.trim(),
            circle_name: circle_name.trim() || '未所属'
          };
          usersList.value.push(userObj);
          localStorage.setItem('quadtecho_users', JSON.stringify(usersList.value));
          await selectUser(userObj);
          newUserForm.value = { username: '', display_name: '', circle_name: '' };
        }

        // ================= 掲示板 (SNSコミュニティ) =================
        const boardSearch = ref('');
        const boardFilter = ref('all');
        const boardSort = ref('new');
        const boardBusy = ref(false);
        const boardLoading = ref(false);
        const boardError = ref('');
        const expandedPost = ref(null);
        const replyDrafts = ref({});
        const selectedBoardSticker = ref(null);
        const boardShareMode = ref('talk');
        const sharePageId = ref(null);
        const shareStickerName = ref('');
        const shareStickerKey = ref(null);
        const shareStickerPreview = ref(null);
        const shareStickerFileDataUrl = ref(null);
        const myStickers = ref([]);
        try { myStickers.value = JSON.parse(localStorage.getItem('quadtecho_my_stickers') || '[]'); } catch (_) { myStickers.value = []; }

        const boardTopicTags = ['#今日のひとこと', '#サークル連絡', '#勉強・レポート', '#手帳シェア', '#質問・相談', '#つぶやき'];
        const boardPresetStickers = [
          { emoji: '🌟', label: 'キラキラ' },
          { emoji: '💖', label: 'ハート' },
          { emoji: '☕', label: 'カフェ' },
          { emoji: '📚', label: '勉強' },
          { emoji: '✏️', label: 'メモ' },
          { emoji: '🎸', label: '音楽' },
          { emoji: '🎉', label: '祝' },
          { emoji: '🐱', label: 'ねこ' }
        ];

        function insertTag(tag) {
          if (newBoardContent.value.includes(tag)) return;
          newBoardContent.value = newBoardContent.value ? `${newBoardContent.value} ${tag}` : tag;
        }

        function toggleBoardSticker(emoji) {
          selectedBoardSticker.value = selectedBoardSticker.value === emoji ? null : emoji;
        }

        function setShareMode(mode) {
          boardShareMode.value = mode;
          if (mode === 'techo_page') {
            if (!sharePageId.value && pages.value.length) sharePageId.value = currentPageId.value || pages.value[0].id;
            applySharePageDefaults();
          }
          if (mode === 'sticker') applyShareStickerDefaults();
        }
        function getPageItemsForShare(pageId) {
          if (pageId === currentPageId.value) return items.value || [];
          const raw = localStorage.getItem(`quadtecho_items_page_${pageId}`);
          if (raw) { try { return JSON.parse(raw); } catch (_) { } }
          return [];
        }
        function persistMyStickers() {
          try { localStorage.setItem('quadtecho_my_stickers', JSON.stringify(myStickers.value)); } catch (_) { }
        }
        function resolveBoardImage(url) {
          if (!url) return '';
          if (url.startsWith('data:') || url.startsWith('http') || url.startsWith('blob:')) return url;
          if (url.startsWith('/')) return (isFlaskOnline.value ? activeFlaskUrl : '') + url;
          return url;
        }
        const sharePagePreview = computed(() => {
          const pg = pages.value.find(pp => pp.id === sharePageId.value);
          if (!pg) return null;
          const list = getPageItemsForShare(pg.id) || [];
          return {
            id: pg.id, title: pg.title, page_number: pg.page_number,
            notes: list.filter(i => i && i.item_type === 'sticky_note' && i.content).map(i => String(i.content).slice(0, 120)),
            stickers: list.filter(i => i && i.item_type === 'sticker' && i.image_url).slice(0, 6)
          };
        });
        const shareStickerChoices = computed(() => {
          const base = (presetStickers || []).map((st, idx) => ({ key: 'preset-' + idx, name: st.name, icon: st.icon, category: 'プリセット' }));
          const mine = (myStickers.value || []).map((st, idx) => ({ key: 'mine-' + idx, name: st.name, icon: st.icon, category: 'マイシール' }));
          return [...mine, ...base];
        });
        function pickShareSticker(st) {
          shareStickerKey.value = st.key;
          shareStickerPreview.value = st.icon;
          shareStickerFileDataUrl.value = null;
          if (!shareStickerName.value) shareStickerName.value = st.name;
        }
        function applySharePageDefaults() {
          if (!sharePageId.value && pages.value.length) sharePageId.value = currentPageId.value || pages.value[0].id;
          const pg = pages.value.find(pp => pp.id === sharePageId.value);
          if (pg && !newBoardTitle.value) newBoardTitle.value = `【手帳シェア】${pg.title}`;
          if (pg && (!newBoardContent.value || !newBoardContent.value.includes('手帳'))) {
            newBoardContent.value = `手帳ページ「${pg.title}」をシェアします！📒✨\n手帳から取り込んで使ってね。\n\n#手帳シェア`;
          }
        }
        function applyShareStickerDefaults() {
          if (!shareStickerName.value) shareStickerName.value = '';
          if (!shareStickerPreview.value && shareStickerChoices.value.length) pickShareSticker(shareStickerChoices.value[0]);
          if (!newBoardTitle.value) newBoardTitle.value = '【シールシェア】オリジナルシール';
          if (!newBoardContent.value || !newBoardContent.value.includes('シール')) {
            newBoardContent.value = `オリジナルシール「${shareStickerName.value || shareStickerChoices.value[0]?.name || ''}」をシェアします！🎨\n「マイシールに追加」ボタンで手帳に取り込めます。\n\n#シールシェア`;
          }
        }
        function handleShareStickerFile(event) {
          const file = event.target.files && event.target.files[0];
          event.target.value = '';
          if (!file) return;
          if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
            triggerToast('PNG・JPEG・WebP・GIFの10MB以下を選んでください', 'error');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            shareStickerPreview.value = reader.result;
            shareStickerFileDataUrl.value = reader.result;
            shareStickerKey.value = 'upload';
            if (!shareStickerName.value) shareStickerName.value = file.name.replace(/\.[^.]+$/, '') || 'オリジナルシール';
            triggerToast('シール画像をセットしました！');
          };
          reader.readAsDataURL(file);
        }
        function shareCurrentTecho() {
          setShareMode('techo_page');
          sharePageId.value = currentPageId.value;
          applySharePageDefaults();
          const curPage = pages.value.find(p => p.id === currentPageId.value);
          const pageTitle = curPage ? curPage.title : '手帳ノート';
          newBoardTitle.value = `【手帳シェア】${pageTitle}`;
          const stickies = (items.value || []).filter(it => it && it.item_type === 'sticky_note' && it.content);
          let snippet = '';
          if (stickies.length > 0) {
            snippet = stickies.slice(0, 3).map(s => `📌 ${s.content.replace(/\n/g, ' ')}`).join('\n');
          } else {
            snippet = '📌 予定とメモをまとめました！';
          }
          newBoardContent.value = `今日の手帳（PAGE ${curPage?.page_number || 1}: ${pageTitle}）をシェアします！📒✨\n\n${snippet}\n\n#手帳シェア`;
          selectedBoardSticker.value = '🌟';
          triggerToast('開いている手帳の内容を投稿欄にセットしました！');
        }

        const boardFilters = [
          { id: 'all', label: '☷ すべての話題' },
          { id: 'mine', label: '👤 自分の投稿' },
          { id: 'liked', label: '❤️ リアクションした投稿' }
        ];

        function totalReactions(p) {
          return (p.likes?.length || 0) + (p.claps?.length || 0) + (p.ideas?.length || 0) + (p.coffees?.length || 0);
        }

        const filteredBoardPosts = computed(() => {
          const q = boardSearch.value.trim().toLowerCase();
          return boardPosts.value.filter(p => {
            const hasMyReaction = (p.likes?.includes(currentUser.value.id)) ||
              ((p.claps || []).includes(currentUser.value.id)) ||
              ((p.ideas || []).includes(currentUser.value.id)) ||
              ((p.coffees || []).includes(currentUser.value.id));
            if (boardFilter.value === 'mine' && p.user_id !== currentUser.value.id) return false;
            if (boardFilter.value === 'liked' && !hasMyReaction) return false;
            if (!q) return true;
            return [p.title, p.content, p.author_name, p.circle_name, p.sticker_url].join(' ').toLowerCase().includes(q);
          }).slice().sort((a, b) => {
            if (boardSort.value === 'popular') {
              return totalReactions(b) - totalReactions(a) || b.id - a.id;
            }
            return (b.is_pinned || 0) - (a.is_pinned || 0) || b.id - a.id;
          });
        });

        function boardTime(post) {
          if (!post.created_at) return post.time || '最近';
          const raw = post.created_at;
          const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
          return Number.isNaN(date.getTime()) ? '最近' : date.toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        function cacheBoard() {
          localStorage.setItem('quadtecho_board', JSON.stringify(boardPosts.value));
        }

        async function boardRequest(path, method = 'GET', payload) {
          const res = await fetch(`${activeFlaskUrl}/api/board${path}`, {
            method, headers: { 'Content-Type': 'application/json' },
            ...(payload ? { body: JSON.stringify(payload) } : {})
          });
          const data = await res.json();
          if (!res.ok || !data.success) throw new Error(data.error || '掲示板に接続できませんでした');
          return data;
        }

        function normalizeBoardPost(raw) {
          const post = { ...raw };
          if (!post.post_type) post.post_type = 'talk';
          for (const k of ['shared_page_data', 'shared_sticker_data']) {
            const v = post[k];
            if (typeof v === 'string' && v.trim()) {
              try { post[k] = JSON.parse(v); } catch (_) { post[k] = null; }
            } else if (!v) post[k] = null;
          }
          return post;
        }
        function buildSharedPageData(pageId) {
          const pg = pages.value.find(pp => pp.id === pageId);
          if (!pg) return null;
          const list = getPageItemsForShare(pageId) || [];
          return {
            title: pg.title, page_number: pg.page_number,
            notes: list.filter(i => i && i.item_type === 'sticky_note' && i.content).map(i => String(i.content).slice(0, 500)),
            stickers: list.filter(i => i && i.item_type === 'sticker' && i.image_url).map(i => ({ content: i.content || '', image_url: i.image_url }))
          };
        }
        function buildSharedStickerData() {
          const name = (shareStickerName.value || '').trim() || 'オリジナルシール';
          let icon = shareStickerPreview.value;
          let category = 'オリジナル';
          const found = (shareStickerChoices.value || []).find(c => c.key === shareStickerKey.value);
          if (found) { if (!icon) icon = found.icon; category = found.category || category; }
          if (!icon) return null;
          return { name: name.slice(0, 40), icon, image_url: icon, category };
        }
        async function fetchBoard() {
          if (boardLoading.value) return;
          boardLoading.value = true;
          boardError.value = '';
          try {
            let posts;
            if (isFlaskOnline.value) {
              posts = (await boardRequest('')).posts;
            } else {
              posts = JSON.parse(localStorage.getItem('quadtecho_board') || '[]');
            }
            boardPosts.value = posts.map(p => ({
              ...normalizeBoardPost(p),
              likes: p.likes || [],
              claps: p.claps || [],
              ideas: p.ideas || [],
              coffees: p.coffees || [],
              comments: p.comments || []
            }));
            if (!isFlaskOnline.value) cacheBoard();
          } catch (error) {
            boardError.value = '読み込みに失敗しました。接続を確認して再試行してください。';
          } finally { boardLoading.value = false; }
        }

        function switchToBoard() {
          currentTab.value = 'board';
          fetchBoard();
        }

        async function submitBoardPost() {
          if (boardBusy.value || boardLoading.value) return;
          const title = newBoardTitle.value.trim(), content = newBoardContent.value.trim();
          if (!title || !content || title.length > 100 || content.length > 2000) {
            triggerToast('タイトルは100文字、本文は2000文字以内で入力してください', 'error');
            return;
          }
          const mode = boardShareMode.value || 'talk';
          let shared_page_data = null;
          let shared_sticker_data = null;
          if (mode === 'techo_page') {
            if (!sharePageId.value) { triggerToast('共有する手帳ページを選んでください', 'error'); return; }
            shared_page_data = buildSharedPageData(sharePageId.value);
            if (!shared_page_data) { triggerToast('手帳ページが見つかりません', 'error'); return; }
          }
          if (mode === 'sticker') {
            shared_sticker_data = buildSharedStickerData();
            if (!shared_sticker_data) { triggerToast('共有するシールを選んでください', 'error'); return; }
            if (!shareStickerName.value.trim()) shareStickerName.value = shared_sticker_data.name;
          }
          boardBusy.value = true;
          const payload = {
            user_id: currentUser.value.id,
            title,
            content,
            bg_color: '#e0eee3',
            sticker_url: selectedBoardSticker.value || null,
            post_type: mode,
            shared_page_data,
            shared_sticker_data
          };
          try {
            if (isFlaskOnline.value) {
              await boardRequest('', 'POST', payload);
              await fetchBoard();
            } else {
              boardPosts.value.unshift({
                ...payload,
                id: Date.now(),
                author_name: currentUser.value.display_name,
                circle_name: currentUser.value.circle_name,
                created_at: new Date().toISOString(),
                likes: [],
                claps: [],
                ideas: [],
                coffees: [],
                comments: []
              });
              cacheBoard();
            }
            newBoardTitle.value = '';
            newBoardContent.value = '';
            selectedBoardSticker.value = null;
            shareStickerName.value = '';
            shareStickerPreview.value = null;
            shareStickerFileDataUrl.value = null;
            shareStickerKey.value = null;
            boardShareMode.value = 'talk';
            showNewBoardModal.value = false;
            boardFilter.value = 'all';
            boardSearch.value = '';
            boardSort.value = 'new';
            triggerToast('投稿しました！');
          } catch (error) {
            triggerToast('投稿できませんでした。内容を残しています。再試行してください。', 'error');
          } finally { boardBusy.value = false; }
        }

        async function importSharedPage(post) {
          if (boardBusy.value || !currentUser.value) return;
          const data = post.shared_page_data;
          if (!data) { triggerToast('共有データが見つかりません', 'error'); return; }
          boardBusy.value = true;
          try {
            const title = `${data.title || '共有手帳'} (共有から取り込み)`.slice(0, 100);
            let newPage = null;
            if (isFlaskOnline.value) {
              try {
                const res = await fetch(`${activeFlaskUrl}/api/pages`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ user_id: currentUser.value.id, title })
                });
                const r = await res.json();
                if (r.success) newPage = r.page;
              } catch (_) { }
            }
            if (!newPage) {
              newPage = { id: Date.now(), user_id: currentUser.value.id, title, page_number: pages.value.length + 1 };
              pages.value.push(newPage);
              localStorage.setItem(`quadtecho_pages_user_${currentUser.value.id}`, JSON.stringify(pages.value));
            } else { pages.value.push(newPage); }
            const srcNotes = Array.isArray(data.notes) ? data.notes : [];
            const srcStickers = Array.isArray(data.stickers) ? data.stickers : [];
            const cloned = [];
            srcNotes.forEach((t, i) => cloned.push({
              id: 0, page_id: newPage.id, user_id: currentUser.value.id,
              item_type: 'sticky_note', content: String(t).slice(0, 500), image_url: null,
              x: 80 + (i % 2) * 240, y: 90 + Math.floor(i / 2) * 200,
              width: 190, height: 140, rotation: i % 2 ? 1.5 : -2, z_index: cloned.length + 1, bg_color: stickyColors[i % stickyColors.length]
            }));
            srcStickers.forEach((st) => cloned.push({
              id: 0, page_id: newPage.id, user_id: currentUser.value.id,
              item_type: 'sticker', content: st.content || '', image_url: st.image_url,
              x: 120 + (cloned.length % 3) * 160, y: 110 + Math.floor(cloned.length / 3) * 150,
              width: 110, height: 110, rotation: 0, z_index: cloned.length + 1, bg_color: 'transparent'
            }));
            if (isFlaskOnline.value) {
              try {
                await fetch(`${activeFlaskUrl}/api/pages/${newPage.id}/items`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ user_id: currentUser.value.id, items: cloned })
                });
              } catch (_) { }
            }
            localStorage.setItem(`quadtecho_items_page_${newPage.id}`, JSON.stringify(cloned));
            sheetCache.value[newPage.id] = JSON.parse(JSON.stringify(cloned));
            await switchPage(newPage.id);
            currentTab.value = 'canvas';
            triggerToast(`手帳「${title}」を取り込みました！`);
          } finally { boardBusy.value = false; }
        }
        async function importSharedSticker(post) {
          if (!currentUser.value) return;
          const data = post.shared_sticker_data;
          if (!data || !(data.icon || data.image_url)) { triggerToast('シールデータが見つかりません', 'error'); return; }
          const icon = data.icon || data.image_url;
          const name = (data.name || 'オリジナルシール').slice(0, 40);
          if ((myStickers.value || []).some(st => st.icon === icon)) {
            triggerToast('このシールは追加済みです');
            return;
          }
          myStickers.value.push({ name, icon, category: data.category || 'オリジナル', from_post: post.id });
          persistMyStickers();
          if (!presetStickers.some(st => st.icon === icon)) presetStickers.push({ name, icon });
          triggerToast(`「${name}」をマイシールに追加しました！手帳で貼れます`);
        }
        async function toggleReaction(post, reactionType) {
          if (boardBusy.value || boardLoading.value) return;
          boardBusy.value = true;
          const userId = currentUser.value.id;
          if (!post[reactionType]) post[reactionType] = [];
          const hasReacted = post[reactionType].includes(userId);
          post[reactionType] = hasReacted
            ? post[reactionType].filter(id => id !== userId)
            : [...post[reactionType], userId];

          try {
            if (reactionType === 'likes' && isFlaskOnline.value) {
              await boardRequest(`/${post.id}/likes`, 'PUT', { user_id: userId, liked: !hasReacted });
            }
            cacheBoard();
          } catch (_) {
          } finally { boardBusy.value = false; }
        }

        const toggleBoardLike = (p) => toggleReaction(p, 'likes');

        async function confirmDeleteBoardPost(post) {
          if (!confirm(`「${post.title}」を削除してもよろしいですか？`)) return;
          boardBusy.value = true;
          try {
            if (isFlaskOnline.value) {
              await boardRequest(`/${post.id}?user_id=${currentUser.value.id}`, 'DELETE');
            }
            boardPosts.value = boardPosts.value.filter(p => p.id !== post.id);
            cacheBoard();
            triggerToast('投稿を削除しました');
          } catch (e) {
            triggerToast('削除できませんでした', 'error');
          } finally {
            boardBusy.value = false;
          }
        }

        async function submitBoardComment(post) {
          const content = (replyDrafts.value[post.id] || '').trim();
          if (boardBusy.value || boardLoading.value || !content || content.length > 500) return;
          boardBusy.value = true;
          const user = { ...currentUser.value };
          try {
            let id = Date.now();
            if (isFlaskOnline.value) id = (await boardRequest(`/${post.id}/comments`, 'POST', { user_id: user.id, content })).comment_id;
            if (!post.comments) post.comments = [];
            post.comments.push({ id, user_id: user.id, author_name: user.display_name, content, created_at: new Date().toISOString() });
            if (!isFlaskOnline.value) cacheBoard();
            replyDrafts.value[post.id] = '';
            triggerToast('返信しました！');
          } catch (error) { triggerToast('返信できませんでした。再試行してください。', 'error'); }
          finally { boardBusy.value = false; }
        }

        // ================= 初期化 ＆ ポート自動探査 =================
        onMounted(async () => {
          // タッチデバイスの判定フォールバック：CSSメディアクエリが効かない環境でも
          // html.is-mobile クラスでモバイルUIを強制する（幅・解像度に関係なく）
          const applyDeviceClass = () => {
            const root = document.documentElement;
            if (root && root.classList) {
              root.classList.toggle('is-mobile', !!isMobileDevice());
            }
          };
          applyDeviceClass();
          window.addEventListener('resize', applyDeviceClass);
          window.addEventListener('orientationchange', applyDeviceClass);

          // キーボードショートカット登録 (⌘Z, ⌘⇧Z, Ctrl+Z, Ctrl+Y)
          window.addEventListener('keydown', handleKeyDown);
          window.addEventListener('paste', pasteImage);

          // トラックパッド／マウスホイール：preventDefault を確実に効かせるため
          // 非passive リスナーとして明示的に登録（テンプレートの @wheel は passive になり得る）
          if (deskRef.value && typeof deskRef.value.addEventListener === 'function') {
            deskRef.value.addEventListener('wheel', onDeskWheel, { passive: false });
          }

          // Safari のトラックパッドピンチ（gesture イベント）対応
          // gesture はデスク要素と document の両方に登録して確実に捕捉
          const bindGesture = (target) => {
            if (!target || typeof target.addEventListener !== 'function') return;
            // preventDefault を効かせるため非passiveで登録
            target.addEventListener('gesturestart', onGestureStart, { passive: false });
            target.addEventListener('gesturechange', onGestureChange, { passive: false });
            target.addEventListener('gestureend', onGestureEnd, { passive: false });
          };
          if (deskRef.value) bindGesture(deskRef.value);
          if (typeof document !== 'undefined') bindGesture(document);

          if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            try {
              const res = await fetch(`${activeFlaskUrl}/api/health`);
              isFlaskOnline.value = res.ok;
            } catch (_) { }
          } else {
            // 5000, 5001, 5002 ポートを自動探査
            const candidatePorts = [5000, 5001, 5002, 5003];
            for (const p of candidatePorts) {
              try {
                const res = await fetch(`http://127.0.0.1:${p}/api/health`);
                if (res.ok) {
                  // QuadTecho 実DBを持つポートを優先 (service名で判定)
                  try {
                    const h = await res.clone().json();
                    if (h && h.service && h.service !== 'QuadTecho Flask API') continue;
                  } catch (_) { }
                  activeFlaskUrl = `http://127.0.0.1:${p}`;
                  isFlaskOnline.value = true;
                  break;
                }
              } catch (_) { }
            }
          }

          if (isFlaskOnline.value) {
            try {
              const usersRes = await fetch(`${activeFlaskUrl}/api/users`);
              const usersData = await usersRes.json();
              if (usersData.success && Array.isArray(usersData.users)) {
                const liveUsers = usersData.users.filter(u => !isLegacyDummyUsername(u.username));
                if (liveUsers.length > 0) {
                  usersList.value = liveUsers;
                }
              }
            } catch (_) { }
          }

          // 保存済みアカウントが一覧に存在する場合のみ復元する。
          // 旧ダミー（みやび先輩など）が残っていた場合は破棄してゲストに戻す。
          let restoredUser = null;
          try {
            const savedUser = localStorage.getItem('quadtecho_active_user');
            if (savedUser) restoredUser = JSON.parse(savedUser);
          } catch (_) { restoredUser = null; }
          const matchedUser = (restoredUser && restoredUser.id != null && !isLegacyDummyUsername(restoredUser.username))
            ? usersList.value.find(u => u.id === restoredUser.id)
            : null;
          if (matchedUser) {
            currentUser.value = matchedUser;
          } else {
            if (usersList.value.length === 0) {
              usersList.value = [{ id: 1, username: 'guest', display_name: 'ゲスト', circle_name: '未所属' }];
            }
            currentUser.value = usersList.value[0];
            try { localStorage.setItem('quadtecho_active_user', JSON.stringify(currentUser.value)); } catch (_) { }
          }
          await loadPages(currentUser.value.id);
          if (topSheetId.value == null) topSheetId.value = currentPageId.value;
          fetchBoard();

          // キャンバスを直接開いた場合も、初期表示を整える
          if (currentTab.value === 'canvas') {
            fitInitialView();
          }
        });

        return {
          sheetPlaneRef, visibleSheets, topSheetId, draggingSheetId, sheetZ, touchSheet, focusSheet, nextFreeSpot,
          sheetItems, setZoom, resizeImage, imageBusy, draggedPageId,
          tabDragPoint, startTabPointerDrag, clickPageTab, startPageTabDrag, onDeskDragOver, onDeskDrop, dropImageOnSheet, placePageBeside, openAddSheetModal, addSheetFromList, showAddSheetModal, arrangeSheets, closeSheet, isSheetOpen, openTabs, startSheetDrag,
          importImages, pasteImage,
          isSwitchingPage, isFlaskOnline, currentTab, notebookRef, deskRef, tabbarRef, toast,
          mobileMenuOpen, toggleMobileMenu, openMobileTab,
          stagePos, isDraggingStage, isPaletteCollapsed, mobilePaletteOpen, toggleMobilePalette, startStageDrag, resetStagePos,
          onDeskWheel, onGestureStart, onGestureChange, onGestureEnd,
          undo, redo, canUndo, canRedo, recordHistory, resetItemRotation,
          paperStyle, zoomLevel, fitScale, quickDropSticky, bringToFront, sendToBack, duplicateItem,
          showUserModal, showSignupModal, showProfileModal, profileForm, currentUser, usersList, modalUsers, newUserForm, loginUsername, selectUser, loginByUsername, logout, openProfileModal, saveProfile, createNewUser, openSignupModal, backToLoginModal,
          pages, currentPageId, currentPage, showNewPageModal, newPageTitle,
          showRenameModal, renameTitle, switchPage, openNewPageModal, confirmCreatePage,
          openRenameModal, confirmRenamePage, deleteCurrentPage, deleteRenamingPage, saveCurrentPage,
          openTechoFromHome, openTechoFromList, duplicatePage,
          totalItemCount, getPageItemCount, getPagePreview, recentStickyNotes,
          techoSearchQuery, filteredPages,
          folders, activeFolderId, newPageFolderId, showNewFolderModal, newFolderName,
          showRenameFolderModal, renameFolderName, dragOverFolderId,
          selectFolder, openNewFolderModal, confirmCreateFolder, openRenameFolderModal, confirmRenameFolder, deleteFolder,
          folderNameById, getFolderPageCount, movePageToFolder, onFolderDragOver, onFolderDrop,
          stickyColors, selectedColor, newStickyContent, presetStickers,
          items, selectedId, activeItem, startDrag, addSticky, addPreset,
          handleImageFile, removeItem,
          boardPosts, showNewBoardModal, newBoardTitle, newBoardContent,
          switchToBoard, submitBoardPost, boardSearch, boardFilter, boardSort, boardBusy, boardLoading, boardError,
          expandedPost, replyDrafts, boardFilters, filteredBoardPosts, boardTime, fetchBoard, toggleBoardLike, submitBoardComment,
          boardTopicTags, boardPresetStickers, selectedBoardSticker, insertTag, toggleBoardSticker, shareCurrentTecho, toggleReaction, confirmDeleteBoardPost,
          boardShareMode, sharePageId, shareStickerName, shareStickerKey, shareStickerPreview, sharePagePreview, shareStickerChoices, setShareMode, pickShareSticker, handleShareStickerFile, resolveBoardImage, importSharedPage, importSharedSticker, myStickers,
          boardShareMode, sharePageId, shareStickerName, shareStickerKey, shareStickerPreview, sharePagePreview, shareStickerChoices, setShareMode, pickShareSticker, handleShareStickerFile, resolveBoardImage, importSharedPage, importSharedSticker, myStickers
        };
      }
    }).mount('#app');
