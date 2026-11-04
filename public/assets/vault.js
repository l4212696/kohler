// The Vault: AI-painted avatars (free, priced, or custom-made), frames, win effects and the
// Kohler Pass. Nothing here is a bet; every sale is plain revenue.
// Uses casino page helpers (api, money, esc, ic, toast, CS, KV, KohlerFace…).
(function () {
  const TABS = [['avatar', 'Avatars', 'users'], ['frame', 'Frames', 'crown'], ['effect', 'Win effects', 'sparkles'], ['theme', 'Themes', 'layers'], ['filter', 'Filters', 'gem'], ['badges', 'Badges', 'trophy'], ['pass', 'Kohler Pass', 'ticket']];
  const TIER_ORDER = { free: 0, earned: 1, common: 2, rare: 3, epic: 4, legendary: 5, pass: 6 };
  const CAT_ORDER = ['All', 'Mine', 'Earned', 'Seasonal', 'Classic', 'Textures', 'World', 'Funny', 'Trending', 'Flags', 'Themes', 'Filters'];
  let cat = 'All', search = '', badges = null;
  const seasonNote = (it) => it.season ? `${it.season.label} · ${it.season.live ? 'until ' + new Date(`${new Date().getFullYear() + (it.season.to < it.season.from && new Date().getMonth() > 6 ? 1 : 0)}-${it.season.to}T12:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'back next year'}` : '';
  const TC = { free: '#14532d', common: '#1d2634', rare: '#0c3550', epic: '#2e1a5e', legendary: '#4a3510', pass: '#2e1a5e' };
  let tab = 'avatar', tierFilter = 'all', opts = null;

  /* ── frames / effects / pass (unchanged items from /api/vault) ── */
  function preview(it, size) {
    if (it.kind === 'frame') {
      const u = CS.user;
      return `<span style="position:relative;display:block;width:${size}px;height:${size}px">${KohlerFace.html(u?.username || 'kohler', u?.equip, size, 30)}${KohlerCharacter.frame(it.art, size)}</span>`;
    }
    if (it.kind === 'filter') {
      const u = CS.user;
      return `<span style="display:block;width:${size}px;height:${size}px;filter:${it.art.css}">${KohlerFace.html(u?.username || 'kohler', { ...(u?.equip || {}), filter: null }, size, 30)}</span>`;
    }
    if (it.kind === 'theme') {
      const a = it.art, c = a.colors || ['#ffffff'], bg = a.kind === 'aurora' ? `linear-gradient(160deg,#05070b,${c[1]}55,${c[0]}44)` : a.fog ? `linear-gradient(180deg,#0b0614,${a.fog})` : `radial-gradient(120% 90% at 50% 0,${c[0]}33,#07090d 70%)`;
      const bits = a.emoji ? a.emoji.concat(a.emoji).slice(0, 5).map((e, i) => `<span style="position:absolute;left:${12 + i * 18}%;top:${10 + (i * 37) % 70}%;font-size:${size / 6}px">${e}</span>`).join('')
        : Array.from({ length: 14 }, (_, i) => `<i style="position:absolute;left:${(i * 53) % 96}%;top:${(i * 29) % 92}%;width:${a.kind === 'snow' || a.kind === 'stars' ? 3 : 5}px;height:${a.kind === 'petals' ? 3 : a.kind === 'snow' || a.kind === 'stars' ? 3 : 5}px;border-radius:50%;background:${c[i % c.length]};${a.kind === 'bubbles' ? `border:1px solid ${c[0]};background:none;width:9px;height:9px` : ''};opacity:.85"></i>`).join('');
      return `<span style="position:relative;display:block;width:${size}px;height:${size}px;border-radius:22px;overflow:hidden;background:${bg}">${a.kind === 'code' ? `<span style="position:absolute;inset:0;color:${c[0]};font:12px ui-monospace,monospace;opacity:.7;word-break:break-all;padding:6px;line-height:1.1">アカサ01KOHLER$タナ10ハマヤ</span>` : bits}</span>`;
    }
    if (it.kind === 'effect' && it.art.emoji) {
      return `<span style="position:relative;display:grid;place-items:center;width:${size}px;height:${size}px;font-size:${size / 3.2}px">${it.art.emoji.slice(0, 3).map((e, i) => `<span style="position:absolute;transform:translate(${(i - 1) * size / 4}px,${i === 1 ? -size / 8 : size / 10}px) rotate(${(i - 1) * 14}deg)">${e}</span>`).join('')}</span>`;
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
      : it.earn ? `<span class="tier earned" style="white-space:nowrap">${ic('lock', 12)} Earn it</span>`
      : it.season && !it.season.live ? `<span class="muted" style="font-size:12px">Back next year</span>`
      : `<button class="btn gold sm" data-buy="${it.id}">${money(it.price)}</button>`;
    return `<div class="vt ${it.tier} ${eq ? 'on' : ''}" style="--tc:${TC[it.tier]}">
      <div class="show">${preview(it, 112)}${it.kind === 'effect' || it.kind === 'theme' ? `<button class="btn sm" style="position:absolute;bottom:8px;left:8px;height:28px" data-try="${it.id}">Preview</button>` : ''}${it.season ? `<span class="tier seasonal" style="position:absolute;top:8px;left:8px">${esc(it.season.label)}</span>` : ''}</div>
      <div class="meta"><div class="row" style="justify-content:space-between"><b>${esc(it.name)}</b><span class="tier ${it.tier}">${it.tier}</span></div>
        <small>${esc(it.earn && !it.owned ? 'How to get it: ' + it.blurb : it.blurb)}${it.season ? `<br><span style="color:var(--gold)">${esc(seasonNote(it))}</span>` : ''}</small><div class="foot"><span class="muted num" style="font-size:12px">${it.owned ? (it.earn ? 'Earned' : it.price ? 'Owned' : 'Free') : it.pass ? 'Pass perk' : it.earn ? '' : 'Free'}</span>${act}</div></div></div>`;
  }

  /* ── avatars ── */
  const A = () => CS.avatars || { avatars: [], owned: [], mine: [], pending: [], custom: { enabled: false } };
  function avTile(a, mine) {
    const u = CS.user, eq = u && KohlerFace.idFor(u.username, u.equip) === a.id && u.equip?.avatar === a.id;
    const owned = mine || !a.price || A().owned.includes(a.id);
    const act = !u ? `<button class="btn sm" data-auth>Sign in</button>`
      : eq ? `<button class="btn sm" data-avuneq>Equipped</button>`
      : owned ? `<button class="btn neon sm" data-aveq="${a.id}">Use</button>`
      : `<button class="btn gold sm" data-avbuy="${a.id}">${money(a.price)}</button>`;
    return `<div class="vt av ${mine ? 'legendary' : a.tier} ${eq ? 'on' : ''}">
      <div class="show img"><img src="${KohlerFace.url(a.id, 512)}" alt="${esc(a.name)}" loading="lazy" decoding="async">${mine ? '<span class="tier legendary" style="position:absolute;top:8px;left:8px">Yours only</span>' : ''}</div>
      <div class="meta"><div class="row" style="justify-content:space-between;gap:6px"><b>${esc(a.name)}</b>${mine ? '' : `<span class="tier ${a.tier}">${a.tier}</span>`}</div>
        <div class="foot"><span class="muted" style="font-size:12px">${mine ? 'Custom' : owned && a.price ? 'Owned' : !a.price ? 'Free' : ''}</span>${act}</div></div></div>`;
  }
  function avatarsTab() {
    const d = A(), list = d.avatars.filter((a) => tierFilter === 'all' || a.tier === tierFilter);
    const tiers = ['all', 'free', 'common', 'rare', 'epic', 'legendary'].filter((t) => t === 'all' || d.avatars.some((a) => a.tier === t));
    const create = d.custom.enabled ? `<div class="mk-card"><div class="mk-faces">${d.avatars.slice(0, 4).map((a) => `<img src="${KohlerFace.url(a.id, 128)}" alt="">`).join('') || ''}</div>
        <div style="flex:1;min-width:220px"><span class="tag">${ic('sparkles', 14)}Made just for you</span><h2>Create your own avatar</h2>
          <p class="muted" style="margin:4px 0 0">Describe it, we paint ${d.custom.images} versions. Only you can use them.</p></div>
        <button class="btn gold lg" data-create>${ic('sparkles', 17)}Create · ${money(d.custom.price)}</button></div>` : '';
    const pend = d.pending.length ? `<div class="panelx" style="display:flex;align-items:center;gap:12px"><span class="live-dot"></span><b>Painting your custom avatars…</b><button class="btn sm" style="margin-left:auto" data-order="${d.pending[0].id}">Watch</button></div>` : '';
    const mine = d.mine.length ? `<div class="sect"><h2>Your custom avatars</h2><span>${d.mine.length}</span></div><div class="vt-grid">${d.mine.map((a) => avTile(a, true)).join('')}</div>` : '';
    const grid = d.avatars.length ? `<div class="sect"><h2>The collection</h2><span>${d.avatars.length} avatars</span></div>
        <div class="filters">${tiers.map((t) => `<button class="pill ${t === tierFilter ? 'on' : ''}" data-tier="${t}">${t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
          ${CS.user ? `<button class="pill ${CS.user.equip?.avatar_mode === 'default' ? 'on' : ''}" data-avdefault>Use default text avatar</button>` : ''}</div>
        <div class="vt-grid">${list.map((a) => avTile(a)).join('')}</div>`
      : `<div class="empty">${ic('sparkles', 40, 'color:var(--gold)')}<h3>The collection is being painted</h3><p>New avatars show up here as they're finished.</p>${d.review ? `<p style="margin-top:10px"><a class="btn gold" href="/admin#/avatars">${d.review} painted and waiting for your review</a></p>` : CS.user?.isAdmin ? '<p class="muted" style="font-size:13px">Progress: Admin → Avatar factory.</p>' : ''}</div>`;
    return create + pend + mine + grid;
  }

  function render() {
    const V = CS.vault; if (!V) return;
    const u = CS.user;
    const all = V.items.filter((i) => i.kind === tab);
    const cats = ['All', ...(CS.user ? ['Mine'] : []), ...CAT_ORDER.filter((c) => c !== 'All' && c !== 'Mine' && all.some((i) => i.cat === c))];
    if (!cats.includes(cat)) cat = 'All';
    const qq = search.trim().toLowerCase();
    const items = all.filter((i) => (cat === 'All' ? i.cat !== 'Flags' || qq : cat === 'Mine' ? i.owned && (i.price || i.earn || i.pass) : i.cat === cat) && (!qq || i.name.toLowerCase().includes(qq)))
      .sort((a, b) => (b.season?.live ? 1 : 0) - (a.season?.live ? 1 : 0) || TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.price - b.price || a.name.localeCompare(b.name));
    const live = (V.seasons || []).find((x) => x.live);
    const strip = ['frame', 'effect', 'theme', 'filter'].includes(tab) ? `${live ? `<div class="vt-season">${ic('sparkles', 15)}<b>${esc(live.label)} is here.</b> Seasonal items are only in the shop for a few weeks, and they're yours forever once you have them.</div>` : ''}
      <div class="vt-filters"><div class="filters">${cats.map((c) => `<button class="pill ${c === cat ? 'on' : ''}" data-vcat="${c}">${c === 'Flags' ? 'Country flags' : c}</button>`).join('')}</div>
        ${tab === 'frame' ? `<input class="inp vt-search" id="vtq" placeholder="Search frames or countries" value="${esc(search)}">` : ''}</div>` : '';
    const pass = V.items.find((i) => i.kind === 'pass');
    $('#view').innerHTML = `<section class="vt-hero"><div><span class="tag">${ic('gem', 14)}The Vault</span><h1>Look the part.</h1>
        <p>Avatars, frames, win effects, themes and filters. Cosmetic only, and yours forever.</p></div>
      ${u ? `<div class="vt-me"><div class="face">${(window.userFace || (() => ''))(u, 84)}</div><div><b style="font-family:var(--display)">${esc(u.username)}</b>
        <div class="muted" style="font-size:13px">${u.equip?.avatar ? esc(KohlerFace.byId[u.equip.avatar]?.name || 'Custom avatar') : 'Default avatar'}${u.passUntil ? ` · <span style="color:#c4b5fd">Pass until ${new Date(u.passUntil).toLocaleDateString()}</span>` : ''}</div>
        <div class="num" style="margin-top:4px;color:var(--neon);font-weight:700">${money(u.balance)}</div></div></div>` : `<button class="btn neon lg" data-auth>Sign in to collect</button>`}</section>
      <div class="tabs">${TABS.map(([k, l, i]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${ic(i, 18)}${l}</button>`).join('')}</div>
      ${tab === 'avatar' ? avatarsTab()
      : tab === 'pass' ? `<div class="pass-card"><div>${KohlerCharacter.frame({ ring: '#a78bfa', glow: true }, 96).replace('position:absolute;inset:0;', '')}</div>
          <div><h2>Kohler Pass</h2><div class="muted">30 days. Buy again any time to stack another 30.</div>
            <ul><li>No service fee on shop orders</li><li>The Pass Holder frame and a Pass badge</li></ul>
            ${u?.passUntil ? `<p style="color:#c4b5fd;margin:10px 0 0">Active until ${new Date(u.passUntil).toLocaleString()}</p>` : ''}</div>
          <div style="text-align:center"><div style="font-family:var(--display);font-size:30px;font-weight:800">${money(pass.price)}</div>
            ${u ? `<button class="btn gold lg" data-buy="${pass.id}" style="margin-top:8px">${u.passUntil ? 'Add 30 days' : 'Get the Pass'}</button>` : '<button class="btn neon" data-auth>Sign in</button>'}</div></div>
        <div class="sect"><h2>Pass perks</h2></div><div class="vt-grid">${V.items.filter((i) => i.pass).map(tile).join('')}</div>`
      : tab === 'badges' ? badgesTab()
      : strip + (items.length ? `<div class="vt-grid">${items.slice(0, 240).map(tile).join('')}</div>` : `<div class="empty">${cat === 'Mine' ? 'Nothing here yet.' : 'Nothing matches that.'}</div>`)}`;
    const qin = $('#vtq'); if (qin) { qin.oninput = () => { search = qin.value; const pos = qin.selectionStart; render(); const n = $('#vtq'); n.focus(); n.setSelectionRange(pos, pos); }; }
    if (tab === 'badges' && !badges) api('/badges').then((b) => { badges = b; if (tab === 'badges' && location.hash.startsWith('#/vault')) render(); }).catch(() => {});
  }
  function badgesTab() {
    if (!badges) return '<div class="empty" style="border:0">Loading badges…</div>';
    const p = badges.progress, have = badges.badges.filter((b) => b.earned).length;
    const steps = [[1, 1], [2, 1.1], [3, 1.25], [7, 1.5], [14, 1.75], [30, 2]];
    const streakCard = p ? `<div class="vt-streak"><div class="flame">${ic('flame', 30)}</div><div style="flex:1;min-width:200px"><div class="big num">${p.streak}<span>-day streak</span></div>
        <div class="muted" style="font-size:13.5px">${p.playedToday ? 'Today counts. ' : p.streak ? 'Play today to keep it going. ' : 'Play today to start one. '}XP ×${p.mult}${p.nextStep ? ` · ×${p.nextStep.mult} at ${p.nextStep.days} days` : ' (the max)'}. Best: ${p.bestStreak} days.</div>
        <div class="vt-steps">${steps.map(([d, m]) => `<span class="${p.streak >= d ? 'on' : ''}"><b>${d}d</b>×${m}</span>`).join('')}</div></div></div>` : '';
    return `${streakCard}<div class="sect"><h2>Badges</h2><span>${have} of ${badges.badges.length}</span></div>
      <div class="vt-badges">${badges.badges.map((b) => `<div class="vb ${b.earned ? 'on' : ''}"><div class="ico">${b.icon}</div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small>
        ${b.reward && KV[b.reward] ? `<small class="rw">${b.earned ? 'Unlocked' : 'Unlocks'}: ${esc(KV[b.reward].name)}</small>` : ''}${b.earned ? `<small class="when">${new Date(b.earnedAt).toLocaleDateString()}</small>` : ''}</div>`).join('')}</div>`;
  }
  async function reload() {
    const [v, a] = await Promise.all([api('/vault'), api('/avatars').catch(() => null)]);
    CS.vault = v; window.KV = Object.fromEntries(v.items.map((i) => [i.id, i]));
    if (a) { CS.avatars = a; KohlerFace.set(a.avatars); (a.pending || []).forEach((o) => follow(o.id)); }
  }
  async function show() {
    if (!CS.vault || !CS.avatars) { $('#view').innerHTML = '<div class="empty" style="border:0">Opening the Vault…</div>'; await reload(); }
    else reload().then(() => location.hash.startsWith('#/vault') && !$('#modal').classList.contains('on') && render()).catch(() => {});
    render();
  }
  const after = async (msg, fx) => { await reload(); paintMe(); render(); if (fx) KohlerFX.play(fx); buzz([20, 40, 60]); toast(msg); };

  /* ── buying ── */
  function confirmBuy({ title, blurb, price, art, go }) {
    $('#mbox').innerHTML = `<div style="display:grid;place-items:center;padding:4px 0 14px">${art}</div>
      <h2 style="font-family:var(--display);margin:0 0 4px;text-align:center">${esc(title)}</h2>${blurb ? `<p class="muted" style="text-align:center;margin:0 0 16px">${esc(blurb)}</p>` : ''}
      <div class="panelx"><div class="kv"><span>Price</span><b class="num">${money(price)}</b></div><div class="kv"><span>Paid from</span><b>${CS.user.testMode ? 'Test balance' : 'Your balance'} (${money(CS.user.balance)})</b></div></div>
      <button class="btn gold wide lg" id="vbuy">Buy for ${money(price)}</button><button class="btn ghost wide" style="margin-top:6px" onclick="document.getElementById('modal').classList.remove('on')">Not now</button>`;
    $('#modal').classList.add('on');
    $('#vbuy').onclick = async () => {
      $('#vbuy').disabled = true;
      try { await go(); $('#modal').classList.remove('on'); }
      catch (e) { $('#vbuy').disabled = false; if (e.status === 402) { $('#modal').classList.remove('on'); toast('Not enough balance. Top up first.'); wallet('deposit'); } else toast(e.message); }
    };
  }
  function buyItem(id) {
    const it = KV[id]; if (!it) return; if (!CS.user) return authModal();
    confirmBuy({ title: it.name, blurb: it.blurb, price: it.price, art: preview(it, 140), go: async () => {
      const out = await api('/vault/buy', { method: 'POST', body: { item: id } });
      CS.user.balance = out.balance; CS.user.equip = out.equip || CS.user.equip; CS.user.passUntil = out.passUntil;
      await after(it.kind === 'pass' ? 'Kohler Pass active' : `${it.name} is yours and equipped`, it.kind === 'effect' ? it.id : 'fx-confetti');
    } });
  }
  function buyAvatar(id) {
    const a = KohlerFace.byId[id]; if (!a) return; if (!CS.user) return authModal();
    confirmBuy({ title: a.name, blurb: `${a.tier[0].toUpperCase() + a.tier.slice(1)} avatar. Yours to keep and use any time.`, price: a.price,
      art: `<img src="${KohlerFace.url(id, 512)}" alt="" style="width:220px;height:220px;border-radius:28px;object-fit:cover">`, go: async () => {
        const out = await api('/avatars/buy', { method: 'POST', body: { id } });
        CS.user.balance = out.balance; CS.user.equip = out.equip;
        await after(`${a.name} is yours and equipped`, CS.user.equip?.effect || 'fx-confetti');
      } });
  }
  async function equipAvatar(id) {
    try { const out = await api('/avatars/equip', { method: 'POST', body: id === 'default' ? { default: true } : { id } }); CS.user.equip = out.equip; paintMe(); render(); buzz(10); toast(id && id !== 'default' ? 'Avatar equipped' : 'Back to your default avatar'); }
    catch (e) { toast(e.message); }
  }
  async function equip(slot, item) {
    try { const out = await api('/vault/equip', { method: 'POST', body: { slot, item } }); CS.user.equip = out.equip; await reload(); paintMe(); render(); buzz(10); }
    catch (e) { toast(e.message); }
  }

  /* ── create your own ── */
  async function builder() {
    if (!CS.user) return authModal();
    opts = opts || await api('/avatars/custom/options');
    const d = A().custom;
    const sel = Object.assign({ prompt: '', personality: '', background: 'colourful_studio' }, CS.avDraft || {});
    const IDEAS = ['a grumpy pigeon in a tiny tuxedo', 'a hamster bodybuilder with gold chains', 'a sleepy dragon in pyjamas', 'a robot chef with a giant moustache', 'a smug cat wearing a diamond crown', 'an alien DJ with glowing headphones'];
    const chips = (key, list) => `<div class="chips-wrap">${list.map((o) => `<button class="pill ${sel[key] === o.id ? 'on' : ''}" data-k="${key}" data-v="${o.id}">${esc(o.label)}</button>`).join('')}</div>`;
    const paint = () => {
      $('#mbox').innerHTML = `<h2 style="font-family:var(--display);margin:0 0 4px">Create your avatar</h2>
        <p class="muted" style="margin:0 0 14px">Describe it. We paint ${d.images} versions, only for you.</p>
        <label class="field"><span>Your avatar</span><textarea class="inp" id="bP" maxlength="200" rows="3" style="height:auto;padding:12px;resize:vertical;font:15px/1.45 var(--body)" placeholder="${esc(IDEAS[Math.floor(Math.random() * IDEAS.length)])}">${esc(sel.prompt)}</textarea>
          <small class="faint" style="display:flex;justify-content:space-between"><span>Made-up characters only</span><span id="bN">${sel.prompt.length}/200</span></small></label>
        <div class="chips-wrap" style="margin:-4px 0 14px">${IDEAS.slice(0, 4).map((x) => `<button class="pill" style="text-transform:none" data-idea="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div class="field"><span>Mood (optional)</span>${chips('personality', [{ id: '', label: 'any' }, ...opts.personalities])}</div>
        <div class="field"><span>Scene</span>${chips('background', opts.backgrounds)}</div>
        <div class="err" id="bErr"></div>
        <button class="btn gold wide lg" id="bGo">${ic('sparkles', 17)}Paint ${d.images} for ${money(d.price)}</button>
        <p class="muted" style="font-size:12px;text-align:center;margin:8px 0 0">${CS.user.testMode ? 'Test balance' : 'Balance'} ${money(CS.user.balance)}. Failed paints are refunded.</p>`;
      const P = $('#bP');
      P.oninput = () => { sel.prompt = P.value; CS.avDraft = { ...sel }; $('#bN').textContent = `${P.value.length}/200`; };
      $('#mbox').querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { sel[b.dataset.k] = b.dataset.v; CS.avDraft = { ...sel }; buzz(5); paint(); }));
      $('#mbox').querySelectorAll('[data-idea]').forEach((b) => (b.onclick = () => { sel.prompt = b.dataset.idea; CS.avDraft = { ...sel }; paint(); }));
      $('#bGo').onclick = async () => {
        sel.prompt = P.value.trim();
        if (sel.prompt.length < 6) { $('#bErr').textContent = 'Describe your avatar in a few words.'; return P.focus(); }
        $('#bGo').disabled = true; $('#bGo').textContent = 'Checking…';
        try {
          const out = await api('/avatars/custom', { method: 'POST', body: { prompt: sel.prompt, personality: sel.personality || undefined, background: sel.background } });
          CS.avDraft = null; CS.user.balance -= d.price; paintMe(); buzz([20, 40]); watch(out.order);
        } catch (e) {
          $('#bGo').disabled = false; $('#bGo').innerHTML = `${ic('sparkles', 17)}Paint ${d.images} for ${money(d.price)}`;
          if (e.status === 402) { $('#modal').classList.remove('on'); toast('Not enough balance. Top up first.'); wallet('deposit'); } else $('#bErr').textContent = e.message;
        }
      };
    };
    $('#modal').classList.add('on'); paint();
    $('#mbox').scrollTop = 0;
  }
  // One poller per order, one request at a time. On Vercel these requests are what paint the
  // order, so it keeps going (quietly) after the window is closed, as long as Kohler is open.
  const watching = new Map();
  function follow(orderId, onUpdate) {
    const w = watching.get(orderId) || { subs: new Set(), last: null };
    if (onUpdate) w.subs.add(onUpdate);
    if (!watching.has(orderId)) {
      watching.set(orderId, w);
      (async function loop() {
        let o = null;
        try { o = await api('/avatars/custom/' + orderId); w.last = o; w.subs.forEach((f) => f(o)); } catch {}
        if (o && o.status !== 'generating') {
          watching.delete(orderId);
          if (!w.subs.size && o.avatars.length) toast(`Your custom avatars are ready. Open the Vault to wear one.`);
          reload().then(() => location.hash.startsWith('#/vault') && !$('#modal').classList.contains('on') && render()).catch(() => {});
          return;
        }
        // ask again soon while painting, or when the server says the next picture can start
        const wait = !o ? 5000 : o.nextAt ? Math.min(30_000, Math.max(2000, new Date(o.nextAt) - Date.now() + 500)) : 1500;
        setTimeout(loop, wait);
      })();
    } else if (onUpdate && w.last) onUpdate(w.last);
    return () => w.subs.delete(onUpdate);
  }
  function watch(orderId) {
    $('#modal').classList.add('on');
    const t0 = Date.now();
    let stop = () => {};
    const show = (o) => {
      if (!$('#modal').classList.contains('on')) return stop();
      const slots = Array.from({ length: o.images }, (_, i) => o.avatars[i]);
      const done = o.status !== 'generating';
      $('#mbox').innerHTML = `<h2 style="font-family:var(--display);margin:0 0 4px">${done ? (o.avatars.length ? 'Your avatars are ready' : 'That didn’t work') : 'Painting your avatars…'}</h2>
        <p class="muted" style="margin:0 0 14px">${done ? (o.avatars.length ? 'Tap one to wear it.' : `Nothing could be painted. ${money(o.refunded)} went back to your balance.`)
          : o.waitingUntil ? `The painter is resting until ${new Date(o.waitingUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Your order is safe.`
          : o.painter === 'backup' && o.nextAt ? `Busy painter: the next picture starts in about ${Math.max(1, Math.round((new Date(o.nextAt) - Date.now()) / 60000))} min. You can close this; we keep going.`
          : o.ahead ? `${o.ahead} ahead of you.` : `${Math.floor((Date.now() - t0) / 1000)}s`}</p>
        <div class="mk-grid">${slots.map((a) => a ? `<button class="mk-slot done" data-pick="${a.id}"><img src="${KohlerFace.url(a.id, 512)}" alt=""></button>` : `<div class="mk-slot ${done ? 'fail' : 'wait'}"></div>`).join('')}</div>
        ${done && o.refunded && o.avatars.length ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">${money(o.refunded)} refunded for the ones that didn’t come out.</p>` : ''}
        <button class="btn ghost wide" style="margin-top:12px" id="wClose">${done ? 'Close' : 'Keep browsing'}</button>`;
      $('#wClose').onclick = () => { stop(); $('#modal').classList.remove('on'); reload().then(() => location.hash.startsWith('#/vault') && render()); };
      $('#mbox').querySelectorAll('[data-pick]').forEach((b) => (b.onclick = async () => { stop(); await equipAvatar(b.dataset.pick); $('#modal').classList.remove('on'); await after('Looking good', CS.user.equip?.effect || 'fx-confetti'); }));
      if (done) { stop(); if (o.avatars.length) { KohlerFX.play('fx-confetti'); buzz([30, 60, 30]); } refreshMe(); }
    };
    $('#mbox').innerHTML = '<h2 style="font-family:var(--display)">Painting your avatars…</h2><div class="mk-grid">' + '<div class="mk-slot wait"></div>'.repeat(A().custom.images || 4) + '</div>';
    stop = follow(orderId, show);
  }

  document.addEventListener('click', (e) => {
    if (!location.hash.startsWith('#/vault') && !e.target.closest('#mbox')) return;
    const t = e.target.closest('[data-tab],[data-buy],[data-eq],[data-uneq],[data-try],[data-auth],[data-avbuy],[data-aveq],[data-avuneq],[data-avdefault],[data-create],[data-tier],[data-order],[data-vcat]'); if (!t) return;
    if (t.closest('#mbox') && !t.matches('[data-buy],[data-auth]')) return;
    e.preventDefault();
    const d = t.dataset;
    if (d.tab) { tab = d.tab; cat = 'All'; search = ''; if (tab === 'badges') badges = null; render(); }
    else if (d.buy) buyItem(d.buy);
    else if (d.eq) equip(KV[d.eq].slot, d.eq);
    else if (d.uneq) equip(d.uneq, null);
    else if (d.try) { const it = KV[d.try]; if (it?.kind === 'theme') { window.KohlerTheme?.set(it.art); toast(`Previewing ${it.name}`); clearTimeout(window.__thPrev); window.__thPrev = setTimeout(() => window.KohlerTheme?.set(CS.user?.equipArt?.theme || null), 6000); } else KohlerFX.play(d.try, it?.art); }
    else if (d.vcat) { cat = d.vcat; render(); }
    else if (d.avbuy) buyAvatar(d.avbuy);
    else if (d.aveq) equipAvatar(d.aveq);
    else if (t.hasAttribute('data-avuneq')) equipAvatar('default');
    else if (t.hasAttribute('data-avdefault')) equipAvatar('default');
    else if (t.hasAttribute('data-create')) builder();
    else if (d.tier) { tierFilter = d.tier; render(); }
    else if (d.order) watch(d.order);
    else if (t.hasAttribute('data-auth')) authModal();
  });
  window.Vault = { show, reload };
})();
