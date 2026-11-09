// Everything the Vault sells or gives away. Kinds:
//   frame  – a ring around your avatar (everyone sees it)      effect – plays on your screen when you win
//   theme  – an ambient layer over Kohler on your own screen   filter – changes how your avatar looks (everyone sees it)
//   pass   – the Kohler Pass
// earn: a badge id (lib/achievements.js) – the item can't be bought, it's given with the badge.
// season: shown and sold only between from and to (MM-DD, every year); anyone who has it keeps it forever.
const P = (d) => Math.round(d * 100);
const tierOf = (cents, earn) => (earn ? 'earned' : cents === 0 ? 'free' : cents <= 199 ? 'common' : cents <= 299 ? 'rare' : cents <= 499 ? 'epic' : 'legendary');
const item = (kind, id, name, price, art, blurb, extra = {}) => ({ id, kind, slot: kind === 'pass' ? null : kind, name, price: extra.earn ? 0 : P(price), tier: extra.tier || tierOf(extra.earn ? 0 : P(price), extra.earn), art, blurb, ...extra });
const F = (id, name, price, cat, art, blurb, extra) => item('frame', id, name, price, art, blurb, { cat, ...extra });
const X = (id, name, price, cat, art, blurb, extra) => item('effect', id, name, price, art, blurb, { cat, ...extra });
const TH = (id, name, price, cat, art, blurb, extra) => item('theme', id, name, price, art, blurb, { cat, ...extra });
const FI = (id, name, price, cat, art, blurb, extra) => item('filter', id, name, price, art, blurb, { cat, ...extra });

export const SEASONS = {
  halloween: { label: 'Halloween', from: '10-01', to: '11-05' },
  christmas: { label: 'Christmas', from: '12-01', to: '01-06' },
};
const HW = { season: 'halloween' }, XM = { season: 'christmas' };

const names = new Intl.DisplayNames(['en'], { type: 'region' });
const EXTRA_NAMES = { 'gb-eng': 'England', 'gb-sct': 'Scotland', 'gb-wls': 'Wales', 'gb-nir': 'Northern Ireland' };
export const FLAG_CODES = ["ad", "ae", "af", "ag", "ai", "al", "am", "ao", "aq", "ar", "as", "at", "au", "aw", "ax", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bl", "bm", "bn", "bo", "bq", "br", "bs", "bt", "bv", "bw", "by", "bz", "ca", "cc", "cd", "cf", "cg", "ch", "ci", "ck", "cl", "cm", "cn", "co", "cp", "cr", "cu", "cv", "cw", "cx", "cy", "cz", "de", "dg", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "eu", "fi", "fj", "fk", "fm", "fo", "fr", "ga", "gb-eng", "gb-nir", "gb-sct", "gb-wls", "gb", "gd", "ge", "gf", "gg", "gh", "gi", "gl", "gm", "gn", "gp", "gq", "gr", "gs", "gt", "gu", "gw", "gy", "hk", "hm", "hn", "hr", "ht", "hu", "ic", "id", "ie", "il", "im", "in", "io", "iq", "ir", "is", "it", "je", "jm", "jo", "jp", "ke", "kg", "kh", "ki", "km", "kn", "kp", "kr", "kw", "ky", "kz", "la", "lb", "lc", "li", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me", "mf", "mg", "mh", "mk", "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt", "mu", "mv", "mw", "mx", "my", "mz", "na", "nc", "ne", "nf", "ng", "ni", "nl", "no", "np", "nr", "nu", "nz", "om", "pa", "pc", "pe", "pf", "pg", "ph", "pk", "pl", "pm", "pn", "pr", "ps", "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sc", "sd", "se", "sg", "sh", "si", "sj", "sk", "sl", "sm", "sn", "so", "sr", "ss", "st", "sv", "sx", "sy", "sz", "tc", "td", "tf", "tg", "th", "tj", "tk", "tl", "tm", "tn", "to", "tr", "tt", "tv", "tw", "tz", "ua", "ug", "um", "un", "us", "uy", "uz", "va", "vc", "ve", "vg", "vi", "vn", "vu", "wf", "ws", "xk", "ye", "yt", "za", "zm", "zw"];
const countryName = (c) => EXTRA_NAMES[c] || (() => { try { return names.of(c.toUpperCase()); } catch { return c.toUpperCase(); } })();

