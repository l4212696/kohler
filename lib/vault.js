// The Vault: things people buy or earn that aren't bets. Frames ring your avatar, effects
// play when you win, themes decorate your own screen, filters change how your avatar looks,
// and the Kohler Pass is a 30-day membership. The catalog is lib/vault-items.js.
// Anything you get is yours forever, even after a seasonal item leaves the shop.
import express from 'express';

import { ITEMS, BY_ID, SEASONS, inSeason } from './vault-items.js';
export { ITEMS };
export const itemById = (id) => BY_ID[id];
const SLOTS = ['frame', 'effect', 'theme', 'filter'];

export function createVault({ q, withTx, move, audit, onBuy = async () => [] }) {
  const owned = async (userId) => new Set((await q('select item_id from user_items where user_id = $1', [userId])).rows.map((r) => r.item_id));
  const passActive = (u) => !!u.pass_until && new Date(u.pass_until) > new Date();
  // free items are for everyone; earned and bought ones need to be in user_items; the Pass frame needs the Pass
  const canUse = (u, set, item) => (item.pass ? passActive(u) : item.earn || item.price > 0 ? set.has(item.id) : true);

  const router = express.Router();
  router.get('/', async (req, res) => {
    const u = req.user, now = new Date();
    const set = u ? await owned(u.id) : new Set();
    // out-of-season items disappear from the shop, except for people who already have them
    const items = ITEMS.filter((i) => inSeason(i, now) || set.has(i.id)).map((i) => ({
      id: i.id, kind: i.kind, slot: i.slot, name: i.name, tier: i.tier, price: i.price, art: i.art, blurb: i.blurb, cat: i.cat || null,
      pass: !!i.pass, earn: i.earn || null, season: i.season ? { id: i.season, ...SEASONS[i.season], live: inSeason(i, now) } : null,
      owned: u ? canUse(u, set, i) : i.price === 0 && !i.pass && !i.earn,
    }));
    res.set('cache-control', 'no-store');
    res.json({ items, seasons: Object.entries(SEASONS).map(([id, x]) => ({ id, ...x, live: inSeason({ season: id }, now) })),
      equip: u?.equip || {}, passUntil: u && passActive(u) ? u.pass_until : null, balance: u ? Number(u.balance_cents) : null });
  });
  router.post('/buy', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to buy.' });
    const item = BY_ID[String(req.body.item || '')];
    if (!item || item.price <= 0 || item.earn) return res.status(400).json({ error: item?.earn ? 'That one can only be earned.' : 'That item is free or not for sale.' });
    if (!inSeason(item)) return res.status(400).json({ error: `${item.name} is back next ${SEASONS[item.season].label}.` });
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
          await onBuy(c, u.id);
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
    if (!SLOTS.includes(slot)) return res.status(400).json({ error: 'Unknown slot. Avatars are equipped through /api/avatars/equip.' });
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
