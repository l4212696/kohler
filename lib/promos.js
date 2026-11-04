// Bonuses and referrals.
//
// Bonus money is real balance with a lock on it: it can be played (casino and Survivor) but it
// can't be withdrawn or spent in the shop until the player has wagered it a few times over
// (promo_wager_x). Every bet counts down `wager_left_cents`; when that reaches zero the lock lifts
// and it's ordinary money. If the player loses it, the lock simply shrinks with the balance.
//
// First deposit: the first real deposit is matched (default 100%, i.e. doubled) up to a cap.
// Referrals: every account has a code and a link (/r/CODE). A referral becomes "active" when the
// person they brought makes a real deposit of at least ref_min_deposit_cents. Every ref_every
// active referrals pays the referrer ref_reward_cents of bonus money, again and again.
import crypto from 'node:crypto';
import express from 'express';

export const BET_KINDS = new Set(['casino_bet', 'pool_buyin', 'bet']);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I mix-ups
const newCode = () => Array.from(crypto.randomBytes(7), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

export const DEFAULTS = {
  promo_first_enabled: 'true', promo_first_match_pct: '100', promo_first_cap_cents: '5000', promo_wager_x: '5',
  ref_enabled: 'true', ref_every: '10', ref_reward_cents: '1000', ref_min_deposit_cents: '1000',
};

export function createPromos({ q, withTx, move, audit, log = console }) {
  async function settings(c = { query: q }) {
    const m = Object.fromEntries((await c.query(`select key, value from site_settings where key like 'promo\\_%' or key like 'ref\\_%'`)).rows.map((r) => [r.key, r.value]));
    const v = { ...DEFAULTS, ...m }, n = (k) => Math.max(0, Math.round(Number(v[k]) || 0));
    return {
      firstEnabled: v.promo_first_enabled !== 'false', firstPct: Math.min(500, n('promo_first_match_pct')), firstCap: n('promo_first_cap_cents'),
      wagerX: Math.min(50, n('promo_wager_x')),
      refEnabled: v.ref_enabled !== 'false', refEvery: Math.max(1, n('ref_every')), refReward: n('ref_reward_cents'), refMinDeposit: n('ref_min_deposit_cents'),
    };
  }

  // credit bonus money with its lock (inside the caller's transaction)
  async function grant(c, userId, cents, kind, ref, meta = {}) {
    if (!(cents > 0)) return 0;
    const s = await settings(c);
    await move(c, userId, cents, kind, ref, meta);
    await c.query(`update users set bonus_locked_cents = bonus_locked_cents + $2, wager_left_cents = wager_left_cents + $3 where id = $1`,
      [userId, cents, cents * s.wagerX]);
    // bonuses are a cost: they lower revenue on the admin overview
    await c.query(`insert into platform_fees (user_id, kind, ref, amount_cents) values ($1, 'bonus', $2, $3)`, [userId, ref, -cents]);
    return cents;
  }

  // Called inside the transaction that credits a real (non-test) deposit, after the credit.
  async function onDeposit(c, userId, creditCents, ref) {
    const s = await settings(c), out = { bonus: 0, referral: null };
    const u = (await c.query(`select id, test_mode, referred_by, ref_active_at from users where id = $1 for update`, [userId])).rows[0];
    if (!u || u.test_mode) return out;
    const deposits = Number((await c.query(`select count(*)::int n from ledger where user_id = $1 and kind = 'deposit' and not coalesce((meta->>'test')::boolean, false)`, [userId])).rows[0].n);
    // first deposit: matched once per account
    if (s.firstEnabled && s.firstPct > 0 && deposits === 1 && !(await c.query(`select 1 from ledger where user_id = $1 and kind = 'bonus_first'`, [userId])).rows[0]) {
      out.bonus = await grant(c, userId, Math.min(s.firstCap, Math.floor(creditCents * s.firstPct / 100)), 'bonus_first', ref, { pct: s.firstPct });
    }
    // referral: the referred player becomes "active" once their deposits reach the minimum
    if (s.refEnabled && u.referred_by && !u.ref_active_at) {
      const total = Number((await c.query(`select coalesce(sum(delta_cents), 0)::bigint s from ledger where user_id = $1 and kind = 'deposit' and not coalesce((meta->>'test')::boolean, false)`, [userId])).rows[0].s);
      if (total >= s.refMinDeposit) {
        await c.query('update users set ref_active_at = now() where id = $1', [userId]);
        const referrer = u.referred_by;
        await c.query('select id from users where id = $1 for update', [referrer]);
        const active = Number((await c.query('select count(*)::int n from users where referred_by = $1 and ref_active_at is not null', [referrer])).rows[0].n);
        out.referral = { referrer, active };
        if (active % s.refEvery === 0 && s.refReward > 0) {
          const milestone = active / s.refEvery;
          const fresh = (await c.query(`insert into referral_rewards (user_id, milestone, active_count, amount_cents) values ($1,$2,$3,$4)
                                         on conflict (user_id, milestone) do nothing returning id`, [referrer, milestone, active, s.refReward])).rows[0];
          if (fresh) out.referral.reward = await grant(c, referrer, s.refReward, 'bonus_referral', `ref:${milestone}`, { active });
        }
      }
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
  // at sign-up: link the new account to whoever's code was used
  async function attach(userId, code) {
    const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!c) return null;
    const r = (await q(`select id from users where ref_code = $1 and id <> $2 and not banned`, [c, userId])).rows[0];
    if (!r) return null;
    await q('update users set referred_by = $2 where id = $1 and referred_by is null', [userId, r.id]);
    return r.id;
  }

  const mask = (name) => { const s = String(name || ''); return s.length <= 4 ? s[0] + '•••' : s.slice(0, 3) + '•••' + s.slice(-2); };
  async function summary(user, origin) {
    const s = await settings(), code = await codeFor(user.id);
    const [list, earned] = await Promise.all([
      q(`select username, created_at, ref_active_at from users where referred_by = $1 order by created_at desc limit 100`, [user.id]),
      q(`select coalesce(sum(amount_cents), 0)::bigint s, count(*)::int n from referral_rewards where user_id = $1`, [user.id]),
    ]);
    const active = list.rows.filter((r) => r.ref_active_at).length;
    return {
      enabled: s.refEnabled, code, link: `${origin}/r/${code}`,
      every: s.refEvery, reward: s.refReward, minDeposit: s.refMinDeposit, wagerX: s.wagerX,
      signedUp: list.rows.length, active, toNext: s.refEvery - (active % s.refEvery),
      earned: Number(earned.rows[0].s), rewards: earned.rows[0].n,
      people: list.rows.map((r) => ({ name: mask(r.username), joined: r.created_at, active: !!r.ref_active_at })),
    };
  }
  // what the wallet shows: locked bonus and, before the first deposit, the offer
  async function walletInfo(user) {
    const s = await settings();
    const deposited = !!(await q(`select 1 from ledger where user_id = $1 and kind = 'deposit' and not coalesce((meta->>'test')::boolean, false) limit 1`, [user.id])).rows[0];
    const locked = Math.min(Number(user.bonus_locked_cents || 0), Math.max(0, Number(user.balance_cents)));
    return {
      bonusLocked: locked, wagerLeft: locked ? Number(user.wager_left_cents || 0) : 0,
      withdrawable: Math.max(0, Number(user.balance_cents) - locked),
      firstOffer: !user.test_mode && !deposited && s.firstEnabled && s.firstPct > 0 ? { pct: s.firstPct, cap: s.firstCap, wagerX: s.wagerX } : null,
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
  router.get('/offer', h(async (_req, res) => { const s = await settings(); res.json({ first: s.firstEnabled && s.firstPct > 0 ? { pct: s.firstPct, cap: s.firstCap, wagerX: s.wagerX } : null, referral: s.refEnabled ? { every: s.refEvery, reward: s.refReward, minDeposit: s.refMinDeposit } : null }); }));

  const admin = express.Router();
  admin.get('/', h(async (_req, res) => {
    const [s, stats, top] = await Promise.all([
      settings(),
      q(`select
          (select coalesce(-sum(amount_cents), 0) from platform_fees where kind = 'bonus' and created_at > now() - interval '30 days')::bigint as granted30,
          (select coalesce(sum(least(bonus_locked_cents, greatest(balance_cents, 0))), 0) from users where not test_mode)::bigint as locked_now,
          (select count(*) from users where referred_by is not null)::int as referred,
          (select count(*) from users where ref_active_at is not null)::int as active,
          (select count(*) from referral_rewards)::int as rewards`),
      q(`select u.username, count(r.id)::int as signed, count(r.ref_active_at)::int as active
           from users r join users u on u.id = r.referred_by group by u.username order by 3 desc, 2 desc limit 8`),
    ]);
    const x = stats.rows[0];
    res.json({ settings: s, stats: { granted30: Number(x.granted30), lockedNow: Number(x.locked_now), referred: x.referred, active: x.active, rewards: x.rewards }, top: top.rows });
  }));
  admin.patch('/', h(async (req, res) => {
    const b = req.body || {}, put = (k, v) => q(`insert into site_settings (key, value, updated_at) values ($1,$2,now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, String(v)]);
    const num = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)));
    if (b.firstEnabled !== undefined) await put('promo_first_enabled', !!b.firstEnabled);
    if (b.firstPct !== undefined) await put('promo_first_match_pct', num(b.firstPct, 500));
    if (b.firstCap !== undefined) await put('promo_first_cap_cents', num(b.firstCap, 10_000_000));
    if (b.wagerX !== undefined) await put('promo_wager_x', num(b.wagerX, 50));
    if (b.refEnabled !== undefined) await put('ref_enabled', !!b.refEnabled);
    if (b.refEvery !== undefined) await put('ref_every', Math.max(1, num(b.refEvery, 1000)));
    if (b.refReward !== undefined) await put('ref_reward_cents', num(b.refReward, 10_000_000));
    if (b.refMinDeposit !== undefined) await put('ref_min_deposit_cents', num(b.refMinDeposit, 10_000_000));
    await audit?.(req, 'promos.update', b);
    res.json({ settings: await settings() });
  }));

  return { settings, grant, onDeposit, attach, codeFor, summary, walletInfo, router, admin };
}
