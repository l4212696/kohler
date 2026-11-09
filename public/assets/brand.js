// Kohler brand mark + win effects. The mark is an ivory stem and a cut gold gem
// that together read as a K. KohlerLogo.mark(size, tile) → '<svg …>'.
(function () {
  let n = 0;
  function mark(size = 32, tile = false) {
    const id = 'kl' + (++n);
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" style="display:block">
      <defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf7ec"/><stop offset="1" stop-color="#d6c9a8"/></linearGradient>
        <linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset="1" stop-color="#e8c46a"/></linearGradient>
        <linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c99a35"/><stop offset="1" stop-color="#7a5a16"/></linearGradient></defs>
      ${tile ? `<rect x="2" y="2" width="96" height="96" rx="26" fill="#0e131b" stroke="rgba(232,196,106,.55)" stroke-width="2"/>` : ''}
      <g transform="${tile ? 'translate(9 9) scale(.82)' : ''}">
        <rect x="12" y="12" width="16" height="76" rx="8" fill="url(#${id}s)"/>
        <path d="M30 50L60 17L90 50Z" fill="url(#${id}t)"/>
        <path d="M30 50L90 50L60 83Z" fill="url(#${id}b)"/>
        <path d="M45 50L60 17L75 50Z" fill="#fff" opacity=".28"/>
        <path d="M30 50H90" stroke="#5c430f" stroke-width="1.4" opacity=".55"/>
      </g></svg>`;
  }
  const word = (size = 30) => `<span class="kbrand">${mark(size)}<span>Kohler</span></span>`;
  // The Kohler coin. heads: gold with the K-gem struck in; tails: obsidian with a gold crown.
  function coin(size = 120, side = 'heads') {
    const id = 'kc' + (++n), H = side === 'heads';
    const teeth = Array.from({ length: 48 }, (_, i) => { const a = i / 48 * Math.PI * 2; return `<line x1="${50 + 46 * Math.cos(a)}" y1="${50 + 46 * Math.sin(a)}" x2="${50 + 49 * Math.cos(a)}" y2="${50 + 49 * Math.sin(a)}"/>`; }).join('');
    return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" style="display:block"><defs>
      <radialGradient id="${id}f" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${H ? '#fff4c4' : '#2b3446'}"/><stop offset=".55" stop-color="${H ? '#e8c46a' : '#121822'}"/><stop offset="1" stop-color="${H ? '#9a7322' : '#05070a'}"/></radialGradient>
      <linearGradient id="${id}r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset=".5" stop-color="#b8902e"/><stop offset="1" stop-color="#f3d58a"/></linearGradient></defs>
      <circle cx="50" cy="50" r="49" fill="url(#${id}r)"/>
      <g stroke="${H ? '#7a5a16' : '#5c430f'}" stroke-width="1.6" opacity=".7">${teeth}</g>
      <circle cx="50" cy="50" r="43" fill="url(#${id}f)"/>
      <circle cx="50" cy="50" r="37" fill="none" stroke="${H ? 'rgba(122,90,22,.55)' : 'rgba(0,255,102,.55)'}" stroke-width="1.4" stroke-dasharray="2 3"/>
      ${H ? `<g transform="translate(27 27) scale(.46)" opacity=".95"><rect x="12" y="12" width="16" height="76" rx="8" fill="#fdf8e6" stroke="#7a5a16" stroke-width="2"/>
          <path d="M30 50L60 17L90 50Z" fill="#fff6d0" stroke="#7a5a16" stroke-width="2"/><path d="M30 50L90 50L60 83Z" fill="#b8902e" stroke="#7a5a16" stroke-width="2"/></g>`
        : `<path d="M30 60l-3-22 12 10 11-17 11 17 12-10-3 22Z" fill="url(#${id}r)" stroke="#5c430f" stroke-width="1.5"/><rect x="30" y="62" width="40" height="6" rx="2" fill="url(#${id}r)"/>
          <circle cx="50" cy="31" r="2.6" fill="#00ff66"/>`}
      <ellipse cx="36" cy="26" rx="16" ry="7" fill="#fff" opacity="${H ? .25 : .08}" transform="rotate(-30 36 26)"/></svg>`;
  }
  window.KohlerLogo = { mark, word, coin };

  // ── win effects: canvas particles, no libraries ──
  const KINDS = {
    confetti: { n: 140, colors: ['#00ff66', '#e8c46a', '#ffffff', '#ff4d6d', '#7c5cff'], shape: 'rect', from: 'top' },
    coins: { n: 70, colors: ['#e8c46a', '#f3d58a', '#b8902e'], shape: 'coin', from: 'top' },
    fireworks: { n: 160, colors: ['#ff4d6d', '#00ff66', '#9be7ff', '#e8c46a', '#c084fc'], shape: 'dot', from: 'burst' },
    lightning: { n: 0, colors: ['#00ff66'], shape: 'bolt' },
    royal: { n: 110, colors: ['#e8c46a', '#fff1b8', '#ffd166'], shape: 'crown', from: 'top' },
  };
  function play(id) {
    const k = KINDS[String(id || 'fx-confetti').replace('fx-', '')] || KINDS.confetti;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas'), x = c.getContext('2d'), W = innerWidth, H = innerHeight, d = Math.min(2, devicePixelRatio || 1);
    c.width = W * d; c.height = H * d; c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:90';
    x.scale(d, d); document.body.appendChild(c);
    const P = [];
    if (k.from === 'burst') for (let b = 0; b < 4; b++) { const cx = W * (.2 + .6 * Math.random()), cy = H * (.2 + .3 * Math.random()), t0 = b * 260;
      for (let i = 0; i < k.n / 4; i++) { const a = Math.random() * 7, v = 2 + Math.random() * 4; P.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: k.colors[i % k.colors.length], s: 2.5, t0, life: 1 }); } }
    else for (let i = 0; i < k.n; i++) P.push({ x: Math.random() * W, y: -20 - Math.random() * H * .5, vx: (Math.random() - .5) * 2, vy: 2 + Math.random() * 3, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: k.colors[i % k.colors.length], s: 5 + Math.random() * 6, t0: 0, life: 1 });
    const t0 = performance.now(), DUR = k.shape === 'bolt' ? 700 : 2600;
    (function f(t) {
      const e = t - t0; x.clearRect(0, 0, W, H);
      if (k.shape === 'bolt') {
        const a = 1 - e / DUR; x.fillStyle = `rgba(0,255,102,${.18 * a})`; x.fillRect(0, 0, W, H);
        x.strokeStyle = `rgba(190,255,215,${a})`; x.lineWidth = 4; x.shadowColor = '#00ff66'; x.shadowBlur = 30; x.beginPath();
        let px = W * .55, py = 0; x.moveTo(px, py); while (py < H * .8) { px += (Math.random() - .5) * 120; py += 40 + Math.random() * 40; x.lineTo(px, py); } x.stroke();
      }
      for (const p of P) {
        if (e < p.t0) continue;
        p.x += p.vx; p.y += p.vy;
        if (k.from === 'burst') { p.vy += .06; p.vx *= .985; p.life = Math.max(0, 1 - (e - p.t0) / 1500); } else { p.vy += .05; p.r += p.vr; }
        x.globalAlpha = Math.min(1, p.life * 1.5, (DUR - e) / 500); x.fillStyle = p.c;
        if (k.shape === 'rect') { x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); }
        else if (k.shape === 'coin') { x.save(); x.translate(p.x, p.y); x.scale(Math.abs(Math.cos(p.r)), 1); x.beginPath(); x.arc(0, 0, p.s, 0, 7); x.fill(); x.strokeStyle = '#7a5a16'; x.lineWidth = 1.2; x.stroke(); x.restore(); }
        else if (k.shape === 'crown') { x.save(); x.translate(p.x, p.y); x.rotate(p.r * .3); const s = p.s * .8; x.beginPath(); x.moveTo(-s, s * .5); x.lineTo(-s, -s * .4); x.lineTo(-s * .5, 0); x.lineTo(0, -s * .7); x.lineTo(s * .5, 0); x.lineTo(s, -s * .4); x.lineTo(s, s * .5); x.fill(); x.restore(); }
        else { x.beginPath(); x.arc(p.x, p.y, p.s, 0, 7); x.fill(); }
      }
      x.globalAlpha = 1;
      if (e < DUR) requestAnimationFrame(f); else c.remove();
    })(t0);
  }
  window.KohlerFX = { play };
})();
