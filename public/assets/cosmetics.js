// Vault cosmetics in the browser: frames (KohlerFrame), emoji win effects (KohlerFX), themes that
// decorate your own screen (KohlerTheme) and avatar filters. Item "art" comes from the server
// catalog (lib/vault-items.js); nothing here decides who owns what.
(function () {
  let uid = 0;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Frames sit OUTSIDE the avatar, like a border: the avatar is the 0..100 square (rounded ~30%),
  // the ring runs from its edge outwards. RING(w) is the band between the avatar's edge (with a
  // hair of overlap so no gap shows) and a rounded square w units further out.
  const R = 30, M = 12;   // avatar corner radius, and how far outside the avatar a frame may draw
  const rr = (a, b, r) => { const s = b - a; return `M${a + r} ${a}H${a + s - r}A${r} ${r} 0 0 1 ${b} ${a + r}V${b - r}A${r} ${r} 0 0 1 ${a + s - r} ${b}H${a + r}A${r} ${r} 0 0 1 ${a} ${b - r}V${a + r}A${r} ${r} 0 0 1 ${a + r} ${a}Z`; };
  const RING = (w) => rr(-w, 100 + w, R + w) + rr(1, 99, R - 1);

  // small repeating tiles; c = colours. Each returns [tile size, svg content]
  const PAT = {
    stripes: (c) => [c.length * 4, c.map((x, i) => `<rect x="${i * 4}" width="4" height="${c.length * 4}" fill="${x}"/>`).join(''), 45],
    facets: (c) => [10, `<rect width="10" height="10" fill="${c[1]}"/><path d="M0 0L10 0L5 5Z" fill="${c[0]}"/><path d="M0 10L5 5L10 10Z" fill="${c[2]}"/><path d="M0 0L5 5L0 10Z" fill="${c[1]}" opacity=".7"/>`],
    marble: (c) => [20, `<rect width="20" height="20" fill="${c[0]}"/><path d="M0 6C5 2 9 11 14 7S20 4 20 4M0 15C6 12 8 19 13 16S20 13 20 13" stroke="${c[1]}" stroke-width="1.2" fill="none"/><path d="M3 0C6 4 4 9 8 12" stroke="${c[2]}" stroke-width=".6" fill="none"/>`],
    stars: (c) => [16, `<rect width="16" height="16" fill="${c[0]}"/><circle cx="4" cy="5" r="3" fill="${c[1]}" opacity=".7"/><circle cx="3" cy="3" r=".7" fill="${c[2]}"/><circle cx="11" cy="9" r=".5" fill="${c[2]}"/><circle cx="7" cy="13" r=".9" fill="${c[2]}"/><circle cx="14" cy="2" r=".4" fill="${c[2]}"/>`],
    camo: (c) => [20, `<rect width="20" height="20" fill="${c[3]}"/><path d="M2 3c4-3 9 1 6 5s-8 2-6-5Z" fill="${c[0]}"/><path d="M11 9c5-2 9 2 6 6s-9 1-6-6Z" fill="${c[1]}"/><path d="M1 13c3-1 6 2 3 5s-5-1-3-5Z" fill="${c[2]}"/><path d="M13 1c3 0 4 3 1 4s-4-3-1-4Z" fill="${c[2]}"/>`],
    leopard: (c) => [12, `<rect width="12" height="12" fill="${c[0]}"/><ellipse cx="3.5" cy="3.5" rx="2.2" ry="1.7" fill="${c[2]}" stroke="${c[1]}" stroke-width="1"/><ellipse cx="9" cy="8.5" rx="2" ry="1.5" fill="${c[2]}" stroke="${c[1]}" stroke-width="1"/>`],
    zebra: (c) => [12, `<rect width="12" height="12" fill="${c[0]}"/><path d="M0 2Q6 4 12 1V4Q6 7 0 5ZM0 8Q6 10 12 7V10Q6 13 0 11Z" fill="${c[1]}"/>`],
    weave: (c) => [6, `<rect width="6" height="6" fill="${c[0]}"/><path d="M0 0L6 6M-1 5L1 7M5 -1L7 1" stroke="${c[1]}" stroke-width="1"/><path d="M0 3h6" stroke="${c[2]}" stroke-width=".35" stroke-dasharray="1 1"/>`],
    pixel: (c) => [8, `<rect width="4" height="4" fill="${c[0]}"/><rect x="4" width="4" height="4" fill="${c[1]}"/><rect y="4" width="4" height="4" fill="${c[2]}"/><rect x="4" y="4" width="4" height="4" fill="${c[3] || c[0]}"/>`],
    checker: (c) => [4, `<rect width="4" height="4" fill="${c[0]}"/><rect width="2" height="2" fill="${c[1]}"/><rect x="2" y="2" width="2" height="2" fill="${c[1]}"/>`, 45],
    waves: (c) => [16, `<rect width="16" height="16" fill="${c[0]}"/><path d="M0 5Q4 1 8 5T16 5V9Q12 13 8 9T0 9Z" fill="${c[1]}"/><path d="M0 13Q4 10 8 13T16 13" stroke="${c[2]}" stroke-width="1.4" fill="none"/>`],
    kente: (c) => [16, `<rect width="16" height="16" fill="${c[3]}"/><rect width="8" height="8" fill="${c[0]}"/><rect x="0" y="2" width="8" height="1.5" fill="${c[1]}"/><rect x="0" y="5" width="8" height="1.5" fill="${c[2]}"/>
      <rect x="8" y="8" width="8" height="8" fill="${c[0]}"/><rect x="10" y="8" width="1.5" height="8" fill="${c[1]}"/><rect x="13" y="8" width="1.5" height="8" fill="${c[2]}"/><rect x="8" width="8" height="8" fill="${c[1]}"/><path d="M8 4h8M12 0v8" stroke="${c[0]}" stroke-width="1.2"/>`],
    ankara: (c) => [14, `<rect width="14" height="14" fill="${c[0]}"/><circle cx="7" cy="7" r="5.5" fill="${c[1]}"/><circle cx="7" cy="7" r="3.5" fill="${c[2]}"/><circle cx="7" cy="7" r="1.6" fill="${c[3]}"/><circle cx="0" cy="0" r="2" fill="${c[2]}"/><circle cx="14" cy="14" r="2" fill="${c[2]}"/>`],
    mudcloth: (c) => [12, `<rect width="12" height="12" fill="${c[0]}"/><path d="M1 2h4M7 2h4M1 6l2 2 2-2M7 6l2 2 2-2" stroke="${c[1]}" stroke-width=".9" fill="none"/><circle cx="3" cy="10.5" r=".8" fill="${c[1]}"/><circle cx="9" cy="10.5" r=".8" fill="${c[1]}"/>`],
    plaid: (c) => [12, `<rect width="12" height="12" fill="${c[0]}"/><rect y="4" width="12" height="4" fill="${c[1]}" opacity=".75"/><rect x="4" width="4" height="12" fill="${c[1]}" opacity=".6"/><path d="M0 6h12M6 0v12" stroke="${c[3]}" stroke-width=".5"/>`],
    petals: (c) => [12, `<rect width="12" height="12" fill="${c[0]}"/>${[[3, 3], [9, 8]].map(([x, y]) => [0, 72, 144, 216, 288].map((a) => `<ellipse cx="${x}" cy="${y - 1.4}" rx=".9" ry="1.5" fill="${c[1]}" transform="rotate(${a} ${x} ${y})"/>`).join('') + `<circle cx="${x}" cy="${y}" r=".6" fill="${c[2]}"/>`).join('')}`],
    scales: (c) => [10, `<rect width="10" height="10" fill="${c[0]}"/>${[[5, 5], [0, 10], [10, 10], [0, 0], [10, 0]].map(([x, y]) => [4.6, 3.2, 1.8].map((r, i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? c[2] : c[1]}"/>`).join('')).join('')}`],
    tiles: (c) => [12, `<rect width="12" height="12" fill="${c[0]}" stroke="${c[1]}" stroke-width=".6"/><path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" fill="${c[1]}"/><circle cx="6" cy="6" r="1.6" fill="${c[2]}"/>`],
    feathers: (c) => [10, `<rect width="10" height="10" fill="${c[2]}"/><path d="M0 10L5 0L10 10Z" fill="${c[0]}"/><path d="M2.5 10L5 4L7.5 10Z" fill="${c[1]}"/>`],
    dots: (c) => [10, `<rect width="10" height="10" fill="${c[3]}"/><circle cx="2.5" cy="2.5" r="1.6" fill="${c[0]}"/><circle cx="7.5" cy="2.5" r="1.6" fill="${c[1]}"/><circle cx="2.5" cy="7.5" r="1.6" fill="${c[2]}"/><circle cx="7.5" cy="7.5" r="1.6" fill="${c[0]}"/>`],
    tape: (c) => [6, `<rect width="6" height="6" fill="${c[0]}"/><path d="M0 1.5h6M0 4.5h6" stroke="${c[1]}" stroke-width=".5"/>`],
    grass: (c) => [8, `<rect width="8" height="8" fill="${c[0]}"/><path d="M1 8L2 2L3 8M4 8L5.5 1L6 8M6.5 8L7.5 3L8 8" fill="${c[1]}"/><path d="M2 8L2.6 4" stroke="${c[2]}" stroke-width=".4"/>`],
    web: (c) => [14, `<rect width="14" height="14" fill="${c[0]}"/><path d="M0 0L14 14M14 0L0 14M7 0V14M0 7H14" stroke="${c[1]}" stroke-width=".35"/><circle cx="7" cy="7" r="3" stroke="${c[1]}" stroke-width=".35" fill="none"/><circle cx="7" cy="7" r="6" stroke="${c[1]}" stroke-width=".35" fill="none"/>`],
    lights: (c) => [12, `<rect width="12" height="12" fill="#0b1f12"/><path d="M0 6Q3 8 6 6T12 6" stroke="${c[0]}" stroke-width="1" fill="none"/>${[[3, 7.3, c[1]], [9, 7.3, c[3]]].map(([x, y, k]) => `<ellipse cx="${x}" cy="${y + 1.2}" rx="1.3" ry="1.8" fill="${k}"/>`).join('')}<ellipse cx="6" cy="7.2" rx="1.3" ry="1.8" fill="${c[2]}"/>`],
    flames: (c) => [10, `<rect width="10" height="10" fill="${c[0]}"/><path d="M0 10C1 6 3 6 2.5 2C5 5 5 7 5 10ZM5 10C6 7 8 6 7.5 1C10 4 10 7 10 10Z" fill="${c[1]}"/><path d="M1.5 10C2 8 3 8 3 6C4 8 4 9 3.8 10ZM6.5 10C7 8 8 8 8 5.5C9 8 9 9 8.8 10Z" fill="${c[2]}"/>`],
  };

  function KohlerFrame(art, size) {
    if (!art) return '';
    // the svg covers the avatar plus a margin all round, so the frame can wrap the avatar's edge
    const px = size * M / 100, id = 'kf' + (++uid), wrap = (inner, glow) => `<svg viewBox="${-M} ${-M} ${100 + 2 * M} ${100 + 2 * M}" width="${size + 2 * px}" height="${size + 2 * px}" style="position:absolute;left:${-px}px;top:${-px}px;pointer-events:none;overflow:visible${glow ? `;filter:drop-shadow(0 0 ${Math.max(2, size / 22)}px ${glow})` : ''}" aria-hidden="true">${inner}</svg>`;
    const top = art.top ? `<text x="50" y="${art.top === '🎅' ? 4 : 2}" text-anchor="middle" font-size="${art.top === '🎅' ? 26 : 20}" style="font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${esc(art.top)}</text>` : '';
    const crown = art.crown ? '<path d="M34 -2l6-9 5 6 5-8 5 8 5-6 6 9Z" fill="#e8c46a" stroke="#7a5a12" stroke-width="1.2"/>' : '';
    const glow = art.glow === true ? art.ring : art.glow || null;
    if (art.flag) {
      return wrap(`<defs><clipPath id="${id}"><path d="${RING(7)}" clip-rule="evenodd"/></clipPath></defs>
        <image href="/assets/flags/${esc(art.flag)}.webp" x="-9" y="-9" width="118" height="118" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>
        <path d="${RING(7)}" fill-rule="evenodd" fill="none" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>${top}`);
    }
    if (art.emoji) {
      const pts = [[50, -3], [91, 1], [103, 50], [91, 99], [50, 103], [9, 99], [-3, 50], [9, 1]];
      return wrap(`<path d="${RING(5)}" fill-rule="evenodd" fill="${art.ring || '#e8c46a'}"/>
        ${pts.map(([x, y]) => `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" style="font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${esc(art.emoji)}</text>`).join('')}${crown}${top}`, glow);
    }
    if (art.pattern === 'rainbow' || art.pattern === 'tiedye') {
      const cols = art.pattern === 'rainbow' ? ['#ff004d', '#ff8c00', '#ffd500', '#00d26a', '#00a3ff', '#7b3cff', '#ff004d'] : [...art.colors, art.colors[0]];
      return wrap(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${cols.map((c, i) => `<stop offset="${i / (cols.length - 1)}" stop-color="${c}"/>`).join('')}
        ${art.flow ? '<animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="6s" repeatCount="indefinite"/>' : ''}</linearGradient></defs>
        <path d="${RING(6)}" fill-rule="evenodd" fill="url(#${id})"/>${crown}${top}`, glow);
    }
    if (art.pattern && PAT[art.pattern]) {
      const [t, body, rot] = PAT[art.pattern](art.colors || ['#888', '#aaa', '#ccc', '#eee']);
      const anim = art.flow ? `<animateTransform attributeName="patternTransform" type="translate" from="0 0" to="0 ${-t}" dur="${art.pattern === 'flames' ? 1.2 : 4}s" repeatCount="indefinite" additive="sum"/>` : '';
      return wrap(`<defs><pattern id="${id}" width="${t}" height="${t}" patternUnits="userSpaceOnUse" ${rot ? `patternTransform="rotate(${rot})"` : ''}>${body}${anim}</pattern></defs>
        <path d="${RING(7)}" fill-rule="evenodd" fill="url(#${id})"/><path d="${RING(7)}" fill-rule="evenodd" fill="none" stroke="${art.ring || 'rgba(0,0,0,.35)'}" stroke-width=".8"/>${crown}${top}`, glow);
    }
    // plain ring (the original frames)
    const ring = art.ring || '#e8c46a';
    return wrap(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ring}"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="${ring}"/></linearGradient></defs>
      <rect x="-1.5" y="-1.5" width="103" height="103" rx="31.5" fill="none" stroke="url(#${id})" stroke-width="5">
        ${art.spin ? '<animate attributeName="stroke-dasharray" values="0 400;400 0;0 400" dur="3s" repeatCount="indefinite"/>' : ''}</rect>
      ${art.facets ? '<path d="M-3 24L24 -3M76 -3l27 27M103 76L76 103M24 103L-3 76" stroke="#e6faff" stroke-width="2.5"/>' : ''}${crown}${top}`, glow);
  }
  window.KohlerFrame = KohlerFrame;
  if (window.KohlerCharacter) window.KohlerCharacter.frame = KohlerFrame;

  /* ── emoji win effects ── */
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function emojiFX(art) {
    if (reduce()) return;
    const c = document.createElement('canvas'), x = c.getContext('2d'), W = innerWidth, H = innerHeight, d = Math.min(2, devicePixelRatio || 1);
    c.width = W * d; c.height = H * d; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:90'; x.scale(d, d); document.body.appendChild(c);
    const E = art.emoji, mode = art.mode || 'burst', P = [], n = mode === 'parade' ? 14 : mode === 'burst' ? 70 : 46;
    for (let i = 0; i < n; i++) {
      const e = E[i % E.length], s = 22 + Math.random() * 22;
      if (mode === 'rain') P.push({ e, s, x: Math.random() * W, y: -40 - Math.random() * H * .6, vx: (Math.random() - .5) * 1.2, vy: 2.5 + Math.random() * 3, r: (Math.random() - .5) * .6, vr: (Math.random() - .5) * .06, g: .04 });
      else if (mode === 'float') P.push({ e, s, x: Math.random() * W, y: H + 40 + Math.random() * H * .4, vx: (Math.random() - .5) * .8, vy: -(1.6 + Math.random() * 2.4), r: 0, vr: 0, g: 0, sway: Math.random() * 6 });
      else if (mode === 'drift') P.push({ e, s: s * .8, x: -40 - Math.random() * W * .5, y: Math.random() * H * .8, vx: 2 + Math.random() * 2.5, vy: .6 + Math.random(), r: Math.random() * 6, vr: .03, g: 0, sway: Math.random() * 6 });
      else if (mode === 'parade') P.push({ e, s: 34, x: -60 - i * 70, y: H * .78 + Math.sin(i) * 10, vx: 4.2, vy: 0, r: 0, vr: 0, g: 0, hop: i });
      else { const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 9; P.push({ e, s, x: W / 2, y: H * .45, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, r: 0, vr: (Math.random() - .5) * .2, g: .22 }); }
    }
    if (art.sound === 'horn') try { const ac = new AudioContext(); [0, .18, .36].forEach((w) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sawtooth'; o.frequency.value = 466; g.gain.setValueAtTime(.06, ac.currentTime + w); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + w + .16); o.connect(g).connect(ac.destination); o.start(ac.currentTime + w); o.stop(ac.currentTime + w + .17); }); } catch {}
    const t0 = performance.now(), DUR = mode === 'parade' ? 3600 : 2800;
    (function f(t) {
      const e = t - t0; x.clearRect(0, 0, W, H);
      if (art.glow && e < 600) { x.fillStyle = art.glow; x.globalAlpha = .18 * (1 - e / 600); x.fillRect(0, 0, W, H); }
      x.textAlign = 'center'; x.textBaseline = 'middle';
      for (const p of P) {
        p.vy += p.g; p.x += p.vx + (p.sway ? Math.sin((e / 400) + p.sway) * .8 : 0); p.y += p.vy; p.r += p.vr;
        const hop = p.hop !== undefined ? -Math.abs(Math.sin(e / 160 + p.hop)) * 14 : 0;
        x.globalAlpha = Math.max(0, Math.min(1, (DUR - e) / 600));
        x.save(); x.translate(p.x, p.y + hop); x.rotate(p.r); x.font = `${p.s}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; x.fillText(p.e, 0, 0); x.restore();
      }
      x.globalAlpha = 1;
      if (e < DUR) requestAnimationFrame(f); else c.remove();
    })(t0);
  }
  const wait = () => new Promise((r) => (window.KohlerFX ? r() : addEventListener('load', r, { once: true })));
  wait().then(() => {
    if (!window.KohlerFX || window.KohlerFX.__emoji) return;
    const base = window.KohlerFX.play;
    window.KohlerFX.play = (id, art) => {
      // no effect equipped → the default confetti (this used to crash when nothing was equipped)
      const a = art || (id && window.KV?.[id]?.art) || (id && window.KohlerEquipArt?.effectId === id ? window.KohlerEquipArt?.effect : null);
      if (a?.emoji) return emojiFX(a);
      return base(id);
    };
    window.KohlerFX.__emoji = true;
  });

  /* ── themes: a light ambient layer over the page, on your screen only ── */
  let layer = null;
  function setTheme(art) {
    layer?.stop(); layer = null;
    if (!art) return;
    const c = document.createElement('canvas'), x = c.getContext('2d');
    c.className = 'k-theme'; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;opacity:.85';
    document.body.appendChild(c);
    let W = 0, H = 0; const d = Math.min(1.5, devicePixelRatio || 1);
    const fit = () => { W = innerWidth; H = innerHeight; c.width = W * d; c.height = H * d; x.setTransform(d, 0, 0, d, 0, 0); };
    fit(); addEventListener('resize', fit);
    const cols = art.colors || ['#ffffff'], N = Math.min(160, art.count || 40), P = [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const add = (init) => {
      const p = { x: rnd(0, W), y: init ? rnd(0, H) : -20, s: rnd(.6, 1.4), v: rnd(.4, 1.2) * (art.speed || 1), ph: rnd(0, 6.28), c: cols[Math.floor(rnd(0, cols.length))], e: art.emoji ? art.emoji[Math.floor(rnd(0, art.emoji.length))] : null };
      if (art.kind === 'bubbles' || art.kind === 'fireflies' || art.kind === 'dust') p.y = init ? rnd(0, H) : H + 20;
      return p;
    };
    for (let i = 0; i < N; i++) P.push(add(true));
    const glyphs = 'アカサタナハマヤラワ0123456789KOHLER$';
    const cols2 = art.kind === 'code' ? Array.from({ length: Math.ceil(innerWidth / 18) }, () => rnd(-40, 0)) : null;
    let raf = 0, last = performance.now();
    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const dt = Math.min(50, t - last) / 16.7; last = t;
      x.clearRect(0, 0, W, H);
      if (art.fog) { const g = x.createLinearGradient(0, H * .55, 0, H); g.addColorStop(0, 'transparent'); g.addColorStop(1, art.fog + '66'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
      if (art.kind === 'aurora') {
        for (let i = 0; i < 3; i++) { const g = x.createLinearGradient(0, 0, W, 0), k = Math.sin(t / 3000 + i * 2);
          g.addColorStop(0, 'transparent'); g.addColorStop(.5 + .3 * k, cols[i % cols.length] + '22'); g.addColorStop(1, 'transparent');
          x.fillStyle = g; x.beginPath(); x.moveTo(0, H * (.1 + i * .08)); for (let px = 0; px <= W; px += 40) x.lineTo(px, H * (.12 + i * .08) + Math.sin(px / 180 + t / 1600 + i) * 30); x.lineTo(W, 0); x.lineTo(0, 0); x.fill(); }
        return;
      }
      if (art.kind === 'code') {
        x.font = '15px ui-monospace,monospace'; x.fillStyle = cols[0];
        cols2.forEach((y, i) => { for (let k = 0; k < 14; k++) { x.globalAlpha = (1 - k / 14) * .35; x.fillText(glyphs[(i * 7 + k + Math.floor(t / 90)) % glyphs.length], i * 18, (y - k) * 18); }
          cols2[i] = y > H / 18 + 14 ? rnd(-30, 0) : y + .12 * dt; });
        x.globalAlpha = 1; return;
      }
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        if (art.kind === 'bubbles' || art.kind === 'fireflies' || art.kind === 'dust') { p.y -= p.v * dt * (art.kind === 'fireflies' ? .35 : .6); p.x += Math.sin(t / 900 + p.ph) * .4; if (p.y < -20) P[i] = add(false); }
        else if (art.kind === 'stars') { /* still, twinkling */ }
        else { p.y += p.v * dt * (art.kind === 'snow' ? 1 : 1.3); p.x += Math.sin(t / 1100 + p.ph) * (art.kind === 'petals' ? 1.1 : .5); if (p.y > H + 30) P[i] = add(false); }
        if (p.e) { x.globalAlpha = .55; x.font = `${18 * p.s}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; x.fillText(p.e, p.x, p.y); continue; }
        x.fillStyle = p.c;
        if (art.kind === 'snow') { x.globalAlpha = .8; x.beginPath(); x.arc(p.x, p.y, 1.6 * p.s + .6, 0, 7); x.fill(); }
        else if (art.kind === 'petals') { x.globalAlpha = .75; x.save(); x.translate(p.x, p.y); x.rotate(t / 1400 + p.ph); x.beginPath(); x.ellipse(0, 0, 5 * p.s, 2.6 * p.s, 0, 0, 7); x.fill(); x.restore(); }
        else if (art.kind === 'fireflies' || art.kind === 'dust') { x.globalAlpha = .35 + .45 * Math.abs(Math.sin(t / 700 + p.ph)); x.shadowColor = p.c; x.shadowBlur = 8; x.beginPath(); x.arc(p.x, p.y, (art.kind === 'dust' ? 1.1 : 1.8) * p.s, 0, 7); x.fill(); x.shadowBlur = 0; }
        else if (art.kind === 'stars') { x.globalAlpha = .25 + .55 * Math.abs(Math.sin(t / 1500 + p.ph)); x.fillRect(p.x, p.y, 1.4 * p.s, 1.4 * p.s); }
        else if (art.kind === 'bubbles') { x.globalAlpha = .4; x.strokeStyle = p.c; x.lineWidth = 1.2; x.beginPath(); x.arc(p.x, p.y, 6 * p.s, 0, 7); x.stroke(); }
        else if (art.kind === 'confetti') { x.globalAlpha = .7; x.save(); x.translate(p.x, p.y); x.rotate(t / 500 + p.ph); x.fillRect(-3, -1.5, 6, 3); x.restore(); }
      }
      x.globalAlpha = 1;
    };
    if (reduce()) { draw(performance.now()); cancelAnimationFrame(raf); } else raf = requestAnimationFrame(draw);
    layer = { stop() { cancelAnimationFrame(raf); removeEventListener('resize', fit); c.remove(); } };
  }
  window.KohlerTheme = { set: setTheme };
})();
