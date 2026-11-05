// Kohler UI kit (with ui.css). Swaps the browser's own controls for Kohler-styled ones, on every
// page and for anything a page adds later:
//   <select>                       → a styled button and list (the real <select> stays, hidden,
//                                     so page code that reads .value or listens for change still works)
//   <input type=date|datetime-local> → a styled button and calendar (same: the real box keeps the value)
//   confirm() / prompt()           → KUI.confirm(text) / KUI.prompt(text) return promises
(function () {
  if (window.KUI) return;
  const CHEV = '<svg class="kx-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  let open = null;   // { pop, close }

  function place(pop, anchor) {
    const r = anchor.getBoundingClientRect(), vh = innerHeight, vw = innerWidth;
    pop.style.minWidth = Math.max(160, r.width) + 'px';
    const h = pop.offsetHeight, w = pop.offsetWidth, below = vh - r.bottom - 8, up = below < h && r.top > below;
    pop.classList.toggle('up', up);
    pop.style.top = (up ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + 'px';
  }
  function show(pop, anchor, onClose) {
    closeOpen();
    document.body.appendChild(pop); place(pop, anchor);
    const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
    const move = (e) => { if (e.type === 'scroll' && pop.contains(e.target)) return; place(pop, anchor); };
    const close = () => { if (open?.pop !== pop) return; pop.remove(); open = null; removeEventListener('pointerdown', away, true); removeEventListener('scroll', move, true); removeEventListener('resize', move); onClose?.(); };
    setTimeout(() => addEventListener('pointerdown', away, true));
    addEventListener('scroll', move, true); addEventListener('resize', move);
    open = { pop, close };
    return close;
  }
  function closeOpen() { open?.close(); }

  /* ── dropdowns ── */
  function enhanceSelect(sel) {
    if (sel.dataset.kx || sel.multiple || sel.size > 1 || sel.closest('.kx-pop')) return;
    sel.dataset.kx = '1';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = ((sel.className || '') + ' kx-sel').trim();
    btn.setAttribute('role', 'combobox'); btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    const label = sel.getAttribute('aria-label') || sel.closest('label')?.querySelector('span')?.textContent;
    if (label) btn.setAttribute('aria-label', label);
    if (sel.getAttribute('style')) btn.setAttribute('style', sel.getAttribute('style'));
    sel.classList.add('kx-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
    sel.after(btn);
    const paint = () => {
      const o = sel.options[sel.selectedIndex];
      btn.innerHTML = `<span class="kx-v${o ? '' : ' ph'}">${esc(o ? o.text : sel.dataset.placeholder || 'Choose…')}</span>${CHEV}`;
      btn.disabled = sel.disabled;
    };
    sel._kxPaint = paint; paint();
    sel.addEventListener('change', paint);
    new MutationObserver(paint).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });

    let act = -1, typed = '', typedT;
    const opts = () => [...sel.options];
    function openList() {
      if (sel.disabled) return;
      const pop = document.createElement('div');
      pop.className = 'kx-pop'; pop.setAttribute('role', 'listbox');
      let html = '', lastGroup = null;
      opts().forEach((o, i) => {
        const g = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement : null;
        if (g && g !== lastGroup) html += `<div class="kx-grp">${esc(g.label)}</div>`;
        lastGroup = g;
        if (o.hidden) return;
        html += `<div class="kx-opt" role="option" data-i="${i}" aria-selected="${i === sel.selectedIndex}"${o.disabled || g?.disabled ? ' aria-disabled="true"' : ''}>${esc(o.text)}</div>`;
      });
      pop.innerHTML = html;
      act = sel.selectedIndex;
      const mark = () => pop.querySelectorAll('.kx-opt').forEach((d) => d.classList.toggle('act', +d.dataset.i === act));
      const pick = (i) => { const o = sel.options[i]; if (!o || o.disabled) return; const changed = sel.selectedIndex !== i; sel.selectedIndex = i; paint(); close(); btn.focus(); if (changed) fire(sel); };
      pop.addEventListener('pointermove', (e) => { const d = e.target.closest('.kx-opt'); if (d && +d.dataset.i !== act) { act = +d.dataset.i; mark(); } });
      pop.addEventListener('click', (e) => { const d = e.target.closest('.kx-opt'); if (d && d.getAttribute('aria-disabled') !== 'true') pick(+d.dataset.i); });
      btn.setAttribute('aria-expanded', 'true');
      const close = show(pop, btn, () => btn.setAttribute('aria-expanded', 'false'));
      mark(); pop.querySelector('.kx-opt.act')?.scrollIntoView({ block: 'nearest' });
      btn._kxKeys = (e) => {
        const n = sel.options.length, step = (d) => { let i = act; for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!sel.options[i].disabled && !sel.options[i].hidden) return i; } return act; };
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); act = step(e.key === 'ArrowDown' ? 1 : -1); mark(); pop.querySelector('.kx-opt.act')?.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(act); }
        else if (e.key === 'Escape' || e.key === 'Tab') { close(); }
        else if (e.key.length === 1) { typed += e.key.toLowerCase(); clearTimeout(typedT); typedT = setTimeout(() => (typed = ''), 600);
          const i = opts().findIndex((o) => o.text.toLowerCase().startsWith(typed)); if (i >= 0) { act = i; mark(); pop.querySelector('.kx-opt.act')?.scrollIntoView({ block: 'nearest' }); } }
      };
    }
    btn.addEventListener('click', () => (btn.getAttribute('aria-expanded') === 'true' ? closeOpen() : openList()));
    btn.addEventListener('keydown', (e) => {
      if (btn.getAttribute('aria-expanded') === 'true') return btn._kxKeys?.(e);
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
    });
    // a <label> around the select now focuses the button
    sel.addEventListener('focus', () => btn.focus());
  }
  // code that sets select.value / selectedIndex directly also updates the button
  for (const prop of ['value', 'selectedIndex']) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    if (d?.set) Object.defineProperty(HTMLSelectElement.prototype, prop, { ...d, set(v) { d.set.call(this, v); this._kxPaint?.(); } });
  }

  /* ── dates ── */
  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function parseLocal(v) { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null; }
  function enhanceDate(inp) {
    if (inp.dataset.kx) return;
    inp.dataset.kx = '1';
    const withTime = inp.type === 'datetime-local';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = ((inp.className || '') + ' kx-sel').trim();
    if (inp.getAttribute('style')) btn.setAttribute('style', inp.getAttribute('style'));
    inp.classList.add('kx-native'); inp.tabIndex = -1; inp.setAttribute('aria-hidden', 'true');
    inp.after(btn);
    const fmt = (d) => d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) + (withTime ? ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
    const paint = () => { const d = parseLocal(inp.value); btn.innerHTML = `<span class="kx-v${d ? '' : ' ph'}">${esc(d ? fmt(d) : inp.placeholder || inp.dataset.placeholder || (withTime ? 'Pick a date and time' : 'Pick a date'))}</span><svg class="kx-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`; };
    inp._kxPaint = paint; paint();
    inp.addEventListener('change', paint);
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-expanded') === 'true') return closeOpen();
      const cur = parseLocal(inp.value), now = new Date();
      let view = new Date((cur || now).getFullYear(), (cur || now).getMonth(), 1), pickD = cur, hh = cur ? cur.getHours() : 12, mm = cur ? cur.getMinutes() : 0;
      const pop = document.createElement('div'); pop.className = 'kx-pop kx-cal';
      const draw = () => {
        const first = (view.getDay() + 6) % 7, start = new Date(view.getFullYear(), view.getMonth(), 1 - first);
        let days = '';
        for (let i = 0; i < 42; i++) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
          const same = (a) => a && a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth() && a.getDate() === d.getDate();
          days += `<button type="button" class="kx-day${d.getMonth() !== view.getMonth() ? ' out' : ''}${same(now) ? ' today' : ''}${same(pickD) ? ' on' : ''}" data-d="${d.getFullYear()}-${d.getMonth()}-${d.getDate()}">${d.getDate()}</button>`;
        }
        pop.innerHTML = `<div class="kx-cal-h"><button type="button" class="kx-nav" data-m="-1" aria-label="Previous month">‹</button><b>${MONTHS[view.getMonth()]} ${view.getFullYear()}</b><button type="button" class="kx-nav" data-m="1" aria-label="Next month">›</button></div>
          <div class="kx-days">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => `<div class="wd">${w}</div>`).join('')}${days}</div>
          ${withTime ? `<div class="kx-time"><span>Time</span><input class="num" id="kxH" inputmode="numeric" maxlength="2" value="${pad(hh)}" aria-label="Hour"><b>:</b><input class="num" id="kxM" inputmode="numeric" maxlength="2" value="${pad(mm)}" aria-label="Minute"></div>` : ''}
          <div class="kx-cal-f"><button type="button" class="kx-btn" data-clear>Clear</button><button type="button" class="kx-btn pri" data-done>Done</button></div>`;
        if (withTime) for (const [id, max, set] of [['#kxH', 23, (v) => (hh = v)], ['#kxM', 59, (v) => (mm = v)]]) {
          const el = pop.querySelector(id);
          el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(0, 2); set(Math.min(max, +el.value || 0)); });
          el.addEventListener('blur', () => { el.value = pad(Math.min(max, +el.value || 0)); });
          el.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const v = (Math.min(max, +el.value || 0) + (e.key === 'ArrowUp' ? 1 : -1) + max + 1) % (max + 1); set(v); el.value = pad(v); } if (e.key === 'Enter') commit(); });
        }
      };
      const commit = () => {
        if (pickD) inp.value = `${pickD.getFullYear()}-${pad(pickD.getMonth() + 1)}-${pad(pickD.getDate())}` + (withTime ? `T${pad(hh)}:${pad(mm)}` : '');
        paint(); close(); fire(inp); btn.focus();
      };
      pop.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-m]'), day = e.target.closest('[data-d]');
        if (nav) { view = new Date(view.getFullYear(), view.getMonth() + +nav.dataset.m, 1); draw(); place(pop, btn); }
        else if (day) { const [y, m, d] = day.dataset.d.split('-').map(Number); pickD = new Date(y, m, d); if (!withTime) return commit(); if (m !== view.getMonth()) view = new Date(y, m, 1); draw(); }
        else if (e.target.closest('[data-clear]')) { inp.value = ''; paint(); close(); fire(inp); }
        else if (e.target.closest('[data-done]')) commit();
      });
      draw();
      btn.setAttribute('aria-expanded', 'true');
      const close = show(pop, btn, () => btn.setAttribute('aria-expanded', 'false'));
    });
  }
  const dval = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(HTMLInputElement.prototype, 'value', { ...dval, set(v) { dval.set.call(this, v); this._kxPaint?.(); } });

  /* ── confirm / prompt ── */
  function dialog(text, { input = false, value = '', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
    return new Promise((res) => {
      const d = document.createElement('div'); d.className = 'kx-dlg';
      d.innerHTML = `<div role="dialog" aria-modal="true"><p>${esc(text)}</p>${input ? `<input type="text" value="${esc(value)}">` : ''}<div class="row"><button type="button" class="kx-btn" data-no>${esc(cancel)}</button><button type="button" class="kx-btn pri" data-yes${danger ? ' style="background:#ff4d6d;border-color:#ff4d6d;color:#fff"' : ''}>${esc(ok)}</button></div></div>`;
      const done = (v) => { d.remove(); removeEventListener('keydown', key, true); res(v); };
      const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(input ? null : false); } if (e.key === 'Enter') { e.preventDefault(); done(input ? d.querySelector('input').value : true); } };
      d.querySelector('[data-no]').onclick = () => done(input ? null : false);
      d.querySelector('[data-yes]').onclick = () => done(input ? d.querySelector('input').value : true);
      d.onclick = (e) => { if (e.target === d) done(input ? null : false); };
      addEventListener('keydown', key, true);
      document.body.appendChild(d);
      (d.querySelector('input') || d.querySelector('[data-yes]')).focus();
    });
  }

  /* ── text areas grow with what you type (instead of a resize corner) ── */
  function grow(t) {
    if (!t._kxMin) t._kxMin = t.offsetHeight || 0;
    t.style.height = 'auto';
    t.style.height = Math.max(t._kxMin, t.scrollHeight + (t.offsetHeight - t.clientHeight)) + 'px';
  }
  addEventListener('input', (e) => { if (e.target.tagName === 'TEXTAREA') grow(e.target); }, true);

  /* ── apply to the page, now and as it changes ── */
  function scan(root) {
    if (!root.querySelectorAll) return;
    if (root.matches?.('select')) enhanceSelect(root);
    if (root.matches?.('input[type=date],input[type=datetime-local]')) enhanceDate(root);
    root.querySelectorAll('select').forEach(enhanceSelect);
    root.querySelectorAll('input[type=date],input[type=datetime-local]').forEach(enhanceDate);
  }
  function start() {
    scan(document);
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n); })
      .observe(document.documentElement, { childList: true, subtree: true });
    // a view that re-renders while a list is open: drop the stale list
    addEventListener('hashchange', closeOpen);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.KUI = { confirm: (t, o) => dialog(t, o), prompt: (t, value, o) => dialog(t, { ...o, input: true, value }), enhance: scan, close: closeOpen };
})();
