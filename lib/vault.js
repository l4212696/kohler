// The Vault: things people buy that aren't bets. Characters sit in your Survivor
// seat and on your profile, frames ring your avatar, effects play when you win,
// and the Kohler Pass is a 30-day membership. Every sale is 100% platform revenue.
import express from 'express';

const P = (d) => Math.round(d * 100);
// art: the spec public/assets/characters.js draws
const CH = (id, name, tier, price, art, blurb) => ({ id: 'ch-' + id, kind: 'character', slot: 'character', name, tier, price: P(price), art, blurb });
export const ITEMS = [
  // free starters
  CH('pip', 'Pip', 'free', 0, { shape: 'blob', c1: '#7cf29c', c2: '#1f9d55', eye: 'dot', mouth: 'smile', acc: 'none' }, 'Small, round, unbothered.'),
  CH('mochi', 'Mochi', 'free', 0, { shape: 'bean', c1: '#ffd1e8', c2: '#ff7ab8', eye: 'sleepy', mouth: 'o', acc: 'bow' }, 'Soft. Suspiciously lucky.'),
  CH('bolt', 'Bolt', 'free', 0, { shape: 'bot', c1: '#9fd8ff', c2: '#2f80ed', eye: 'visor', mouth: 'flat', acc: 'antenna' }, 'Calculates odds. Ignores them.'),
  CH('kumo', 'Kumo', 'free', 0, { shape: 'ghost', c1: '#f4f6fb', c2: '#a9b4cc', eye: 'big', mouth: 'o', acc: 'none' }, 'Floats past every elimination.'),
  CH('taro', 'Taro', 'free', 0, { shape: 'cat', c1: '#c9b6ff', c2: '#7c5cff', eye: 'dot', mouth: 'smile', acc: 'none' }, 'Nine lives, one stake.'),
  CH('olive', 'Olive', 'free', 0, { shape: 'blob', c1: '#d9f99d', c2: '#65a30d', eye: 'big', mouth: 'grin', acc: 'none' }, 'Keeps it green.'),
  // common
  CH('ziggy', 'Ziggy', 'common', 0.99, { shape: 'alien', c1: '#86efac', c2: '#0f766e', eye: 'big', mouth: 'grin', acc: 'antenna' }, 'Came for the Blitz tables.'),
  CH('bruno', 'Bruno', 'common', 0.99, { shape: 'cat', c1: '#fdba74', c2: '#c2410c', eye: 'dot', mouth: 'fang', acc: 'shades' }, 'Too cool to sweat a Duel.'),
  CH('juno', 'Juno', 'common', 1.49, { shape: 'bean', c1: '#a5f3fc', c2: '#0891b2', eye: 'star', mouth: 'smile', acc: 'headphones' }, 'Plays with the volume up.'),
  CH('rex', 'Rex', 'common', 1.49, { shape: 'dino', c1: '#bef264', c2: '#4d7c0f', eye: 'dot', mouth: 'fang', acc: 'none' }, 'Survived one extinction already.'),
  CH('luna', 'Luna', 'common', 1.99, { shape: 'ghost', c1: '#e0e7ff', c2: '#6366f1', eye: 'sleepy', mouth: 'smile', acc: 'halo' }, 'Moonlit and unbothered.'),
  CH('kai', 'Kai', 'common', 1.99, { shape: 'blob', c1: '#7dd3fc', c2: '#1d4ed8', eye: 'dot', mouth: 'grin', acc: 'shades' }, 'Rides every hot streak.'),
  CH('nyx', 'Nyx', 'common', 1.99, { shape: 'cat', c1: '#4b5563', c2: '#111827', eye: 'star', mouth: 'fang', acc: 'none' }, 'Black cat. Your problem now.'),
  CH('vex', 'Vex', 'common', 1.99, { shape: 'alien', c1: '#f0abfc', c2: '#a21caf', eye: 'x', mouth: 'o', acc: 'horns' }, 'Chaotic neutral.'),
  // rare
  CH('ember', 'Ember', 'rare', 4.99, { shape: 'blob', c1: '#fdba74', c2: '#dc2626', eye: 'big', mouth: 'grin', acc: 'flame' }, 'Literally on fire.'),
  CH('frost', 'Frost', 'rare', 4.99, { shape: 'bean', c1: '#e0f2fe', c2: '#38bdf8', eye: 'star', mouth: 'flat', acc: 'helmet' }, 'Ice in the veins at the draw.'),
  CH('glitch', 'Glitch', 'rare', 4.99, { shape: 'bot', c1: '#00ff66', c2: '#065f46', eye: 'visor', mouth: 'grin', acc: 'antenna' }, 'Not a bug. A feature.'),
  CH('shogun', 'Shogun', 'rare', 4.99, { shape: 'cat', c1: '#fca5a5', c2: '#991b1b', eye: 'dot', mouth: 'flat', acc: 'mask' }, 'Strikes once. Survives always.'),
  CH('oracle', 'Oracle', 'rare', 4.99, { shape: 'ghost', c1: '#ddd6fe', c2: '#7c3aed', eye: 'star', mouth: 'o', acc: 'wizard' }, 'Already knows the result.'),
  CH('astra', 'Astra', 'rare', 4.99, { shape: 'alien', c1: '#bae6fd', c2: '#0369a1', eye: 'big', mouth: 'smile', acc: 'helmet' }, 'From a casino in orbit.'),
  // epic
  CH('phantom', 'Phantom', 'epic', 9.99, { shape: 'ghost', c1: '#1f2937', c2: '#020617', eye: 'visor', mouth: 'flat', acc: 'horns', aura: '#a78bfa' }, 'Seen at every high-stakes table.'),
  CH('pharaoh', 'Pharaoh', 'epic', 9.99, { shape: 'cat', c1: '#fde68a', c2: '#b45309', eye: 'star', mouth: 'smile', acc: 'crown', aura: '#e8c46a' }, 'The vault was always his.'),
  // legendary
  CH('midas', 'Midas', 'legendary', 24.99, { shape: 'king', c1: '#fff1b8', c2: '#c99a35', eye: 'star', mouth: 'grin', acc: 'crown', aura: '#ffd166' }, 'Everything he touches. You know the rest.'),
  CH('zenith', 'Zenith', 'legendary', 49.99, { shape: 'king', c1: '#c4ffd9', c2: '#00b84a', eye: 'visor', mouth: 'smile', acc: 'halo', aura: '#00ff66' }, 'The last one standing. Every time.'),
  // frames
  { id: 'fr-gold', kind: 'frame', slot: 'frame', name: 'Gold Ring', tier: 'common', price: P(1.99), art: { ring: '#e8c46a' }, blurb: 'Classic gold around your avatar.' },
  { id: 'fr-neon', kind: 'frame', slot: 'frame', name: 'Neon Pulse', tier: 'rare', price: P(2.99), art: { ring: '#00ff66', glow: true }, blurb: 'Glows green while you play.' },
  { id: 'fr-inferno', kind: 'frame', slot: 'frame', name: 'Inferno', tier: 'rare', price: P(4.99), art: { ring: '#ff5a1f', glow: true, spin: true }, blurb: 'A ring of moving flame.' },
  { id: 'fr-diamond', kind: 'frame', slot: 'frame', name: 'Diamond Cut', tier: 'epic', price: P(9.99), art: { ring: '#9be7ff', glow: true, facets: true }, blurb: 'Faceted ice-blue.' },
  { id: 'fr-obsidian', kind: 'frame', slot: 'frame', name: 'Obsidian Crown', tier: 'legendary', price: P(19.99), art: { ring: '#e8c46a', glow: true, crown: true }, blurb: 'Gold crown on a black ring.' },
  { id: 'fr-pass', kind: 'frame', slot: 'frame', name: 'Pass Holder', tier: 'pass', price: 0, pass: true, art: { ring: '#a78bfa', glow: true }, blurb: 'Free while your Kohler Pass is active.' },
  // win effects
  { id: 'fx-confetti', kind: 'effect', slot: 'effect', name: 'Confetti', tier: 'free', price: 0, art: { fx: 'confetti' }, blurb: 'The classic.' },
  { id: 'fx-coins', kind: 'effect', slot: 'effect', name: 'Coin Shower', tier: 'common', price: P(2.99), art: { fx: 'coins' }, blurb: 'Gold coins rain down when you win.' },
  { id: 'fx-fireworks', kind: 'effect', slot: 'effect', name: 'Fireworks', tier: 'rare', price: P(3.99), art: { fx: 'fireworks' }, blurb: 'Bursts across the screen.' },
  { id: 'fx-lightning', kind: 'effect', slot: 'effect', name: 'Lightning', tier: 'rare', price: P(4.99), art: { fx: 'lightning' }, blurb: 'A flash of neon green.' },
  { id: 'fx-royal', kind: 'effect', slot: 'effect', name: 'Royal Gold', tier: 'epic', price: P(7.99), art: { fx: 'royal' }, blurb: 'Crowns and gold dust.' },
  // membership
  { id: 'pass-30', kind: 'pass', slot: null, name: 'Kohler Pass · 30 days', tier: 'pass', price: P(9.99), art: {},
    blurb: 'No service fee on shop orders, the Pass Holder frame and a Pass badge. Stacks if you buy again.' },
];
const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
export const itemById = (id) => BY_ID[id];

