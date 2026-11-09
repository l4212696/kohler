// Legendary avatars: named characters with a personality. They're the same family as the
// starter avatars (same exaggerated CGI-portrait look, same framing) pushed further: richer
// materials, wilder costumes and scenes as the rarity goes up. They star in games (character
// slots, the flying crash game) and some epics unlock by playing Survivor.
//
// Everything is managed from Kohler Control → Legends: text, personality lines, price, how many
// Survivor rounds unlock it, live/hidden, painting and approving the portrait, and which
// characters star in which game. Portraits are painted by the avatar factory (lib/avatars).
import express from 'express';

// Every character here is Legendary: the top tier of the Vault, in the same collection as the
// starter avatars. (The old free/common/rare/epic split only survives as how wild the CAST
// entries below were written.)
export const LEGEND_PRICE = 1999;

// How far the picture is pushed at each rarity (from the Kohler avatar design system). Rarity
// changes how extravagant and original it is, never the rendering style.
const RARITY_DIRECTION = {
  free: 'elegant and polished, a few tasteful details, soft balanced cinematic lighting, simple clean backdrop',
  common: 'expressive and full of personality, fashionable costume details, cinematic lighting, themed colourful background',
  rare: 'luxurious, surreal and mysterious, elaborate one-of-a-kind accessories, dramatic cinematic lighting, an immersive environment',
  epic: 'outlandish, absurdist and iconic, an extravagant over-the-top costume, a spectacular surreal photomontage environment, highly atmospheric lighting, visually unforgettable',
};
const REALISM = {
  fur: 'individual fur strands with natural density',
  feathers: 'detailed layered feather structures with iridescent sheen',
  scales: 'physically realistic scale patterns with glossy reflections',
  skin: 'realistic skin pores, texture and natural imperfections',
  alien: 'glossy iridescent translucent skin with subtle veins',
  robot: 'brushed and scratched metal with physically accurate reflections and tiny glowing LEDs',
  shell: 'detailed shell texture with natural ridges and wet highlights',
};

// The house prompt: the starter avatars' style (lib/avatars/style.js buildPrompt) with the
// design system's realism and the rarity's ambition added on top.
export const TEXTURES = Object.keys(REALISM);
export function legendPrompt(l) {
  const lines = [
    `Hyper-exaggerated pseudo-realistic 3D CGI meme character portrait of ${l.subject}${l.personality ? `, ${l.personality}` : ''}${l.accessory ? `, wearing ${l.accessory}` : ''}.${l.extra ? ` ${l.extra}.` : ''}`,
    `${REALISM[l.texture] || REALISM.fur}, detailed realistic eyes with natural reflections, realistic fabric folds and stitching, physically accurate gold, metal and gemstones.`,
    'Cartoonishly exaggerated huge expressive eyes, oversized mouth and teeth, squishy cheeks, absurd funny memorable personality, premium animated-feature-film meets photoreal look.',
    `Legendary edition: ${RARITY_DIRECTION.epic}.`,
    'Premium cinematic CGI render, subsurface scattering, dramatic rim lighting, natural contact shadows, crisp focus on the face, shallow depth of field.',
    `Background: ${l.background || 'a colourful gradient photo studio backdrop'}, layered cinematic depth, softly blurred.`,
    'Centred head-and-shoulders portrait, square composition, the face is large, fully visible and looking at the camera, safe for a circular crop, single character, family-friendly, fully clothed, no text, no letters, no watermark, no logo, no border, no collage.',
  ];
  return lines.join(' ').slice(0, 2000);
}
// shorter version for the backup painter (its prompt travels in the web address)
export function legendShortPrompt(l) {
  return [`legendary premium 3D CGI meme character portrait of ${l.subject}`, l.personality, l.accessory && `wearing ${l.accessory}`,
    RARITY_DIRECTION.epic, 'hilariously exaggerated expression, hyperrealistic textures, cinematic lighting',
    `background: ${l.background || 'colourful studio'}`, 'centered head-and-shoulders, square avatar, single character, family-friendly, fully clothed, no text, no watermark']
    .filter(Boolean).join(', ').slice(0, 600);
}

// The founding cast. Every character is original; humans are archetypes only (never an
// ethnicity, never a real person). Lines are what they say in the games.
const L = (id, name, title, rarity, emoji, texture, subject, personality, accessory, background, bio, lines, extra = {}) =>
  ({ id, name, title, rarity, emoji, texture, subject, personality, accessory, background, bio, lines, ...extra });
