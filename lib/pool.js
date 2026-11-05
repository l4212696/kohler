// Pool Pot — equal-stake social pools with one provably-fair winner.
//
//   pot     = sum of every seat's stake (HOUSE seat included when it sits)
//   fee     = floor(pot * fee_bps / 10000)          -> platform_fees (kind 'pool_fee')
//   payout  = pot - fee                              -> winner (user ledger, or pool_house_ledger for HOUSE)
//
// Fairness is commit-reveal. When a round opens we store server_seed and publish
// sha256(server_seed). Every seat contributes a client seed as it joins. At the
// draw:
//   client_seed = sha256(seat seeds in seat order joined by "|")
//   hash        = sha256(server_seed + ":" + client_seed + ":" + round_id)
//   winner      = parseInt(hash[0..13], 16) % seat_count
// The server can't pick a seed after seeing the players' seeds (it committed
// first), and players can't steer the result (they never see server_seed until
// it's over). Every seat has exactly 1/N, the HOUSE seat included.
//
// This module deliberately does not touch lib/house.js. Pool odds never depend
// on any wallet balance.
//
// Locking order everywhere: pool_rounds row -> users rows. Keep it that way.

import crypto from 'node:crypto';
import express from 'express';
import { EventEmitter } from 'node:events';
import { BY_ID as VAULT, ITEMS as VAULT_ITEMS } from './vault-items.js';

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const combineClientSeeds = (seeds) => sha256(seeds.join('|'));
export function drawIndex(serverSeed, clientSeed, roundId, seatCount) {
  const hash = sha256(`${serverSeed}:${clientSeed}:${roundId}`);
  return { hash, index: parseInt(hash.slice(0, 13), 16) % seatCount };
}
// Survivor: pick L distinct losers. Each pick hashes (server : client : round : i)
// and takes that value mod the seats still standing.
export function drawLosers(serverSeed, clientSeed, roundId, n, L) {
  const left = Array.from({ length: n }, (_, i) => i), losers = [], hashes = [];
  for (let i = 0; i < L; i++) {
    const h = sha256(`${serverSeed}:${clientSeed}:${roundId}:${i}`);
    hashes.push(h);
    losers.push(left.splice(parseInt(h.slice(0, 13), 16) % left.length, 1)[0]);
  }
  return { losers, hashes };
}
// stakes of the losers are forfeited; 10% (fee_bps) of the forfeit is the fee;
// survivors get their stake back plus an equal share of the rest. Dust goes to the fee.
export function survivorSplit(stakeCents, n, L, feeBps) {
  const forfeit = stakeCents * L, survivors = n - L;
  const fee0 = Math.floor((forfeit * feeBps) / 10000);
  const share = Math.floor((forfeit - fee0) / survivors);
  const fee = forfeit - share * survivors;
  return { forfeit, fee, share, survivors };
}
export const MODES = {
  duel: { label: 'Duel', n: 2, losers: 1 }, classic: { label: 'Classic', n: 3, losers: 1 },
  squad: { label: 'Squad', n: 5, losers: 1 }, blitz: { label: 'Blitz', n: 10, losers: 2 },
};
const losersFor = (n) => (n >= 10 ? 2 : 1);

export function splitPot(potCents, feeBps) {
  const fee = Math.floor((potCents * feeBps) / 10000);
  return { fee, payout: potCents - fee };
}

export const STAKES = [100, 250, 500, 1000, 2500, 5000, 10000];

// Session names for crew tables when the captain doesn't pick one. Two words,
// reads well in a chat preview: "Velvet Heist", "Midnight Jackpot".
const NAME_A = ['Neon', 'Velvet', 'Midnight', 'Golden', 'Electric', 'Lucky', 'Turbo', 'Cosmic', 'Savage', 'Royal',
  'Fever', 'Thunder', 'Diamond', 'Rocket', 'Wild', 'Shadow', 'Blaze', 'Crimson', 'Frost', 'Hyper'];
const NAME_B = ['Heist', 'Jackpot', 'Showdown', 'Rush', 'Vault', 'Table', 'Circle', 'Drop', 'Riot', 'Crown',
  'Stakeout', 'Pot', 'Lounge', 'Arena', 'Gambit', 'Syndicate', 'Run', 'Den', 'Hustle', 'Summit'];
export const sessionName = () =>
  `${NAME_A[crypto.randomInt(NAME_A.length)]} ${NAME_B[crypto.randomInt(NAME_B.length)]}`;
const LOCK_MS = 3000;                 // seats can't be left in the final 3s
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LIVE = "('open','countdown')";