export function createVault({ q, withTx, move, audit }) {
  const owned = async (userId) => new Set((await q('select item_id from user_items where user_id = $1', [userId])).rows.map((r) => r.item_id));
  const passActive = (u) => !!u.pass_until && new Date(u.pass_until) > new Date();
  const canUse = (u, set, item) => item.price === 0 && !item.pass ? true : item.pass ? passActive(u) : set.has(item.id);

  const router = express.Router();
  router.get('/', async (req, res) => {
    const u = req.user;
    const set = u ? await owned(u.id) : new Set();
    res.json({
      // the cartoon characters are retired: avatars (lib/avatars) replaced them
      items: ITEMS.filter((i) => i.kind !== 'character').map(({ id, kind, slot, name, tier, price, art, blurb, pass }) => ({ id, kind, slot, name, tier, price, art, blurb, pass: !!pass,
        owned: u ? canUse(u, set, BY_ID[id]) : price === 0 && !pass })),
      equip: u?.equip || {}, passUntil: u && passActive(u) ? u.pass_until : null, balance: u ? Number(u.balance_cents) : null,
    });
  });
  router.post('/buy', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to buy.' });
    const item = BY_ID[String(req.body.item || '')];
    if (!item || item.price <= 0 || item.kind === 'character') return res.status(400).json({ error: 'That item is free or not for sale.' });
    try {
      const out = await withTx(async (c) => {
        const u = (await c.query('select id, balance_cents, test_mode, pass_until, banned from users where id = $1 for update', [req.user.id])).rows[0];
        if (u.banned) throw Object.assign(new Error('Account suspended.'), { code: 403 });
        if (item.kind !== 'pass' && (await c.query('select 1 from user_items where user_id = $1 and item_id = $2', [u.id, item.id])).rows[0])
          throw Object.assign(new Error('You already own this.'), { code: 409 });
        if (Number(u.balance_cents) < item.price) throw Object.assign(new Error('Not enough balance.'), { code: 402, need: item.price - Number(u.balance_cents) });
        await move(c, u.id, -item.price, 'vault', item.id, { name: item.name, test: u.test_mode || undefined });
        if (item.kind === 'pass') {
          await c.query(`update users set pass_until = greatest(coalesce(pass_until, now()), now()) + interval '30 days' where id = $1`, [u.id]);
        } else {
          await c.query('insert into user_items (user_id, item_id, price_cents, is_test) values ($1,$2,$3,$4)', [u.id, item.id, item.price, !!u.test_mode]);
          // buying something equips it straight away
          await c.query(`update users set equip = jsonb_set(coalesce(equip, '{}'), $2, to_jsonb($3::text)) where id = $1`, [u.id, `{${item.slot}}`, item.id]);
        }
        if (!u.test_mode) await c.query(`insert into platform_fees (user_id, kind, ref, amount_cents) values ($1, 'vault', $2, $3)`, [u.id, item.id, item.price]);
        return (await c.query('select balance_cents, equip, pass_until from users where id = $1', [u.id])).rows[0];
      });
      res.json({ ok: true, balance: Number(out.balance_cents), equip: out.equip, passUntil: out.pass_until });
    } catch (e) { res.status(e.code || 500).json({ error: e.message, need: e.need }); }
  });
  router.post('/equip', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
    const slot = String(req.body.slot || '');
    if (!['frame', 'effect'].includes(slot)) return res.status(400).json({ error: 'Unknown slot. Avatars are equipped through /api/avatars/equip.' });
    const id = req.body.item ? String(req.body.item) : null;
    if (id) {
      const item = BY_ID[id];
      if (!item || item.slot !== slot) return res.status(400).json({ error: 'That item does not go there.' });
      const u = (await q('select pass_until from users where id = $1', [req.user.id])).rows[0];
      if (!canUse({ ...u }, await owned(req.user.id), item)) return res.status(403).json({ error: 'You don’t own that yet.' });
    }
    const r = await q(
      id ? `update users set equip = jsonb_set(coalesce(equip, '{}'), $2, to_jsonb($3::text)) where id = $1 returning equip`
         : `update users set equip = coalesce(equip, '{}') - $2 where id = $1 returning equip`,
      id ? [req.user.id, `{${slot}}`, id] : [req.user.id, slot]);
    res.json({ equip: r.rows[0].equip });
  });

  const admin = express.Router();
  admin.get('/', async (_req, res) => {
    const [sales, top] = await Promise.all([
      q(`select coalesce(sum(price_cents), 0)::bigint as all_time,
                coalesce(sum(price_cents) filter (where acquired_at > now() - interval '24 hours'), 0)::bigint as day,
                coalesce(sum(price_cents) filter (where acquired_at > now() - interval '30 days'), 0)::bigint as month,
                count(*)::int as items from user_items where not is_test`),
      q(`select item_id, count(*)::int as sold, sum(price_cents)::bigint as revenue from user_items where not is_test group by item_id order by revenue desc limit 15`),
    ]);
    const pass = (await q(`select coalesce(sum(-delta_cents), 0)::bigint as rev, count(*)::int as n from ledger l join users u on u.id = l.user_id
                           where l.kind = 'vault' and l.ref = 'pass-30' and not u.test_mode`)).rows[0];
    const av = top.rows.filter((r) => r.item_id.startsWith('av:')).map((r) => r.item_id.slice(3));
    const names = av.length ? Object.fromEntries((await q('select id::text, name from avatars where id = any($1::uuid[])', [av])).rows.map((x) => ['av:' + x.id, 'Avatar · ' + x.name])) : {};
    res.json({ sales: { ...sales.rows[0], pass: Number(pass.rev), passes: pass.n },
      top: top.rows.map((r) => ({ ...r, name: BY_ID[r.item_id]?.name || names[r.item_id] || r.item_id, revenue: Number(r.revenue) })) });
  });
  return { router, admin, passActive };
}
