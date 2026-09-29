import { createApp } from 'vue';

import './styles/app.css';
import { appOptions } from './app.js';
import { initAutoMarquee } from './auto-marquee.js';

const app = createApp(appOptions);

// 予期しない描画エラーで画面全体が真っ白にならないようにする。
// （古い JS がキャッシュから読み込まれた場合などの保険）
app.config.errorHandler = (err, _instance, info) => {
  console.error('[QuadTecho] render error:', err, info);
};

app.mount('#app');

// マウント後に、見切れテキストの自動スクロールを有効化する
initAutoMarquee();
