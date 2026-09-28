const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Vue = require('../frontend/node_modules/vue');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/app.js'), 'utf8');
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)) }; };
const localStorage = storage(), sessionStorage = storage();
let mounted, state;
function boot() {
  vm.runInNewContext(source, {
    Vue: { ...Vue, onMounted: fn => { mounted = fn; }, createApp: options => ({ config: {}, mount() { state = options.setup(); } }) },
    localStorage, sessionStorage, window: { addEventListener() {}, removeEventListener() {}, location: { hash: '' } },
    history: { replaceState() {} },
    fetch: async () => { throw Error('offline'); }, setTimeout: () => 0, confirm: () => true, console,
    URL: { createObjectURL: () => 'blob:test-image', revokeObjectURL() {} },
    Image: class { naturalWidth = 480; naturalHeight = 240; set src(value) { Promise.resolve().then(() => this.onload()); } },
    document: { createElement: () => ({ width:0, height:0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/webp;base64,dGVzdA==' }) }
  });
}
// 履歴（pushState/popstate）を検証するための独立ブート
function bootWithHistory(initialHash) {  const calls = [];
  const listeners = new Map();
  const location = { hash: initialHash || '' };
  const history = {
    replaceState(state, _title, url) { calls.push({ type: 'replace', state }); if (url) location.hash = url; },
    pushState(state, _title, url) { calls.push({ type: 'push', state }); if (url) location.hash = url; },
    back() { calls.push({ type: 'back' }); }
  };
  let localMounted, localState;
  vm.runInNewContext(source, {
    Vue: { ...Vue, onMounted: fn => { localMounted = fn; }, createApp: options => ({ config: {}, mount() { localState = options.setup(); } }) },
    localStorage: storage(), sessionStorage: storage(),
    window: {
      addEventListener(kind, fn) { listeners.set(kind, fn); },
      removeEventListener(kind) { listeners.delete(kind); },
      location
    },
    history,
    fetch: async () => { throw Error('offline'); }, setTimeout: () => 0, confirm: () => true, console,
    URL: { createObjectURL: () => 'blob:test-image', revokeObjectURL() {} },
    Image: class { naturalWidth = 480; naturalHeight = 240; set src(value) { Promise.resolve().then(() => this.onload()); } },
    document: { createElement: () => ({ width:0, height:0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/webp;base64,dGVzdA==' }) }
  });
  return { calls, listeners, location, state: () => localState, mounted: localMounted };
}
// Flask接続検出を検証するための独立ブート（fetchを差し替え可能）
function bootWithFetch(fetchImpl) {
  let localMounted, localState;
  vm.runInNewContext(source, {
    Vue: { ...Vue, onMounted: fn => { localMounted = fn; }, createApp: options => ({ config: {}, mount() { localState = options.setup(); } }) },
    localStorage: storage(), sessionStorage: storage(),
    window: {
      addEventListener() {}, removeEventListener() {},
      location: { hash: '', hostname: '127.0.0.1' }
    },
    history: { replaceState() {}, pushState() {}, back() {} },
    fetch: fetchImpl, setTimeout: () => 0, confirm: () => true, console,
    URL: { createObjectURL: () => 'blob:test-image', revokeObjectURL() {} },
    Image: class { naturalWidth = 480; naturalHeight = 240; set src(value) { Promise.resolve().then(() => this.onload()); } },
    document: { createElement: () => ({ width:0, height:0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/webp;base64,dGVzdA==' }) }
  });
  return { state: () => localState, mounted: localMounted };
}
(async () => {
  boot(); await mounted();
  state.currentTab.value = 'canvas';
  state.items.value[0].content = 'ページを移動しても保存される';
  await Promise.all([state.switchPage(2), state.switchPage(1)]);
  assert.equal(state.currentPageId.value, 2);
  assert.equal(state.currentTab.value, 'canvas');
  boot(); await mounted();
  assert.equal(state.currentTab.value, 'canvas');
  assert.equal(state.currentPageId.value, 2);
  await state.switchPage(1);
  assert.equal(state.items.value[0].content, 'ページを移動しても保存される');
  state.deskRef.value = { clientWidth: 1200, clientHeight: 900, getBoundingClientRect: () => ({ left:0, top:0, right:1200, bottom:900 }) };
  state.sheetPlaneRef.value = { getBoundingClientRect: () => ({ left:100, top:100 }) };
  await state.placePageBeside(2);
  assert.equal(state.visibleSheets.value.length, 2);
  assert.equal(state.currentPageId.value, 2);
  assert.equal(state.visibleSheets.value[1].x, 940);
  assert.equal(state.sheetItems(1)[0].content, 'ページを移動しても保存される');
  state.setZoom(10); assert.equal(state.zoomLevel.value, 2);
  state.setZoom(-1); assert.equal(state.zoomLevel.value, .3);
  state.setZoom(.5);
  const events = new Map();
  const dragTarget = { setPointerCapture() {}, addEventListener: (k,v) => events.set(k,v), removeEventListener: k => events.delete(k) };
  state.startTabPointerDrag({ button:0, target:{ closest:() => null }, currentTarget:dragTarget, pointerId:1, clientX:10, clientY:10 }, 2);
  events.get('pointermove')({ clientX:500, clientY:300 });
  assert.equal(state.draggedPageId.value, 2);
  await events.get('pointerup')({ type:'pointerup', clientX:500, clientY:300 });
  const positioned = state.visibleSheets.value.find(p => p.id === 2);
  assert.equal(positioned.x, 800); assert.equal(positioned.y, 400);
  assert.equal(events.size, 0);
  state.startSheetDrag({ button:0, target:{ closest:() => null }, currentTarget:dragTarget, pointerId:2, clientX:100, clientY:100, preventDefault() {} }, positioned);
  events.get('pointermove')({ clientX:150, clientY:120 });
  events.get('pointerup')();
  assert.equal(state.visibleSheets.value.find(p => p.id === 2).x, 900);
  assert.equal(state.visibleSheets.value.find(p => p.id === 2).y, 440);
  const photo = { width:100, height:200, x:800, y:700 };
  state.resizeImage(photo, 600);
  assert.equal(photo.height / photo.width, 2);
  assert.ok(photo.height <= 660 && photo.y + photo.height <= 760);
  // 付箋も画像と同じく比率を保ったまま大きさを変更できる
  const stickyForResize = { item_type:'sticky_note', width:170, height:140, x:80, y:80 };
  state.resizeImage(stickyForResize, 340);
  assert.equal(stickyForResize.width, 340);
  assert.equal(stickyForResize.height, 280);
  assert.equal(stickyForResize.height / stickyForResize.width, 140 / 170);
  // 文字サイズは付箋の大きさに連動し、手動（スライダー／数値入力）でも調整できる
  assert.equal(state.stickyFontSize(stickyForResize), 26, '付箋を2倍にすると文字サイズも2倍（13→26）');
  state.setStickyFontSize(stickyForResize, 30);
  assert.equal(state.stickyFontSize(stickyForResize), 30, '手動スライダーで文字サイズを指定できる');
  const fontInput = { value: '' };
  state.commitStickyFontSize(stickyForResize, 42, fontInput);
  assert.equal(state.stickyFontSize(stickyForResize), 42, '数値入力を直接クリックして指定できる');
  assert.equal(fontInput.value, 42, '入力欄の表示が現在値へ揃う');
  state.commitStickyFontSize(stickyForResize, 999, fontInput);
  assert.equal(state.stickyFontSize(stickyForResize), 48, '上限48pxにクランプ');
  assert.equal(fontInput.value, 48, 'クランプ後の値が入力欄へ反映される');
  // 付箋サイズのリセット: 大きさだけを戻し、文字サイズ設定は維持する
  state.resetStickySize(stickyForResize);
  assert.equal(stickyForResize.width, 170);
  assert.equal(stickyForResize.height, 140);
  assert.ok(stickyForResize.font_scale !== 1, 'リセットしても文字サイズ設定は保持される');
  assert.notEqual(state.stickyFontSize(stickyForResize), 13, '文字サイズはリセットされない');
  // 付箋以外はリセット対象外
  const imageForReset = { item_type:'sticker', width: 320, height: 160, x: 20, y: 70 };
  state.resetStickySize(imageForReset);
  assert.equal(imageForReset.width, 320, '画像・シールは付箋サイズリセットの対象外');
  // 選択中アイテムの種別でサイズスライダーの表示を切り替える
  const prevItems = state.items.value, prevSelected = state.selectedId.value;
  state.items.value = [{ id: 9999, item_type: 'sticky_note', width: 170, height: 140, x: 80, y: 80 }];
  state.selectedId.value = 9999;
  assert.equal(state.canResizeItem.value, true, '付箋を選択するとサイズスライダーを表示');
  state.items.value = prevItems; state.selectedId.value = prevSelected;
  assert.equal(state.canResizeItem.value, false, '非選択ならサイズスライダーは出ない');
  await state.closeSheet(2);
  assert.equal(state.visibleSheets.value.length, 1);
  assert.equal(state.currentPageId.value, 1);
  assert.equal(state.pages.value.length, 2);
  const countBeforeImage = state.items.value.length;
  await state.importImages([{ type:'image/png', size:1024, name:'photo.png' }], { x:200, y:200 });
  const addedImage = state.items.value.at(-1);
  assert.equal(addedImage.item_type, 'sticker');
  assert.equal(addedImage.width, 320); assert.equal(addedImage.height, 160);
  assert.equal(addedImage.x, 200); assert.equal(addedImage.page_id, state.currentPageId.value);
  assert.equal(state.items.value.length, countBeforeImage + 1);
  assert.ok(JSON.parse(localStorage.getItem('quadtecho_items_page_1')).some(i => i.content === 'photo.png'));
  await state.importImages([{ type:'text/plain', size:1024, name:'bad.txt' }, { type:'image/png', size:11 * 1024 * 1024, name:'large.png' }]);
  assert.equal(state.items.value.length, countBeforeImage + 1);
  state.undo(); assert.equal(state.items.value.length, countBeforeImage);
  state.redo(); assert.equal(state.items.value.at(-1).content, 'photo.png');
  assert.equal(state.imageBusy.value, false);
  state.newBoardTitle.value = '勉強会'; state.newBoardContent.value = '一緒に勉強しよう';
  await state.submitBoardPost();
  const post = state.boardPosts.value[0];
  await state.toggleBoardLike(post);
  assert.equal(post.likes.length, 1);
  state.replyDrafts.value[post.id] = '参加します';
  await state.submitBoardComment(post);
  state.boardFilter.value = 'liked';
  assert.equal(state.filteredBoardPosts.value.length, 1);
  state.boardSearch.value = '存在しない文字列';
  assert.equal(state.filteredBoardPosts.value.length, 0);
  await state.fetchBoard();
  assert.equal(state.boardPosts.value[0].comments[0].content, '参加します');
  assert.equal(state.boardPosts.value[0].likes.length, 1);
  await state.toggleBoardLike(state.boardPosts.value[0]);
  assert.equal(state.boardPosts.value[0].likes.length, 0);
  // 三点メニュー: 投稿とチャットで排他的に開閉し、外側クリックで閉じる
  state.togglePostMenu(post.id);
  assert.equal(state.openPostMenu.value, post.id);
  state.toggleChatMenu(123);
  assert.equal(state.openPostMenu.value, null, 'チャットメニューを開くと投稿メニューは閉じる');
  assert.equal(state.openChatMenu.value, 123);
  state.toggleChatMenu(123);
  assert.equal(state.openChatMenu.value, null, '同じボタンをもう一度押すと閉じる');
  state.togglePostMenu(post.id);
  state.closeOpenMenus();
  assert.equal(state.openPostMenu.value, null, 'closeOpenMenus で閉じる');
  // チャットの三点メニューからの削除（オフライン時はローカルから消える）
  state.circleMessages.value = [{ id: 7, user_id: state.currentUser.value.id, content: '消す発言' }];
  await state.confirmDeleteCircleMessage(state.circleMessages.value[0]);
  assert.equal(state.openChatMenu.value, null, 'チャット削除時にメニューを閉じる');
  assert.equal(state.circleMessages.value.length, 0);
  // 三点メニューからの削除: 追加した投稿だけが消え、既存の投稿は残る
  state.newBoardTitle.value = '削除テスト'; state.newBoardContent.value = '消える投稿';
  await state.submitBoardPost();
  const doomed = state.boardPosts.value[0];
  await state.confirmDeleteBoardPost(doomed);
  assert.equal(state.openPostMenu.value, null, '削除時にメニューを閉じる');
  assert.ok(!state.boardPosts.value.some(p => p.id === doomed.id), '削除した投稿が一覧から消える');
  assert.equal(state.boardPosts.value.length, 1, '他の投稿は残る');
  // アカウント管理: ログイン <-> アカウント作成モーダル切り替え
  assert.equal(state.showUserModal.value, false);
  assert.equal(state.showSignupModal.value, false);
  assert.equal(state.usersList.value.length, 1);
  assert.equal(state.currentUser.value.username, 'guest');
  state.loginUsername.value = 'guest';
  state.showUserModal.value = true;
  await state.loginByUsername();
  assert.equal(state.currentUser.value.username, 'guest');
  assert.equal(state.showUserModal.value, false);
  assert.equal(state.loginUsername.value, '');
  state.loginUsername.value = 'unknown-user';
  state.showUserModal.value = true;
  await state.loginByUsername();
  assert.equal(state.currentUser.value.username, 'guest');
  assert.equal(state.showUserModal.value, true);
  state.openSignupModal();
  assert.equal(state.showUserModal.value, false);
  assert.equal(state.showSignupModal.value, true);
  state.newUserForm.value.username = 'taro123';
  state.backToLoginModal();
  assert.equal(state.showUserModal.value, true);
  assert.equal(state.showSignupModal.value, false);
  state.openSignupModal();
  assert.equal(state.newUserForm.value.username, '');
  // 保存された旧ダミーは廃棄してゲストへ置き換える
  localStorage.setItem('quadtecho_active_user', JSON.stringify({ id: 2, username: 'senpai', display_name: 'みやび先輩', circle_name: '軽音サークル' }));
  boot(); await mounted();
  assert.equal(state.currentUser.value.username, 'guest');
  assert.equal(state.usersList.value.length, 1);
  assert.equal(JSON.parse(localStorage.getItem('quadtecho_active_user')).username, 'guest');
  state.isFlaskOnline.value = true;
  state.newBoardTitle.value = '通信失敗'; state.newBoardContent.value = '下書きは残す';
  await state.submitBoardPost();
  assert.equal(state.newBoardContent.value, '下書きは残す');
  assert.equal(state.boardPosts.value.length, 1);
  assert.equal(state.boardBusy.value, false);

  // ===== 履歴トラバーサル（ブラウザの戻る/進む）=====
  const h = bootWithHistory('');
  await h.mounted();
  const hs = h.state();
  assert.ok(h.listeners.has('popstate'), 'popstate リスナーが登録される');
  assert.equal(h.location.hash, '#home', '初期タブが履歴の基点として登録される');
  assert.ok(h.calls.some(c => c.type === 'replace' && c.state.quadtecho === 'tab'), '基点は replaceState で登録');

  // タブ移動で履歴に1件積む
  hs.currentTab.value = 'list';
  const tabPush = h.calls.filter(c => c.type === 'push' && c.state.quadtecho === 'tab').pop();
  assert.ok(tabPush && tabPush.state.tab === 'list', 'タブ移動で pushState される');
  assert.equal(h.location.hash, '#list', 'URLハッシュがタブに追従する');

  // 戻る/進むでタブが復元される
  h.location.hash = '#home';
  h.listeners.get('popstate')({ state: { quadtecho: 'tab', tab: 'home' } });
  assert.equal(hs.currentTab.value, 'home', 'popstate（戻る）で前のタブへ復元');
  h.location.hash = '#list';
  h.listeners.get('popstate')({ state: { quadtecho: 'tab', tab: 'list' } });
  assert.equal(hs.currentTab.value, 'list', 'popstate（進む）で次のタブへ復元');

  // モーダルを開くと履歴を積み、「戻る」でまず閉じる
  hs.showUserModal.value = true;
  await Vue.nextTick(); await Vue.nextTick();
  assert.ok(h.calls.some(c => c.type === 'push' && c.state.quadtecho === 'overlay'), 'オーバーレイ表示で履歴を積む');
  const hashWhileOpen = h.location.hash;
  h.listeners.get('popstate')({ state: { quadtecho: 'tab', tab: 'list' } });
  await Vue.nextTick(); await Vue.nextTick();
  assert.equal(hs.showUserModal.value, false, '「戻る」でモーダルが閉じる');
  assert.equal(hs.currentTab.value, 'list', '「戻る」でタブは変わらない');
  assert.equal(h.location.hash, hashWhileOpen, 'モーダルを閉じてもURLは変わらない');

  // UI操作で閉じたときは積んだ履歴を取り除く（余分な「戻る」を残さない）
  const h2 = bootWithHistory('#list');
  await h2.mounted();
  const hs2 = h2.state();
  hs2.showUserModal.value = true;
  await Vue.nextTick(); await Vue.nextTick();
  const backsBefore = h2.calls.filter(c => c.type === 'back').length;
  hs2.showUserModal.value = false;
  await Vue.nextTick(); await Vue.nextTick();
  assert.ok(h2.calls.filter(c => c.type === 'back').length > backsBefore, 'UIで閉じたら history.back() で履歴を戻す');

  // ===== 入手したシール（マイシール）を手帳で使える =====
  const stickerIcon = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  assert.equal(state.myStickers.value.length, 0);
  assert.equal(state.addMySticker({
    name: '部活ロゴ', icon: stickerIcon, category: 'オリジナル', source: 'circle', source_id: 7 }), true);
  assert.equal(state.myStickers.value.length, 1);
  // 同じ画像は重複追加しない
  assert.equal(state.addMySticker({ name: '部活ロゴ', icon: stickerIcon }), false);
  assert.equal(state.myStickers.value.length, 1);
  assert.equal(JSON.parse(localStorage.getItem('quadtecho_my_stickers')).length, 1);
  // 入手したシールを手帳ページへ貼れる
  const beforeStickerCount = state.items.value.length;
  state.addMyStickerToTecho(state.myStickers.value[0]);
  assert.equal(state.items.value.length, beforeStickerCount + 1);
  const placedSticker = state.items.value.at(-1);
  assert.equal(placedSticker.item_type, 'sticker');
  assert.equal(placedSticker.image_url, stickerIcon);
  // リロード後もマイシールが残る（手帳で使い続けられる）
  boot(); await mounted();
  assert.equal(state.myStickers.value.length, 1);

  // ===== ログアウト後もアカウントは残り、再ログインできる =====
  boot(); await mounted();
  assert.equal(state.isFlaskOnline.value, false);
  state.usersList.value = [
    { id: 1, username: 'guest', display_name: 'ゲスト', circle_name: '未所属' },
    { id: 5, username: 'yaya_moderate', display_name: 'wawa404', circle_name: '未所属' }
  ];
  state.loginUsername.value = 'yaya_moderate';
  await state.loginByUsername();
  assert.equal(state.currentUser.value.username, 'yaya_moderate');
  await state.logout();
  assert.equal(state.currentUser.value.username, 'guest');
  assert.ok(state.usersList.value.some(u => u.username === 'yaya_moderate'),
    'ログアウトしてもアカウント一覧から消えない');
  state.loginUsername.value = 'yaya_moderate';
  await state.loginByUsername();
  assert.equal(state.currentUser.value.username, 'yaya_moderate', 'ログアウト後に再ログインできる');

  // ===== 全角入力・ニックネームでもログインできる =====
  state.loginUsername.value = 'ｙａｙａ＿ｍｏｄｅｒａｔｅ';
  await state.loginByUsername();
  assert.equal(state.currentUser.value.username, 'yaya_moderate', '全角入力でもログインできる');
  await state.logout();
  state.loginUsername.value = 'wawa404';   // 一覧に出ているニックネーム
  await state.loginByUsername();
  assert.equal(state.currentUser.value.username, 'yaya_moderate', 'ニックネームでもログインできる');

  // ===== サーバー未接続でも保存済みアカウントを復元してログインできる =====
  localStorage.setItem('quadtecho_users', JSON.stringify([
    { id: 1, username: 'guest', display_name: 'ゲスト', circle_name: '未所属' },
    { id: 9, username: 'saved_user', display_name: '保存ユーザー', circle_name: '未所属' }
  ]));
  boot(); await mounted();
  assert.ok(state.usersList.value.some(u => u.username === 'saved_user'),
    'オフラインでも保存済みアカウントが一覧に復元される');
  state.loginUsername.value = 'saved_user';
  await state.loginByUsername();
  assert.equal(state.currentUser.value.username, 'saved_user', 'オフラインでもログインできる');

  // ===== Flaskサーバーが後から起動しても自動で「Flask同期」へ切り替わる =====
  const healthResponse = () => ({
    ok: true,
    clone() { return this; },
    json: async () => ({ service: 'QuadTecho Flask API', status: 'healthy' })
  });
  const okFetch = async (url) => {
    if (String(url).includes('/api/health')) return healthResponse();
    throw new Error('offline');
  };
  const hf = bootWithFetch(okFetch);
  await hf.mounted();
  assert.equal(hf.state().isFlaskOnline.value, true, 'ヘルスチェック成功で Flask同期 になる');

  // 未起動ならローカル保存のまま（何度呼んでも落ちない）
  const offFetch = async () => { throw new Error('offline'); };
  const hf2 = bootWithFetch(offFetch);
  await hf2.mounted();
  assert.equal(hf2.state().isFlaskOnline.value, false, '未起動ならローカル保存のまま');
  assert.equal(await hf2.state().probeFlaskOnce(), false, '再検出しても未接続なら false');

  // 途中でサーバーが起動したケースを再検出で拾える
  let serverUp = false;
  const flakyFetch = async (url) => {
    if (!serverUp) throw new Error('offline');
    if (String(url).includes('/api/health')) return healthResponse();
    throw new Error('offline');
  };
  const hf3 = bootWithFetch(flakyFetch);
  await hf3.mounted();
  assert.equal(hf3.state().isFlaskOnline.value, false);
  serverUp = true;
  assert.equal(await hf3.state().probeFlaskOnce(), true, '再検出でサーバーを検知できる');
  assert.equal(hf3.state().isFlaskOnline.value, true, '再検出後に Flask同期 へ切り替わる');

  // ===== 未保存インジケータ ＆ キーボード操作（Delete・矢印・⌘S・⌘D・Esc） =====
  boot(); await mounted();
  state.currentTab.value = 'canvas';
  assert.equal(state.isDirty.value, false, '手帳を開いた直後は保存済み扱い');
  state.newStickyContent.value = 'キーボード操作テスト';
  state.addSticky();
  assert.equal(state.isDirty.value, true, '付箋を追加すると「未保存」になる');
  await state.saveCurrentPage(false);
  assert.equal(state.isDirty.value, false, '保存すると未保存が解消される');

  // キーイベントのスタブ（preventDefault の呼び出しも検証できるようにする）
  const keyEvent = (over = {}) => Object.assign({
    key: 'ArrowRight', target: { tagName: 'BODY' },
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }
  }, over);

  // 矢印キー：1px、Shift併用で10px
  const moved = state.items.value[0];
  state.selectedId.value = moved.id;
  const baseX = moved.x, baseY = moved.y;
  let ev = keyEvent({ key: 'ArrowRight' });
  state.handleKeyDown(ev);
  assert.equal(ev.defaultPrevented, true, '矢印キーの標準動作（スクロール）を止める');
  assert.equal(moved.x, baseX + 1, '矢印キーで1px右へ微移動できる');
  ev = keyEvent({ key: 'ArrowDown', shiftKey: true });
  state.handleKeyDown(ev);
  assert.equal(moved.y, baseY + 10, 'Shift+矢印で10px動く');
  // ノートの外へは出ない（ドラッグと同じ下限20/70へクランプ）
  moved.x = 25; moved.y = 70;
  state.handleKeyDown(keyEvent({ key: 'ArrowLeft', shiftKey: true }));
  state.handleKeyDown(keyEvent({ key: 'ArrowUp' }));
  assert.equal(moved.x, 20, '左端は20pxで止まる（キー移動もノート内に収まる）');
  assert.equal(moved.y, 70, '上端は70pxで止まる');
  // 連続した微移動は1回のUndoでまとめて戻せる
  state.undo();
  assert.equal(state.items.value[0].x, baseX, '連続した微移動を1回のUndoで戻せる');
  assert.equal(state.items.value[0].y, baseY, '縦位置も同じUndoで戻る');

  // Delete / Backspace：選択中の付箋を剥がす（文字入力中は剥がさない）
  const keepCount = state.items.value.length;
  state.selectedId.value = state.items.value[0].id;
  ev = keyEvent({ key: 'Delete' });
  state.handleKeyDown(ev);
  assert.equal(ev.defaultPrevented, true, 'Deleteの標準動作を止める');
  assert.equal(state.items.value.length, keepCount - 1, 'Deleteで選択中の付箋を剥がせる');
  assert.equal(state.selectedId.value, null, '剥がしたあとは選択が外れる');
  state.selectedId.value = state.items.value[0].id;
  state.handleKeyDown(keyEvent({ key: 'Backspace', target: { tagName: 'TEXTAREA' } }));
  assert.equal(state.items.value.length, keepCount - 1, '文字入力中のBackspaceでは剥がさない');

  // ⌘/Ctrl + D：複製、⌘/Ctrl + S：保存
  ev = keyEvent({ key: 'd', ctrlKey: true });
  state.handleKeyDown(ev);
  assert.equal(ev.defaultPrevented, true, '⌘/Ctrl+D のブックマーク追加を止める');
  assert.equal(state.items.value.length, keepCount, '⌘/Ctrl+D で選択中の付箋を複製できる');
  assert.equal(state.isDirty.value, true, '複製すると未保存になる');
  ev = keyEvent({ key: 's', ctrlKey: true });
  state.handleKeyDown(ev);
  assert.equal(ev.defaultPrevented, true, '⌘/Ctrl+S でブラウザの保存ダイアログを抑止する');
  await Promise.resolve();
  assert.equal(state.isDirty.value, false, '⌘/Ctrl+S で保存される');

  // Esc：選択解除・モーダルやメニューを閉じる・入力欄のフォーカスを外す
  state.selectedId.value = state.items.value[0].id;
  state.showProfileModal.value = true;
  state.mobileMenuOpen.value = true;
  state.handleKeyDown(keyEvent({ key: 'Escape' }));
  assert.equal(state.selectedId.value, null, 'Escで選択を解除できる');
  assert.equal(state.showProfileModal.value, false, 'Escでモーダルを閉じられる');
  assert.equal(state.mobileMenuOpen.value, false, 'Escでモバイルメニューを閉じられる');
  let blurred = false;
  state.handleKeyDown(keyEvent({ key: 'Escape', target: { tagName: 'INPUT', blur() { blurred = true; } } }));
  assert.equal(blurred, true, '入力中のEscでフォーカスを外す');

  // 未保存のまま離脱しようとしたときだけ確認を出す（beforeunload）
  assert.equal(state.isDirty.value, false, 'Esc（選択解除）だけでは内容が変わらないので未保存にならない');
  state.addSticky();
  assert.equal(state.isDirty.value, true, '付箋を追加すると未保存に戻る');
  const unloadEvent = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  assert.equal(state.handleBeforeUnload(unloadEvent), '', '未保存ならブラウザ標準の確認を出す');
  assert.equal(unloadEvent.defaultPrevented, true);
  await state.saveCurrentPage(false);
  assert.equal(state.handleBeforeUnload({ preventDefault() { } }), undefined, '保存済みなら確認を出さない');

  // ===== 日本語IMEの変換確定Enterで誤った確定・送信・削除をしない =====
  let actionCalled = false;
  const composing = { isComposing: true, keyCode: 229, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  state.submitOnEnter(composing, () => { actionCalled = true; });
  assert.equal(actionCalled, false, 'IME変換中のEnterでは実行しない');
  assert.equal(composing.defaultPrevented, false, '変換中のEnterは標準動作（変換確定）に任せる');
  const settled = { isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  state.submitOnEnter(settled, () => { actionCalled = true; });
  assert.equal(actionCalled, true, '変換が終わったEnterで実行する');
  assert.equal(settled.defaultPrevented, true, '実行時は既定動作（改行など）を止める');
  assert.equal(state.isComposingKey({ keyCode: 229 }), true, 'keyCode 229 も変換中として扱う');
  // 変換中のキー入力ではキャンバスのショートカット（剥がす）を動かさない
  const keepItems = state.items.value.length;
  state.currentTab.value = 'canvas';
  state.selectedId.value = state.items.value[0].id;
  state.handleKeyDown({
    key: 'Backspace', isComposing: true, keyCode: 229, target: { tagName: 'BODY' }, preventDefault() { }
  });
  assert.equal(state.items.value.length, keepItems, 'IME変換中はBackspaceで付箋を剥がさない');

  // モーダルを開いている間は、背面のキャンバスをキーで動かさない
  state.selectedId.value = state.items.value[0].id;
  state.showNewPageModal.value = true;
  const itemsWhileOpen = state.items.value.length;
  const xWhileOpen = state.items.value[0].x;
  state.handleKeyDown(keyEvent({ key: 'Delete' }));
  state.handleKeyDown(keyEvent({ key: 'ArrowRight' }));
  assert.equal(state.items.value.length, itemsWhileOpen, 'モーダル表示中はDeleteで剥がさない');
  assert.equal(state.items.value[0].x, xWhileOpen, 'モーダル表示中は矢印キーで動かさない');
  assert.equal(state.showNewPageModal.value, true, '単独キーではモーダルは閉じない（Escで閉じる）');

  console.log('PASS: page switching, reload restoration, saved content, multi-page placement, pointer dragging, zoom limits, image & sticky sizing, sticky font size input & size reset, posts, likes, replies, persistence, failure recovery, history traversal, my stickers, login/logout, flask detection, unsaved indicator & keyboard shortcuts');
})().catch(error => { console.error(error); process.exitCode = 1; });
