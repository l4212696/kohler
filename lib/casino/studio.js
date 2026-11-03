// Kohler Studio: a built-in game provider. It behaves exactly like an external
// aggregator would: the game runs in an iframe, the provider's server decides
// every outcome, and money moves only through signed HTTP calls to Kohler's
// seamless wallet (/api/casino/v1/...). Swap it for SoftSwiss/Slotegrator and
// the wallet side doesn't change.
//
// Demo mode (?demo=1) plays the same engines with a pretend $1,000 held here,
// never touching the wallet.
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import * as E from './engines.js';
import { sign, fmt, toCents } from './wallet.js';

const rid = () => crypto.randomBytes(9).toString('base64url');

export function createStudio({ q, providerId, secret, walletUrl, publicDir, local, log = console }) {
  const tokens = new Map();   // game token → { userId, exp } (provider-side cache of authenticate)
  const demos = new Map();    // demo id → { balance, exp }
  const retries = [];         // wins the wallet didn't confirm; retried with the same transaction_id
  setInterval(() => { const now = Date.now(); for (const [k, v] of tokens) if (v.exp < now) tokens.delete(k); for (const [k, v] of demos) if (v.exp < now) demos.delete(k); }, 600_000).unref();

  async function wallet(endpoint, body) {
    // same server: call the wallet directly. CASINO_WALLET_URL forces the signed HTTP route instead.
    if (local && !process.env.CASINO_WALLET_URL) return local(providerId, endpoint, body);
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await fetch(walletUrl() + '/api/casino/v1' + endpoint, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'x-casino-provider': providerId, 'x-casino-timestamp': ts, 'x-casino-signature': sign(await secret(), ts, raw) },
      body: raw,
    });
    return r.json();
  }
  // wins are retried (same transaction_id, so the wallet can't pay twice)
  async function settleWin(body) {
    for (let i = 0; i < 3; i++) {
      try { const r = await wallet('/game/win', body); if (r.status === 'OK' || r.error_code !== 'INTERNAL_ERROR') return r; } catch { /* network */ }
      await new Promise((ok) => setTimeout(ok, 300 * (i + 1)));
    }
    retries.push({ body, tries: 0, next: Date.now() + 10_000 });
    return { status: 'PENDING' };
  }
  setInterval(async () => {
    for (const r of [...retries]) {
      if (r.next > Date.now()) continue;
      try { const x = await wallet('/game/win', r.body); if (x.status === 'OK' || x.error_code !== 'INTERNAL_ERROR') { retries.splice(retries.indexOf(r), 1); continue; } } catch {}
      r.tries++; r.next = Date.now() + Math.min(600_000, 10_000 * 2 ** r.tries);
      if (r.tries > 12) { log.error('[studio] giving up on win', r.body.transaction_id); retries.splice(retries.indexOf(r), 1); }
    }
  }, 5000).unref();

  async function gameRow(id) {
    const g = (await q('select * from casino_games where id = $1 and provider_id = $2', [id, providerId])).rows[0];
    if (!g) throw Object.assign(new Error('Game not found'), { http: 404 });
    return g;
  }
  function publicConfig(g) {
    const t = g.theme || {};
    const cfg = { id: g.id, name: g.name, engine: g.engine, rtp: Number(g.rtp), volatility: g.volatility, theme: t,
      min: Number(g.min_bet_cents), max: Number(g.max_bet_cents), active: g.active };
    if (g.engine === 'slot') cfg.paytable = E.slotPaytable(t.volatility, Number(t.rtp)).lines.map(({ symbol, count, mult }) => ({ symbol, count, mult }));
    if (g.engine === 'plinko') cfg.plinko = E.plinkoTable(t.rows, t.risk).mult;
    if (g.engine === 'wheel') cfg.wheel = E.wheelTable(t.risk).segments;
    return cfg;
  }

  // who is playing: a real wallet session or a demo
  async function player(body, gameId) {
    if (body.demo) {
      let d = demos.get(body.demo);
      if (!d) { d = { balance: 100000, exp: 0 }; demos.set(body.demo, d); }
      d.exp = Date.now() + 2 * 3600e3;
      return { demo: true, d };
    }
    const token = String(body.token || '');
    let t = tokens.get(token);
    if (!t || t.exp < Date.now()) {
      const a = await wallet('/user/authenticate', { token });
      if (a.status !== 'OK') throw Object.assign(new Error(a.message), { wallet: a });
      t = { userId: a.user_id, username: a.username, test: a.test, gameId: a.game_id, exp: Date.now() + 5 * 60_000 };
      tokens.set(token, t);
    }
    if (t.gameId !== gameId) throw Object.assign(new Error('This session belongs to another game.'), { http: 403 });
    return { demo: false, token, ...t };
  }

  // one bet → outcome → win. Returns { balance, result } or a wallet error.
  async function oneShot(p, g, betCents, decide) {
    if (!(betCents >= Number(g.min_bet_cents) && betCents <= Number(g.max_bet_cents)))
      return { error: { error_code: 'BET_LIMIT', message: `Bet between ${fmt(g.min_bet_cents)} and ${fmt(g.max_bet_cents)}.` } };
    if (p.demo) {
      if (p.d.balance < betCents) return { error: { error_code: 'INSUFFICIENT_FUNDS', message: 'Not enough demo balance. Reload for a fresh $1,000.' } };
      const result = decide();
      p.d.balance += result.payoutCents - betCents;
      return { result, balance: fmt(p.d.balance) };
    }
    const round = `${g.id}:${rid()}`;
    const base = { token: p.token, user_id: p.userId, game_id: g.id, round_id: round, currency: 'USD' };
    let bet;
    try { bet = await wallet('/game/bet', { ...base, transaction_id: round + ':bet', amount: fmt(betCents) }); }
    catch (e) {
      // we don't know whether the bet landed: cancel it so the player can't be charged for a round they never saw
      wallet('/game/rollback', { user_id: p.userId, game_id: g.id, round_id: round, transaction_id: round + ':rb', reference_transaction_id: round + ':bet' }).catch(() => {});
      return { error: { error_code: 'INTERNAL_ERROR', message: 'Connection to the wallet failed. Your bet was cancelled.' } };
    }
    if (bet.status !== 'OK') return { error: bet };
    const result = decide();
    const win = await settleWin({ ...base, transaction_id: round + ':win', amount: fmt(result.payoutCents) });
    return { result, round, balance: win.status === 'OK' ? win.balance : bet.balance, pending: win.status === 'PENDING' };
  }

  /* ── blackjack (multi-step) ── */
  const bjView = (s) => ({ player: s.player, dealer: s.done ? s.dealer : [s.dealer[0], { r: '?', s: '?' }], done: s.done, result: s.result,
    playerTotal: E.handValue(s.player).total, dealerTotal: s.done ? E.handValue(s.dealer).total : null, bet: s.bet, payoutCents: s.payoutCents || 0,
    canDouble: !s.done && s.player.length === 2 });
  async function blackjack(p, g, action, params) {
    if (action === 'deal') {
      const betCents = toCents(params.bet);
      if (p.demo) {
        const r = await oneShotDemoDeal(p, g, betCents); return r;
      }
      if (!(betCents >= Number(g.min_bet_cents) && betCents <= Number(g.max_bet_cents)))
        return { error: { error_code: 'BET_LIMIT', message: `Bet between ${fmt(g.min_bet_cents)} and ${fmt(g.max_bet_cents)}.` } };
      const round = `${g.id}:${rid()}`;
      const base = { token: p.token, user_id: p.userId, game_id: g.id, round_id: round, currency: 'USD' };
      const bet = await wallet('/game/bet', { ...base, transaction_id: round + ':bet', amount: fmt(betCents) });
      if (bet.status !== 'OK') return { error: bet };
      const s = E.bjDeal(betCents);
      let balance = bet.balance;
      if (s.done) { const w = await settleWin({ ...base, transaction_id: round + ':win', amount: fmt(s.payoutCents) }); if (w.balance) balance = w.balance; }
      await q(`insert into studio_rounds (id, user_id, game_id, state, status) values ($1,$2,$3,$4,$5)`,
        [round, p.userId, g.id, { ...s, round }, s.done ? 'done' : 'open']);
      return { result: { ...bjView(s), round }, balance };
    }
    const round = String(params.round || '');
    if (p.demo) return demoBjAct(p, g, round, action);
    const row = (await q(`select * from studio_rounds where id = $1 and user_id = $2 and status = 'open'`, [round, p.userId])).rows[0];
    if (!row) return { error: { error_code: 'ROUND_NOT_FOUND', message: 'That hand is already finished.' } };
    const s = row.state;
    const base = { token: p.token, user_id: p.userId, game_id: g.id, round_id: round, currency: 'USD' };
    let balance = null;
    if (action === 'double') {
      if (s.player.length !== 2) return { error: { error_code: 'BAD_REQUEST', message: 'You can only double on your first two cards.' } };
      const d = await wallet('/game/bet', { ...base, transaction_id: round + ':double', amount: fmt(s.bet) });
      if (d.status !== 'OK') return { error: d };
      balance = d.balance;
    }
    try { E.bjAct(s, action); } catch (e) { return { error: { error_code: 'BAD_REQUEST', message: e.message } }; }
    if (s.done) { const w = await settleWin({ ...base, transaction_id: round + ':win', amount: fmt(s.payoutCents) }); if (w.balance) balance = w.balance; }
    await q(`update studio_rounds set state = $2, status = $3, updated_at = now() where id = $1`, [round, s, s.done ? 'done' : 'open']);
    return { result: { ...bjView(s), round }, balance };
  }
  const demoHands = new Map();
  async function oneShotDemoDeal(p, g, betCents) {
    if (!(betCents >= Number(g.min_bet_cents) && betCents <= Number(g.max_bet_cents))) return { error: { error_code: 'BET_LIMIT', message: `Bet between ${fmt(g.min_bet_cents)} and ${fmt(g.max_bet_cents)}.` } };
    if (p.d.balance < betCents) return { error: { error_code: 'INSUFFICIENT_FUNDS', message: 'Not enough demo balance.' } };
    p.d.balance -= betCents;
    const s = E.bjDeal(betCents); const round = 'demo:' + rid();
    if (s.done) p.d.balance += s.payoutCents; else demoHands.set(round, s);
    return { result: { ...bjView(s), round }, balance: fmt(p.d.balance) };
  }
  function demoBjAct(p, g, round, action) {
    const s = demoHands.get(round);
    if (!s) return { error: { error_code: 'ROUND_NOT_FOUND', message: 'That hand is already finished.' } };
    if (action === 'double') { if (p.d.balance < s.bet) return { error: { error_code: 'INSUFFICIENT_FUNDS', message: 'Not enough demo balance to double.' } }; p.d.balance -= s.bet; }
    try { E.bjAct(s, action); } catch (e) { return { error: { error_code: 'BAD_REQUEST', message: e.message } }; }
    if (s.done) { p.d.balance += s.payoutCents; demoHands.delete(round); }
    return { result: { ...bjView(s), round }, balance: fmt(p.d.balance) };
  }

  /* ── originals with state: Rocket and Mines ──────────────────────────────
     Money goes through `purse`: the wallet for real players, the demo balance
     for demo. Round state lives in studio_rounds (real) or memory (demo). */
  const demoRounds = new Map();
  function purse(p, g, round) {
    const base = { token: p.token, user_id: p.userId, game_id: g.id, round_id: round, currency: 'USD' };
    return {
      async bet(cents, tag = 'bet') {
        if (p.demo) { if (p.d.balance < cents) return { error: { error_code: 'INSUFFICIENT_FUNDS', message: 'Not enough demo balance.' } }; p.d.balance -= cents; return { balance: fmt(p.d.balance) }; }
        const r = await wallet('/game/bet', { ...base, transaction_id: `${round}:${tag}`, amount: fmt(cents) });
        return r.status === 'OK' ? { balance: r.balance } : { error: r };
      },
      async win(cents) {
        if (p.demo) { p.d.balance += cents; return { balance: fmt(p.d.balance) }; }
        const r = await settleWin({ ...base, transaction_id: `${round}:win`, amount: fmt(cents) });
        return { balance: r.balance, pending: r.status === 'PENDING' };
      },
    };
  }
  const loadRound = async (p, id) => p.demo ? demoRounds.get(id) || null
    : (await q(`select state from studio_rounds where id = $1 and user_id = $2 and status = 'open'`, [id, p.userId])).rows[0]?.state || null;
  const saveRound = async (p, g, id, st, done) => {
    if (p.demo) { demoRounds.set(id, st); if (done) setTimeout(() => demoRounds.delete(id), 60_000).unref?.(); return; }
    await q(`insert into studio_rounds (id, user_id, game_id, state, status) values ($1,$2,$3,$4,$5)
             on conflict (id) do update set state = excluded.state, status = excluded.status, updated_at = now()`,
      [id, p.userId, g.id, st, done ? 'done' : 'open']);
  };
  const limits = (g, cents) => (cents >= Number(g.min_bet_cents) && cents <= Number(g.max_bet_cents)) ? null
    : { error: { error_code: 'BET_LIMIT', message: `Bet between ${fmt(g.min_bet_cents)} and ${fmt(g.max_bet_cents)}.` } };

  // Rocket: the server settles every round on its own clock, so a dropped connection
  // still pays an auto cash-out and still loses at the crash.
  const rocketTimers = new Map();
  async function rocketSettle(p, g, id, at) {
    const st = await loadRound(p, id);
    if (!st || st.done) return st;
    const elapsed = (at ?? Date.now()) - st.start;
    const crashMs = E.rocketMsFor(st.crash);
    let m = Math.max(1, E.rocketAt(Math.max(0, Math.min(elapsed, crashMs))));
    if (st.auto && st.auto <= st.crash && E.rocketMsFor(st.auto) <= elapsed) m = st.auto;
    const crashed = !(st.auto && m === st.auto) && elapsed >= crashMs;
    if (!crashed && at === undefined && !(st.auto && m === st.auto)) return st;   // still flying
    st.done = true; st.cashedAt = crashed ? null : m; st.payoutCents = crashed ? 0 : Math.floor(st.bet * m + 1e-9);
    const r = await purse(p, g, id).win(st.payoutCents);
    st.balance = r.balance;
    await saveRound(p, g, id, st, true);
    clearTimeout(rocketTimers.get(id)); rocketTimers.delete(id);
    return st;
  }
  const rocketView = (st) => ({ round: st.id, startedAt: st.start, now: Date.now(), done: !!st.done, crash: st.done ? st.crash : null,
    cashedAt: st.cashedAt ?? null, payoutCents: st.payoutCents || 0, auto: st.auto || null, bet: st.bet, seedHash: st.seedHash });
  async function rocket(p, g, action, prm) {
    if (action === 'launch') {
      const bet = toCents(prm.bet); const bad = limits(g, bet); if (bad) return bad;
      const id = `${g.id}:${rid()}`;
      const b = await purse(p, g, id).bet(bet); if (b.error) return b;
      const crash = E.crashPoint(), seed = rid();
      const auto = prm.auto ? Math.max(1.01, Math.floor(Number(prm.auto) * 100) / 100) : null;
      const st = { id, bet, crash, auto, start: Date.now() + 600, seedHash: crypto.createHash('sha256').update(`${seed}:${crash}`).digest('hex'), seed };
      await saveRound(p, g, id, st, false);
      const endAt = st.start + Math.min(E.rocketMsFor(crash), auto ? E.rocketMsFor(auto) : Infinity) + 40;
      const h = setTimeout(() => rocketSettle(p, g, id, endAt).catch((e) => log.error('[studio] rocket', e.message)), endAt - Date.now());
      h.unref?.(); rocketTimers.set(id, h);
      return { result: rocketView(st), balance: b.balance };
    }
    const id = String(prm.round || '');
    if (action === 'cashout') {
      const st = await rocketSettle(p, g, id, Date.now());
      if (!st) {
        // pressed a moment after it blew up: show how the flight ended instead of an error
        const row = p.demo ? null : (await q(`select state from studio_rounds where id = $1 and user_id = $2`, [id, p.userId])).rows[0];
        return row ? { result: rocketView(row.state), balance: row.state.balance } : { error: { error_code: 'ROUND_NOT_FOUND', message: 'That flight already ended.' } };
      }
      return { result: rocketView(st), balance: st.balance };
    }
    // status: lets the client learn about a crash without being told the crash point early
    let st = await loadRound(p, id);
    if (!st) {
      const row = p.demo ? null : (await q(`select state from studio_rounds where id = $1 and user_id = $2`, [id, p.userId])).rows[0];
      return row ? { result: rocketView(row.state), balance: row.state.balance } : { error: { error_code: 'ROUND_NOT_FOUND', message: 'Round not found.' } };
    }
    if (Date.now() - st.start >= E.rocketMsFor(st.crash)) st = await rocketSettle(p, g, id, Date.now());
    return { result: rocketView(st), balance: st.balance };
  }

  async function mines(p, g, action, prm) {
    if (action === 'start') {
      const bet = toCents(prm.bet); const bad = limits(g, bet); if (bad) return bad;
      const m = Math.min(24, Math.max(1, Math.round(Number(prm.mines) || 3)));
      const id = `${g.id}:${rid()}`;
      const b = await purse(p, g, id).bet(bet); if (b.error) return b;
      const st = { id, bet, m, mines: E.placeMines(m), picks: [], done: false };
      await saveRound(p, g, id, st, false);
      return { result: { round: id, m, picks: [], mult: 1, next: E.minesMult(m, 1), done: false }, balance: b.balance };
    }
    const id = String(prm.round || '');
    const st = await loadRound(p, id);
    if (!st) return { error: { error_code: 'ROUND_NOT_FOUND', message: 'That round already ended.' } };
    let bal = null;
    if (action === 'reveal') {
      const t = Math.round(Number(prm.tile));
      if (!(t >= 0 && t < 25) || st.picks.includes(t)) return { error: { error_code: 'BAD_REQUEST', message: 'Pick an unopened tile.' } };
      st.picks.push(t);
      if (st.mines.includes(t)) { st.done = true; st.boom = t; st.payoutCents = 0; bal = (await purse(p, g, id).win(0)).balance; }
      else if (st.picks.length === 25 - st.m) action = 'cashout';
    }
    if (action === 'cashout' && !st.done) {
      if (!st.picks.length) return { error: { error_code: 'BAD_REQUEST', message: 'Open at least one tile first.' } };
      st.done = true; st.payoutCents = Math.floor(st.bet * E.minesMult(st.m, st.picks.length) + 1e-9);
      bal = (await purse(p, g, id).win(st.payoutCents)).balance;
    }
    await saveRound(p, g, id, st, st.done);
    const k = st.picks.length;
    return { result: { round: id, m: st.m, picks: st.picks, mult: E.minesMult(st.m, k), next: E.minesMult(st.m, k + 1), done: st.done,
      boom: st.boom ?? null, payoutCents: st.payoutCents || 0, mines: st.done ? st.mines : null }, balance: bal };
  }

  /* ── sweep: finish rounds nobody is watching ──────────────────────────────
     Rocket: the flight already ended on the server clock (auto cash-out paid, or crashed).
     Mines left alone for an hour: cash out what was found, or refund if no tile was opened. */
  async function sweep() {
    const rows = (await q(`select r.id, r.user_id, r.game_id, r.state, r.updated_at, g.engine from studio_rounds r join casino_games g on g.id = r.game_id
                           where r.status = 'open' order by r.updated_at limit 200`)).rows;
    let rocket = 0, mines = 0;
    for (const r of rows) {
      const g = await gameRow(r.game_id).catch(() => null); if (!g) continue;
      const p = { demo: false, userId: r.user_id }, st = r.state;
      try {
        if (r.engine === 'rocket') {
          const end = st.start + Math.min(E.rocketMsFor(st.crash), st.auto ? E.rocketMsFor(st.auto) : Infinity) + 40;
          if (Date.now() > end) { await rocketSettle(p, g, r.id, end); rocket++; }
        } else if (r.engine === 'mines' && Date.now() - new Date(r.updated_at).getTime() > 3600e3 && !st.done) {
          st.done = true; st.payoutCents = st.picks.length ? Math.floor(st.bet * E.minesMult(st.m, st.picks.length) + 1e-9) : st.bet;
          await purse(p, g, r.id).win(st.payoutCents); await saveRound(p, g, r.id, st, true); mines++;
        }
      } catch (e) { log.error('[studio] sweep', r.id, e.message); }
    }
    return { rocket, mines };
  }
  // a normal server sweeps every minute; serverless hosts sweep from /api/cron/tick and on play
  setInterval(() => sweep().catch(() => {}), 60_000).unref();

  /* ── HTTP ── */
  const router = express.Router();
  // old game links: the client now lives at /studio/play.html?g=<id> (served as a static file everywhere)
  router.get('/play/:gameId', (req, res) => res.redirect(302, `/studio/play.html?g=${encodeURIComponent(req.params.gameId)}`));
  router.get('/api/config/:gameId', async (req, res) => {
    try { res.json(publicConfig(await gameRow(req.params.gameId))); } catch (e) { res.status(e.http || 500).json({ error: e.message }); }
  });
  router.post('/api/session', async (req, res) => {
    try {
      const g = await gameRow(String(req.body.gameId || ''));
      const p = await player(req.body, g.id);
      if (p.demo) return res.json({ demo: true, balance: fmt(p.d.balance), currency: 'USD' });
      const b = await wallet('/user/balance', { token: p.token });
      res.json({ demo: false, username: p.username, test: p.test, balance: b.balance, currency: 'USD' });
    } catch (e) { res.status(e.http || 401).json({ error: e.wallet?.message || e.message, error_code: e.wallet?.error_code }); }
  });
  router.post('/api/play', async (req, res) => {
    try {
      const b = req.body || {};
      const g = await gameRow(String(b.gameId || ''));
      if (!g.active && !b.demo) return res.json({ error: { error_code: 'GAME_DISABLED', message: 'This game is switched off.' } });
      const p = await player(b, g.id);
      const prm = b.params || {}, t = g.theme || {};
      let out;
      switch (g.engine) {
        case 'slot': { const bet = toCents(prm.bet); out = await oneShot(p, g, bet, () => E.spinSlot({ volatility: t.volatility, rtp: Number(t.rtp), betCents: bet })); break; }
        case 'dice': { const bet = toCents(prm.bet); out = await oneShot(p, g, bet, () => E.rollDice({ target: prm.target, betCents: bet })); break; }
        case 'plinko': { const bet = toCents(prm.bet); out = await oneShot(p, g, bet, () => E.dropPlinko({ rows: t.rows, risk: t.risk, betCents: bet })); break; }
        case 'wheel': { const bet = toCents(prm.bet); out = await oneShot(p, g, bet, () => E.spinWheel({ risk: t.risk, betCents: bet })); break; }
        case 'roulette': {
          const bets = E.validateRouletteBets(prm.bets);
          if (!bets) { out = { error: { error_code: 'BAD_REQUEST', message: 'Place at least one valid chip.' } }; break; }
          out = await oneShot(p, g, bets.reduce((a, x) => a + x.cents, 0), () => E.spinRoulette(bets));
          break;
        }
        case 'blackjack': out = await blackjack(p, g, String(b.action || 'deal'), prm); break;
        case 'coinflip': { const bet = toCents(prm.bet); const side = prm.side === 'tails' ? 'tails' : 'heads'; out = await oneShot(p, g, bet, () => E.flipCoin({ side, betCents: bet })); break; }
        case 'limbo': { const bet = toCents(prm.bet); out = await oneShot(p, g, bet, () => E.playLimbo({ target: prm.target, betCents: bet })); break; }
        case 'rocket': out = await rocket(p, g, String(b.action || 'status'), prm); break;
        case 'mines': out = await mines(p, g, String(b.action || 'start'), prm); break;
        default: out = { error: { error_code: 'GAME_NOT_FOUND', message: 'Unknown engine.' } };
      }
      res.json(out);
    } catch (e) {
      log.error('[studio]', e.message);
      res.status(e.http || 500).json({ error: { error_code: e.wallet?.error_code || 'INTERNAL_ERROR', message: e.wallet?.message || e.message } });
    }
  });
  return { router, wallet, sweep, pendingWins: () => retries.length };
}