export const CAST = [
  // ── free: elegant, clean, still desirable
  L('madame-velvet', 'Madame Velvet', 'The Unbothered', 'free', '🐈', 'fur',
    'a fluffy white Persian cat with half-closed eyes', 'utterly unbothered, chin raised', 'a single strand of pearls', 'a soft blush-pink photo studio',
    'Has never once hurried. Wins anyway.', { win: ['Naturally.', 'As expected.', 'Put it on my tab.'], big: ['Fetch my fan. And the money.'], lose: ['I didn’t want it anyway.', 'Beneath me.'], idle: ['Wake me when it’s interesting.'] }),
  L('professor-hoot', 'Professor Hoot', 'Head of Probability', 'free', '🦉', 'feathers',
    'a barn owl', 'ridiculously serious, one eyebrow raised', 'tiny round brass spectacles and a tweed bow tie', 'a candle-lit library of ancient books',
    'Has a theory for every spin. None of them work.', { win: ['As my calculations predicted.', 'Hoo saw that coming? Me.'], big: ['Publish this result immediately!'], lose: ['A statistical anomaly.', 'Peer review will vindicate me.'], idle: ['Hmm. Fascinating.'] }),
  L('unit-07', 'Unit 07', 'Customer Service Bot', 'free', '🤖', 'robot',
    'a sleek minimalist white robot with a single round blue eye', 'adorably confused, head tilted', 'a lanyard with a blank name badge', 'a clean pale-blue futuristic studio',
    'Was built to fold towels. Ended up here.', { win: ['WIN DETECTED. HAPPY.EXE RUNNING.', 'Beep. Boop. Money.'], big: ['ERROR: TOO MUCH JOY.'], lose: ['Recalculating feelings…', 'Is this a bug?'], idle: ['Hello. I am helping.'] }),
  L('sunny-pepper', 'Sunny Pepper', 'Chief of Vibes', 'free', '🦊', 'fur',
    'a red panda', 'maniacally happy, huge grin', 'an oversized knitted beanie with a pom-pom', 'a sunny tropical beach with soft bokeh',
    'Thinks every spin is the best day of their life.', { win: ['BEST. DAY. EVER!', 'Yippee!!'], big: ['I’M CRYING HAPPY TEARS!'], lose: ['Still a great day!', 'Next one’s ours!'], idle: ['Hiiii!'] }),
  // ── common: stronger personality
  L('gerald', 'Gerald Buttersworth', 'Chief Executive of Snacks', 'common', '🐶', 'fur',
    'a pug in a sharp pinstripe business suit', 'overconfident, smug grin', 'an absurdly oversized silk tie', 'a moody city street at night with wet reflections',
    'Closes deals. Mostly for treats.', { win: ['Another deal closed.', 'Synergy, baby.'], big: ['Buy the company. Buy all the companies.'], lose: ['A strategic loss.', 'Circle back next quarter.'], idle: ['Let’s take this offline.'] }),
  L('dj-capy', 'DJ Capy', 'Too Chill To Care', 'common', '🦫', 'fur',
    'a capybara', 'totally unbothered, eyes half closed', 'a glowing RGB gaming headset', 'a neon-lit gaming room with RGB lights',
    'Has never panicked. Not even once.', { win: ['Nice.', 'Vibes paid off.'], big: ['Okay… that’s actually huge.'], lose: ['Whatever, man.', 'It’s all good.'], idle: ['…'] }),
  L('mama-gloria', 'Mama Gloria', 'Do Not Touch The Bag', 'common', '🪿', 'feathers',
    'a goose', 'furiously angry, honking with beak wide open', 'enormous white designer sunglasses and a wide-brimmed sun hat', 'a luxury yacht deck under bright sun',
    'Owns the pond, the yacht and your lunch.', { win: ['HONK. Mine.', 'Respect the goose.'], big: ['HOOOONK!!!'], lose: ['Who did this? WHO?', 'I’m calling my lawyer.'], idle: ['Don’t look at me.'] }),
  L('lil-chomp', 'Lil Chomp', 'Smile Like A Vault', 'common', '🐊', 'scales',
    'a young crocodile', 'mischievous sideways grin', 'shiny gold grills on every tooth', 'an abandoned neon arcade',
    'Bites first, asks for a refund later.', { win: ['Chomp chomp, cha-ching.', 'Snack secured.'], big: ['That’s a lotta gold for my teeth.'], lose: ['I’ll bite back.', 'Rude.'], idle: ['Got any snacks?'] }),
  L('nana-bolt', 'Nana Bolt', 'Fastest Grandma Alive', 'common', '👵', 'skin',
    'a tiny grandmother athlete with curly silver hair', 'overconfident, flexing one arm', 'a luxury velvet tracksuit and three gold medals', 'a stadium running track under floodlights',
    'Retired at 90. Unretired at 91.', { win: ['Back in my day this was harder.', 'Gold. Again.'], big: ['Somebody get me a bigger medal!'], lose: ['Warming up, sweetie.', 'Hmph.'], idle: ['Stretch your legs, dear.'] }),
  L('hamlet', 'Hamlet', 'Tragic Prince of Cheeks', 'common', '🐹', 'fur',
    'a hamster with enormously stuffed cheeks', 'dramatically crying, one tear rolling down', 'a ruffled royal Elizabethan collar', 'a fairytale castle hall at dusk',
    'To spin or not to spin. Always spin.', { win: ['Joy! Unbearable joy!', 'Fortune smiles on Hamlet!'], big: ['Alas! I am rich!'], lose: ['Woe is me!', 'Alas, poor balance.'], idle: ['*sniff*'] }),
  // ── rare: surreal, luxurious, mysterious
  L('sir-flapsworth', 'Sir Reginald Flapsworth', 'Pilot, Allegedly', 'rare', '🐦', 'feathers',
    'a pompous city pigeon', 'arrogant, beak in the air', 'a tiny tuxedo, a gold monocle and leather flying goggles', 'a cloudy sky at golden hour full of fireworks',
    'Strapped himself to a firework. Calls it aviation.', { win: ['Splendid landing, what?', 'Told you I could fly.'], big: ['Higher! HIGHER, I SAY!'], lose: ['KABOOM — I meant to do that.', 'Feathers everywhere. Tremendous.'], idle: ['Prepare for take-off.'] }, { texture: 'feathers' }),
  L('baron-von-mane', 'Baron Von Mane', 'Hair Is Wealth', 'rare', '🦁', 'fur',
    'a lion with an absurdly enormous, perfectly blow-dried golden mane', 'arrogant, admiring himself', 'diamond earrings and a silk smoking jacket', 'the leather interior of a luxury car at night',
    'Spends more on conditioner than you do on rent.', { win: ['Magnificent. Like my hair.', 'Of course.'], big: ['Gild the mane!'], lose: ['My hair is still perfect.', 'Unthinkable.'], idle: ['Is the lighting good?'] }),
  L('oracle-of-moss', 'The Oracle of Moss', 'Saw This Coming', 'rare', '🐢', 'shell',
    'an ancient wise tortoise whose shell grows glowing crystals and moss', 'mysterious, knowing smile', 'a hooded cloak of woven leaves', 'an enchanted forest with floating lights',
    'Three hundred years old. Still won’t tell you the next number.', { win: ['It was written.', 'The moss foretold it.'], big: ['The stars align, little one.'], lose: ['This too was foreseen.', 'Patience.'], idle: ['Ask… and wait.'] }),
  L('neon-ronin', 'Neon Ronin', 'Silent Blade', 'rare', '🦊', 'fur',
    'a red fox', 'intimidating, narrowed glowing eyes', 'futuristic chrome samurai armour with glowing seams', 'a rainy cyberpunk city at night with neon signs',
    'Speaks rarely. Wins often.', { win: ['…', 'Clean cut.'], big: ['The city will remember this.'], lose: ['Again.', 'Hm.'], idle: ['…'] }),
  L('duchess-octavia', 'Duchess Octavia', 'Eight Arms of Elegance', 'rare', '🐙', 'alien',
    'an octopus aristocrat', 'eccentric, delighted', 'a towering powdered wig, ropes of pearls and a lace gown', 'a dreamlike underwater ballroom with chandeliers',
    'Plays eight tables at once. Wins on at least three.', { win: ['How delightfully damp!', 'Splendid, darling.'], big: ['Pearls for everyone!'], lose: ['Ink-credible.', 'Tentacles crossed next time.'], idle: ['Tea, darling?'] }),
  L('tony-two-watches', 'Tony Two-Watches', 'Knows A Guy', 'rare', '🦝', 'fur',
    'a raccoon in a shiny silk shirt', 'suspicious, side-eyeing the camera', 'two luxury gold watches on each wrist', 'a surreal velvet nightclub with mirror balls',
    'Always on time. Twice.', { win: ['Don’t ask where I got it.', 'Business is good.'], big: ['Nobody saw nothin’.'], lose: ['This ain’t over.', 'I’ll make a call.'], idle: ['You didn’t see me.'] }),
  // ── epic: spectacle. Some only unlock by playing Survivor.
  L('emperor-bananas', 'Emperor Bananas III', 'Ruler of All Gold', 'epic', '🦍', 'fur',
    'a ridiculously wealthy silverback gorilla emperor seated on a towering golden throne', 'ridiculously rich, laughing with arms open', 'a diamond crown, layers of oversized gold chains and an ermine royal robe', 'a golden palace hall overflowing with treasure and banana-shaped chandeliers',
    'Owns the casino. And the moon. And you, a bit.', { win: ['Bring me another banana.', 'The Emperor is pleased.'], big: ['GOLD! MORE GOLD! ALL THE GOLD!'], lose: ['Execute the dealer. Kidding.', 'An emperor never loses. He invests.'], idle: ['Kneel.'] }, { unlock_rounds: 50, buyable: false }),
  L('king-zorgulon', 'King Zorgulon', 'Big Head, Bigger Plans', 'epic', '👽', 'alien',
    'a giant-headed alien king with a gigantic glowing brain-shaped head', 'shocked, mouth wide open', 'a jewelled galactic cape and a crown of tiny orbiting moons', 'outer space with a ringed planet and a nebula',
    'Came for world domination. Stayed for the slots.', { win: ['Earthlings… impressive.', 'Zorgulon approves.'], big: ['THIS IS BETTER THAN CONQUEST!'], lose: ['Recalibrating the galaxy.', 'Unacceptable, Earthling.'], idle: ['Take me to your jackpot.'] }, { unlock_rounds: 100, buyable: false }),
  L('lady-chimera', 'Lady Chimera', 'Half Peacock, Half Problem', 'epic', '🦚', 'feathers',
    'a surreal peacock-lion hybrid aristocrat with a fanned tail of jewel-coloured feathers', 'dramatic, chin raised', 'a gold filigree corset and a jewelled tiara', 'an erupting volcano under a red sky',
    'Everyone stares. That’s the point.', { win: ['Admire me.', 'Darling, of course.'], big: ['Feathers! Flames! Fortune!'], lose: ['How dare it.', 'I’ll allow it. Once.'], idle: ['You may look.'] }, { unlock_rounds: 25, buyable: true }),
  L('duke-escargot', 'Grand Duke Escargot', 'Takes His Time', 'epic', '🐌', 'shell',
    'a giant snail whose shell is a tiny gold-plated mansion with lit windows', 'completely unbothered, sipping tea', 'a silk cravat and a monocle', 'a dreamlike garden of giant flowers at dusk',
    'Moves slowly. Wins eventually. Every time.', { win: ['In due course.', 'Patience pays.'], big: ['Splendid. I shall celebrate… slowly.'], lose: ['No rush.', 'Tomorrow, perhaps.'], idle: ['…still arriving.'] }, { unlock_rounds: 75, buyable: true }),
  L('count-ribbitworth', 'Count Ribbitworth', 'Sits On A Fortune', 'epic', '🐸', 'scales',
    'a bullfrog aristocrat sitting on a mountain of gold coins', 'ridiculously serious, chest puffed out', 'an ermine royal robe and a gold monocle', 'a misty swamp turned into a golden palace',
    'Has been sitting on this fortune for 400 years. Refuses to move.', { win: ['Ribbit. Rich.', 'Into the pile.'], big: ['CROAK OF VICTORY!'], lose: ['A mere lily pad of a loss.', 'Ribbit… regrettable.'], idle: ['Ribbit.'] }, { unlock_rounds: 150, buyable: false }),
];