const N = (v) => (v == null ? null : Number(v));
const fail = (code, message, extra = {}) => { throw Object.assign(new Error(message), { code, ...extra }); };
const rnd = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');
const cleanSeed = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : rnd(12));
const newCode = () => Array.from(crypto.randomBytes(5), (b) => CODE_ABC[b % CODE_ABC.length]).join('');
const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function createPoolPot({ q, withTx, move, audit, gamblingEnabled, limit = () => true, onPlay = async () => [], log = console }) {
  const bus = new EventEmitter();
  bus.setMaxListeners(0);

  /* ── settings ─────────────────────────────────────────────────────────── */

  async function settings(c) {
    const run = c ? (t, p) => c.query(t, p) : q;
    const r = await run("select key, value from site_settings where key like 'pool\\_%' or key like 'survivor\\_%'");
    const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
    return {
      enabled: m.pool_enabled === 'true',
      paused: m.pool_paused === 'true',
      feeBps: clampInt(m.pool_fee_bps, 0, 5000, 1000),
      houseSeats: m.pool_house_seats !== 'false',
      maxStakeCents: clampInt(m.pool_max_stake_cents, 100, 10_000_000, 10000),
      crewTables: m.pool_crew_tables !== 'false',
      houseFill: m.survivor_house_fill !== 'false',
      houseAfterSecs: clampInt(m.survivor_house_after_secs, 5, 3600, 30),
      houseMax: clampInt(m.survivor_house_max, 0, 5, 2),
      houseMinTable: clampInt(m.survivor_house_min_table, 3, 12, 5),
    };
  }

  /* ── test mode ────────────────────────────────────────────────────────── */

  const isTestUser = async (c, userId) =>
    !!userId && !!(await c.query('select test_mode from users where id = $1', [userId])).rows[0]?.test_mode;

  // Test accounts never sit at a real table. Each gets a private copy per table
  // (is_sandbox) where simulated players fill the other seats. Real players can't
  // open or join a sandbox, and sandbox money never reaches fees or the books.
  // Returns { table: where seats go, shown: what the player sees it as }.
  async function resolveTable(c, code, userId, { create = true } = {}) {
    const t = (await c.query('select * from pool_tables where code = $1', [code])).rows[0];
    if (!t) return null;
    const test = await isTestUser(c, userId);
    if (t.is_sandbox) return test && t.created_by === userId ? { table: t, shown: t } : null;
    if (!test) return { table: t, shown: t };
    const find = async () => (await c.query(
      'select * from pool_tables where is_sandbox and sandbox_of = $1 and created_by = $2', [t.id, userId])).rows[0];
    let sb = await find();
    if (!sb && create) {
      await c.query(
        `insert into pool_tables (code, name, stake_cents, max_seats, min_players, countdown_secs, mode, losers, house_seat, house_fill,
                                  is_private, is_sandbox, sandbox_of, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,true,true,$10,$11) on conflict do nothing`,
        ['S' + newCode(), t.name, t.stake_cents, t.max_seats, t.min_players, t.countdown_secs, t.mode, t.losers, t.house_seat, t.id, userId]);
      sb = await find();
    }
    if (sb && (sb.stake_cents !== t.stake_cents || sb.max_seats !== t.max_seats || sb.house_seat !== t.house_seat))
      await c.query('update pool_tables set stake_cents = $2, max_seats = $3, house_seat = $4, countdown_secs = $5, min_players = $6, losers = $7, mode = $8 where id = $1',
        [sb.id, t.stake_cents, t.max_seats, t.house_seat, t.countdown_secs, t.min_players, t.losers, t.mode]);
    return sb ? { table: { ...sb, active: sb.active && t.active }, shown: t } : null;
  }

  // simulated players at a test account's tables wear a frame some of the time, like real players
  const BOT_FRAMES = VAULT_ITEMS.filter((i) => i.slot === 'frame' && i.price > 0 && !i.season && !i.earn).map((i) => i.id);
  const botFrame = (name) => { let h = 2166136261; for (const ch of String(name)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } h >>>= 0;
    return h % 10 < 4 ? BOT_FRAMES[h % BOT_FRAMES.length] : null; };
  const BOT_NAMES = ['nova_k', 'dex', 'mira', 'tomasz', 'jinx', 'olu', 'rafa22', 'kenji', 'sasha.v', 'bram', 'ines',
    'koda', 'yaw', 'lena_m', 'pix', 'oscar', 'zuri', 'marlo', 'taye', 'vik', 'ama_b', 'joon'];

  async function addBot(c, r, seats) {
    const used = new Set(seats.map((x) => x.bot_name).filter(Boolean));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    const idx = seats.length ? Math.max(...seats.map((x) => x.seat_index)) + 1 : 0;
    await c.query('insert into pool_seats (round_id, seat_index, bot_name, client_seed, stake_cents) values ($1,$2,$3,$4,$5)',
      [r.id, idx, free[crypto.randomInt(free.length)], rnd(12), N(r.stake_cents)]);
    await c.query('update pool_rounds set pot_cents = pot_cents + $2 where id = $1', [r.id, N(r.stake_cents)]);
  }

  // Simulated players drift in every 1-5s while the test player is seated.
  const sims = new Map();
  function startSim(roundId) {
    if (sims.has(roundId) || !started) return;
    const step = async () => {
      sims.delete(roundId);
      let code = null, settled = null, keep = false, clock = 0;
      try {
        await withTx(async (c) => {
          const r = (await c.query(
            `select r.*, t.code from pool_rounds r join pool_tables t on t.id = r.table_id
              where r.id = $1 and t.is_sandbox and r.status in ${LIVE} for update`, [roundId])).rows[0];
          if (!r) return;
          const seats = (await c.query('select * from pool_seats where round_id = $1 order by seat_index', [roundId])).rows;
          if (!seats.some((x) => x.user_id) || seats.length >= r.max_seats) return;
          if (r.status === 'countdown' && new Date(r.countdown_ends_at).getTime() - Date.now() < 2000) return;
          keep = true;
          if (Math.random() > 0.72) return;
          code = r.code;
          await addBot(c, r, seats);
          const players = seats.filter((x) => !x.is_house).length + 1;
          if (r.status === 'open' && players >= r.min_players) {
            await c.query(`update pool_rounds set status = 'countdown', countdown_ends_at = now() + make_interval(secs => $2) where id = $1`,
              [r.id, r.countdown_secs]);
            clock = r.countdown_secs * 1000 + 60;
          }
          if (seats.length + 1 >= r.max_seats) { settled = await settle(c, roundId); keep = false; }
        });
      } catch (e) { log.error('[pool] sim', e.message); }
      if (code) emitChange(code, true);
      if (settled) emitSettled(settled);
      if (clock) scheduleTick(clock);
      if (keep) schedule();
    };
    const schedule = () => { const h = setTimeout(step, 1000 + Math.random() * 4000); h.unref?.(); sims.set(roundId, h); };
    schedule();
  }

  // Serverless hosts pause between requests, so the timers above may never fire. Each time the
  // test player's table is read, bring it up to date: the simulated players who'd have arrived
  // by now (about one every 2.5s since the last arrival), the clock, and the draw when it's due.
  async function simCatchUp(c, r, seats) {
    if (r.status === 'countdown' && new Date(r.countdown_ends_at).getTime() <= Date.now()) return settle(c, r.id);
    const last = Math.max(...seats.map((x) => new Date(x.joined_at).getTime()));
    let due = Math.min(r.max_seats - seats.length, Math.floor((Date.now() - last) / 2500));
    if (r.status === 'countdown' && new Date(r.countdown_ends_at).getTime() - Date.now() < 2000) due = 0;
    if (due <= 0) return null;
    for (let i = 0; i < due; i++) await addBot(c, r, (await c.query('select * from pool_seats where round_id = $1', [r.id])).rows);
    const now = (await c.query('select * from pool_seats where round_id = $1', [r.id])).rows;
    if (now.length >= r.max_seats) return settle(c, r.id);
    if (r.status === 'open' && now.filter((x) => !x.is_house).length >= r.min_players) {
      await c.query(`update pool_rounds set status = 'countdown', countdown_ends_at = now() + make_interval(secs => $2) where id = $1`, [r.id, r.countdown_secs]);
      scheduleTick(r.countdown_secs * 1000 + 60);
    }
    return null;
  }

  /* ── round lifecycle ──────────────────────────────────────────────────── */

  async function openRound(c, table, s) {
    const seed = rnd(32);
    const seq = (await c.query('select coalesce(max(seq), 0) + 1 as n from pool_rounds where table_id = $1', [table.id])).rows[0].n;
    const withHouse = !!(table.house_seat && s.houseSeats);
    const ins = await c.query(
      `insert into pool_rounds (table_id, seq, stake_cents, max_seats, min_players, countdown_secs,
                                fee_bps, house_seat, server_seed, server_seed_hash, losers_n)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict do nothing returning *`,
      [table.id, N(seq), N(table.stake_cents), table.max_seats, table.min_players, table.countdown_secs,
       s.feeBps, withHouse, seed, sha256(seed), Math.min(table.losers || losersFor(table.max_seats), table.max_seats - 1)]
    );
    const round = ins.rows[0];
    if (!round) return null; // someone else opened it first
    if (withHouse) {
      const stake = N(table.stake_cents);
      await c.query(
        `insert into pool_seats (round_id, seat_index, is_house, client_seed, stake_cents, label) values ($1, 0, true, $2, $3, 'Kohler')`,
        [round.id, rnd(12), stake]
      );
      if (!table.is_sandbox)
        await c.query(`insert into pool_house_ledger (round_id, delta_cents, kind) values ($1, $2, 'buyin')`, [round.id, -stake]);
      await c.query('update pool_rounds set pot_cents = $2 where id = $1', [round.id, stake]);
    }
    return round;
  }

  async function liveRoundForUpdate(c, table, s) {
    const sel = () => c.query(`select * from pool_rounds where table_id = $1 and status in ${LIVE} for update`, [table.id]);
    let r = (await sel()).rows[0];
    if (!r) { await openRound(c, table, s); r = (await sel()).rows[0]; }
    return r;
  }

  // Runs inside the caller's transaction. Returns a summary, or null if the
  // round isn't drawable (already settled, or fewer than two seats).
  async function settle(c, roundId) {
    const r = (await c.query('select * from pool_rounds where id = $1 for update', [roundId])).rows[0];
    if (!r || !['open', 'countdown'].includes(r.status)) return null;
    const seats = (await c.query(
      `select s.*, u.username from pool_seats s left join users u on u.id = s.user_id
        where s.round_id = $1 order by s.seat_index`, [roundId])).rows;
    if (seats.length < 2) return null;
    const table = (await c.query('select * from pool_tables where id = $1', [r.table_id])).rows[0];
    const sandbox = table.is_sandbox;
    const n = seats.length, L = Math.max(1, Math.min(r.losers_n || 1, n - 1));
    const stake = N(r.stake_cents);
    const clientSeed = combineClientSeeds(seats.map((x) => x.client_seed));
    const { losers, hashes } = drawLosers(r.server_seed, clientSeed, r.id, n, L);
    const { fee, share } = survivorSplit(stake, n, L, r.fee_bps);
    const pot = stake * n;
    const nameOf = (x) => (x.is_house ? (x.label || 'Kohler') : (x.bot_name || x.username));

    for (let i = 0; i < n; i++) {
      if (losers.includes(i)) continue;
      const x = seats[i], back = N(x.stake_cents) + share;
      if (x.is_house) { if (!sandbox) await c.query(`insert into pool_house_ledger (round_id, delta_cents, kind) values ($1, $2, 'payout')`, [r.id, back]); }
      else if (x.user_id) await move(c, x.user_id, back, 'pool_payout', r.id, { table: table.code, seq: r.seq, share, survived: true, test: sandbox || undefined });
      // simulated players (test sandbox) have nothing to pay
    }
    if (fee > 0 && !sandbox) await c.query(`insert into platform_fees (user_id, kind, ref, amount_cents) values (null, 'pool_fee', $1, $2)`, [r.id, fee]);
    await c.query(
      `update pool_rounds set status = 'settled', client_seed = $2, draw_hash = $3, winner_index = $4, winner_seat_id = $5,
              loser_indexes = $6, pot_cents = $7, fee_cents = $8, payout_cents = $9, share_cents = $9, settled_at = now(),
              loser_names = $10, loser_seat_ids = $11
        where id = $1`,
      [r.id, clientSeed, hashes[0], losers[0], seats[losers[0]].id, losers, pot, fee, share,
       losers.map((i) => nameOf(seats[i])), losers.map((i) => seats[i].id)]);
    const humanIds = seats.filter((x) => x.user_id).map((x) => x.user_id);
    // a settled round is a real bet: it counts for the daily streak and earns XP on the stake
    for (const id of humanIds) await onPlay(c, id, stake);
    if (table.active) await openRound(c, table, await settings(c));
    return {
      roundId: r.id, code: table.code, tableName: table.name, isPrivate: table.is_private, isSandbox: sandbox,
      pot, fee, share, stake, seats: n, losers,
      loserNames: losers.map((i) => nameOf(seats[i])),
      survivorNames: seats.filter((_, i) => !losers.includes(i)).map(nameOf),
      // kept for older listeners
      payout: share, winner: { name: nameOf(seats.find((_, i) => !losers.includes(i))), isHouse: false },
    };
  }

  // Kohler seats: on tables of houseMinTable+ seats that stall, the house buys up
  // to houseMax labelled seats so the round can start. Same stake, same odds, shown as "Kohler".
  const fillTimers = new Map();
  function scheduleFill(roundId, ms) {
    if (!started) return;
    clearTimeout(fillTimers.get(roundId));
    const h = setTimeout(() => { fillTimers.delete(roundId); houseFill(roundId).catch((e) => log.error('[survivor] fill', e.message)); }, ms);
    h.unref?.(); fillTimers.set(roundId, h);
  }
  async function houseFill(roundId) {
    const s = await settings();
    if (!s.houseFill || s.paused) return null;
    let settled = null, code = null, priv = false;
    await withTx(async (c) => {
      const r = (await c.query(
        `select r.*, t.code, t.is_private, t.is_sandbox, t.house_fill, t.active from pool_rounds r join pool_tables t on t.id = r.table_id
          where r.id = $1 and r.status in ${LIVE} for update`, [roundId])).rows[0];
      if (!r || !r.house_fill || r.is_sandbox || !r.active || r.max_seats < s.houseMinTable) return;
      if (r.last_join_at && Date.now() - new Date(r.last_join_at).getTime() < s.houseAfterSecs * 1000 - 50) return;
      const seats = (await c.query('select * from pool_seats where round_id = $1 order by seat_index', [r.id])).rows;
      const houseIn = seats.filter((x) => x.is_house).length, humans = seats.filter((x) => x.user_id).length;
      const missing = r.max_seats - seats.length, room = s.houseMax - houseIn;
      // only top up a table that's nearly there, and never sit the house alone with nobody
      if (!humans || missing <= 0 || missing > room) return;
      let idx = seats.length ? Math.max(...seats.map((x) => x.seat_index)) + 1 : 0;
      for (let k = 0; k < missing; k++) {
        await c.query(`insert into pool_seats (round_id, seat_index, is_house, client_seed, stake_cents, label) values ($1,$2,true,$3,$4,'Kohler')`,
          [r.id, idx++, rnd(12), N(r.stake_cents)]);
        await c.query(`insert into pool_house_ledger (round_id, delta_cents, kind) values ($1, $2, 'buyin')`, [r.id, -N(r.stake_cents)]);
        await c.query('update pool_rounds set pot_cents = pot_cents + $2 where id = $1', [r.id, N(r.stake_cents)]);
      }
      code = r.code; priv = r.is_private;
      settled = await settle(c, r.id);
    });
    if (code) emitChange(code, priv);
    emitSettled(settled);
    return settled;
  }

  async function cancelRound(c, roundId, reopen = true) {
    const r = (await c.query(`select * from pool_rounds where id = $1 and status in ${LIVE} for update`, [roundId])).rows[0];
    if (!r) return null;
    const seats = (await c.query('select * from pool_seats where round_id = $1', [roundId])).rows;
    const sb = (await c.query('select is_sandbox from pool_tables where id = $1', [r.table_id])).rows[0].is_sandbox;
    for (const s of seats) {
      if (s.bot_name) continue;
      if (s.is_house) {
        if (!sb) await c.query(`insert into pool_house_ledger (round_id, delta_cents, kind) values ($1, $2, 'refund')`, [r.id, N(s.stake_cents)]);
      } else {
        await move(c, s.user_id, N(s.stake_cents), 'pool_refund', r.id, { reason: 'cancelled' });
      }
    }
    await c.query(`update pool_rounds set status = 'cancelled', settled_at = now(), server_seed_hash = server_seed_hash where id = $1`, [r.id]);
    const table = (await c.query('select * from pool_tables where id = $1', [r.table_id])).rows[0];
    if (reopen && table.active) await openRound(c, table, await settings(c));
    return { roundId: r.id, code: table.code, isPrivate: table.is_private, refunded: seats.length };
  }

  function emitChange(code, isPrivate) { bus.emit('change', { code, isPrivate: !!isPrivate }); }
  function emitSettled(out) {
    if (!out) return;
    emitChange(out.code, out.isPrivate);
    if (!out.isPrivate) {
      bus.emit('win', { code: out.code, table: out.tableName, name: out.winner.name, isHouse: out.winner.isHouse,
        payout: out.payout, pot: out.pot, at: new Date().toISOString() });
    }
  }

  /* ── player actions ───────────────────────────────────────────────────── */

  async function join(userId, code, clientSeed) {
    const out = await withTx(async (c) => {
      const s = await settings(c);
      if (s.paused) fail(503, 'Pool is paused. No new seats right now.');
      const table = (await resolveTable(c, code, userId))?.table;
      if (!table || !table.active) fail(404, 'table not found');

      const round = await liveRoundForUpdate(c, table, s);
      const stake = N(round.stake_cents);
      if (stake > s.maxStakeCents) fail(400, 'This table is above the current stake cap.');

      const u = (await c.query(
        'select id, balance_cents, banned, pool_cooloff_until, pool_daily_limit_cents from users where id = $1 for update',
        [userId])).rows[0];
      if (!u || u.banned) fail(403, 'suspended');
      if (u.pool_cooloff_until && new Date(u.pool_cooloff_until) > new Date())
        fail(403, 'Your cool-off is active.', { cooloffUntil: u.pool_cooloff_until });

      const seats = (await c.query('select * from pool_seats where round_id = $1 order by seat_index', [round.id])).rows;
      if (seats.some((x) => x.user_id === userId)) fail(409, 'You already have a seat in this round.');
      if (seats.length >= round.max_seats) fail(409, 'Table full. The next round opens in a moment.');
      if (N(u.balance_cents) < stake) fail(402, 'Not enough balance for this seat.', { need: stake - N(u.balance_cents) });

      if (u.pool_daily_limit_cents != null) {
        const spent = N((await c.query(
          `select coalesce(sum(case when kind = 'pool_buyin' then -delta_cents
                                    when kind = 'pool_refund' then -delta_cents else 0 end), 0) as n
             from ledger where user_id = $1 and created_at > now() - interval '24 hours'
              and kind in ('pool_buyin','pool_refund')`, [userId])).rows[0].n);
        if (spent + stake > N(u.pool_daily_limit_cents))
          fail(403, `That would pass your 24h pool limit (${(N(u.pool_daily_limit_cents) / 100).toFixed(2)}).`);
      }

      await move(c, userId, -stake, 'pool_buyin', round.id, { table: table.code, seq: round.seq });
      const seatIndex = seats.length ? Math.max(...seats.map((x) => x.seat_index)) + 1 : 0;
      await c.query(
        'insert into pool_seats (round_id, seat_index, user_id, client_seed, stake_cents) values ($1,$2,$3,$4,$5)',
        [round.id, seatIndex, userId, cleanSeed(clientSeed), stake]
      );
      await c.query('update pool_rounds set pot_cents = pot_cents + $2, last_join_at = now() where id = $1', [round.id, stake]);

      const humans = seats.filter((x) => !x.is_house).length + 1;
      let countdownStarted = false;
      if (round.status === 'open' && humans >= round.min_players) {
        await c.query(
          `update pool_rounds set status = 'countdown', countdown_ends_at = now() + make_interval(secs => $2) where id = $1`,
          [round.id, round.countdown_secs]);
        countdownStarted = true;
      }
      const settled = seats.length + 1 >= round.max_seats ? await settle(c, round.id) : null;
      return { roundId: round.id, seatIndex, settled, countdownStarted, code: table.code, isPrivate: table.is_private,
        countdownSecs: round.countdown_secs, sandbox: table.is_sandbox, maxSeats: round.max_seats };
    });
    emitChange(out.code, out.isPrivate);
    emitSettled(out.settled);
    if (out.countdownStarted) scheduleTick(out.countdownSecs * 1000 + 60);
    if (out.sandbox && !out.settled) startSim(out.roundId);
    if (!out.sandbox && !out.settled) settings().then((st) => { if (st.houseFill && out.maxSeats >= st.houseMinTable) scheduleFill(out.roundId, st.houseAfterSecs * 1000 + 100); }).catch(() => {});
    return out;
  }

  async function leave(userId, code) {
    const out = await withTx(async (c) => {
      const table = (await resolveTable(c, code, userId, { create: false }))?.table;
      if (!table) fail(404, 'table not found');
      const round = (await c.query(`select * from pool_rounds where table_id = $1 and status in ${LIVE} for update`, [table.id])).rows[0];
      if (!round) fail(404, 'no live round');
      const seat = (await c.query('select * from pool_seats where round_id = $1 and user_id = $2', [round.id, userId])).rows[0];
      if (!seat) fail(404, 'You are not seated.');
      if (round.status === 'countdown' && new Date(round.countdown_ends_at).getTime() - Date.now() < LOCK_MS)
        fail(409, 'Seats are locked for the draw.');

      await c.query('delete from pool_seats where id = $1', [seat.id]);
      await move(c, userId, N(seat.stake_cents), 'pool_refund', round.id, { reason: 'left' });
      await c.query('update pool_rounds set pot_cents = pot_cents - $2 where id = $1', [round.id, N(seat.stake_cents)]);
      const humans = N((await c.query('select count(*)::int n from pool_seats where round_id = $1 and not is_house', [round.id])).rows[0].n);
      if (round.status === 'countdown' && humans < round.min_players)
        await c.query(`update pool_rounds set status = 'open', countdown_ends_at = null where id = $1`, [round.id]);
      return { code: table.code, isPrivate: table.is_private, refunded: N(seat.stake_cents) };
    });
    emitChange(out.code, out.isPrivate);
    return out;
  }

  async function createCrewTable(userId, body) {
    const s = await settings();
    if (!s.crewTables) fail(403, 'Crew tables are switched off.');
    const stake = Math.round(Number(body.stakeCents));
    if (!STAKES.includes(stake) || stake > s.maxStakeCents) fail(400, 'Pick one of the listed stakes.');
    const maxSeats = MODES[body.mode]?.n || clampInt(body.maxSeats, 2, 10, 5);
    const name = String(body.name || '').replace(/[^\p{L}\p{N} '_-]/gu, '').trim().slice(0, 24) || sessionName();
    const mine = N((await q('select count(*)::int n from pool_tables where created_by = $1 and active and sandbox_of is null', [userId])).rows[0].n);
    if (mine >= 3) fail(409, 'You already have 3 open crew tables. Close one first.');
    return withTx(async (c) => {
      const test = await isTestUser(c, userId);
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const t = (await c.query(
          `insert into pool_tables (code, name, stake_cents, max_seats, min_players, countdown_secs, mode, losers, house_seat, house_fill, is_private, is_sandbox, created_by)
           values ($1,$2,$3,$4,$4,45,'crew',$7,false,false,true,$6,$5) on conflict (code) do nothing returning *`,
          [code, name, stake, maxSeats, userId, test, losersFor(maxSeats)])).rows[0];
        if (t) { await openRound(c, t, s); return { code: t.code, name: t.name }; }
      }
      fail(500, 'could not allocate a code');
    });
  }

  async function closeCrewTable(userId, code) {
    const out = await withTx(async (c) => {
      const t = (await c.query('select * from pool_tables where code = $1 and created_by = $2 and active for update', [code, userId])).rows[0];
      if (!t) fail(404, 'not your table');
      const live = (await c.query(`select id from pool_rounds where table_id = $1 and status in ${LIVE}`, [t.id])).rows[0];
      if (live) {
        const n = N((await c.query('select count(*)::int n from pool_seats where round_id = $1', [live.id])).rows[0].n);
        if (n > 0) fail(409, 'Players are seated. Wait for the draw or for them to leave.');
        await cancelRound(c, live.id, false);
      }
      await c.query('update pool_tables set active = false where id = $1', [t.id]);
      return { code: t.code };
    });
    emitChange(out.code, true);
    return out;
  }

  async function setLimits(userId, body) {
    return withTx(async (c) => {
      const u = (await c.query('select pool_daily_limit_cents, pool_limit_changed_at, pool_cooloff_until from users where id = $1 for update', [userId])).rows[0];
      if (body.cooloffHours !== undefined) {
        const h = Number(body.cooloffHours);
        if (![24, 168, 720].includes(h)) fail(400, 'Cool-off is 24h, 7 days or 30 days.');
        // greatest(): a cool-off can be extended but never shortened
        await c.query(
          `update users set pool_cooloff_until = greatest(coalesce(pool_cooloff_until, now()), now() + make_interval(hours => $2)) where id = $1`,
          [userId, h]);
      }
      if (body.dailyLimitCents !== undefined) {
        const next = body.dailyLimitCents === null || body.dailyLimitCents === '' ? null : Math.round(Number(body.dailyLimitCents));
        if (next !== null && (!Number.isFinite(next) || next < 100)) fail(400, 'Minimum limit is $1.');
        const cur = N(u.pool_daily_limit_cents);
        const loosening = cur !== null && (next === null || next > cur);
        const recent = u.pool_limit_changed_at && Date.now() - new Date(u.pool_limit_changed_at).getTime() < 24 * 3600e3;
        if (loosening && recent) fail(409, 'You can raise or remove a limit 24 hours after your last change.');
        await c.query('update users set pool_daily_limit_cents = $2, pool_limit_changed_at = now() where id = $1', [userId, next]);
      }
      return me(userId, c);
    });
  }

  /* ── read models ──────────────────────────────────────────────────────── */

  const liveSummarySql = (where) => `
    select t.id, t.code, t.name, t.stake_cents, t.max_seats, t.min_players, t.countdown_secs, t.mode,
           t.house_seat, t.is_private, t.active, t.sort, t.created_by, t.is_sandbox, t.sandbox_of, t.losers,
           r.id as round_id, r.seq, r.status, r.pot_cents, r.countdown_ends_at, r.fee_bps,
           r.house_seat as round_house, r.server_seed_hash,
           (select count(*) from pool_seats s where s.round_id = r.id)::int as seats,
           (select count(*) from pool_seats s where s.round_id = r.id and s.is_house)::int as house_in,
           coalesce((select bool_or(s.user_id = $1) from pool_seats s where s.round_id = r.id), false) as me_in
      from pool_tables t
      left join pool_rounds r on r.table_id = t.id and r.status in ${LIVE}
     where ${where}
     order by t.sort, t.created_at`;

  const tableOut = (t, s) => ({
    code: t.code, name: t.name, stake: N(t.stake_cents), maxSeats: t.max_seats, minPlayers: t.min_players,
    countdownSecs: t.countdown_secs, mode: t.mode, losers: t.losers || 1, houseSeat: !!t.house_seat, isPrivate: !!t.is_private,
    active: !!t.active,
    round: t.round_id ? {
      id: t.round_id, seq: t.seq, status: t.status, pot: N(t.pot_cents), seats: t.seats,
      houseIn: t.house_in > 0, houseN: t.house_in, meIn: !!t.me_in, feeBps: t.fee_bps, endsAt: t.countdown_ends_at,
      serverSeedHash: t.server_seed_hash,
    } : null,
    feeBps: t.fee_bps ?? s?.feeBps,
  });

  async function lobby(userId) {
    const s = await settings();
    // A test (creator) account lives in its own world: its feed and live numbers come from its own
    // tables, where simulated players sit. Real players never see any of it, and it never sees theirs.
    const test = userId ? await isTestUser({ query: q }, userId) : false;
    const where = test ? 't.is_sandbox and t.created_by = $1' : 'not t.is_private';
    const [tables, feed, live] = await Promise.all([
      q(liveSummarySql('t.active and not t.is_private'), [userId]),
      q(`select r.id, r.share_cents, r.stake_cents, r.max_seats, r.losers_n, r.loser_names, r.settled_at, t.name as table_name,
                coalesce(o.code, t.code) as code, t.mode
           from pool_rounds r join pool_tables t on t.id = r.table_id left join pool_tables o on o.id = t.sandbox_of
          where r.status = 'settled' and ${where} order by r.settled_at desc limit 20`, test ? [userId] : []),
      q(`select count(*) filter (where not s.is_house)::int as seated, coalesce(sum(s.stake_cents), 0)::bigint as escrow
           from pool_rounds r join pool_tables t on t.id = r.table_id join pool_seats s on s.round_id = r.id
          where r.status in ${LIVE} and ${where}`, test ? [userId] : []),
    ]);
    const mine = userId ? (await q(liveSummarySql('t.active and t.is_private and t.created_by = $1 and t.sandbox_of is null'), [userId])).rows : [];
    // A test account sees its own sandbox round on each public card.
    const sb = test ? Object.fromEntries((await q(liveSummarySql('t.is_sandbox and t.created_by = $1 and t.sandbox_of is not null'), [userId]))
      .rows.map((x) => [x.sandbox_of, x])) : {};
    return {
      testMode: test,
      settings: { paused: s.paused, feeBps: s.feeBps, maxStake: s.maxStakeCents, crewTables: s.crewTables, stakes: STAKES.filter((x) => x <= s.maxStakeCents) },
      tables: tables.rows.map((t) => (sb[t.id] ? { ...tableOut(sb[t.id], s), code: t.code, name: t.name, sandbox: true } : tableOut(t, s))),
      crew: mine.map((t) => tableOut(t, s)),
      feed: feed.rows.map((f) => ({ id: f.id, table: f.table_name, mode: f.mode, code: f.code, at: f.settled_at, stake: N(f.stake_cents),
        share: N(f.share_cents), survivors: f.max_seats - f.losers_n, losers: f.loser_names || [] })),
      live: { seated: live.rows[0].seated, pots: N(live.rows[0].escrow) },
      now: new Date().toISOString(),
    };
  }

  async function tableView(code, userId) {
    const s = await settings();
    let simRound = null, simSettled = null;
    const rt = await withTx(async (c) => {
      const r = await resolveTable(c, code, userId);
      if (!r) return null;
      if (r.table.active) {
        const liveQ = () => c.query(`select * from pool_rounds where table_id = $1 and status in ${LIVE}`, [r.table.id]);
        let live = (await liveQ()).rows[0];
        if (!live) { await openRound(c, r.table, s); live = (await liveQ()).rows[0]; }
        if (r.table.is_sandbox && live) {
          const seats = (await c.query('select * from pool_seats where round_id = $1 order by seat_index', [live.id])).rows;
          const players = seats.filter((x) => !x.is_house);
          if (!players.length) {
            // a fresh sandbox round already has someone waiting, never enough to start the clock
            const n = crypto.randomInt(Math.max(1, live.min_players));
            for (let i = 0; i < n; i++) await addBot(c, live, (await c.query('select * from pool_seats where round_id = $1', [live.id])).rows);
          } else if (players.some((x) => x.user_id === userId)) {
            simRound = live.id;
            simSettled = await simCatchUp(c, live, seats);
          }
        }
      }
      return r;
    });
    if (simSettled) emitSettled(simSettled);
    if (!rt) fail(404, 'table not found');
    if (simRound) startSim(simRound);
    const t = (await q(liveSummarySql('t.id = $2'), [userId, rt.table.id])).rows[0];
    // a draw that's overdue (server restarted mid-countdown, clock moved) runs now
    if (t.status === 'countdown' && new Date(t.countdown_ends_at).getTime() <= Date.now()) scheduleTick(0);
    const [seats, hist] = await Promise.all([
      t.round_id ? q(
        `select s.seat_index, s.is_house, s.client_seed, s.joined_at, coalesce(s.user_id = $2, false) as me,
                s.bot_name is not null as bot, coalesce(s.bot_name, u.username, 'player') as name, u.equip
           from pool_seats s left join users u on u.id = s.user_id where s.round_id = $1 order by s.seat_index`,
        [t.round_id, userId]) : { rows: [] },
      q(`select r.id, r.seq, r.status, r.pot_cents, r.payout_cents, r.fee_cents, r.settled_at,
                (select count(*) from pool_seats x where x.round_id = r.id)::int as seats,
                exists(select 1 from pool_seats x where x.round_id = r.id and x.is_house) as house_sat,
                r.loser_names, r.share_cents, r.stake_cents, r.losers_n,
                exists(select 1 from pool_seats x where x.round_id = r.id and x.user_id = $2) as me_in,
                exists(select 1 from pool_seats x where x.round_id = r.id and x.user_id = $2 and x.id = any(r.loser_seat_ids)) as me_lost
           from pool_rounds r
          where r.table_id = $1 and r.status in ('settled','cancelled') order by r.seq desc limit 50`, [t.id, userId]),
    ]);
    const sandbox = !!t.is_sandbox;
    return {
      table: { ...tableOut(t, s), code: rt.shown.code, name: rt.shown.name, liveCode: t.code, sandbox,
        mine: !!userId && t.created_by === userId && !t.sandbox_of },
      seats: seats.rows.map((x) => ({ index: x.seat_index, name: x.is_house ? 'Kohler' : x.name, isHouse: x.is_house,
        me: !!x.me, bot: !!x.bot, avatar: x.equip?.avatar || null, ...(() => { const f = x.bot ? botFrame(x.name) : x.equip?.frame || null; return { frame: f, frameArt: f ? VAULT[f]?.art || null : null }; })(), filter: x.equip?.filter || null, clientSeed: x.client_seed, joinedAt: x.joined_at })),
      history: hist.rows.map((h) => ({ id: h.id, seq: h.seq, status: h.status, pot: N(h.pot_cents), share: N(h.share_cents), stake: N(h.stake_cents),
        fee: N(h.fee_cents), at: h.settled_at, seats: h.seats, houseSat: h.house_sat, losers: h.loser_names || [],
        meIn: h.me_in, meLost: h.me_lost, meSurvived: h.me_in && !h.me_lost && h.status === 'settled' })),
      paused: s.paused,
      now: new Date().toISOString(),
    };
  }

  async function roundView(id, userId) {
    const r = (await q(
      `select r.*, t.code, t.name as table_name from pool_rounds r join pool_tables t on t.id = r.table_id where r.id = $1`, [id])).rows[0];
    if (!r) fail(404, 'round not found');
    const done = r.status === 'settled' || r.status === 'cancelled';
    const seats = (await q(
      `select s.id, s.seat_index, s.is_house, s.client_seed, coalesce(s.user_id = $2, false) as me,
              s.bot_name is not null as bot, coalesce(s.bot_name, u.username, 'player') as name, u.equip
         from pool_seats s left join users u on u.id = s.user_id where s.round_id = $1 order by s.seat_index`, [id, userId])).rows;
    return {
      id: r.id, code: r.code, table: r.table_name, seq: r.seq, status: r.status,
      stake: N(r.stake_cents), pot: N(r.pot_cents), fee: N(r.fee_cents), payout: N(r.payout_cents), feeBps: r.fee_bps,
      houseSeat: r.house_seat, serverSeedHash: r.server_seed_hash,
      serverSeed: done ? r.server_seed : null,
      clientSeed: r.client_seed, drawHash: r.draw_hash, loserIndexes: r.loser_indexes || [], losersN: r.losers_n, share: N(r.share_cents),
      settledAt: r.settled_at,
      seats: seats.map((x) => ({ index: x.seat_index, name: x.is_house ? 'Kohler' : x.name, isHouse: x.is_house, me: !!x.me, bot: !!x.bot,
        avatar: x.equip?.avatar || null, frame: x.equip?.frame || null, filter: x.equip?.filter || null, clientSeed: x.client_seed, lost: (r.loser_seat_ids || []).includes(x.id) })),
    };
  }

  async function me(userId, c) {
    const run = c ? (t, p) => c.query(t, p) : q;
    const u = (await run(
      `select balance_cents, pool_cooloff_until, pool_daily_limit_cents, pool_limit_changed_at from users where id = $1`, [userId])).rows[0];
    const agg = (await run(
      `select coalesce(sum(delta_cents), 0)::bigint as net,
              coalesce(sum(case when kind = 'pool_buyin' then -delta_cents when kind = 'pool_refund' then -delta_cents else 0 end), 0)::bigint as spent,
              count(*) filter (where kind = 'pool_buyin')::int as seats
         from ledger where user_id = $1 and created_at > now() - interval '24 hours'
          and kind in ('pool_buyin','pool_refund','pool_payout')`, [userId])).rows[0];
    return {
      balance: N(u.balance_cents),
      cooloffUntil: u.pool_cooloff_until && new Date(u.pool_cooloff_until) > new Date() ? u.pool_cooloff_until : null,
      dailyLimit: N(u.pool_daily_limit_cents), limitChangedAt: u.pool_limit_changed_at,
      last24h: { net: N(agg.net), spent: N(agg.spent), seats: agg.seats },
    };
  }

  // Text for the link card a chat app draws when someone pastes /t/CODE.
  // Live numbers make it feel urgent; the fee is in the line so nobody's misled.
  async function sharePreview(code) {
    const t = (await q(
      `select t.name, t.code, t.stake_cents, t.max_seats, t.losers, t.active, t.is_sandbox, u.username as captain, r.fee_bps,
              (select count(*) from pool_seats s where s.round_id = r.id and not s.is_house)::int as humans,
              (select count(*) from pool_seats s where s.round_id = r.id)::int as seats
         from pool_tables t left join users u on u.id = t.created_by
         left join pool_rounds r on r.table_id = t.id and r.status in ${LIVE}
        where t.code = $1`, [code])).rows[0];
    if (!t || !t.active || t.is_sandbox) return null;
    const s = await settings();
    const stake = N(t.stake_cents), n = t.max_seats, L = t.losers || losersFor(n);
    const { share } = survivorSplit(stake, n, L, t.fee_bps ?? s.feeBps);
    const left = Math.max(0, n - (t.seats || 0));
    const $ = (c) => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
    const who = t.captain ? `${t.captain} wants you at` : 'Seats open at';
    return {
      name: t.name, code: t.code,
      title: `Survive ${t.name}: ${$(stake)} in, survivors win ${$(share)} each`,
      description: `${who} ${t.name}. ${left === 1 ? 'Last seat open' : `${left} of ${n} seats open`}. Everyone stakes ${$(stake)}; ` +
        `${L === 1 ? 'one random player is' : L + ' random players are'} knocked out and the other ${n - L} split their stake. ` +
        `10% fee on the knocked-out stake. Provably fair. You can lose your stake. 18+.`,
      stake, share, left, maxSeats: n, humans: t.humans || 0,
    };
  }

  // Books must sum to zero: user ledger + house-seat ledger + pool fees + money sitting in live pots.
  async function books() {
    const k = (await q(`select
          (select coalesce(sum(delta_cents), 0) from ledger l where kind in ('pool_buyin','pool_refund','pool_payout')
              and not exists (select 1 from pool_rounds r join pool_tables t on t.id = r.table_id where r.id::text = l.ref and t.is_sandbox))::bigint as users,
          (select coalesce(sum(delta_cents), 0) from pool_house_ledger)::bigint as house,
          (select coalesce(sum(amount_cents), 0) from platform_fees where kind = 'pool_fee')::bigint as fees,
          (select coalesce(sum(pot_cents), 0) from pool_rounds where table_id in (select id from pool_tables where not is_sandbox) and status in ${LIVE})::bigint as escrow`)).rows[0];
    const drift = N(k.users) + N(k.house) + N(k.fees) + N(k.escrow);
    return { users: N(k.users), house: N(k.house), fees: N(k.fees), escrow: N(k.escrow), drift, ok: drift === 0 };
  }

  async function sweepFills() {
    const s = await settings();
    if (!s.houseFill) return 0;
    const rows = (await q(
      `select r.id from pool_rounds r join pool_tables t on t.id = r.table_id
        where r.status = 'open' and t.house_fill and not t.is_sandbox and t.active and r.max_seats >= $1
          and r.last_join_at < now() - make_interval(secs => $2)`, [s.houseMinTable, s.houseAfterSecs])).rows;
    let n = 0; for (const r of rows) if (await houseFill(r.id)) n++;
    return n;
  }

  /* ── ticker ───────────────────────────────────────────────────────────── */

  // Event-driven on purpose: nothing polls the database while the room is
  // quiet, so Neon can scale to zero. A tick runs when a countdown is due (we
  // schedule it when the clock starts) and then schedules the next due round.
  let timer = null, busy = false, again = false, started = false;
  async function tick() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const due = (await q(`select id from pool_rounds where status = 'countdown' and countdown_ends_at <= now() order by countdown_ends_at limit 25`)).rows;
      for (const { id } of due) {
        try {
          const out = await withTx(async (c) => {
            const ok = (await c.query(
              `select id from pool_rounds where id = $1 and status = 'countdown' and countdown_ends_at <= now() for update skip locked`, [id])).rows[0];
            return ok ? settle(c, id) : null;
          });
          emitSettled(out);
        } catch (e) { log.error('[pool] settle failed', id, e.message); }
      }
      const next = (await q(`select min(countdown_ends_at) as t from pool_rounds where status = 'countdown'`)).rows[0]?.t;
      if (next) scheduleTick(new Date(next).getTime() - Date.now() + 60);
    } catch (e) {
      log.error('[pool] tick', e.message);
      if (started) scheduleTick(5000); // DB waking up or blipped: try again shortly
    } finally {
      busy = false;
      if (again) { again = false; scheduleTick(0); }
    }
  }
  function scheduleTick(ms) {
    if (!started) return;
    const at = Date.now() + Math.max(0, ms);
    if (timer && timer.at <= at) return;       // an earlier wake-up is already booked
    clearTimeout(timer?.h);
    const h = setTimeout(() => { timer = null; tick().catch(() => {}); }, Math.max(0, ms));
    h.unref?.();
    timer = { h, at };
  }

  async function ensureAll() {
    const s = await settings();
    const missing = (await q(
      `select t.* from pool_tables t where t.active
          and not exists (select 1 from pool_rounds r where r.table_id = t.id and r.status in ${LIVE})`)).rows;
    for (const t of missing) {
      const r = await withTx((c) => openRound(c, t, s));
      if (r) emitChange(t.code, t.is_private);
    }
  }

  // Boot: settle anything that came due while we were down, open missing rounds.
  async function start() {
    if (started) return;
    started = true;
    try { await ensureAll(); } catch (e) { log.error('[pool] ensureAll', e.message); }
    await tick();
  }
  function stop() { started = false; clearTimeout(timer?.h); timer = null; }

  /* ── HTTP ─────────────────────────────────────────────────────────────── */

  const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    const code = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 500;
    if (code === 500) log.error('[pool]', e.message);
    const { message, code: _c, stack, ...extra } = e;
    res.status(code).json({ error: code === 500 ? 'server error' : message, ...extra });
  });
  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'sign in' }));
  const gate = h(async (req, res) => {
    const on = (await gamblingEnabled()) && (await settings()).enabled;
    if (!on) return res.status(404).json({ error: 'not available' });
    req._poolNext();
  });

  const router = express.Router();
  router.use((req, res, next) => { req._poolNext = next; gate(req, res); });

  router.get('/lobby', h(async (req, res) => res.json(await lobby(req.user?.id || null))));
  router.get('/t/:code', h(async (req, res) => res.json(await tableView(String(req.params.code).toUpperCase(), req.user?.id || null))));
  router.get('/rounds/:id', h(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'round not found' });
    res.json(await roundView(req.params.id, req.user?.id || null));
  }));
  router.get('/name', (_req, res) => res.json({ name: sessionName() }));
  router.get('/me', requireUser, h(async (req, res) => res.json(await me(req.user.id))));
  router.post('/limits', requireUser, h(async (req, res) => res.json(await setLimits(req.user.id, req.body || {}))));
  router.post('/t/:code/join', requireUser, h(async (req, res) => {
    if (!(await limit(`pool:${req.user.id}`, 40, 60_000))) return res.status(429).json({ error: 'slow down' });
    const out = await join(req.user.id, String(req.params.code).toUpperCase(), req.body?.clientSeed);
    res.json({ roundId: out.roundId, seatIndex: out.seatIndex, settled: out.settled ? { roundId: out.settled.roundId } : null });
  }));
  router.post('/t/:code/leave', requireUser, h(async (req, res) => {
    if (!(await limit(`pool:${req.user.id}`, 40, 60_000))) return res.status(429).json({ error: 'slow down' });
    res.json(await leave(req.user.id, String(req.params.code).toUpperCase()));
  }));
  router.post('/tables', requireUser, h(async (req, res) => {
    if (req.user.banned) return res.status(403).json({ error: 'suspended' });
    if (!(await limit(`poolcrew:${req.user.id}`, 5, 600_000))) return res.status(429).json({ error: 'slow down' });
    res.json(await createCrewTable(req.user.id, req.body || {}));
  }));
  router.post('/t/:code/close', requireUser, h(async (req, res) => res.json(await closeCrewTable(req.user.id, String(req.params.code).toUpperCase()))));

  // Server-sent events: "something changed on table X" pings plus the public win
  // feed. Clients refetch on ping, so nothing private ever rides this stream.
  // Private tables only ping subscribers who already know the code.
  router.get('/stream', (req, res) => {
    const watch = String(req.query.code || '').toUpperCase();
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const onChange = (e) => { if (!e.isPrivate || e.code === watch) send('change', { code: e.code }); };
    const onWin = (e) => send('win', e);
    bus.on('change', onChange); bus.on('win', onWin);
    const hb = setInterval(() => res.write(': hb\n\n'), 20_000);
    // serverless functions have a time limit: end politely and let the browser reconnect
    const life = setTimeout(() => res.end(), Number(process.env.SSE_MAX_MS || (process.env.VERCEL ? 50_000 : 30 * 60_000)));
    req.on('close', () => { clearInterval(hb); clearTimeout(life); bus.off('change', onChange); bus.off('win', onWin); });
  });

  /* admin (mounted under the existing adminRouter, which is god-only for these paths) */

  const admin = express.Router();
  admin.get('/', h(async (req, res) => {
    const s = await settings();
    const [tables, st, rec] = await Promise.all([
      q(liveSummarySql('not t.is_sandbox'), [req.user.id]),
      q(`select
          (select count(*) from pool_rounds where table_id in (select id from pool_tables where not is_sandbox) and status = 'settled')::int as rounds_all,
          (select count(*) from pool_rounds where table_id in (select id from pool_tables where not is_sandbox) and status = 'settled' and settled_at > now() - interval '24 hours')::int as rounds_24h,
          (select coalesce(sum(pot_cents), 0) from pool_rounds where table_id in (select id from pool_tables where not is_sandbox) and status = 'settled')::bigint as volume_all,
          (select coalesce(sum(pot_cents), 0) from pool_rounds where table_id in (select id from pool_tables where not is_sandbox) and status = 'settled' and settled_at > now() - interval '24 hours')::bigint as volume_24h,
          (select coalesce(sum(fee_cents), 0) from pool_rounds where table_id in (select id from pool_tables where not is_sandbox) and status = 'settled')::bigint as fees_all,
          (select coalesce(sum(fee_cents), 0) from pool_rounds where table_id in (select id from pool_tables where not is_sandbox) and status = 'settled' and settled_at > now() - interval '24 hours')::bigint as fees_24h,
          (select coalesce(sum(delta_cents), 0) from pool_house_ledger)::bigint as house_seat_net,
          (select count(*) from pool_rounds r where r.table_id in (select id from pool_tables where not is_sandbox) and r.status = 'settled'
              and exists (select 1 from pool_seats s where s.id = r.winner_seat_id and s.is_house))::int as house_wins,
          (select count(*) from pool_rounds r where r.table_id in (select id from pool_tables where not is_sandbox) and r.status = 'settled'
              and exists (select 1 from pool_seats s where s.round_id = r.id and s.is_house))::int as house_sat,
          (select coalesce(sum(pot_cents), 0) from pool_rounds where table_id in (select id from pool_tables where not is_sandbox) and status in ${LIVE})::bigint as live_escrow`),
      // Books must sum to zero: user ledger + house-seat ledger + pool fees + money sitting in live pots.
      q(`select
          (select coalesce(sum(delta_cents), 0) from ledger l where kind in ('pool_buyin','pool_refund','pool_payout')
              and not exists (select 1 from pool_rounds r join pool_tables t on t.id = r.table_id where r.id::text = l.ref and t.is_sandbox))::bigint as users,
          (select coalesce(sum(delta_cents), 0) from pool_house_ledger)::bigint as house,
          (select coalesce(sum(amount_cents), 0) from platform_fees where kind = 'pool_fee')::bigint as fees,
          (select coalesce(sum(pot_cents), 0) from pool_rounds where table_id in (select id from pool_tables where not is_sandbox) and status in ${LIVE})::bigint as escrow`),
    ]);
    const k = rec.rows[0];
    const drift = N(k.users) + N(k.house) + N(k.fees) + N(k.escrow);
    res.json({
      settings: s,
      tables: tables.rows.map((t) => tableOut(t, s)),
      stats: Object.fromEntries(Object.entries(st.rows[0]).map(([a, b]) => [a, N(b)])),
      reconcile: { users: N(k.users), house: N(k.house), fees: N(k.fees), escrow: N(k.escrow), drift, ok: drift === 0 },
    });
  }));

  admin.patch('/settings', h(async (req, res) => {
    const b = req.body || {};
    const put = async (key, v) => q(
      `insert into site_settings (key, value, updated_at) values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`, [key, String(v)]);
    const changed = {};
    if (b.enabled !== undefined) { await put('pool_enabled', !!b.enabled); changed.enabled = !!b.enabled; }
    if (b.paused !== undefined) { await put('pool_paused', !!b.paused); changed.paused = !!b.paused; }
    if (b.houseSeats !== undefined) { await put('pool_house_seats', !!b.houseSeats); changed.houseSeats = !!b.houseSeats; }
    if (b.crewTables !== undefined) { await put('pool_crew_tables', !!b.crewTables); changed.crewTables = !!b.crewTables; }
    if (b.feeBps !== undefined) { const v = clampInt(b.feeBps, 0, 2500, 1000); await put('pool_fee_bps', v); changed.feeBps = v; }
    if (b.maxStakeCents !== undefined) { const v = clampInt(b.maxStakeCents, 100, 10_000_000, 10000); await put('pool_max_stake_cents', v); changed.maxStakeCents = v; }
    if (b.houseFill !== undefined) { await put('survivor_house_fill', !!b.houseFill); changed.houseFill = !!b.houseFill; }
    if (b.houseAfterSecs !== undefined) { const v = clampInt(b.houseAfterSecs, 5, 3600, 30); await put('survivor_house_after_secs', v); changed.houseAfterSecs = v; }
    if (b.houseMax !== undefined) { const v = clampInt(b.houseMax, 0, 5, 2); await put('survivor_house_max', v); changed.houseMax = v; }
    await audit(req, 'pool.settings', changed);
    res.json({ settings: await settings() });
  }));

  admin.post('/tables', h(async (req, res) => {
    const b = req.body || {};
    const code = String(b.code || newCode()).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || newCode();
    const stake = Math.round(Number(b.stakeCents));
    if (!(stake > 0)) fail(400, 'stake required');
    const mode = MODES[b.mode] ? b.mode : 'squad';
    const maxSeats = MODES[mode].n;
    const t = await withTx(async (c) => {
      const row = (await c.query(
        `insert into pool_tables (code, name, stake_cents, max_seats, min_players, countdown_secs, mode, losers, house_seat, house_fill, sort)
         values ($1,$2,$3,$4,$4,30,$5,$6,$7,$8,$9) returning *`,
        [code, String(b.name || MODES[mode].label).slice(0, 32), stake, maxSeats, mode, MODES[mode].losers, !!b.houseSeat,
         b.houseFill !== false && maxSeats >= 5, clampInt(b.sort, -1000, 1000, 0)])).rows[0];
      await openRound(c, row, await settings(c));
      return row;
    });
    await audit(req, 'pool.table.create', { code: t.code, stake, maxSeats, houseSeat: !!b.houseSeat });
    emitChange(t.code, false);
    res.json({ code: t.code });
  }));

  // Edits apply from the next round: a live round keeps the ticket it opened with.
  admin.patch('/tables/:code', h(async (req, res) => {
    const b = req.body || {};
    const code = String(req.params.code).toUpperCase();
    const out = await withTx(async (c) => {
      const t = (await c.query('select * from pool_tables where code = $1 for update', [code])).rows[0];
      if (!t) fail(404, 'table not found');
      const sets = [], vals = [t.id];
      const put = (col, v) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };
      if (b.name !== undefined) put('name', String(b.name).slice(0, 32));
      if (b.houseSeat !== undefined) put('house_seat', !!b.houseSeat);
      if (b.houseFill !== undefined) put('house_fill', !!b.houseFill);
      if (b.countdownSecs !== undefined) put('countdown_secs', clampInt(b.countdownSecs, 5, 600, t.countdown_secs));
      if (b.minPlayers !== undefined) put('min_players', clampInt(b.minPlayers, 2, t.max_seats, t.min_players));
      if (b.sort !== undefined) put('sort', clampInt(b.sort, -1000, 1000, 0));
      if (b.stakeCents !== undefined) put('stake_cents', Math.max(1, Math.round(Number(b.stakeCents))));
      if (b.active !== undefined) put('active', !!b.active);
      if (sets.length) await c.query(`update pool_tables set ${sets.join(', ')} where id = $1`, vals);
      let cancelled = null;
      if (b.active === false) {
        const live = (await c.query(`select id from pool_rounds where table_id = $1 and status in ${LIVE}`, [t.id])).rows[0];
        if (live) cancelled = await cancelRound(c, live.id, false);
      }
      return { code, isPrivate: t.is_private, cancelled };
    });
    await audit(req, 'pool.table.update', { code, ...b });
    emitChange(out.code, out.isPrivate);
    res.json({ ok: true, cancelled: out.cancelled });
  }));

  admin.post('/rounds/:id/cancel', h(async (req, res) => {
    const out = await withTx((c) => cancelRound(c, req.params.id, true));
    if (!out) fail(404, 'no live round with that id');
    await audit(req, 'pool.round.cancel', out);
    emitChange(out.code, out.isPrivate);
    res.json(out);
  }));

  admin.get('/rounds', h(async (_req, res) => {
    const r = await q(
      `select r.id, r.seq, r.status, r.pot_cents, r.fee_cents, r.payout_cents, r.settled_at, r.house_seat,
              r.loser_names, r.share_cents, r.stake_cents, r.losers_n, t.mode,
              exists (select 1 from pool_seats s where s.round_id = r.id and s.is_house) as house_in,
              t.code, t.name, w.is_house as winner_house, u.username as winner_name,
              (select count(*) from pool_seats s where s.round_id = r.id)::int as seats
         from pool_rounds r join pool_tables t on t.id = r.table_id
         left join pool_seats w on w.id = r.winner_seat_id left join users u on u.id = w.user_id
        where r.status in ('settled','cancelled') and not t.is_sandbox order by r.settled_at desc limit 200`);
    res.json({ rounds: r.rows.map((x) => ({ ...x, share_cents: N(x.share_cents), stake_cents: N(x.stake_cents), pot_cents: N(x.pot_cents), fee_cents: N(x.fee_cents), payout_cents: N(x.payout_cents),
      winner: x.status === 'settled' ? (x.winner_house ? 'HOUSE' : x.winner_name) : null })) });
  }));

  return {
    router, admin, start, stop, tick, bus, settings, sharePreview, books, houseFill, sweepFills,
    // exposed for tests / scripts
    join, leave, settle, cancelRound, lobby, tableView, roundView, me, setLimits, createCrewTable, closeCrewTable, ensureAll,
  };
}
