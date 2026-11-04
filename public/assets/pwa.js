// Installable app: registers the service worker and powers the "Install app" buttons.
// A button with [data-install] is shown only when the browser can install Kohler (Chrome, Edge,
// Android) or on an iPhone/iPad in Safari, where it explains Share → Add to Home Screen.
(function () {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', () => navigator.serviceWorker?.register('/sw.js').catch(() => {}));
  }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
  let deferred = null;
  const show = () => document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = standalone || !(deferred || ios); });
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; show(); });
  addEventListener('appinstalled', () => { deferred = null; show(); });
  function hint() {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.style.cssText = 'position:fixed;inset:auto 12px 12px;z-index:9999;padding:16px 18px;border-radius:18px;background:#151c27;border:1px solid rgba(255,255,255,.16);color:#eef2f8;font:14.5px/1.5 Inter,system-ui,sans-serif;box-shadow:0 18px 40px rgba(0,0,0,.5)';
    d.innerHTML = '<b style="display:block;margin-bottom:4px">Add Kohler to your Home Screen</b>Tap the Share button <span aria-hidden="true">(the square with an arrow)</span>, then <b>Add to Home Screen</b>.<button style="display:block;margin-top:10px;height:36px;padding:0 14px;border-radius:10px;background:#00e05a;color:#03140a;font-weight:700;border:0">Got it</button>';
    d.querySelector('button').onclick = () => d.remove();
    document.body.appendChild(d);
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-install]'); if (!b) return;
    e.preventDefault();
    if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; show(); }
    else if (ios) hint();
  });
  document.addEventListener('DOMContentLoaded', show);
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; show(); }); } }).observe(document.documentElement, { childList: true, subtree: true });
  window.KohlerApp = { standalone };
})();