// Which characters star in which game. Slots: 7 symbols, lowest to highest, the last is the
// jackpot (pays on 5 only). Crash: one flyer. Admin can recast; the payouts don't change.
export const DEFAULT_CASTS = {
  'ks-legends-lounge': ['professor-hoot', 'unit-07', 'sunny-pepper', 'madame-velvet', 'dj-capy', 'gerald', 'emperor-bananas'],
  'ks-billionaire-zoo': ['hamlet', 'lil-chomp', 'mama-gloria', 'tony-two-watches', 'duchess-octavia', 'baron-von-mane', 'king-zorgulon'],
  'ks-flapsworth': ['sir-flapsworth'],
};

export function createLegends({ q, withTx, move, audit, avatars, log = console }) {
  const shape = (r, avatarOk = true) => r && ({
    id: r.id, name: r.name, title: r.title, tier: 'legendary', emoji: r.emoji, bio: r.bio, lines: r.lines || {},
    price: r.price_cents, unlockRounds: r.unlock_rounds, buyable: r.buyable, status: r.status, sort: r.sort,
    image: avatarOk && r.avatar_id ? r.avatar_id : null,
  });

  // seed the founding cast (only rows that don't exist yet, so admin edits always survive)
  async function seed() {
    for (const [i, l] of CAST.entries()) {
      await q(`insert into legends (id, name, title, rarity, emoji, category, archetype, subject, personality, accessory, background, extra, bio, lines, price_cents, unlock_rounds, buyable, sort)
               values ($1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict (id) do nothing`,
        [l.id, l.name, l.title, 'legendary', l.emoji, l.texture, l.subject, l.personality, l.accessory, l.background, l.extra || null, l.bio, l.lines,
         l.buyable === false ? 0 : LEGEND_PRICE, l.unlock_rounds || null, l.buyable !== false, i]);
    }
  }
  let seeded = null;
  const ready = () => (seeded ??= seed().catch((e) => { seeded = null; throw e; }));

  async function settings(c = null) {
    const m = Object.fromEntries((await (c ? c.query.bind(c) : q)(`select key, value from site_settings where key like 'legends\\_%'`)).rows.map((r) => [r.key, r.value]));
    let casts = {};
    try { casts = JSON.parse(m.legends_casts || '{}'); } catch {}
    return { unlocks: m.legends_unlocks_enabled !== 'false', casts: { ...DEFAULT_CASTS, ...casts } };
  }

  // ── painting: one job per portrait, painted by the avatar factory, approved here ──
  async function paint(id) {
    await ready();
    const l = (await q('select * from legends where id = $1', [id])).rows[0];
    if (!l) throw Object.assign(new Error('No such character.'), { code: 404 });
    const busy = (await q(`select 1 from avatar_jobs where kind = 'catalogue' and spec->>'legendId' = $1 and status in ('queued','running')`, [id])).rows[0];
    if (busy) return { queued: false, already: true };
    const spec = { collection: 'legendary', legendId: id, name: l.name, tier: 'legendary', price: 0, category: l.category, subject: l.subject,
      personality: l.personality, accessory: l.accessory, background: l.background, extra: l.extra,
      prompt: legendPrompt({ ...l, texture: l.category }), shortPrompt: legendShortPrompt(l), seed: Math.floor(Math.random() * 2 ** 31) };
    await q(`insert into avatar_jobs (kind, spec) values ('catalogue', $1)`, [spec]);
    avatars?.kick?.();
    return { queued: true };
  }
  // the avatar factory calls this when a legend's portrait comes back
  async function painted(c, legendId, avatarId) {
    await c.query(`update legends set pending_id = $2, updated_at = now() where id = $1`, [legendId, avatarId]);
  }

  // ── Survivor unlocks: called for every settled human seat ──
  async function onSurvivorPlay(c, userId) {
    const u = (await c.query(`update users set survivor_rounds = survivor_rounds + 1 where id = $1 returning survivor_rounds, test_mode`, [userId])).rows[0];
    if (!u) return [];
    const s = await settings(c);   // inside the round's transaction: never a second connection
    if (!s.unlocks) return [];
    const due = (await c.query(`select l.id, l.name from legends l where l.status = 'live' and l.avatar_id is not null and l.unlock_rounds is not null and l.unlock_rounds <= $2
        and not exists (select 1 from user_items i where i.user_id = $1 and i.item_id = 'lg:' || l.id)`, [userId, u.survivor_rounds])).rows;
    for (const l of due) {
      await c.query(`insert into user_items (user_id, item_id, price_cents, is_test) values ($1, $2, 0, $3) on conflict do nothing`, [userId, 'lg:' + l.id, !!u.test_mode]);
      await c.query(`insert into legend_unlocks (user_id, legend_id, how) values ($1, $2, 'survivor') on conflict do nothing`, [userId, l.id]);
    }
    return due;
  }
  // can this player wear this avatar? (asked by the avatar factory for legendary portraits)
  async function canWear(userId, avatarId) {
    const l = (await q(`select id, price_cents, unlock_rounds, buyable from legends where avatar_id = $1 and status = 'live'`, [avatarId])).rows[0];
    if (!l) return false;
    if (!l.unlock_rounds && l.price_cents === 0) return true;
    return !!(await q(`select 1 from user_items where user_id = $1 and item_id = $2`, [userId, 'lg:' + l.id])).rows[0];
  }

  /* ── public: /api/legends ── */
  const router = express.Router();
  const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { log.error('[legends]', e.message); res.status(e.code || 500).json({ error: e.code ? e.message : 'Something went wrong.' }); });
  router.get('/', h(async (req, res) => {
    await ready();
    const [rows, s] = await Promise.all([q(`select * from legends where status = 'live' and avatar_id is not null order by sort, name`), settings()]);
    let owned = [], rounds = 0, fresh = [];
    if (req.user) {
      owned = (await q(`select substr(item_id, 4) id from user_items where user_id = $1 and item_id like 'lg:%'`, [req.user.id])).rows.map((r) => r.id);
      rounds = Number((await q('select survivor_rounds from users where id = $1', [req.user.id])).rows[0]?.survivor_rounds || 0);
    }
    res.set('cache-control', 'no-store').json({
      legends: rows.rows.map((r) => ({ ...shape(r), owned: owned.includes(r.id) || (!r.unlock_rounds && r.price_cents === 0) })),
      casts: s.casts, unlocks: s.unlocks, rounds,
    });
  }));
  // new unlocks the player hasn't been told about yet (the casino shows them once)
  router.get('/news', h(async (req, res) => {
    if (!req.user) return res.json({ unlocked: [] });
    const r = await q(`select l.id, l.name, l.title, l.avatar_id from legend_unlocks u join legends l on l.id = u.legend_id where u.user_id = $1 and not u.seen`, [req.user.id]);
    if (r.rows.length) await q(`update legend_unlocks set seen = true where user_id = $1 and not seen`, [req.user.id]);
    res.json({ unlocked: r.rows.map((x) => ({ id: x.id, name: x.name, title: x.title, image: x.avatar_id })) });
  }));
  router.post('/:id/buy', h(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
    const out = await withTx(async (c) => {
      const l = (await c.query(`select * from legends where id = $1 and status = 'live' and avatar_id is not null`, [req.params.id])).rows[0];
      if (!l) throw Object.assign(new Error('That character isn’t available.'), { code: 404 });
      if (!l.buyable || l.price_cents <= 0) throw Object.assign(new Error(l.unlock_rounds ? `Unlock ${l.name} by playing ${l.unlock_rounds} Survivor rounds.` : 'This one is free.'), { code: 400 });
      if ((await c.query(`select 1 from user_items where user_id = $1 and item_id = $2`, [req.user.id, 'lg:' + l.id])).rows[0]) return { already: true };
      const u = (await c.query(`select balance_cents, bonus_locked_cents, test_mode from users where id = $1 for update`, [req.user.id])).rows[0];
      const spendable = Number(u.balance_cents) - Math.min(Number(u.bonus_locked_cents || 0), Math.max(0, Number(u.balance_cents)));
      if (spendable < l.price_cents) throw Object.assign(new Error('Not enough balance for this one.'), { code: 400 });
      await move(c, req.user.id, -l.price_cents, 'vault', 'lg:' + l.id, { legend: l.id, ...(u.test_mode ? { test: true } : {}) });
      await c.query(`insert into user_items (user_id, item_id, price_cents, is_test) values ($1,$2,$3,$4)`, [req.user.id, 'lg:' + l.id, l.price_cents, !!u.test_mode]);
      if (!u.test_mode) await c.query(`insert into platform_fees (user_id, kind, ref, amount_cents) values ($1, 'vault', $2, $3)`, [req.user.id, 'lg:' + l.id, l.price_cents]);
      return { bought: true };
    });
    res.json(out);
  }));

  /* ── admin: /api/admin/legends ── */
  const admin = express.Router();
  admin.get('/', h(async (_req, res) => {
    await ready();
    const [rows, s, owners, jobs] = await Promise.all([
      q(`select l.*, a.status as pending_status from legends l left join avatars a on a.id = l.pending_id order by l.sort, l.name`),
      settings(),
      q(`select substr(item_id, 4) id, count(*)::int n from user_items where item_id like 'lg:%' group by 1`),
      q(`select spec->>'legendId' id, status, last_error from avatar_jobs where kind = 'catalogue' and spec->>'legendId' is not null and status in ('queued','running','failed') order by created_at desc`),
    ]);
    const own = Object.fromEntries(owners.rows.map((r) => [r.id, r.n]));
    const job = {}; for (const j of jobs.rows) job[j.id] ??= { status: j.status, error: j.last_error };
    res.json({
      legends: rows.rows.map((r) => ({ ...shape(r), subject: r.subject, personality: r.personality, accessory: r.accessory, background: r.background, extra: r.extra,
        texture: r.category, pending: r.pending_id, owners: own[r.id] || 0, job: job[r.id] || null, prompt: legendPrompt({ ...r, texture: r.category }) })),
      settings: s, games: Object.keys(DEFAULT_CASTS), defaultPrice: LEGEND_PRICE, textures: TEXTURES, serverless: !!process.env.VERCEL,
    });
  }));
  const FIELDS = { name: 60, title: 60, emoji: 8, subject: 300, personality: 160, accessory: 200, background: 200, extra: 200, bio: 240 };
  function clean(b, base = {}) {
    const o = {};
    for (const [k, max] of Object.entries(FIELDS)) if (b[k] !== undefined) o[k] = String(b[k] ?? '').trim().slice(0, max);
    if (b.texture !== undefined && TEXTURES.includes(b.texture)) o.category = b.texture;
    if (b.price !== undefined) o.price_cents = Math.min(10_000_000, Math.max(0, Math.round(Number(b.price) || 0)));
    if (b.unlockRounds !== undefined) o.unlock_rounds = b.unlockRounds === null || b.unlockRounds === '' || Number(b.unlockRounds) <= 0 ? null : Math.min(100_000, Math.round(Number(b.unlockRounds)));
    if (b.buyable !== undefined) o.buyable = !!b.buyable;
    if (b.status !== undefined) o.status = b.status === 'hidden' ? 'hidden' : 'live';
    if (b.sort !== undefined) o.sort = Math.round(Number(b.sort) || 0);
    if (b.lines !== undefined) {
      const L2 = {};
      for (const k of ['win', 'big', 'lose', 'idle']) L2[k] = (Array.isArray(b.lines?.[k]) ? b.lines[k] : String(b.lines?.[k] || '').split('\n')).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 8);
      o.lines = L2;
    }
    if ((o.name ?? base.name) === '') throw Object.assign(new Error('Give it a name.'), { code: 400 });
    return o;
  }
  admin.post('/', h(async (req, res) => {
    await ready();
    const b = req.body || {}, o = clean(b);
    if (!o.name || !o.subject) return res.status(400).json({ error: 'A new character needs a name and a description of what to paint.' });
    const id = (b.id || o.name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'legend';
    const r = await q(`insert into legends (id, name, title, rarity, emoji, category, subject, personality, accessory, background, extra, bio, lines, price_cents, unlock_rounds, buyable, status, sort)
                       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'hidden',999) returning *`,
      [id, o.name, o.title || '', 'legendary', o.emoji || '⭐', TEXTURES.includes(b.texture) ? b.texture : 'fur',
       o.subject, o.personality || null, o.accessory || null, o.background || null, o.extra || null, o.bio || '', o.lines || {},
       o.price_cents ?? LEGEND_PRICE, o.unlock_rounds ?? null, o.buyable ?? true]).catch((e) => { if (e.code === '23505') throw Object.assign(new Error('A character with that name already exists.'), { code: 400 }); throw e; });
    await audit?.(req, 'legends.create', { id });
    res.json({ legend: shape(r.rows[0]) });
  }));
  admin.patch('/:id', h(async (req, res) => {
    const cur = (await q('select * from legends where id = $1', [req.params.id])).rows[0];
    if (!cur) return res.status(404).json({ error: 'No such character.' });
    const o = clean(req.body || {}, cur), keys = Object.keys(o);
    if (!keys.length) return res.json({ legend: shape(cur) });
    const r = await q(`update legends set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1 returning *`, [cur.id, ...keys.map((k) => o[k])]);
    await audit?.(req, 'legends.update', { id: cur.id, fields: keys });
    res.json({ legend: shape(r.rows[0]) });
  }));
  admin.post('/:id/paint', h(async (req, res) => { const out = await paint(req.params.id); await audit?.(req, 'legends.paint', { id: req.params.id }); res.json(out); }));
  admin.post('/paint-missing', h(async (req, res) => {
    await ready();
    const r = await q(`select id from legends where avatar_id is null and pending_id is null`);
    let n = 0; for (const x of r.rows) if ((await paint(x.id)).queued) n++;
    await audit?.(req, 'legends.paint_missing', { n });
    res.json({ queued: n });
  }));
  // the newly painted portrait becomes the character's face (and the old one is retired)
  admin.post('/:id/approve', h(async (req, res) => {
    const out = await withTx(async (c) => {
      const l = (await c.query('select * from legends where id = $1 for update', [req.params.id])).rows[0];
      if (!l?.pending_id) throw Object.assign(new Error('There’s no new portrait waiting.'), { code: 400 });
      await c.query(`update avatars set status = 'approved', approved_at = now() where id = $1`, [l.pending_id]);
      if (l.avatar_id) await c.query(`update avatars set status = 'rejected' where id = $1`, [l.avatar_id]);
      // anyone wearing the old portrait now wears the new one
      if (l.avatar_id) await c.query(`update users set equip = jsonb_set(equip, '{avatar}', to_jsonb($2::text)) where equip->>'avatar' = $1`, [l.avatar_id, l.pending_id]);
      await c.query(`update legends set avatar_id = pending_id, pending_id = null, updated_at = now() where id = $1`, [l.id]);
      return { ok: true };
    });
    await audit?.(req, 'legends.approve', { id: req.params.id });
    res.json(out);
  }));
  admin.post('/:id/reject', h(async (req, res) => {
    const l = (await q('select pending_id from legends where id = $1', [req.params.id])).rows[0];
    if (l?.pending_id) { await q(`update avatars set status = 'rejected' where id = $1`, [l.pending_id]); await q(`update legends set pending_id = null where id = $1`, [req.params.id]); }
    res.json({ ok: true });
  }));
  admin.delete('/:id', h(async (req, res) => {
    const n = Number((await q(`select count(*)::int n from user_items where item_id = $1`, ['lg:' + req.params.id])).rows[0].n);
    if (n) return res.status(400).json({ error: `${n} ${n === 1 ? 'player owns' : 'players own'} this character, so it stays. Hide it instead.` });
    await q('delete from legends where id = $1', [req.params.id]);
    await audit?.(req, 'legends.delete', { id: req.params.id });
    res.json({ ok: true });
  }));
  // settings: Survivor unlocks on/off, and which characters star in which game
  admin.patch('/', h(async (req, res) => {
    const b = req.body || {}, put = (k, v) => q(`insert into site_settings (key, value, updated_at) values ($1,$2,now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, String(v)]);
    if (b.unlocks !== undefined) await put('legends_unlocks_enabled', !!b.unlocks);
    if (b.cast && DEFAULT_CASTS[b.cast.game]) {
      const want = DEFAULT_CASTS[b.cast.game].length, ids = (b.cast.ids || []).map(String);
      if (ids.length !== want) return res.status(400).json({ error: `That game needs ${want} character${want > 1 ? 's' : ''}.` });
      if (new Set(ids).size !== ids.length) return res.status(400).json({ error: 'Each character can only appear once in a game.' });
      const known = new Set((await q('select id from legends')).rows.map((r) => r.id));
      if (ids.some((x) => !known.has(x))) return res.status(400).json({ error: 'Unknown character.' });
      const s = await settings(), custom = Object.fromEntries(Object.entries(s.casts).filter(([g, v]) => JSON.stringify(v) !== JSON.stringify(DEFAULT_CASTS[g])));
      custom[b.cast.game] = ids;
      await put('legends_casts', JSON.stringify(custom));
    }
    await audit?.(req, 'legends.settings', b);
    res.json({ settings: await settings() });
  }));

  return { router, admin, ready, paint, painted, onSurvivorPlay, canWear, settings };
}
