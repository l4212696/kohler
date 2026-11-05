// Kohler characters: drawn from a small spec so every Vault character is crisp at
// any size. KohlerCharacter(spec, { size, bg }) → '<svg …>'.
// spec: { shape, c1, c2, eye, mouth, acc, aura }
(function () {
  let uid = 0;
  const SHAPES = {
    blob: 'M50 20C72 20 84 36 84 57C84 77 69 88 50 88C31 88 16 77 16 57C16 36 28 20 50 20Z',
    bean: 'M52 16C74 18 82 38 80 58C78 78 64 90 46 88C28 86 18 72 20 52C22 30 33 15 52 16Z',
    cat: 'M24 40L22 14L42 28C47 27 53 27 58 28L78 14L76 40C82 48 84 56 84 62C84 80 69 90 50 90C31 90 16 80 16 62C16 56 18 48 24 40Z',
    bot: 'M24 26H76Q84 26 84 34V74Q84 84 74 84H26Q16 84 16 74V34Q16 26 24 26Z',
    ghost: 'M50 16C70 16 82 32 82 52V86L74 80L66 88L58 80L50 88L42 80L34 88L26 80L18 86V52C18 32 30 16 50 16Z',
    alien: 'M50 14C74 14 88 30 86 50C84 70 66 88 50 88C34 88 16 70 14 50C12 30 26 14 50 14Z',
    dino: 'M50 26C72 26 84 40 84 60C84 79 69 90 50 90C31 90 16 79 16 60C16 40 28 26 50 26Z',
    king: 'M50 22C73 22 86 38 86 58C86 78 70 90 50 90C30 90 14 78 14 58C14 38 27 22 50 22Z',
  };
  const eyeY = { blob: 52, bean: 50, cat: 56, bot: 50, ghost: 46, alien: 46, dino: 58, king: 56 };
  function eyes(kind, y) {
    const L = 38, R = 62;
    switch (kind) {
      case 'big': return [L, R].map((x) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="9" fill="#fff"/><circle cx="${x + 1.5}" cy="${y + 1}" r="4.6" fill="#141821"/><circle cx="${x + 3}" cy="${y - 2}" r="1.6" fill="#fff"/>`).join('');
      case 'visor': return `<rect x="26" y="${y - 7}" width="48" height="14" rx="7" fill="#0b0f16"/><rect x="30" y="${y - 3}" width="40" height="5" rx="2.5" fill="var(--vc,#00ff66)" opacity=".95"/>`;
      case 'sleepy': return [L, R].map((x) => `<path d="M${x - 6} ${y}q6 5 12 0" stroke="#141821" stroke-width="3.2" fill="none" stroke-linecap="round"/>`).join('');
      case 'star': return [L, R].map((x) => `<path d="M${x} ${y - 7}l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6Z" fill="#fff" stroke="#141821" stroke-width="1.4"/>`).join('');
      case 'x': return [L, R].map((x) => `<path d="M${x - 4.5} ${y - 4.5}l9 9M${x + 4.5} ${y - 4.5}l-9 9" stroke="#141821" stroke-width="3.2" stroke-linecap="round"/>`).join('');
      default: return [L, R].map((x) => `<circle cx="${x}" cy="${y}" r="4.6" fill="#141821"/><circle cx="${x + 1.6}" cy="${y - 1.6}" r="1.4" fill="#fff"/>`).join('');
    }
  }
  function mouth(kind, y) {
    switch (kind) {
      case 'grin': return `<path d="M39 ${y}h22q0 11-11 11t-11-11Z" fill="#141821"/><path d="M42 ${y}h16v3h-16Z" fill="#fff"/>`;
      case 'o': return `<ellipse cx="50" cy="${y + 3}" rx="4.4" ry="5" fill="#141821"/>`;
      case 'fang': return `<path d="M41 ${y}q9 8 18 0" stroke="#141821" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M45 ${y + 2.6}l2 4.6 2-3.6Z" fill="#fff"/>`;
      case 'flat': return `<path d="M43 ${y + 2}h14" stroke="#141821" stroke-width="3" stroke-linecap="round"/>`;
      default: return `<path d="M41 ${y}q9 9 18 0" stroke="#141821" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    }
  }
  function acc(kind, c2) {
    switch (kind) {
      case 'crown': return `<path d="M30 22l6-14 8 10 6-14 6 14 8-10 6 14Z" fill="#ffd166" stroke="#b8902e" stroke-width="2" stroke-linejoin="round"/><circle cx="50" cy="14" r="2.6" fill="#ff4d6d"/>`;
      case 'shades': return `<path d="M24 46h52v4c0 6-4 10-10 10h-6c-5 0-8-4-9-8h-2c-1 4-4 8-9 8h-6c-6 0-10-4-10-10Z" fill="#0b0f16"/><path d="M30 49h10" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>`;
      case 'horns': return `<path d="M28 30q-8-12-2-22 4 10 12 14ZM72 30q8-12 2-22-4 10-12 14Z" fill="#ff4d6d" stroke="#7f1d1d" stroke-width="1.5"/>`;
      case 'halo': return `<ellipse cx="50" cy="10" rx="18" ry="5" fill="none" stroke="#ffe08a" stroke-width="3.4"/>`;
      case 'headphones': return `<path d="M20 50q0-34 30-34t30 34" stroke="#141821" stroke-width="4.5" fill="none"/><rect x="12" y="44" width="11" height="20" rx="5" fill="#ff4d6d"/><rect x="77" y="44" width="11" height="20" rx="5" fill="#ff4d6d"/>`;
      case 'wizard': return `<path d="M28 26L52 -4 70 26Z" fill="#4c1d95" stroke="#2e1065" stroke-width="2"/><path d="M24 26h50" stroke="#2e1065" stroke-width="5" stroke-linecap="round"/><path d="M52 6l1.6 3.4 3.6.4-2.7 2.4.8 3.6-3.3-1.9-3.3 1.9.8-3.6-2.7-2.4 3.6-.4Z" fill="#ffd166"/>`;
      case 'bow': return `<path d="M70 22l12-8v18ZM70 22l-12-8v18Z" fill="#ff5fa2" stroke="#9d174d" stroke-width="1.5"/><circle cx="70" cy="22" r="4" fill="#ff5fa2" stroke="#9d174d" stroke-width="1.5"/>`;
      case 'helmet': return `<circle cx="50" cy="54" r="40" fill="#bfe9ff" fill-opacity=".14" stroke="#e6f6ff" stroke-width="3"/><path d="M26 28q10-8 18-8" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>`;
      case 'mask': return `<path d="M18 44h64v14H18Z" fill="#141821"/><path d="M80 46l10-4-4 8 6 4-12-2Z" fill="#141821"/>`;
      case 'antenna': return `<path d="M50 24V8" stroke="#141821" stroke-width="3"/><circle cx="50" cy="7" r="5" fill="${c2}" stroke="#141821" stroke-width="2"/>`;
      case 'flame': return `<path d="M50 2c6 10 16 12 14 26-1 8-7 10-14 10s-13-2-14-10C34 18 44 14 50 2Z" fill="#ffb020"/><path d="M50 14c3 6 8 8 7 15-.5 4-3.5 5-7 5s-6.5-1-7-5c-1-7 4-9 7-15Z" fill="#fff3c4"/>`;
      default: return '';
    }
  }
  const dinoSpikes = (c) => `<path d="M30 30l6-12 6 10 8-14 8 14 6-10 6 12Z" fill="${c}"/>`;

  function KohlerCharacter(spec, o = {}) {
    if (!spec) return '';
    const id = 'kc' + (++uid), size = o.size || 64, sh = SHAPES[spec.shape] || SHAPES.blob, y = eyeY[spec.shape] || 52;
    const aura = spec.aura ? `<circle cx="50" cy="56" r="44" fill="url(#${id}a)"><animate attributeName="r" values="40;47;40" dur="2.4s" repeatCount="indefinite"/></circle>` : '';
    const bg = o.bg ? `<rect width="100" height="100" rx="26" fill="url(#${id}b)"/>` : '';
    return `<svg viewBox="-4 -6 108 108" width="${size}" height="${size}" style="${spec.eye === 'visor' ? `--vc:${spec.c1}` : ''}" aria-hidden="true"><defs>
      <radialGradient id="${id}g" cx=".32" cy=".26" r=".9"><stop offset="0" stop-color="${spec.c1}"/><stop offset="1" stop-color="${spec.c2}"/></radialGradient>
      <radialGradient id="${id}a"><stop offset=".55" stop-color="${spec.aura || '#fff'}" stop-opacity=".55"/><stop offset="1" stop-color="${spec.aura || '#fff'}" stop-opacity="0"/></radialGradient>
      <radialGradient id="${id}b" cx=".5" cy=".3" r=".9"><stop offset="0" stop-color="${spec.c1}" stop-opacity=".35"/><stop offset="1" stop-color="#0b0f16"/></radialGradient></defs>
      ${bg}${aura}${spec.shape === 'dino' ? dinoSpikes(spec.c2) : ''}${spec.acc === 'wizard' || spec.acc === 'halo' || spec.acc === 'flame' ? acc(spec.acc, spec.c2) : ''}
      <path d="${sh}" fill="url(#${id}g)" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
      <ellipse cx="36" cy="32" rx="10" ry="6" fill="#fff" opacity=".22" transform="rotate(-20 36 32)"/>
      ${spec.shape === 'bot' ? '<path d="M40 84v8h20v-8" fill="#2a3242"/>' : ''}
      ${eyes(spec.eye, y)}${spec.acc === 'mask' ? acc('mask') : ''}
      <circle cx="30" cy="${y + 10}" r="4.4" fill="#ff7a9a" opacity=".45"/><circle cx="70" cy="${y + 10}" r="4.4" fill="#ff7a9a" opacity=".45"/>
      ${mouth(spec.mouth, y + 13)}
      ${['wizard', 'halo', 'flame', 'mask'].includes(spec.acc) ? '' : acc(spec.acc, spec.c2)}</svg>`;
  }
  // frame ring around any avatar
  KohlerCharacter.frame = function (art, size) {
    if (!art) return '';
    const id = 'kf' + (++uid);
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" style="position:absolute;inset:0;pointer-events:none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${art.ring}"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="${art.ring}"/></linearGradient></defs>
      <rect x="3" y="3" width="94" height="94" rx="28" fill="none" stroke="url(#${id})" stroke-width="5" ${art.glow ? `style="filter:drop-shadow(0 0 5px ${art.ring})"` : ''}>
        ${art.spin ? '<animate attributeName="stroke-dasharray" values="0 400;400 0;0 400" dur="3s" repeatCount="indefinite"/>' : ''}</rect>
      ${art.facets ? '<path d="M3 30L30 3M70 3l27 27M97 70L70 97M30 97L3 70" stroke="#e6faff" stroke-width="2.5"/>' : ''}
      ${art.crown ? '<path d="M34 10l6-9 5 6 5-8 5 8 5-6 6 9Z" fill="#e8c46a" stroke="#7a5a12" stroke-width="1.2"/>' : ''}</svg>`;
  };
  window.KohlerCharacter = KohlerCharacter;
})();
