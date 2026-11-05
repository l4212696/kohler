// Survivor, inside the casino page. Everyone stakes the same; one random seat
// (two at 10-seat tables) is knocked out; everyone else gets their stake back
// plus an equal share of the knocked-out stake, minus a 10% fee.
// Uses the casino page's helpers: api, money, esc, ic, toast, authModal, wallet, refreshMe, CS.
(function () {
  const SV = { es: null, code: null, live: null, t: null, lobby: null, ceremony: false, pending: null, mode: 'all', clock: null, poll: null };
  const MODES = { duel: ['Duel', '2 players, 1 knocked out', 'swords'], classic: ['Classic', '3 players, 1 knocked out', 'users'], squad: ['Squad', '5 players, 1 knocked out', 'shield-check'], blitz: ['Blitz', '10 players, 2 knocked out', 'zap'], crew: ['Private', 'Your own table', 'lock'] };
  const share = (stake, n, L, bps = 1000) => { const f = stake * L, fee0 = Math.floor(f * bps / 10000), s = Math.floor((f - fee0) / (n - L)); return s; };
  let ac; const tone = (f, d = .07, t = 'sine', g = .05, w = 0) => { try { ac = ac || new AudioContext(); const x = ac.currentTime + w, o = ac.createOscillator(), v = ac.createGain(); o.type = t; o.frequency.value = f; v.gain.setValueAtTime(g, x); v.gain.exponentialRampToValueAtTime(.0001, x + d); o.connect(v).connect(ac.destination); o.start(x); o.stop(x + d); } catch {} };
  const buzz = (p) => { try { navigator.vibrate?.(p); } catch {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const face = (seat, size) => {
    if (seat.isHouse) return KohlerLogo.mark(size, true);
    return KohlerFace.html(seat.name, { avatar: seat.avatar, filter: seat.filter }, size, Math.round(size * 0.3));
  };

  function connect(code) {
    SV.es?.close();
    try {
      SV.es = new EventSource('/api/pool/stream' + (code ? '?code=' + encodeURIComponent(code) : ''));
      SV.es.addEventListener('change', (e) => { const d = JSON.parse(e.data); if (SV.code && (d.code === SV.code || d.code === SV.live)) refetch(); else if (!SV.code) refetchLobby(); });
    } catch {}
  }
  let rt;
  const refetch = () => { clearTimeout(rt); rt = setTimeout(() => SV.code && loadTable(SV.code).catch(() => {}), 120); };
  const refetchLobby = () => { clearTimeout(rt); rt = setTimeout(() => !SV.code && location.hash.startsWith('#/survivor') && loadLobby().catch(() => {}), 250); };
  function stop() { SV.ceremony = false; SV.pending = null; SV.es?.close(); SV.es = null; clearInterval(SV.clock); clearInterval(SV.poll); SV.code = null; SV.t = null; }

  /* ── lobby ── */
  async function lobby() {
    stop(); connect(null);
    $('#view').innerHTML = `<section class="sv-hero">
        <div><span class="sv-kicker">${ic('flame', 14)}Kohler's main event</span>
          <h1>Survivor</h1>
          <p>One gets knocked out. Everyone else splits their stake. <a href="/rules.html#survivor" style="color:var(--gold)">How it works</a></p>
          <div class="row" style="margin-top:18px;flex-wrap:wrap"><button class="btn neon" id="svQuick">${ic('zap', 16)}Quick join</button><button class="btn" id="svNew">${ic('lock', 16)}Start a private table</button></div></div>
        <div class="sv-live" id="svLive"></div></section>
      <div class="tabs" id="svModes">${[['all', 'All tables', 'layout-grid'], ...Object.entries(MODES).filter(([k]) => k !== 'crew').map(([k, [l, , i]]) => [k, l, i])].map(([k, l, i]) => `<button class="tab ${SV.mode === k ? 'on' : ''}" data-svm="${k}">${ic(i, 18)}${l}</button>`).join('')}</div>
      <div id="svTables"></div>`;
    $('#svNew').onclick = () => (CS.user ? crewModal() : authModal());
    $('#svQuick').onclick = () => quickJoin();
    $('#svModes').onclick = (e) => { const b = e.target.closest('[data-svm]'); if (!b) return; SV.mode = b.dataset.svm; document.querySelectorAll('[data-svm]').forEach((x) => x.classList.toggle('on', x === b)); paintLobby(); };
    await loadLobby();
    SV.poll = setInterval(() => !document.hidden && refetchLobby(), 15000);
  }
  async function loadLobby() { SV.lobby = await api('/pool/lobby'); paintLobby(); }
  function tableCard(t) {
    const r = t.round || { seats: 0, houseIn: 0 }, n = t.maxSeats, L = t.losers || 1, win = share(t.stake, n, L, r.feeBps ?? 1000);
    const left = n - r.seats, hot = left > 0 && left <= Math.ceil(n / 3);
    const dots = Array.from({ length: n }, (_, i) => `<i class="${i < r.seats ? (i >= r.seats - (r.houseN || 0) ? 'h' : 'f') : ''}"></i>`).join('');
    return `<a class="sv-card ${hot ? 'hot' : ''} ${r.meIn ? 'me' : ''}" href="#/survivor/${t.code}">
      <div class="sv-card-top"><span class="sv-mode">${ic(MODES[t.mode]?.[2] || 'users', 14)}${esc(MODES[t.mode]?.[0] || t.name)}</span>${r.meIn ? '<span class="sv-in">You’re in</span>' : hot ? `<span class="sv-hot">${left === 1 ? 'Last seat' : left + ' left'}</span>` : ''}</div>
      <div class="sv-stake num">${money(t.stake).replace('.00', '')}</div>
      <div class="sv-win">Survivors win <b class="num">+${money(win)}</b> each</div>
      <div class="sv-dots">${dots}</div>
      <div class="sv-card-foot"><span class="num">${r.seats}/${n} seated</span><span>${L} knocked out</span></div></a>`;
  }
  function paintLobby() {
    const L = SV.lobby; if (!L || SV.code || !$('#svTables')) return;
    const live = L.live || {};
    const feed = (L.feed || []).slice(0, 6);
    $('#svLive').innerHTML = `<div class="sv-live-h"><span class="live-dot"></span><b class="num">${live.seated || 0}</b> seated now <span class="muted">· <b class="num">${money(live.pots || 0)}</b> staked</span></div>
      ${feed.length ? feed.map((f) => `<div class="sv-feed"><span class="sk">${ic('x', 12)}</span><span><b>${esc(f.losers.join(' & '))}</b> knocked out at ${esc(f.table)} ${money(f.stake).replace('.00', '')}<br><small>${f.survivors} survived, +${money(f.share)} each</small></span></div>`).join('')
        : '<p class="muted" style="margin:10px 0 0">Results from every table appear here.</p>'}`;
    const list = L.tables.filter((t) => SV.mode === 'all' || t.mode === SV.mode);
    const group = (m) => list.filter((t) => t.mode === m);
    let html = '';
    if (L.crew?.length) html += `<div class="sect"><h2>Your private tables</h2><span>Only people with the link can sit</span></div><div class="sv-grid">${L.crew.map(tableCard).join('')}</div>`;
    for (const m of ['duel', 'classic', 'squad', 'blitz']) {
      const g = group(m); if (!g.length) continue;
      html += `<div class="sect"><h2>${MODES[m][0]}</h2><span>${MODES[m][1]}</span></div><div class="sv-grid">${g.map(tableCard).join('')}</div>`;
    }
    $('#svTables').innerHTML = html || '<div class="empty"><h3>No tables right now</h3><p>Start a private table and invite your group.</p></div>';
  }
  async function quickJoin() {
    if (!CS.user) return authModal();
    const L = SV.lobby || await api('/pool/lobby');
    const t = [...L.tables].filter((x) => x.round && !x.round.meIn && x.stake <= (CS.user.balance || 0)).sort((a, b) => (b.round.seats / b.maxSeats) - (a.round.seats / a.maxSeats))[0];
    if (!t) return toast('No table fits your balance right now. Top up or start your own.');
    location.hash = '#/survivor/' + t.code;
  }

  /* ── table ── */
  async function table(code) {
    stop(); SV.code = code; connect(code);
    $('#view').innerHTML = `<div class="empty" style="border:0">Pulling up a chair…</div>`;
    await loadTable(code);
    // a table you're seated at that fills with simulated players refreshes every 2.5s, so the room
    // fills up live; otherwise every 12s (live updates also arrive over the stream)
    let n = 0;
    SV.poll = setInterval(() => { if (document.hidden) return; const fast = SV.t?.table?.sandbox && SV.t.seats?.some((x) => x.me); if (fast || ++n % 5 === 0) refetch(); }, 2500);
  }
  async function loadTable(code) {
    const d = await api('/pool/t/' + encodeURIComponent(code));
    if (SV.code !== code) return;
    if (d.table.liveCode && d.table.liveCode !== SV.live) { SV.live = d.table.liveCode; if (SV.live !== code) connect(SV.live); }
    const prev = SV.t;
    if (SV.ceremony) { SV.pending = d; return; }
    if (prev?.table.round && d.table.round && prev.table.round.id !== d.table.round.id) {
      const old = await api('/pool/rounds/' + prev.table.round.id).catch(() => null);
      if (old?.status === 'settled') { SV.pending = d; return ceremony(old, prev); }
      if (old?.status === 'cancelled') toast('Round cancelled. Every stake was refunded.');
    }
    paint(d, prev);
  }
  const pos = (i, n) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return { l: 50 + 42 * Math.cos(a), t: 50 + 42 * Math.sin(a) }; };
  function seatsHtml(seats, n, prevKeys, lost = [], won = false) {
    return Array.from({ length: n }, (_, i) => {
      const s = seats[i], p = pos(i, n), st = `left:${p.l}%;top:${p.t}%`;
      if (!s) return `<div class="sv-seat open" data-i="${i}" style="${st}"><div class="av">${ic('user', 22)}</div><div class="nm">open</div></div>`;
      const fresh = prevKeys && !prevKeys.has(s.index + s.name);
      const art = s.frameArt || (s.frame && window.KV?.[s.frame]?.art), fr = art ? KohlerCharacter.frame(art, 58) : '';
      return `<div class="sv-seat ${s.me ? 'me' : ''} ${s.isHouse ? 'house' : ''} ${fresh ? 'new' : ''} ${lost.includes(i) ? 'out' : ''} ${won && !lost.includes(i) ? 'safe' : ''}" data-i="${i}" style="${st}">
        <div class="av">${face(s, 58)}${fr}</div><div class="nm">${s.me ? 'You' : esc(s.name)}${s.isHouse ? ' <span class="house-tag">House</span>' : ''}</div></div>`;
    }).join('');
  }
  function paint(d, prev) {
    SV.t = d;
    const t = d.table, r = t.round || { seats: 0 }, n = t.maxSeats, L = t.losers || 1, win = share(t.stake, n, L, r.feeBps ?? 1000);
    const mine = d.seats.find((s) => s.me);
    const prevKeys = prev?.table.round?.id === r.id ? new Set(prev.seats.map((s) => s.index + s.name)) : null;
    if (prevKeys) {
      const added = d.seats.filter((s) => !prevKeys.has(s.index + s.name));
      if (added.some((s) => s.me)) { tone(523, .09, 'triangle'); tone(784, .14, 'triangle', .05, .08); buzz([14, 40, 28]); }
      else if (added.length) { tone(440, .06); buzz(10); }
      if (added.length && n - d.seats.length === 1) { [440, 554, 659].forEach((f, i) => tone(f, .07, 'square', .025, i * .06)); buzz([12, 50, 12]); }
    }
    $('#view').innerHTML = `<div class="sv-top"><a class="iconbtn" href="#/survivor" aria-label="All tables">${ic('chevron-left', 18)}</a>
        <div><h2>${esc(MODES[t.mode]?.[0] || t.name)} ${t.mode === 'crew' ? esc(t.name) : money(t.stake).replace('.00', '')}</h2><div class="muted" style="font-size:13px">${n} seats, ${L} knocked out</div></div>
        <div class="grow"></div><button class="btn sm" id="svShare">${ic('users', 15)}Invite</button></div>
      <div class="sv-layout"><section>
        <div class="sv-arena" id="arena"><div class="sv-ring"></div>
          <div class="sv-center"><div class="muted">Each survivor wins</div><div class="sv-big num" id="svBig">+${money(win)}</div>
            <div class="sv-sub num" id="svSub">${r.seats}/${n} seated · stake ${money(t.stake)}</div></div>
          <div id="seats">${seatsHtml(d.seats, n, prevKeys)}</div></div>
        <div class="sv-action" id="svAction"></div></section>
        <aside class="sv-side"><div class="panelx"><b>How this table pays</b>
            <div class="kv"><span>Everyone stakes</span><b class="num">${money(t.stake)}</b></div>
            <div class="kv"><span>Knocked out</span><b>${L} of ${n}, at random</b></div>
            <div class="kv"><span>Knocked-out stake</span><b class="num">${money(t.stake * L)}</b></div>
            <div class="kv"><span>Fee (10% of that)</span><b class="num">${money(t.stake * L - win * (n - L))}</b></div>
            <div class="kv"><span>Each survivor gets</span><b class="num up">${money(t.stake)} + ${money(win)}</b></div>
            <p style="font-size:12.5px;margin:10px 0 0"><a href="/rules.html#survivor" style="color:var(--dim);text-decoration:underline">Rules, fairness and House seats</a></p></div>
          <div class="panelx"><div class="row" style="justify-content:space-between"><b>Recent rounds</b><span class="muted" style="font-size:12px">tap to verify</span></div><div id="svHist"></div></div></aside></div>`;
    $('#svShare').onclick = () => shareTable(t);
    action(d);
    $('#svHist').innerHTML = d.history.length ? d.history.slice(0, 12).map((h) => `<div class="sv-h" data-v="${h.id}">
        <span>${h.status === 'cancelled' ? '<span class="muted">cancelled, refunded</span>' : `${ic('x', 12, 'color:var(--rose)')} <b>${esc((h.losers || []).join(' & '))}</b>`}</span>
        <span class="num ${h.meSurvived ? 'up' : h.meLost ? 'down' : 'muted'}">${h.meSurvived ? '+' + money(h.share) : h.meLost ? '−' + money(h.stake) : '+' + money(h.share) + ' each'}</span></div>`).join('')
      : '<p class="muted" style="font-size:13px">First round on this table.</p>';
    $('#svHist').onclick = (e) => { const x = e.target.closest('[data-v]'); if (x) verify(x.dataset.v); };
  }
  function action(d, result) {
    const t = d.table, n = t.maxSeats, r = t.round || { seats: 0 }, mine = d.seats.find((s) => s.me), el = $('#svAction');
    const banner = result ? (result.out ? `<div class="sv-banner out"><b>Knocked out</b><span>−${money(result.stake)}. Run it back?</span></div>`
      : result.in ? `<div class="sv-banner safe"><b class="num">+${money(result.share)}</b><span>You survived. Stake back plus your share.</span></div>`
      : `<div class="sv-banner"><b>${esc(result.losers.join(' & '))} knocked out</b><span>Survivors took +${money(result.share)} each.</span></div>`) : '';
    if (!CS.user) { el.innerHTML = banner + `<p class="sv-fine">${money(t.stake)} a seat. 18+.</p><button class="btn neon wide lg" id="svIn">Sign in to take a seat</button>`; $('#svIn').onclick = () => authModal(); return; }
    if (d.paused) { el.innerHTML = banner + '<p class="sv-fine">Survivor is paused for maintenance. Seats already taken still play.</p>'; return; }
    if (mine) { el.innerHTML = banner + `<p class="sv-fine">You're in. ${n - d.seats.length} seat${n - d.seats.length === 1 ? '' : 's'} to go.</p>
      <div class="row"><button class="btn wide" id="svLeave" style="flex:1">Leave (refund ${money(t.stake)})</button><button class="btn neon" id="svInv" style="flex:1">${ic('users', 16)}Invite friends</button></div>`;
      $('#svLeave').onclick = leave; $('#svInv').onclick = () => shareTable(t); return; }
    if (d.seats.length >= n) { el.innerHTML = banner + '<p class="sv-fine">Table full. Drawing now…</p>'; return; }
    const odds = `${t.losers || 1} in ${n}`;
    el.innerHTML = banner + `<p class="sv-fine">Knocked out: <b>${odds}</b> chance.</p>
      <button class="hold" id="svHold"><i></i><span>${result ? 'Hold to run it back' : 'Hold to take a seat'} · ${money(t.stake)}</span></button>`;
    hold($('#svHold'), join);
  }
  function hold(btn, done) {
    const DUR = 600; let raf, t0, step;
    const bar = btn.querySelector('i'), reset = () => { cancelAnimationFrame(raf); bar.style.width = '0'; t0 = null; };
    const f = (t) => { const k = Math.min(1, (t - t0) / DUR); bar.style.width = k * 100 + '%'; const s = Math.floor(k * 4); if (s > step) { step = s; buzz(4 + s * 4); tone(500 + s * 140, .04, 'triangle', .03); } if (k >= 1) { reset(); done(); return; } raf = requestAnimationFrame(f); };
    btn.onpointerdown = (e) => { e.preventDefault(); t0 = performance.now(); step = 0; raf = requestAnimationFrame(f); };
    btn.onpointerup = btn.onpointerleave = btn.onpointercancel = reset;
    btn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(); } };
  }
  async function join() {
    const seed = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { const out = await api(`/pool/t/${SV.code}/join`, { method: 'POST', body: { clientSeed: seed } }); if (!out.settled) refreshMe(); await loadTable(SV.code); }
    catch (e) { buzz([30, 40, 30]); if (e.status === 402) { toast('Not enough balance for this seat.'); wallet('deposit'); } else toast(e.message); }
  }
  async function leave() { try { await api(`/pool/t/${SV.code}/leave`, { method: 'POST' }); toast('Seat released, stake refunded'); refreshMe(); loadTable(SV.code); } catch (e) { toast(e.message); } }

  async function ceremony(round, prev) {
    SV.ceremony = true; const code = SV.code, gone = () => SV.code !== code || !$('#seats');
    const n = prev.table.maxSeats, seats = round.seats, k = seats.length, losers = round.loserIndexes || [];
    const me = seats.findIndex((s) => s.me), wasIn = me >= 0, iLost = losers.includes(me);
    $('#seats').innerHTML = seatsHtml(seats.map((s) => ({ ...s })), n, null);
    $('#svBig').textContent = 'Drawing…'; $('#svSub').textContent = 'seeds locked ' + round.serverSeedHash.slice(0, 10) + '…';
    $('#svAction').innerHTML = '<p class="sv-fine">Revealing…</p>';
    for (let li = 0; li < losers.length; li++) {
      const target = losers[li], hops = Math.max(12, k * 2 + 1);
      for (let h = 0; h < hops; h++) {
        const cur = (((target - (hops - 1 - h)) % k) + k) % k;
        document.querySelectorAll('.sv-seat.spot').forEach((x) => x.classList.remove('spot'));
        document.querySelector(`.sv-seat[data-i="${cur}"]`)?.classList.add('spot');
        tone(700 + h * 12, .03, 'triangle', .035); buzz(5);
        await sleep(40 + 300 * Math.pow(h / hops, 2.4));
        if (gone()) return;
      }
      document.querySelectorAll('.sv-seat.spot').forEach((x) => x.classList.remove('spot'));
      document.querySelector(`.sv-seat[data-i="${target}"]`)?.classList.add('out');
      tone(160, .35, 'sawtooth', .05); buzz(target === me ? [80] : [20]);
      await sleep(500);
    }
    document.querySelectorAll('.sv-seat:not(.out):not(.open)').forEach((x) => x.classList.add('safe'));
    $('#svBig').textContent = '+' + money(round.share); $('#svSub').textContent = `${k - losers.length} survived`;
    if (wasIn && !iLost) { [523, 659, 784, 1047].forEach((f, i) => tone(f, .2, 'triangle', .07, i * .07)); buzz([30, 60, 30, 60, 140]); KohlerFX?.play(CS.user?.equip?.effect); }
    await sleep(2200);
    if (gone()) return;
    SV.ceremony = false;
    const next = SV.pending; SV.pending = null;
    paint(next, null);
    action(next, { in: wasIn && !iLost, out: wasIn && iLost, share: round.share, stake: round.stake, losers: losers.map((i) => seats[i].name) });
    refreshMe();
  }

  async function verify(id) {
    const r = await api('/pool/rounds/' + id);
    const sha = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, '0')).join('');
    let res = 'Not drawn yet.';
    if (r.status === 'settled') {
      const okHash = (await sha(r.serverSeed)) === r.serverSeedHash, client = await sha(r.seats.map((s) => s.clientSeed).join('|'));
      const left = r.seats.map((_, i) => i), losers = [];
      for (let i = 0; i < (r.losersN || 1); i++) { const h = await sha(`${r.serverSeed}:${client}:${r.id}:${i}`); losers.push(left.splice(parseInt(h.slice(0, 13), 16) % left.length, 1)[0]); }
      const good = okHash && client === r.clientSeed && losers.join() === (r.loserIndexes || []).join();
      res = `${good ? '✅ Verified in your browser' : '❌ Mismatch'}<br><span class="muted">knocked out: ${losers.map((i) => esc(r.seats[i].name)).join(' & ')}</span>`;
    }
    modal(`<h2 style="font-family:var(--display);margin:0 0 6px">Verify round #${r.seq}</h2>
      <div class="field"><span>Server seed hash (published before anyone sat)</span><div class="addr">${r.serverSeedHash}</div></div>
      <div class="field"><span>Server seed (revealed after)</span><div class="addr">${r.serverSeed || 'hidden until the draw'}</div></div>
      <div class="field"><span>Seat seeds, in seat order</span><div class="addr">${r.seats.map((s, i) => `${i} ${esc(s.name)} ${s.clientSeed}`).join('<br>')}</div></div>
      <div class="panelx" style="margin:12px 0">${res}</div>
      <p class="muted" style="font-size:12px">For each knocked-out pick i: hash = sha256(server : sha256(seat seeds joined by "|") : roundId : i); pick = int(hash[0..13], 16) mod seats still in.</p>`);
  }
  function modal(html) { $('#mbox').innerHTML = html; $('#modal').classList.add('on'); }

  async function shareTable(t) {
    const url = location.origin + '/t/' + t.code, n = t.maxSeats, L = t.losers || 1;
    const text = `Survive ${t.mode === 'crew' ? t.name : MODES[t.mode]?.[0]} on Kohler: ${money(t.stake).replace('.00', '')} in, survivors win +${money(share(t.stake, n, L)).replace('.00', '')} each.`;
    try { if (navigator.share) return await navigator.share({ title: 'Survivor on Kohler', text, url }); } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text + ' ' + url); toast('Invite link copied. Paste it in your group chat.'); } catch { prompt('Copy this link', url); }
  }
  async function crewModal() {
    const name = (await api('/pool/name')).name;
    let mode = 'squad', stake = 500;
    const stakes = (SV.lobby?.settings?.stakes || [100, 250, 500, 1000, 2500, 5000, 10000]);
    modal(`<h2 style="font-family:var(--display);margin:0 0 4px">Start a private table</h2><p class="muted" style="margin:0 0 14px">Only people with your link can sit.</p>
      <label class="field"><span>Table name</span><input class="inp" id="cName" value="${esc(name)}" maxlength="24"></label>
      <div class="field"><span>Size</span><div class="row" style="flex-wrap:wrap" id="cMode">${['duel', 'classic', 'squad', 'blitz'].map((m) => `<button class="pill ${m === mode ? 'on' : ''}" data-m="${m}">${MODES[m][0]} (${MODES[m][1].split(',')[0]})</button>`).join('')}</div></div>
      <div class="field"><span>Stake</span><div class="row" style="flex-wrap:wrap" id="cStake">${stakes.map((s) => `<button class="pill ${s === stake ? 'on' : ''}" data-s="${s}">${money(s).replace('.00', '')}</button>`).join('')}</div></div>
      <div class="panelx" id="cPrev" style="margin-bottom:14px"></div><button class="btn neon wide lg" id="cGo">Open the table</button>`);
    const paintP = () => { const m = { duel: [2, 1], classic: [3, 1], squad: [5, 1], blitz: [10, 2] }[mode]; $('#cPrev').innerHTML = `Everyone stakes <b>${money(stake)}</b>. ${m[1]} of ${m[0]} knocked out. Survivors win <b class="up">+${money(share(stake, m[0], m[1]))}</b> each.`; };
    paintP();
    $('#cMode').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; mode = b.dataset.m; $('#cMode').querySelectorAll('.pill').forEach((x) => x.classList.toggle('on', x === b)); paintP(); };
    $('#cStake').onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; stake = +b.dataset.s; $('#cStake').querySelectorAll('.pill').forEach((x) => x.classList.toggle('on', x === b)); paintP(); };
    $('#cGo').onclick = async () => {
      try { const out = await api('/pool/tables', { method: 'POST', body: { name: $('#cName').value, stakeCents: stake, mode } }); $('#modal').classList.remove('on'); location.hash = '#/survivor/' + out.code;
        setTimeout(() => SV.t && shareTable(SV.t.table), 900); }
      catch (e) { toast(e.message); }
    };
  }

  window.Survivor = { lobby, table, stop, live: () => SV.lobby, prefetch: () => api('/pool/lobby').then((l) => (SV.lobby = l)).catch(() => null) };
})();
