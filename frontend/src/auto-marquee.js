/**
 * 見切れたテキストを左へ自動スクロールさせる（Tunedrop の auto-marquee と同方式）。
 * はみ出したテキストだけを左へ流し、画面外では停止・モーション軽減設定では無効化する。
 * ブラウザAPIが無い環境（Node の vm テストなど）では何もしない。
 * main.js がマウント後に呼ぶ。
 */
export function initAutoMarquee() {
  (() => {
    if (typeof matchMedia !== 'function' || typeof document === 'undefined'
      || typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined'
      || typeof IntersectionObserver === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    const selector = [
      '.user-pill-name', '.user-pill-circle',
      '.book-title', '.memo-card-title',
      '.goodnotes-tab .tab-title',
      '.circle-card-head strong', '.home-circle-name',
      '.folder-item-name', '.add-sheet-title',
      '[data-auto-scroll]',
    ].join(',');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const tracked = new Set();
    let pending = false;

    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(refresh);
    }

    const resize = new ResizeObserver(schedule);
    const visibility = new IntersectionObserver(entries => {
      changes.disconnect();
      for (const entry of entries) {
        entry.target.classList.toggle('is-marquee-visible', entry.isIntersecting);
      }
      observeChanges();
    });
    const changes = new MutationObserver(schedule);
    function observeChanges() {
      changes.observe(document.body, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden'],
      });
    }

    function unwrap(element) {
      const content = element.querySelector(':scope > .auto-marquee-text');
      if (content) content.replaceWith(...content.childNodes);
      element.classList.remove('auto-marquee');
      element.style.removeProperty('--text-slide-distance');
      element.style.removeProperty('--text-slide-duration');
    }

    function refresh() {
      pending = false;
      changes.disconnect();
      for (const element of tracked) {
        if (!element.isConnected) {
          resize.unobserve(element);
          visibility.unobserve(element);
          tracked.delete(element);
        }
      }
      for (const element of document.querySelectorAll(selector)) {
        if (!tracked.has(element)) {
          tracked.add(element);
          resize.observe(element);
          visibility.observe(element);
        }
        const enabled = !reducedMotion.matches;
        if (!enabled) { unwrap(element); continue; }
        if (!element.clientWidth || !element.getClientRects().length) continue;
        let content = element.querySelector(':scope > .auto-marquee-text');
        const distance = (content ? content.scrollWidth : element.scrollWidth) - element.clientWidth;
        if (distance <= 2) { unwrap(element); continue; }
        if (!content) {
          content = document.createElement('span');
          content.className = 'auto-marquee-text';
          content.append(...element.childNodes);
          element.append(content);
        }
        element.classList.add('auto-marquee');
        element.style.setProperty('--text-slide-distance', `-${Math.ceil(distance)}px`);
        // 約28px/sで左へ流し、末尾で一拍置いてから次ループへ
        element.style.setProperty('--text-slide-duration', `${Math.max(3, distance / (28 * 0.7))}s`);
      }
      observeChanges();
    }

    reducedMotion.addEventListener('change', schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    schedule();
  })();
}
