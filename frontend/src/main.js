import { createApp } from 'vue';

import './styles/app.css';
import App from './App.vue';
import { initAutoMarquee } from './auto-marquee.js';

// App.vue がテンプレート（画面の HTML）を持ち、setup 本体（src/app.js）を読み込む。
// ここで appOptions を直接マウントすると render が無く、画面が空になるので注意。
const app = createApp(App);

// 予期しない描画エラーで画面全体が真っ白にならないようにする。
// （古い JS がキャッシュから読み込まれた場合などの保険）
app.config.errorHandler = (err, _instance, info) => {
  console.error('[QuadTecho] render error:', err, info);
};

app.mount('#app');

// マウント後に、見切れテキストの自動スクロールを有効化する
initAutoMarquee();
