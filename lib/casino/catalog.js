// Kohler Studio catalog: 53 titles on 6 engines. Upserted into casino_games at
// boot; admins can switch any title off and that choice survives restarts.
// Names and themes are original. RTPs come from the engines, not from here.
import { plinkoTable, wheelTable } from './engines.js';

export const STUDIO_ID = 'kohler-studio';

// [slug, name, volatility, rtp, colorA, colorB, 7 symbols (6 regular + jackpot), tags]
const SLOTS = [
  ['neon-cherry', 'Neon Cherry Nights', 'low', 96.5, '#ff2e88', '#3b0a45', '🍒🍋🍊🍇🔔⭐7️⃣', 'classic'],
  ['pharaoh-vault', 'Pharaoh’s Vault', 'high', 96, '#f6c453', '#3a2408', '🪲🏺🐍👁️🦅🔱👑', 'adventure'],
  ['orbit-jackpot', 'Orbit Jackpot', 'medium', 96.2, '#6d5cff', '#0b1033', '🪐🌙☄️🛸👽🌟💫', 'space'],
  ['dragon-ember', 'Dragon Ember', 'high', 96.1, '#ff5a1f', '#2b0606', '🔥🏮🐉🧧🪙⛩️🐲', 'asian'],
  ['salt-and-gold', 'Salt & Gold', 'medium', 96, '#2fb7a8', '#082a33', '🦜⚓🗺️🧭🦑🏴‍☠️💰', 'pirates'],
  ['dust-devil', 'Dust Devil Saloon', 'medium', 95.8, '#d98b3a', '#2b1607', '🌵🐎🤠🎯🥃🔫⭐', 'western'],
  ['sugar-rush-hour', 'Sugar Rush Hour', 'low', 96.4, '#ff7ad9', '#3d0f39', '🍬🍭🧁🍩🍫🍓🍰', 'candy'],
  ['fjord-raiders', 'Fjord Raiders', 'high', 96.3, '#6ec1ff', '#0b1d33', '🪓🛡️🐺🦌⚡🍺⚔️', 'myth'],
  ['sun-stone', 'Sun Stone Temple', 'medium', 96, '#e9b949', '#1d2a10', '🐆🦎🌽🪶🗿☀️🔆', 'adventure'],
  ['canopy-kings', 'Canopy Kings', 'low', 96.2, '#4cd964', '#0a2614', '🍌🦋🐸🦜🐒🌺🦁', 'nature'],
  ['polar-payday', 'Polar Payday', 'medium', 96.1, '#9be7ff', '#0b2236', '❄️🐧🐻‍❄️🦭⛄🧊💎', 'winter'],
  ['deep-carat', 'Deep Carat Mine', 'high', 96.5, '#38e1ff', '#0d1626', '⛏️🪨🔦🪙💍💠💎', 'gems'],
  ['ronin-blade', 'Ronin Blade', 'high', 96, '#ff4d6d', '#1b0a12', '🎴🏯🌸🪭🗡️🥷⛩️', 'asian'],
  ['night-district', 'Night District', 'medium', 96.3, '#00e5ff', '#140b2e', '🎧🕶️🛵🎰🌃💿🌆', 'urban'],
  ['carnival-crush', 'Carnival Crush', 'low', 96, '#ffb020', '#3a0d26', '🎪🎈🎠🍿🎟️🤹🎡', 'fun'],
  ['savanna-run', 'Savanna Run', 'medium', 96.2, '#f4a259', '#2a1a06', '🦓🦒🐘🦏🐊🌅🦁', 'nature'],
  ['olympus-rising', 'Olympus Rising', 'high', 96.4, '#ffd166', '#1a1440', '🏛️🍇🦉⚡🔱🪽🏆', 'myth'],
  ['haunt-hollow', 'Haunt Hollow', 'medium', 95.9, '#a78bfa', '#120a1f', '🕯️🦇🕸️🧪👻🔮💀', 'spooky'],
  ['circuit-breaker', 'Circuit Breaker', 'high', 96.2, '#00ff88', '#06140e', '🔋💾🔌🤖📡🧬⚡', 'tech'],
  ['gold-rush-1849', 'Gold Rush 1849', 'medium', 96, '#e8b04a', '#21170a', '⛏️🪣🐴🏔️🪙💰🧈', 'western'],
  ['four-leaf', 'Four Leaf Fortune', 'low', 96.5, '#34d399', '#06231a', '🍀🌈🪙🎩🍺🧚💰', 'luck'],
  ['sakura-spin', 'Sakura Spin', 'low', 96.1, '#ff9ecf', '#2a0f22', '🌸🍵🎐🦢🎏🏮🌕', 'asian'],
  ['oasis-gold', 'Oasis Gold', 'medium', 96.2, '#ffcf70', '#2b1a0a', '🐪🌴🏜️🏺🪔🧞💎', 'adventure'],
  ['abyss-pearls', 'Abyss Pearls', 'high', 96.3, '#2bd9c4', '#041a26', '🐚🐠🐙🦈🪸🧜‍♀️🦪', 'ocean'],
  ['magma-core', 'Magma Core', 'high', 95.8, '#ff6a00', '#200a02', '🌋🔥🪨🦖☄️💥🧨', 'adventure'],
  ['pixel-arcade', 'Pixel Arcade', 'low', 96.2, '#7cff6b', '#101030', '🕹️👾🍄⭐🎮🏁👑', 'retro'],
  ['crown-jewels', 'Crown Jewels', 'medium', 96.4, '#ffd700', '#2a0a2e', '💍💎👑🗝️🏰⚜️🦄', 'royal'],
  ['spellbound', 'Spellbound Tower', 'high', 96.1, '#b388ff', '#160b2c', '📜🧪🔮🦉🪄🧙🌙', 'fantasy'],
  ['mech-mayhem', 'Mech Mayhem', 'medium', 96, '#9aa7ff', '#0e1222', '⚙️🔩🛠️🤖🚀🦾🛰️', 'tech'],
  ['jurassic-jackpot', 'Jurassic Jackpot', 'high', 96.2, '#8bd450', '#0e2208', '🥚🦴🌿🦕🌋🦖💎', 'adventure'],
  ['pumpkin-patch', 'Pumpkin Patch Payout', 'low', 96, '#ff8c1a', '#1e0d02', '🎃🍂🌽🦉🕯️🍎🧹', 'spooky'],
  ['honey-hive', 'Honey Hive', 'low', 96.3, '#ffc93c', '#2a1c02', '🐝🌼🍯🌻🐞🌷👑', 'nature'],
  ['cosmic-cats', 'Cosmic Cats', 'medium', 96.1, '#ff6ec7', '#170b33', '🐱🧶🐟🪐🚀🌟😺', 'fun'],
  ['midas-touch-lane', 'Midas Lane', 'high', 96.5, '#f5c542', '#1f1606', '🪙🏆🦢🍷💰🗿👑', 'royal'],
];

