// Kohler avatars: every player gets a unique emblem generated from their name.
// Same name → same avatar everywhere (lobby, Pool Pot seats, PoolWars feed).
//   KohlerAvatar('maya', { size: 40, tier: 'gold' })  → '<svg …>'
// tier: 'bronze' | 'silver' | 'gold' | 'obsidian' adds a ring; house: true gives the HOUSE badge.
(function () {
  const hash = (s) => { let h = 2166136261; for (const c of String(s || '?')) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const PAL = [['#00ff66', '#0a3d24'], ['#e8c46a', '#3a2a08'], ['#38bdf8', '#082a40'], ['#ff2e88', '#3b0a26'], ['#a78bfa', '#21124a'],
    ['#f97316', '#3b1606'], ['#2dd4bf', '#06302b'], ['#facc15', '#3a2f03'], ['#fb7185', '#3d0b14'], ['#818cf8', '#151a4a']];
  const RINGS = { bronze: '#c08457', silver: '#cbd5e1', gold: '#e8c46a', obsidian: '#00ff66' };
  // emblem shapes on a 40×40 grid, all drawn with the accent colour
  const SHAPES = [
    (c) => `<path d="M20 7 31 13.5v13L20 33 9 26.5v-13Z" fill="none" stroke="${c}" stroke-width="2.4"/>`,
    (c) => `<path d="M20 6 34 20 20 34 6 20Z" fill="${c}" opacity=".9"/>`,
    (c) => `<circle cx="20" cy="20" r="11" fill="none" stroke="${c}" stroke-width="2.4"/><circle cx="20" cy="9" r="3" fill="${c}"/>`,
    (c) => `<path d="M8 27 13 13l7 9 7-9 5 14Z" fill="${c}"/>`,
    (c) => `<path d="M9 14l11 7 11-7M9 21l11 7 11-7" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    (c) => `<path d="M20 6l3.6 9.4L33 16l-7.4 6 2.6 9.6L20 26l-8.2 5.6 2.6-9.6L7 16l9.4-.6Z" fill="${c}"/>`,
    (c) => `<rect x="11" y="11" width="18" height="18" rx="4" fill="none" stroke="${c}" stroke-width="2.4" transform="rotate(45 20 20)"/><circle cx="20" cy="20" r="3.4" fill="${c}"/>`,
    (c) => `<path d="M12 28V14a8 8 0 0 1 16 0v14" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><path d="M12 22h16" stroke="${c}" stroke-width="2.6"/>`,
  ];
  function KohlerAvatar(name, o = {}) {
    const size = o.size || 40;
    if (o.house) return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-label="HOUSE"><defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d8bff"/><stop offset="1" stop-color="#2a3bb0"/></linearGradient></defs><rect width="40" height="40" rx="12" fill="url(#hg)"/><path d="M10 21 20 12l10 9M13 19v10h14V19" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
    const h = hash(name), [fg, bg] = PAL[h % PAL.length], shape = SHAPES[(h >>> 4) % SHAPES.length], rot = ((h >>> 8) % 4) * 90;
    const id = 'a' + h.toString(36);
    const initial = String(name || '?').trim()[0]?.toUpperCase() || '?';
    const ring = o.tier && RINGS[o.tier] ? `<rect x="1.2" y="1.2" width="37.6" height="37.6" rx="11" fill="none" stroke="${RINGS[o.tier]}" stroke-width="2.4"/>` : '';
    return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-label="${initial}"><defs><radialGradient id="${id}" cx=".3" cy=".25" r="1"><stop offset="0" stop-color="${fg}" stop-opacity=".35"/><stop offset=".6" stop-color="${bg}"/></radialGradient></defs>
      <rect width="40" height="40" rx="12" fill="url(#${id})"/><g transform="rotate(${rot} 20 20)" opacity=".55">${shape(fg)}</g>
      <text x="20" y="21" text-anchor="middle" dominant-baseline="middle" font-family="Unbounded,Inter,sans-serif" font-weight="800" font-size="15" fill="#fff">${initial}</text>${ring}</svg>`;
  }
  KohlerAvatar.tier = (xp) => (xp >= 1000 ? 'obsidian' : xp >= 200 ? 'gold' : xp >= 50 ? 'silver' : xp >= 10 ? 'bronze' : null);
  window.KohlerAvatar = KohlerAvatar;
})();
