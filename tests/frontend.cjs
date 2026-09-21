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
    Vue: { ...Vue, onMounted: fn => { mounted = fn; }, createApp: options => ({ mount() { state = options.setup(); } }) },
    localStorage, sessionStorage, window: { addEventListener() {}, removeEventListener() {}, location: { hash: '' } },
    history: { replaceState() {} },
    fetch: async () => { throw Error('offline'); }, setTimeout: () => 0, console,
    URL: { createObjectURL: () => 'blob:test-image', revokeObjectURL() {} },
    Image: class { naturalWidth = 480; naturalHeight = 240; set src(value) { Promise.resolve().then(() => this.onload()); } },
    document: { createElement: () => ({ width:0, height:0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/webp;base64,dGVzdA==' }) }
  });
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
  console.log('PASS: page switching, reload restoration, saved content, multi-page placement, pointer dragging, zoom limits, image sizing, posts, likes, replies, persistence, failure recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });
