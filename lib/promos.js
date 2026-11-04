// Promos: bonus money for deposits and referrals, set up and switched on/off from Kohler Control.
//
// Bonus money is real balance with a lock on it: it can be played (casino and Survivor) but it
// can't be withdrawn or spent in the shop until the player has wagered it a few times over (each
// promo sets its own "wagerX"). Every bet counts down `wager_left_cents`; when that reaches zero
// the lock lifts and it's ordinary money. If the player loses it, the lock shrinks with the balance.
//
// Kinds of promo (any number of each; every live one applies):
//   deposit_match       a share of a deposit as bonus, once per player (optionally first deposit only)
//   referral            a friend who joined with your link deposits at least X while the promo runs:
//                       they get their reward straight away; you get yours once they've also bet Y
//                       (so a throwaway second account has to put real money at risk first)
//   referral_milestone  every N "active" friends pays the referrer a reward
// A promo is live when it's on, inside its dates, and hasn't spent its budget. Every payment is
// recorded in promo_grants under a unique key, so nothing is ever paid twice.
import crypto from 'node:crypto';
import express from 'express';

export const BET_KINDS = new Set(['casino_bet', 'pool_buyin', 'bet']);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I mix-ups
const newCode = () => Array.from(crypto.randomBytes(7), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

// field types: money (cents), pct, x (wager multiple), int, bool
export const KINDS = {
  deposit_match: {
    label: 'Deposit bonus', blurb: 'Adds a share of a deposit as bonus money, once per player.',
    fields: [['firstOnly', 'bool', 'First deposit only'], ['pct', 'pct', 'Match (%)'], ['cap', 'money', 'Up to ($)'],
      ['minDeposit', 'money', 'Deposit at least ($)'], ['wagerX', 'x', 'Play it this many times before withdrawing']],
    defaults: { firstOnly: true, pct: 100, cap: 5000, minDeposit: 0, wagerX: 5 },
  },
  referral: {
    label: 'Refer a friend', blurb: 'A friend joins with your link and deposits: you both get bonus money.',
    fields: [['minDeposit', 'money', 'Friend deposits at least ($)'], ['referrerReward', 'money', 'Referrer gets ($)'],
      ['friendReward', 'money', 'Your friend gets ($)'], ['friendWager', 'money', 'Referrer is paid once the friend has bet ($)'],
      ['wagerX', 'x', 'Play it this many times before withdrawing'],
      ['maxPerReferrer', 'int', 'Most friends one player can be paid for (0 = no limit)']],
    defaults: { minDeposit: 2000, referrerReward: 1000, friendReward: 500, friendWager: 10000, wagerX: 5, maxPerReferrer: 0 },
  },
  referral_milestone: {
    label: 'Referral milestones', blurb: 'Every N active friends pays the referrer, again and again.',
    fields: [['every', 'int', 'Every this many active friends'], ['reward', 'money', 'Reward ($)'],
      ['wagerX', 'x', 'Play it this many times before withdrawing']],
    defaults: { every: 10, reward: 1000, wagerX: 5 },
  },
};
const LIMIT = { money: [0, 10_000_000], pct: [0, 500], x: [0, 50], int: [0, 100_000] };
function cleanConfig(kind, input = {}, base = KINDS[kind].defaults) {
  const out = { ...KINDS[kind].defaults, ...base };
  for (const [k, type] of KINDS[kind].fields) {
    if (input[k] === undefined) continue;
    if (type === 'bool') { out[k] = !!input[k]; continue; }
    const [lo, hi] = LIMIT[type], n = Math.round(Number(input[k]));
    if (!Number.isFinite(n)) throw Object.assign(new Error(`${k} must be a number`), { code: 400 });
    out[k] = Math.min(hi, Math.max(lo, n));
  }
  if (kind === 'referral_milestone') out.every = Math.max(1, out.every);
  return out;
}

const GENERAL = { ref_min_deposit_cents: '2000', ref_same_network_block: 'false' };

export function createPromos({ q, withTx, move, audit, achievements, log = console }) {
  const ipHash = (ip) => ip ? crypto.createHash('sha256').update('kohler-ip:' + (process.env.KEY_ENC || '') + ':' + ip).digest('hex').slice(0, 32) : null;

  async function general(c = { query: q }) {
    const m = Object.fromEntries((await c.query(`select key, value from site_settings where key = any($1)`, [Object.keys(GENERAL)])).rows.map((r) => [r.key, r.value]));
    const v = { ...GENERAL, ...m };
    return { activeMin: Math.max(0, Math.round(Number(v.ref_min_deposit_cents) || 0)), sameNetworkBlock: v.ref_same_network_block === 'true' };
  }
  const shape = (p) => p && ({
    id: Number(p.id), kind: p.kind, name: p.name, enabled: p.enabled, config: { ...KINDS[p.kind]?.defaults, ...p.config },
    startsAt: p.starts_at, endsAt: p.ends_at, budget: p.budget_cents == null ? null : Number(p.budget_cents),
    spent: Number(p.spent_cents), uses: p.uses, createdAt: p.created_at,
  });
  const isLive = (p, now = new Date()) => p.enabled && new Date(p.startsAt) <= now && (!p.endsAt || new Date(p.endsAt) > now) && (p.budget == null || p.spent < p.budget);
  async function live(c = { query: q }, kind) {
    const r = await c.query(`select * from promos where enabled and starts_at <= now() and (ends_at is null or ends_at > now())
                               and (budget_cents is null or spent_cents < budget_cents) ${kind ? 'and kind = $1' : ''} order by id`, kind ? [kind] : []);
    return r.rows.map(shape);
  }

  // pay bonus money with its lock, once per key (inside the caller's transaction)
  async function grant(c, promo, { userId, cents, kind, ref, key, role, subject = null, meta = {} }) {
    if (!(cents > 0)) return 0;
    const p = shape((await c.query('select * from promos where id = $1 for update', [promo.id])).rows[0]);
    if (!p || !isLive(p)) return 0;
    if (p.budget != null) cents = Math.min(cents, p.budget - p.spent);
    if (!(cents > 0)) return 0;
    const fresh = (await c.query(`insert into promo_grants (promo_id, key, user_id, role, subject_id, amount_cents) values ($1,$2,$3,$4,$5,$6)
                                   on conflict (key) do nothing returning id`, [p.id, key, userId, role, subject, cents])).rows[0];
    if (!fresh) return 0;
    await move(c, userId, cents, kind, ref, { ...meta, promo: p.id, promoName: p.name });
    const wagerX = Math.max(0, Number(p.config.wagerX) || 0);
    await c.query(`update users set bonus_locked_cents = bonus_locked_cents + $2, wager_left_cents = wager_left_cents + $3 where id = $1`,
      [userId, wagerX > 0 ? cents : 0, cents * wagerX]);
    // bonuses are a cost: they lower revenue on the admin overview
    await c.query(`insert into platform_fees (user_id, kind, ref, amount_cents) values ($1, 'bonus', $2, $3)`, [userId, ref, -cents]);
    await c.query('update promos set spent_cents = spent_cents + $2, uses = uses + 1 where id = $1', [p.id, cents]);
    return cents;
  }

  const realDeposits = (c, userId, since) => c.query(
    `select count(*)::int n, coalesce(sum(delta_cents), 0)::bigint s from ledger
      where user_id = $1 and kind = 'deposit' and not coalesce((meta->>'test')::boolean, false) ${since ? 'and created_at >= $2' : ''}`,
    since ? [userId, since] : [userId]).then((r) => ({ n: r.rows[0].n, total: Number(r.rows[0].s) }));

  // money actually put at risk: casino bets (minus any rolled back) and Survivor seats in rounds
  // that have been played out. A seat in a round still waiting can be left and refunded, so it
  // doesn't count until the round settles.
  const realBets = (c, userId, since) => c.query(
    `select (select coalesce(-sum(delta_cents), 0) from ledger where user_id = $1 and created_at >= $2
               and (kind in ('casino_bet', 'bet') and delta_cents < 0 or kind = 'casino_rollback'))
          + (select coalesce(-sum(l.delta_cents), 0) from ledger l join pool_rounds r on r.id::text = l.ref
              where l.user_id = $1 and l.created_at >= $2 and l.kind in ('pool_buyin', 'pool_refund') and r.status = 'settled') as s`,
    [userId, since]).then((r) => Number(r.rows[0].s));

  // the referrer's reward for one friend: deposited enough AND bet enough since the promo started
  async function payReferrer(c, p, friendId, referrerId) {
    const s = p.config, key = `p${p.id}:referrer:${friendId}`;
    if ((await c.query('select 1 from promo_grants where key = $1', [key])).rows[0]) return 0;
    if ((await realDeposits(c, friendId, p.startsAt)).total < s.minDeposit) return 0;
    if (s.friendWager > 0 && (await realBets(c, friendId, p.startsAt)) < s.friendWager) return 0;
    // a referrer at their limit stops earning (the friend still got their welcome)
    if (s.maxPerReferrer > 0 && Number((await c.query(`select count(*)::int n from promo_grants where promo_id = $1 and user_id = $2 and role = 'referrer'`,
      [p.id, referrerId])).rows[0].n) >= s.maxPerReferrer) return 0;
    return grant(c, p, { userId: referrerId, cents: s.referrerReward, kind: 'bonus_referral', ref: `ref:${friendId}`, key, role: 'referrer', subject: friendId });
  }

  // Called by move() after every casino bet from a referred, non-test player, and when a Survivor
  // round they sat in settles. Cheap when there's nothing left to pay: live referral promos are
  // cached for 30s, and one lookup checks for a payment.
  let liveRefCache = { at: 0, list: [] };
  async function onBet(c, userId, row) {
    if (!row?.referred_by || row.test_mode) return 0;
    if (Date.now() - liveRefCache.at > 30_000) liveRefCache = { at: Date.now(), list: await live(c, 'referral') };
    const promos = liveRefCache.list.filter((p) => p.config.referrerReward > 0);
    if (!promos.length) return 0;
    const g = await general(c);
    if (g.sameNetworkBlock && row.ref_flag === 'same_network') return 0;
    const paid = new Set((await c.query('select key from promo_grants where key = any($1)', [promos.map((p) => `p${p.id}:referrer:${userId}`)])).rows.map((r) => r.key));
    let total = 0;
    for (const p of promos) {
      if (paid.has(`p${p.id}:referrer:${userId}`)) continue;
      const ref = (await c.query('select id, banned, test_mode from users where id = $1', [row.referred_by])).rows[0];
      if (!ref || ref.banned || ref.test_mode) return total;
      total += await payReferrer(c, p, userId, ref.id);
    }
    return total;
  }

  // Called inside the transaction that credits a real (non-test) deposit, after the credit.
  async function onDeposit(c, userId, creditCents, ref) {
    const out = { bonus: 0, referral: null };
    const u = (await c.query(`select id, test_mode, banned, referred_by, ref_active_at, ref_flag from users where id = $1 for update`, [userId])).rows[0];
    if (!u || u.test_mode) return out;
    const promos = await live(c), all = await realDeposits(c, userId);

    for (const p of promos.filter((x) => x.kind === 'deposit_match')) {
      const s = p.config;
      if (s.firstOnly && all.n !== 1) continue;
      if (creditCents < s.minDeposit || !(s.pct > 0)) continue;
      out.bonus += await grant(c, p, { userId, cents: Math.min(s.cap, Math.floor(creditCents * s.pct / 100)), kind: s.firstOnly ? 'bonus_first' : 'bonus_deposit',
        ref, key: `p${p.id}:player:${userId}`, role: 'player', meta: { pct: s.pct } });
    }

    if (!u.referred_by) return out;
    const referrer = (await c.query('select id, banned, test_mode from users where id = $1 for update', [u.referred_by])).rows[0];
    if (!referrer || referrer.banned || referrer.test_mode) return out;
    const g = await general(c), held = g.sameNetworkBlock && u.ref_flag === 'same_network';
    out.referral = { referrer: referrer.id, held };

    // a friend becomes "active" once their deposits reach the minimum (badges and milestones count these)
    let becameActive = false;
    if (!u.ref_active_at && all.total >= g.activeMin) {
      await c.query('update users set ref_active_at = now() where id = $1', [userId]);
      becameActive = true;
    }
    const active = Number((await c.query(`select count(*)::int n from users where referred_by = $1 and ref_active_at is not null and ref_flag is distinct from 'same_network'`, [referrer.id])).rows[0].n);
    out.referral.active = active;
    if (becameActive) await achievements?.referrals(c, referrer.id, active);
    if (held) return out;

    for (const p of promos.filter((x) => x.kind === 'referral')) {
      const s = p.config;
      if ((await realDeposits(c, userId, p.startsAt)).total < s.minDeposit) continue;
      out.referral.friendBonus = (out.referral.friendBonus || 0) + await grant(c, p, { userId, cents: s.friendReward, kind: 'bonus_ref_friend',
        ref: `ref:${referrer.id}`, key: `p${p.id}:friend:${userId}`, role: 'friend', subject: userId });
      out.referral.reward = (out.referral.reward || 0) + await payReferrer(c, p, userId, referrer.id);
    }
    if (becameActive) for (const p of promos.filter((x) => x.kind === 'referral_milestone')) {
      const s = p.config;
      if (!(s.every > 0) || active % s.every !== 0) continue;
      out.referral.reward = (out.referral.reward || 0) + await grant(c, p, { userId: referrer.id, cents: s.reward, kind: 'bonus_referral',
        ref: `ref:m${active / s.every}`, key: `p${p.id}:milestone:${referrer.id}:${active / s.every}`, role: 'referrer', meta: { active } });
    }
    return out;
  }

  async function codeFor(userId) {
    const have = (await q('select ref_code from users where id = $1', [userId])).rows[0]?.ref_code;
    if (have) return have;
    for (let i = 0; i < 6; i++) {
      const code = newCode();
      const r = await q(`update users set ref_code = $2 where id = $1 and ref_code is null and not exists (select 1 from users where ref_code = $2) returning ref_code`, [userId, code]).catch(() => ({ rows: [] }));
      if (r.rows[0]) return r.rows[0].ref_code;
      const again = (await q('select ref_code from users where id = $1', [userId])).rows[0]?.ref_code;
      if (again) return again;
    }
    throw new Error('Could not make a referral code. Try again.');
  }
  // at sign-up: remember a hash of the network (never the address itself) and link the new
  // account to whoever's code was used. Same network as the referrer = probably the same person.
  async function attach(userId, code, ip) {
    const h = ipHash(ip);
    if (h) await q('update users set signup_ip_hash = $2 where id = $1 and signup_ip_hash is null', [userId, h]);
    const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!c) return null;
    const r = (await q(`select id, signup_ip_hash from users where ref_code = $1 and id <> $2 and not banned`, [c, userId])).rows[0];
    if (!r) return null;
    const same = h && r.signup_ip_hash === h;
    await q('update users set referred_by = $2, ref_flag = $3 where id = $1 and referred_by is null', [userId, r.id, same ? 'same_network' : null]);
    return r.id;
  }

  // what players see about a promo (no budgets or counts)
  const publicPromo = (p) => ({ id: p.id, kind: p.kind, name: p.name, endsAt: p.endsAt, ...p.config });

  const mask = (name) => { const s = String(name || ''); return s.length <= 4 ? s[0] + '•••' : s.slice(0, 3) + '•••' + s.slice(-2); };
  async function summary(user, origin) {
    const [promos, code, g] = await Promise.all([live(), codeFor(user.id), general()]);
    const pair = promos.find((p) => p.kind === 'referral'), mile = promos.find((p) => p.kind === 'referral_milestone');
    const [list, earned, paid] = await Promise.all([
      q(`select id, username, created_at, ref_active_at, ref_flag from users where referred_by = $1 order by created_at desc limit 100`, [user.id]),
      q(`select coalesce(sum(delta_cents), 0)::bigint s from ledger where user_id = $1 and kind = 'bonus_referral'`, [user.id]),
      q(`select distinct subject_id from promo_grants where user_id = $1 and role = 'referrer' and subject_id is not null`, [user.id]),
    ]);
    const paidFor = new Set(paid.rows.map((r) => r.subject_id));
    const active = list.rows.filter((r) => r.ref_active_at && r.ref_flag !== 'same_network').length;
    return {
      enabled: !!(pair || mile), code, link: `${origin}/r/${code}`, activeMin: g.activeMin,
      pair: pair ? publicPromo(pair) : null,
      milestone: mile ? { ...publicPromo(mile), toNext: mile.config.every - (active % mile.config.every) } : null,
      signedUp: list.rows.length, active, earned: Number(earned.rows[0].s),
      people: list.rows.map((r) => ({ name: mask(r.username), joined: r.created_at,
        status: paidFor.has(r.id) ? 'paid' : r.ref_flag === 'same_network' && g.sameNetworkBlock ? 'held' : r.ref_active_at ? (pair?.config.friendWager ? 'playing' : 'active') : 'joined' })),
    };
  }
  // what the wallet shows: locked bonus, and offers this player can still get
  async function walletInfo(user) {
    const [promos, all] = await Promise.all([live(), realDeposits({ query: q }, user.id)]);
    const locked = Math.min(Number(user.bonus_locked_cents || 0), Math.max(0, Number(user.balance_cents)));
    const first = !user.test_mode && all.n === 0 && promos.find((p) => p.kind === 'deposit_match' && p.config.firstOnly && p.config.pct > 0);
    let friendOffer = null;
    if (!user.test_mode && user.referred_by) {
      const pair = promos.find((p) => p.kind === 'referral' && p.config.friendReward > 0);
      if (pair && !(await q('select 1 from promo_grants where key = $1', [`p${pair.id}:friend:${user.id}`])).rows[0])
        friendOffer = { reward: pair.config.friendReward, minDeposit: pair.config.minDeposit, wagerX: pair.config.wagerX };
    }
    return {
      bonusLocked: locked, wagerLeft: locked ? Number(user.wager_left_cents || 0) : 0,
      withdrawable: Math.max(0, Number(user.balance_cents) - locked),
      firstOffer: first ? { pct: first.config.pct, cap: first.config.cap, wagerX: first.config.wagerX, minDeposit: first.config.minDeposit } : null,
      friendOffer,
    };
  }

  /* routes */
  const router = express.Router();
  const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { log.error('[promos]', e.message); res.status(e.code || 500).json({ error: e.code ? e.message : 'Something went wrong.' }); });
  router.get('/referrals', h(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
    const origin = process.env.PUBLIC_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
    res.set('cache-control', 'no-store').json(await summary(req.user, origin));
  }));
  router.get('/offer', h(async (_req, res) => {
    const [promos, g] = await Promise.all([live(), general()]);
    const first = promos.find((p) => p.kind === 'deposit_match' && p.config.firstOnly && p.config.pct > 0);
    const pair = promos.find((p) => p.kind === 'referral'), mile = promos.find((p) => p.kind === 'referral_milestone');
    res.json({ promos: promos.map(publicPromo), activeMin: g.activeMin,
      first: first ? { pct: first.config.pct, cap: first.config.cap, wagerX: first.config.wagerX } : null,
      referral: pair ? { minDeposit: pair.config.minDeposit, referrerReward: pair.config.referrerReward, friendReward: pair.config.friendReward, friendWager: pair.config.friendWager, wagerX: pair.config.wagerX } : null,
      milestone: mile ? { every: mile.config.every, reward: mile.config.reward } : null });
  }));

  const admin = express.Router();
  const one = async (id) => shape((await q('select * from promos where id = $1', [id])).rows[0]);
  const when = (v) => { if (v === null || v === '') return null; const d = new Date(v); if (isNaN(d)) throw Object.assign(new Error('That date isn\'t valid.'), { code: 400 }); return d; };
  admin.get('/', h(async (_req, res) => {
    const [list, g, stats, top] = await Promise.all([
      q('select * from promos order by enabled desc, id'),
      general(),
      q(`select
          (select coalesce(-sum(amount_cents), 0) from platform_fees where kind = 'bonus' and created_at > now() - interval '30 days')::bigint as granted30,
          (select coalesce(sum(least(bonus_locked_cents, greatest(balance_cents, 0))), 0) from users where not test_mode)::bigint as locked_now,
          (select count(*) from users where referred_by is not null)::int as referred,
          (select count(*) from users where ref_active_at is not null)::int as active,
          (select count(*) from users where ref_flag = 'same_network')::int as held`),
      q(`select u.username, count(r.id)::int as signed, count(r.ref_active_at)::int as active, count(*) filter (where r.ref_flag = 'same_network')::int as held
           from users r join users u on u.id = r.referred_by group by u.username order by 3 desc, 2 desc limit 8`),
    ]);
    const held = (await q(`select r.username as friend, u.username as referrer, r.created_at, r.ref_active_at is not null as deposited
                             from users r join users u on u.id = r.referred_by where r.ref_flag = 'same_network' order by r.created_at desc limit 30`)).rows;
    const x = stats.rows[0], now = new Date();
    res.json({
      kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { label: v.label, blurb: v.blurb, fields: v.fields, defaults: v.defaults }])),
      promos: list.rows.map(shape).map((p) => ({ ...p, live: isLive(p, now) })),
      general: g,
      stats: { granted30: Number(x.granted30), lockedNow: Number(x.locked_now), referred: x.referred, active: x.active, held: x.held },
      top: top.rows, held,
    });
  }));
  admin.post('/', h(async (req, res) => {
    const b = req.body || {};
    if (!KINDS[b.kind]) return res.status(400).json({ error: 'Pick a kind of promo.' });
    const name = String(b.name || KINDS[b.kind].label).trim().slice(0, 60) || KINDS[b.kind].label;
    const budget = b.budget == null || b.budget === '' ? null : Math.max(0, Math.round(Number(b.budget) || 0));
    const r = await q(`insert into promos (kind, name, enabled, config, starts_at, ends_at, budget_cents) values ($1,$2,$3,$4,coalesce($5, now()),$6,$7) returning *`,
      [b.kind, name, b.enabled !== false, cleanConfig(b.kind, b.config), when(b.startsAt ?? null), when(b.endsAt ?? null), budget]);
    liveRefCache.at = 0;
    await audit?.(req, 'promos.create', { id: r.rows[0].id, kind: b.kind, name });
    res.json({ promo: shape(r.rows[0]) });
  }));
  admin.patch('/:id(\\d+)', h(async (req, res) => {
    const p = await one(req.params.id);
    if (!p) return res.status(404).json({ error: 'No such promo.' });
    const b = req.body || {}, sets = [], vals = [p.id];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (b.name !== undefined) set('name', String(b.name).trim().slice(0, 60) || p.name);
    if (b.enabled !== undefined) set('enabled', !!b.enabled);
    if (b.config !== undefined) set('config', cleanConfig(p.kind, b.config, p.config));
    if (b.startsAt !== undefined) set('starts_at', when(b.startsAt) || new Date());
    if (b.endsAt !== undefined) set('ends_at', when(b.endsAt));
    if (b.budget !== undefined) set('budget_cents', b.budget == null || b.budget === '' ? null : Math.max(0, Math.round(Number(b.budget) || 0)));
    if (!sets.length) return res.json({ promo: p });
    const r = await q(`update promos set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`, vals);
    liveRefCache.at = 0;
    await audit?.(req, 'promos.update', { id: p.id, ...b });
    res.json({ promo: shape(r.rows[0]) });
  }));
  admin.delete('/:id(\\d+)', h(async (req, res) => {
    const p = await one(req.params.id);
    if (!p) return res.status(404).json({ error: 'No such promo.' });
    if (p.uses > 0) return res.status(400).json({ error: 'This promo has paid out, so it stays for the records. Switch it off instead.' });
    await q('delete from promos where id = $1', [p.id]);
    liveRefCache.at = 0;
    await audit?.(req, 'promos.delete', { id: p.id, name: p.name });
    res.json({ ok: true });
  }));
  // settings shared by every referral promo
  admin.patch('/', h(async (req, res) => {
    const b = req.body || {}, put = (k, v) => q(`insert into site_settings (key, value, updated_at) values ($1,$2,now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, String(v)]);
    if (b.activeMin !== undefined) await put('ref_min_deposit_cents', Math.min(10_000_000, Math.max(0, Math.round(Number(b.activeMin) || 0))));
    if (b.sameNetworkBlock !== undefined) await put('ref_same_network_block', !!b.sameNetworkBlock);
    await audit?.(req, 'promos.general', b);
    res.json({ general: await general() });
  }));
  // let a held (same-network) referral through, e.g. two real friends on the same wifi
  admin.post('/release/:username', h(async (req, res) => {
    const r = await q(`update users set ref_flag = 'released' where lower(username::text) = lower($1) and ref_flag = 'same_network' returning id`, [req.params.username]);
    if (!r.rows[0]) return res.status(404).json({ error: 'No held referral for that player.' });
    // pay now if they've already deposited enough (a zero-cent "deposit" triggers no deposit bonus)
    const out = await withTx((c) => onDeposit(c, r.rows[0].id, 0, 'release'));
    await audit?.(req, 'promos.release', { username: req.params.username, paid: out.referral?.reward || 0 });
    res.json({ ok: true, paid: out.referral?.reward || 0 });
  }));

  return { general, live, grant, onDeposit, onBet, attach, codeFor, summary, walletInfo, router, admin };
}