export const ITEMS = [
  /* ── frames: classic ── */
  F('fr-gold', 'Gold Ring', 1.99, 'Classic', { ring: '#e8c46a' }, 'Classic gold around your avatar.'),
  F('fr-neon', 'Neon Pulse', 2.99, 'Classic', { ring: '#00ff66', glow: true }, 'Glows green while you play.'),
  F('fr-inferno', 'Inferno', 4.99, 'Classic', { ring: '#ff5a1f', glow: true, spin: true }, 'A ring of moving flame.'),
  F('fr-diamond', 'Diamond Cut', 9.99, 'Classic', { ring: '#9be7ff', glow: true, facets: true }, 'Faceted ice-blue.'),
  F('fr-obsidian', 'Obsidian Crown', 19.99, 'Classic', { ring: '#e8c46a', glow: true, crown: true }, 'Gold crown on a black ring.'),
  F('fr-pass', 'Pass Holder', 0, 'Classic', { ring: '#a78bfa', glow: true }, 'Free while your Kohler Pass is active.', { pass: true, tier: 'pass' }),

  /* ── frames: textures ── */
  F('fr-fire', 'Wildfire', 3.99, 'Textures', { pattern: 'flames', colors: ['#ff3d00', '#ff9100', '#ffd54f'], glow: '#ff6d00', flow: true }, 'Real flames, always moving.'),
  F('fr-ice', 'Glacier', 3.99, 'Textures', { pattern: 'facets', colors: ['#e0f7ff', '#7fd8ff', '#2a9fd6'], glow: '#7fd8ff' }, 'Cut from a glacier.'),
  F('fr-marble', 'Marble', 2.99, 'Textures', { pattern: 'marble', colors: ['#f4f1ea', '#b9b4aa', '#6f6a62'] }, 'Polished stone, quietly expensive.'),
  F('fr-galaxy', 'Galaxy', 4.99, 'Textures', { pattern: 'stars', colors: ['#1b0f3b', '#5b2a9e', '#ffffff'], glow: '#8b5cf6', flow: true }, 'A slice of the night sky.'),
  F('fr-camo', 'Camo', 1.99, 'Textures', { pattern: 'camo', colors: ['#4b5320', '#6b8e23', '#2f3a1a', '#a39b6a'] }, 'Now you see me.'),
  F('fr-leopard', 'Leopard', 2.99, 'Textures', { pattern: 'leopard', colors: ['#d9a441', '#3b2410', '#8a5a1e'] }, 'Loud on purpose.'),
  F('fr-zebra', 'Zebra', 1.99, 'Textures', { pattern: 'zebra', colors: ['#f5f5f5', '#111111'] }, 'Black, white, never grey.'),
  F('fr-denim', 'Denim', 1.99, 'Textures', { pattern: 'weave', colors: ['#2b4c7e', '#4a6fa5', '#d9c79a'] }, 'Double denim, single ring.'),
  F('fr-pixel', '8-Bit', 2.99, 'Textures', { pattern: 'pixel', colors: ['#ff4d6d', '#ffd166', '#06d6a0', '#118ab2'] }, 'Press start.'),
  F('fr-rainbow', 'Rainbow', 2.99, 'Textures', { pattern: 'rainbow', flow: true }, 'Every colour, all the time.'),
  F('fr-tiedye', 'Tie-Dye', 2.99, 'Textures', { pattern: 'tiedye', colors: ['#ff6ec7', '#7c3aed', '#22d3ee', '#facc15'], flow: true }, 'Festival season, every season.'),
  F('fr-carbon', 'Carbon Fibre', 2.99, 'Textures', { pattern: 'checker', colors: ['#1c1f24', '#2d323a'], ring: '#5b636e' }, 'Light, strong, fast.'),
  F('fr-lava', 'Lava Lamp', 3.99, 'Textures', { pattern: 'waves', colors: ['#5b1a8c', '#ff5e3a', '#ffb347'], flow: true, glow: '#ff5e3a' }, 'Groovy, slow, hypnotic.'),

  /* ── frames: world cultures ── */
  F('fr-kente', 'Kente', 3.99, 'World', { pattern: 'kente', colors: ['#f2b705', '#0b7a3b', '#c1121f', '#111111'] }, 'Woven royal cloth from Ghana.'),
  F('fr-ankara', 'Ankara', 3.99, 'World', { pattern: 'ankara', colors: ['#ff6b00', '#0077b6', '#ffd60a', '#d00000'] }, 'Bold West African wax print.'),
  F('fr-mudcloth', 'Bogolan', 2.99, 'World', { pattern: 'mudcloth', colors: ['#5a3e2b', '#f1e3c8'] }, 'Mali mudcloth, hand-painted lines.'),
  F('fr-shuka', 'Shuka', 2.99, 'World', { pattern: 'plaid', colors: ['#c1121f', '#1d3557', '#c1121f', '#f1faee'] }, 'The red check of the Maasai.'),
  F('fr-tartan', 'Tartan', 2.99, 'World', { pattern: 'plaid', colors: ['#14532d', '#991b1b', '#14532d', '#facc15'] }, 'A clan of your own.'),
  F('fr-sakura', 'Sakura', 3.99, 'World', { pattern: 'petals', colors: ['#ffe4ef', '#ff8fb8', '#d63c77'] }, 'Cherry blossom season.'),
  F('fr-seigaiha', 'Seigaiha', 3.99, 'World', { pattern: 'scales', colors: ['#0b3c5d', '#328cc1', '#d9eef7'] }, 'Japanese ocean waves.'),
  F('fr-talavera', 'Talavera', 3.99, 'World', { pattern: 'tiles', colors: ['#f8f4e3', '#1d4e89', '#f4a300'] }, 'Painted tiles from Puebla.'),
  F('fr-papel', 'Papel Picado', 2.99, 'World', { pattern: 'stripes', colors: ['#ff006e', '#fb5607', '#ffbe0b', '#3a86ff', '#8338ec'] }, 'Fiesta flags, all the colours.'),
  F('fr-carnaval', 'Carnaval', 3.99, 'World', { pattern: 'feathers', colors: ['#009c3b', '#ffdf00', '#002776'], glow: '#ffdf00' }, 'Rio in a ring.'),
  F('fr-rangoli', 'Rangoli', 3.99, 'World', { pattern: 'dots', colors: ['#ff006e', '#ffbe0b', '#00b4d8', '#7209b7'] }, 'Colour at the door for luck.'),
  F('fr-azulejo', 'Azulejo', 2.99, 'World', { pattern: 'tiles', colors: ['#ffffff', '#1f4e9c', '#1f4e9c'] }, 'Blue and white, Lisbon style.'),

  /* ── frames: funny ── */
  F('fr-pizza', 'Pizza Party', 1.99, 'Funny', { emoji: '🍕', ring: '#f4a259' }, 'Extra cheese.'),
  F('fr-tape', 'Duct Tape', 0.99, 'Funny', { pattern: 'tape', colors: ['#b8bcc2', '#8d9298'] }, 'Holding it all together.'),
  F('fr-bacon', 'Bacon', 1.99, 'Funny', { pattern: 'waves', colors: ['#7f1d1d', '#f9a8a8', '#b91c1c'] }, 'Sizzling.'),
  F('fr-banana', 'Going Bananas', 1.99, 'Funny', { emoji: '🍌', ring: '#facc15' }, 'Absolutely bananas.'),
  F('fr-ducks', 'Rubber Ducks', 1.99, 'Funny', { emoji: '🦆', ring: '#fde047' }, 'Quack.'),
  F('fr-cats', 'Cat Tax', 1.99, 'Funny', { emoji: '🐈', ring: '#f59e0b' }, 'You have to pay it.'),
  F('fr-skull', "I'm Dead", 1.99, 'Funny', { emoji: '💀', ring: '#e5e7eb' }, 'That was too funny.'),
  F('fr-clown', 'Clown Car', 0.99, 'Funny', { emoji: '🤡', ring: '#ef4444' }, 'Honk honk.'),

  /* ── frames: trending ── */
  F('fr-main', 'Main Character', 2.99, 'Trending', { ring: '#ffd166', glow: '#ffd166', top: '✨' }, 'The story is about you.'),
  F('fr-npc', 'NPC', 1.99, 'Trending', { pattern: 'pixel', colors: ['#9ca3af', '#6b7280', '#d1d5db', '#4b5563'], top: '🤖' }, 'Hello, traveller.'),
  F('fr-rizz', 'Unspoken Rizz', 1.99, 'Trending', { ring: '#ff5fa2', glow: '#ff5fa2', top: '😏' }, 'No words needed.'),
  F('fr-delulu', 'Delulu', 1.99, 'Trending', { pattern: 'tiedye', colors: ['#fbcfe8', '#c4b5fd', '#a5f3fc', '#fde68a'], top: '🦄' }, 'It is the solulu.'),
  F('fr-sigma', 'Sigma Grindset', 1.99, 'Trending', { pattern: 'stripes', colors: ['#0b0b0b', '#c9a227'], top: '🗿' }, 'No days off.'),
  F('fr-grass', 'Touch Grass', 1.99, 'Trending', { pattern: 'grass', colors: ['#14532d', '#22c55e', '#86efac'] }, 'A gentle reminder.'),
  F('fr-goat', 'GOAT', 2.99, 'Trending', { emoji: '🐐', ring: '#e8c46a', glow: '#e8c46a' }, 'Greatest of all time.'),
  F('fr-stonks', 'Stonks', 1.99, 'Trending', { emoji: '📈', ring: '#16a34a' }, 'Only goes up.'),

  /* ── frames: seasonal ── */
  F('fr-pumpkin', 'Pumpkin Patch', 2.99, 'Seasonal', { emoji: '🎃', ring: '#ea580c', glow: '#ea580c' }, 'Halloween only.', HW),
  F('fr-cobweb', 'Cobweb', 2.99, 'Seasonal', { pattern: 'web', colors: ['#111111', '#d4d4d4'] }, 'Spooky season special.', HW),
  F('fr-bats', 'Night of Bats', 2.99, 'Seasonal', { emoji: '🦇', ring: '#4c1d95', glow: '#7c3aed' }, 'They come out at night.', HW),
  F('fr-candycane', 'Candy Cane', 2.99, 'Seasonal', { pattern: 'stripes', colors: ['#ffffff', '#dc2626'] }, 'Christmas only.', XM),
  F('fr-lights', 'Fairy Lights', 3.99, 'Seasonal', { pattern: 'lights', colors: ['#14532d', '#ef4444', '#facc15', '#38bdf8', '#22c55e'], glow: '#facc15' }, 'Twinkle twinkle.', XM),
  F('fr-santa', 'Santa Hat', 2.99, 'Seasonal', { ring: '#dc2626', top: '🎅' }, 'Ho ho ho.', XM),

  /* ── frames: earned ── */
  F('fr-ember', 'Ember', 0, 'Earned', { ring: '#ff7a1a', glow: '#ff7a1a' }, 'Play 3 days in a row.', { earn: 'streak_3' }),
  F('fr-blaze', 'Blaze', 0, 'Earned', { pattern: 'flames', colors: ['#ff1f00', '#ff7a00', '#ffe066'], glow: '#ff3d00', flow: true }, 'Play 7 days in a row.', { earn: 'streak_7' }),
  F('fr-eternal', 'Eternal Flame', 0, 'Earned', { pattern: 'flames', colors: ['#2563eb', '#60a5fa', '#e0f2fe'], glow: '#60a5fa', flow: true, crown: true }, 'Play 30 days in a row.', { earn: 'streak_30' }),
  F('fr-gilded', 'Gilded', 0, 'Earned', { pattern: 'facets', colors: ['#fff0b8', '#e8c46a', '#8a6420'], glow: '#e8c46a' }, 'Reach Gold tier.', { earn: 'tier_gold' }),
  F('fr-standing', 'Last One Standing', 0, 'Earned', { ring: '#22c55e', glow: '#22c55e', top: '🛡️' }, 'Survive 25 Survivor rounds.', { earn: 'survivor_25' }),
  F('fr-crowd', 'Crowd Pleaser', 0, 'Earned', { emoji: '📣', ring: '#a855f7', glow: '#a855f7' }, 'Ten friends you invited deposit.', { earn: 'referrer_10' }),

  /* ── frames: flags ── */
  ...FLAG_CODES.map((c) => F('fr-flag-' + c, countryName(c), 0.99, 'Flags', { flag: c }, `Rep ${countryName(c)}.`)),

  /* ── win effects ── */
  X('fx-confetti', 'Confetti', 0, 'Classic', { fx: 'confetti' }, 'The classic.'),
  X('fx-coins', 'Coin Shower', 2.99, 'Classic', { fx: 'coins' }, 'Gold coins rain down when you win.'),
  X('fx-fireworks', 'Fireworks', 3.99, 'Classic', { fx: 'fireworks' }, 'Bursts across the screen.'),
  X('fx-lightning', 'Lightning', 4.99, 'Classic', { fx: 'lightning' }, 'A flash of neon green.'),
  X('fx-royal', 'Royal Gold', 7.99, 'Classic', { fx: 'royal' }, 'Crowns and gold dust.'),
  X('fx-fire', 'Fire Burst', 2.99, 'Classic', { emoji: ['🔥'], mode: 'burst', glow: '#ff6d00' }, 'Things are heating up.'),
  X('fx-money', 'Make It Rain', 3.99, 'Classic', { emoji: ['💸', '💵', '💰'], mode: 'rain' }, 'Exactly what it says.'),
  X('fx-diamonds', 'Diamond Hands', 3.99, 'Classic', { emoji: ['💎'], mode: 'rain', glow: '#7fd8ff' }, 'Never selling.'),
  X('fx-lanterns', 'Sky Lanterns', 3.99, 'World', { emoji: ['🏮'], mode: 'float', glow: '#ff9f43' }, 'Lanterns drift up into the night.'),
  X('fx-sakura', 'Hanami', 2.99, 'World', { emoji: ['🌸', '💮'], mode: 'drift' }, 'A breeze of cherry blossom.'),
  X('fx-carnaval', 'Carnaval', 2.99, 'World', { emoji: ['🎉', '🎊', '🪇', '🪅'], mode: 'burst' }, 'The whole street is dancing.'),
  X('fx-diya', 'Festival of Lights', 3.99, 'World', { emoji: ['🪔', '✨'], mode: 'float', glow: '#ffd166' }, 'Little lamps, big glow.'),
  X('fx-drums', 'Talking Drums', 2.99, 'World', { emoji: ['🥁', '🎶', '✨'], mode: 'burst' }, 'The beat drops when you win.'),
  X('fx-tacos', 'Taco Tuesday', 1.99, 'Funny', { emoji: ['🌮'], mode: 'rain' }, 'Every day is Tuesday.'),
  X('fx-ducks', 'Duck Parade', 1.99, 'Funny', { emoji: ['🦆'], mode: 'parade' }, 'They just keep coming.'),
  X('fx-dead', "I'm Dead", 1.99, 'Funny', { emoji: ['💀', '😂', '😭'], mode: 'burst' }, 'Literally crying.'),
  X('fx-aliens', 'Abduction', 2.99, 'Funny', { emoji: ['👽', '🛸'], mode: 'float' }, 'Beam me up.'),
  X('fx-hearts', 'Love It', 1.99, 'Trending', { emoji: ['❤️', '💖', '💘'], mode: 'float' }, 'Heart eyes only.'),
  X('fx-airhorn', 'Airhorn', 2.99, 'Trending', { emoji: ['📯', '🕶️', '💥'], mode: 'burst', sound: 'horn' }, 'BWAAAP.'),
  X('fx-stonks', 'Stonks', 1.99, 'Trending', { emoji: ['📈', '💹', '🚀'], mode: 'float' }, 'To the moon.'),
  X('fx-goat', 'GOAT', 1.99, 'Trending', { emoji: ['🐐', '👑'], mode: 'burst' }, 'Acknowledge the greatness.'),
  X('fx-spooky', 'Spooky Night', 2.99, 'Seasonal', { emoji: ['🎃', '🦇', '👻'], mode: 'burst' }, 'Halloween only.', HW),
  X('fx-gifts', 'Present Drop', 2.99, 'Seasonal', { emoji: ['🎁', '🎄', '❄️', '⭐'], mode: 'rain' }, 'Christmas only.', XM),
  X('fx-phoenix', 'Phoenix', 0, 'Earned', { emoji: ['🔥', '🪶', '✨'], mode: 'burst', glow: '#ff3d00' }, 'Play 14 days in a row.', { earn: 'streak_14' }),
  X('fx-siren', 'Jackpot Siren', 0, 'Earned', { emoji: ['🚨', '💰'], mode: 'burst', glow: '#ff1f3d' }, 'Win $100 or more in one go.', { earn: 'big_win_100' }),

  /* ── themes: on your own screen ── */
  TH('th-money', 'Money Rain', 3.99, 'Themes', { kind: 'emoji', emoji: ['💵', '💸'], speed: 0.6, count: 26 }, 'Notes drifting down while you play.'),
  TH('th-sakura', 'Cherry Blossom', 2.99, 'Themes', { kind: 'petals', colors: ['#ffc2d9', '#ff8fb8'], count: 40 }, 'Petals on the breeze.'),
  TH('th-coderain', 'Code Rain', 2.99, 'Themes', { kind: 'code', colors: ['#00ff66'] }, 'Green glyphs falling forever.'),
  TH('th-fireflies', 'Fireflies', 2.99, 'Themes', { kind: 'fireflies', colors: ['#fff59d', '#c6ff00'], count: 34 }, 'Warm summer night.'),
  TH('th-stars', 'Starfield', 1.99, 'Themes', { kind: 'stars', colors: ['#ffffff', '#c4b5fd'], count: 120 }, 'A quiet night sky.'),
  TH('th-bubbles', 'Bubbles', 1.99, 'Themes', { kind: 'bubbles', colors: ['#7dd3fc'], count: 30 }, 'Gently rising bubbles.'),
  TH('th-party', 'Party Mode', 1.99, 'Themes', { kind: 'confetti', colors: ['#00ff66', '#e8c46a', '#ff4d6d', '#7c5cff', '#38bdf8'], count: 50 }, 'Confetti that never stops.'),
  TH('th-halloween', 'Haunted', 2.99, 'Seasonal', { kind: 'emoji', emoji: ['🦇', '👻', '🎃'], speed: 0.5, count: 16, fog: '#2e1065' }, 'Halloween only.', HW),
  TH('th-snow', 'Snowfall', 2.99, 'Seasonal', { kind: 'snow', colors: ['#ffffff'], count: 120 }, 'Christmas only.', XM),
  TH('th-obsidian', 'Obsidian Sky', 0, 'Earned', { kind: 'aurora', colors: ['#00ff66', '#7c3aed', '#38bdf8'] }, 'Reach Obsidian tier.', { earn: 'tier_obsidian' }),
  TH('th-gallery', 'Gallery Gold', 0, 'Earned', { kind: 'dust', colors: ['#e8c46a', '#fff0b8'], count: 60 }, 'Own 25 Vault items.', { earn: 'collector_25' }),

  /* ── avatar filters: everyone sees them ── */
  FI('fi-noir', 'Noir', 1.99, 'Filters', { css: 'grayscale(1) contrast(1.15)' }, 'Black and white, film-star moody.'),
  FI('fi-sepia', 'Old Photo', 1.99, 'Filters', { css: 'sepia(.85) contrast(1.05) saturate(1.2)' }, 'Found in a drawer from 1920.'),
  FI('fi-neon', 'Neon Pop', 2.99, 'Filters', { css: 'saturate(2.2) contrast(1.25)' }, 'Turned all the way up.'),
  FI('fi-invert', 'Upside Down', 1.99, 'Filters', { css: 'invert(1) hue-rotate(180deg)' }, 'Everything is backwards.'),
  FI('fi-thermal', 'Thermal', 2.99, 'Filters', { css: 'hue-rotate(200deg) saturate(3) contrast(1.4)' }, 'Heat vision on.'),
  FI('fi-vapor', 'Vaporwave', 2.99, 'Filters', { css: 'hue-rotate(260deg) saturate(1.6) contrast(1.1)' }, 'Aesthetic.'),
  FI('fi-comic', 'Comic', 1.99, 'Filters', { css: 'contrast(1.6) saturate(1.5) brightness(1.05)' }, 'Straight out of the panel.'),
  FI('fi-zombie', 'Zombie', 1.99, 'Seasonal', { css: 'hue-rotate(70deg) saturate(.7) brightness(.9) contrast(1.2)' }, 'Halloween only. Braaains.', HW),
  FI('fi-frost', 'Frosted', 1.99, 'Seasonal', { css: 'hue-rotate(170deg) saturate(.6) brightness(1.12)' }, 'Christmas only. Brrr.', XM),
  FI('fi-chrome', 'Chrome', 0, 'Earned', { css: 'grayscale(1) contrast(1.45) brightness(1.1)' }, 'Reach Silver tier.', { earn: 'tier_silver' }),

  /* ── membership ── */
  item('pass', 'pass-30', 'Kohler Pass · 30 days', 9.99, {}, 'Every Epic avatar free to wear, 30% off Legendary avatars, selected avatars free, plus the Pass Holder frame and badge. Stacks if you buy again.', { tier: 'pass' }),
];

// is a seasonal item on sale on this date? (MM-DD windows repeat every year, and can wrap past New Year)
export function inSeason(it, now = new Date()) {
  const s = it.season && SEASONS[it.season];
  if (!s) return true;
  const md = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  return s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to;
}
export const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
