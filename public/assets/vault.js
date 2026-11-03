// The Vault: characters, frames, win effects and the Kohler Pass. Nothing here is
// a bet; every sale is plain revenue. Uses casino page helpers (api, money, esc, ic, toast, CS…).
(function () {
  const TABS = [['character', 'Characters', 'users'], ['frame', 'Frames', 'crown'], ['effect', 'Win effects', 'sparkles'], ['pass', 'Kohler Pass', 'ticket']];
  const TIER_ORDER = { free: 0, common: 1, rare: 2, epic: 3, legendary: 4, pass: 5 };
  const TC = { free: '#14532d', common: '#1d2634', rare: '#0c3550', epic: '#2e1a5e', legendary: '#4a3510', pass: '#2e1a5e' };
  let tab = 'character';

  function preview(it, size) {
    if (it.kind === 'character') return KohlerCharacter(it.art, { size });
    if (it.kind === 'frame') {
      const u = CS.user, ch = KV[u?.equip?.character];
      const inner = ch ? KohlerCharacter(ch.art, { size, bg: true }) : KohlerAvatar(u?.username || 'kohler', { size });
      return `<span style="position:relative;display:block;width:${size}px;height:${size}px">${inner}${KohlerCharacter.frame(it.art, size)}</span>`;
    }
    if (it.kind === 'effect') {
      const fx = { confetti: ['#00ff66', '#e8c46a', '#ff4d6d', '#7c5cff'], coins: ['#e8c46a', '#f3d58a', '#b8902e'], fireworks: ['#ff4d6d', '#9be7ff', '#c084fc'], lightning: ['#00ff66'], royal: ['#e8c46a', '#fff1b8'] }[it.art.fx] || [];
      const dots = Array.from({ length: 18 }, (_, i) => { const a = i / 18 * 6.283, r = 18 + (i % 3) * 9; return `<circle cx="${50 + r * Math.cos(a)}" cy="${50 + r * Math.sin(a)}" r="${2 + (i % 3)}" fill="${fx[i % fx.length]}"/>`; }).join('');
      return `<svg viewBox="0 0 100 100" width="${size}" height="${size}">${it.art.fx === 'lightning' ? '<path d="M56 10L34 54h14l-6 36 26-46H54Z" fill="#00ff66" style="filter:drop-shadow(0 0 8px #00ff66)"/>' : dots}
        ${it.art.fx === 'coins' ? KohlerLogo.coin(40).replace('<svg', '<svg x="30" y="30"') : ''}${it.art.fx === 'royal' ? '<path d="M30 60l-3-22 12 10 11-17 11 17 12-10-3 22Z" fill="#e8c46a"/>' : ''}</svg>`;
    }
    return '';
  }
  function tile(it) {
    const eq = CS.user?.equip?.[it.slot] === it.id;
    const act = !CS.user ? `<button class="btn sm" data-auth>Sign in</button>`
      : it.owned ? (eq ? `<button class="btn sm" data-uneq="${it.slot}">Equipped</button>` : `<button class="btn neon sm" data-eq="${it.id}">Use</button>`)
      : it.pass ? `<button class="btn sm" data-tab="pass">Get Pass</button>`
      : `<button class="btn gold sm" data-buy="${it.id}">${money(it.price)}</button>`;
    return `<div class="vt ${it.tier} ${eq ? 'on' : ''}" style="--tc:${TC[it.tier]}">
      <div class="show">${preview(it, 112)}${it.kind === 'effect' ? `<button class="btn sm" style="position:absolute;bottom:8px;left:8px;height:28px" data-try="${it.id}">Preview</button>` : ''}
        ${it.owned && !eq ? `<span class="own">${ic('shield-check', 16, 'color:var(--neon)')}</span>` : ''}</div>
      <div class="meta"><div class="row" style="justify-content:space-between"><b>${esc(it.name)}</b><span class="tier ${it.tier}">${it.tier}</span></div>
        <small>${esc(it.blurb)}</small><div class="foot"><span class="muted num" style="font-size:12px">${it.price ? (it.owned ? 'Owned' : '') : it.pass ? 'Pass perk' : 'Free'}</span>${act}</div></div></div>`;
  }
  function render() {
    const V = CS.vault; if (!V) return;
    const u = CS.user, ch = KV[u?.equip?.character];
    const items = V.items.filter((i) => i.kind === tab || (tab === 'pass' && i.kind === 'pass'))
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.price - b.price);
    const pass = V.items.find((i) => i.kind === 'pass');
    $('#view').innerHTML = `<section class="vt-hero"><div><span class="tag">${ic('gem', 14)}The Vault</span><h1>Look the part.</h1>
        <p>Characters sit in your Survivor seat for the whole table to see. Frames ring your avatar, effects go off when you win. Cosmetic only: nothing here changes your odds.</p></div>
      ${u ? `<div class="vt-me"><div class="face">${(window.userFace || (() => ''))(u, 84)}</div><div><b style="font-family:var(--display)">${esc(u.username)}</b>
        <div class="muted" style="font-size:13px">${ch ? esc(ch.name) : 'No character yet'}${u.passUntil ? ` · <span style="color:#c4b5fd">Pass until ${new Date(u.passUntil).toLocaleDateString()}</span>` : ''}</div>
        <div class="num" style="margin-top:4px;color:var(--neon);font-weight:700">${money(u.balance)}</div></div></div>` : `<button class="btn neon lg" data-auth>Sign in to collect</button>`}</section>
      <div class="tabs">${TABS.map(([k, l, i]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${ic(i, 18)}${l}</button>`).join('')}</div>
      ${tab === 'pass' ? `<div class="pass-card"><div>${KohlerCharacter.frame({ ring: '#a78bfa', glow: true }, 96).replace('position:absolute;inset:0;', '')}</div>
          <div><h2>Kohler Pass</h2><div class="muted">30 days. Buy again any time to stack another 30.</div>
            <ul><li>No service fee on shop orders</li><li>2× daily bonus</li><li>The Pass Holder frame and a Pass badge</li></ul>
            ${u?.passUntil ? `<p style="color:#c4b5fd;margin:10px 0 0">Active until ${new Date(u.passUntil).toLocaleString()}</p>` : ''}</div>
          <div style="text-align:center"><div style="font-family:var(--display);font-size:30px;font-weight:800">${money(pass.price)}</div>
            ${u ? `<button class="btn gold lg" data-buy="${pass.id}" style="margin-top:8px">${u.passUntil ? 'Add 30 days' : 'Get the Pass'}</button>` : '<button class="btn neon" data-auth>Sign in</button>'}</div></div>
        <div class="sect"><h2>Pass perks</h2></div><div class="vt-grid">${V.items.filter((i) => i.pass).map(tile).join('')}</div>`
      : `<div class="vt-grid">${items.map(tile).join('')}</div>`}`;
  }
  async function reload() { CS.vault = await api('/vault'); window.KV = Object.fromEntries(CS.vault.items.map((i) => [i.id, i])); }
  async function show() {
    if (!CS.vault) { $('#view').innerHTML = '<div class="empty" style="border:0">Opening the Vault…</div>'; await reload(); }
    render();
  }
  async function buy(id) {
    const it = KV[id]; if (!it) return;
    if (!CS.user) return authModal();
    $('#mbox').innerHTML = `<div style="display:grid;place-items:center;padding:8px 0 14px">${preview(it, 140)}</div>
      <h2 style="font-family:var(--display);margin:0 0 4px;text-align:center">${esc(it.name)}</h2><p class="muted" style="text-align:center;margin:0 0 16px">${esc(it.blurb)}</p>
      <div class="panelx"><div class="kv"><span>Price</span><b class="num">${money(it.price)}</b></div><div class="kv"><span>Paid from</span><b>${CS.user.testMode ? 'Test balance' : 'Your balance'} (${money(CS.user.balance)})</b></div></div>
      <button class="btn gold wide lg" id="vbuy">Buy for ${money(it.price)}</button><button class="btn ghost wide" style="margin-top:6px" onclick="document.getElementById('modal').classList.remove('on')">Not now</button>`;
    $('#modal').classList.add('on');
    $('#vbuy').onclick = async () => {
      $('#vbuy').disabled = true;
      try {
        const out = await api('/vault/buy', { method: 'POST', body: { item: id } });
        CS.user.balance = out.balance; CS.user.equip = out.equip || CS.user.equip; CS.user.passUntil = out.passUntil;
        $('#modal').classList.remove('on'); await reload(); paintMe(); render();
        KohlerFX.play(it.kind === 'effect' ? it.id : 'fx-confetti'); buzz([20, 40, 60]);
        toast(it.kind === 'pass' ? 'Kohler Pass active' : `${it.name} is yours and equipped`);
      } catch (e) {
        $('#vbuy').disabled = false;
        if (e.status === 402) { $('#modal').classList.remove('on'); toast('Not enough balance. Top up first.'); wallet('deposit'); } else toast(e.message);
      }
    };
  }
  async function equip(slot, item) {
    try { const out = await api('/vault/equip', { method: 'POST', body: { slot, item } }); CS.user.equip = out.equip; await reload(); paintMe(); render(); buzz(10); }
    catch (e) { toast(e.message); }
  }
  document.addEventListener('click', (e) => {
    if (!location.hash.startsWith('#/vault') && !e.target.closest('#mbox')) return;
    const t = e.target.closest('[data-tab],[data-buy],[data-eq],[data-uneq],[data-try],[data-auth]'); if (!t) return;
    e.preventDefault();
    if (t.dataset.tab) { tab = t.dataset.tab; render(); }
    else if (t.dataset.buy) buy(t.dataset.buy);
    else if (t.dataset.eq) equip(KV[t.dataset.eq].slot, t.dataset.eq);
    else if (t.dataset.uneq) equip(t.dataset.uneq, null);
    else if (t.dataset.try) KohlerFX.play(t.dataset.try);
    else if (t.hasAttribute('data-auth')) authModal();
  });
  window.Vault = { show, reload };
})();