export function buildCatalog() {
  const games = [];
  let sort = 0;
  for (const [slug, name, vol, rtp, a, b, sym, tag] of SLOTS) {
    games.push({
      id: 'ks-' + slug, name, category: 'slots', engine: 'slot', rtp, volatility: vol,
      theme: { a, b, symbols: [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(sym)].map((x) => x.segment), volatility: vol, rtp },
      min: 10, max: vol === 'high' ? 5000 : 10000, tags: [tag], sort: sort++,
    });
  }
  // Legends: the Legendary characters star in these (lib/legends.js decides who; admin can recast).
  // The symbols below are their stand-ins until portraits are painted: same order as the cast.
  for (const [slug, name, vol, rtp, a, b, sym] of [
    ['legends-lounge', 'Legends Lounge', 'medium', 96.3, '#f5c542', '#1a1030', '🦉🤖🦊🐈🦫🐶🦍'],
    ['billionaire-zoo', 'Billionaire Zoo', 'high', 96.4, '#ff5fa2', '#200820', '🐹🐊🪿🦝🐙🦁👽'],
  ]) {
    games.push({
      id: 'ks-' + slug, name, category: 'slots', engine: 'slot', rtp, volatility: vol,
      theme: { a, b, symbols: [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(sym)].map((x) => x.segment), volatility: vol, rtp, cast: 'ks-' + slug },
      min: 10, max: vol === 'high' ? 5000 : 10000, tags: ['legends'], sort: sort++,
    });
  }
  const table = (id, name, engine, rtp, a, b, extra = {}, min = 50, max = 50000, tags = [], category = ['roulette', 'blackjack'].includes(engine) ? 'table' : 'originals') =>
    games.push({ id: 'ks-' + id, name, category, engine, rtp, volatility: extra.risk || null, theme: { a, b, ...extra }, min, max, tags, sort: sort++ });

  // Kohler originals (Survivor lives in its own engine, lib/pool.js)
  table('rocket', 'Rocket', 'rocket', 99, '#ff6a3d', '#1a0703', {}, 10, 100000, ['original', 'crash']);
  // the same crash maths as Rocket, flown by Sir Reginald Flapsworth on a firework
  table('flapsworth', 'Flapsworth Takes Flight', 'rocket', 99, '#ffb347', '#0b1a33', { cast: 'ks-flapsworth', flyer: true }, 10, 100000, ['original', 'crash', 'legends']);
  table('mines', 'Mines', 'mines', 99, '#22c55e', '#04170b', {}, 10, 100000, ['original']);
  table('coinflip', 'Coin Flip', 'coinflip', 98, '#e8c46a', '#191204', {}, 10, 100000, ['original']);
  table('limbo', 'Limbo', 'limbo', 99, '#a78bfa', '#120a2a', {}, 10, 100000, ['original']);
  table('keno-boss', 'Keno Boss', 'keno', 97, '#f5b31a', '#1a1003', {}, 10, 5000, ['original', 'keno']);

  table('roulette-euro', 'European Roulette', 'roulette', 97.3, '#1f9d55', '#06180e', { felt: '#0d5c33' }, 10, 50000, ['roulette']);
  table('roulette-noir', 'Roulette Noir', 'roulette', 97.3, '#c9a227', '#0b0b0f', { felt: '#17171f' }, 10, 50000, ['roulette']);
  table('roulette-velvet', 'Velvet Roulette (high limit)', 'roulette', 97.3, '#b8325a', '#1a0610', { felt: '#5a1027' }, 1000, 500000, ['roulette', 'vip']);
  table('roulette-quick', 'Quick Roulette', 'roulette', 97.3, '#3b82f6', '#06122a', { felt: '#0f2f6b', quick: true }, 10, 20000, ['roulette']);
  table('bj-classic', 'Blackjack Classic', 'blackjack', 98.9, '#16a34a', '#04170b', { felt: '#0e5a2f' }, 100, 50000, ['blackjack']);
  table('bj-high', 'Blackjack High Limit', 'blackjack', 98.9, '#d4af37', '#140f04', { felt: '#3b2c07' }, 2500, 500000, ['blackjack', 'vip']);
  table('bj-midnight', 'Midnight Blackjack', 'blackjack', 98.9, '#6366f1', '#0a0b24', { felt: '#1e1b4b' }, 100, 50000, ['blackjack']);
  table('bj-pro', 'Blackjack Pro', 'blackjack', 98.9, '#ef4444', '#1a0606', { felt: '#5b1111' }, 500, 100000, ['blackjack']);
  table('dice-duel', 'Dice Duel', 'dice', 99, '#22d3ee', '#04161c', {}, 10, 50000, ['dice']);
  table('dice-neon', 'Neon Dice', 'dice', 99, '#e879f9', '#1c0622', {}, 10, 50000, ['dice']);
  table('dice-highroller', 'High Roller Dice', 'dice', 99, '#facc15', '#1a1402', {}, 500, 200000, ['dice', 'vip']);
  for (const [id, name, rows, risk, a, b] of [['plinko-drop', 'Plinko Drop', 12, 'medium', '#38bdf8', '#06142a'], ['plinko-gentle', 'Plinko Gentle', 8, 'low', '#4ade80', '#06200f'], ['plinko-peak', 'Plinko Peak', 16, 'high', '#f43f5e', '#22060d']])
    table(id, name, 'plinko', Math.floor(plinkoTable(rows, risk).rtp * 100) / 100, a, b, { rows, risk }, 10, 20000, ['plinko']);
  for (const [id, name, risk, a, b] of [['wheel-classic', 'Spin Wheel Classic', 'low', '#f59e0b', '#1f1302'], ['wheel-jackpot', 'Jackpot Wheel', 'high', '#a855f7', '#160628']])
    table(id, name, 'wheel', Math.floor(wheelTable(risk).rtp * 100) / 100, a, b, { risk }, 10, 20000, ['wheel']);
  return games;
}
