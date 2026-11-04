// Casino host: catalog, game launch, player history, admin. Wires the seamless
// wallet (provider-facing) and Kohler Studio (built-in provider) together.
import crypto from 'node:crypto';
import express from 'express';
import { createSeamlessWallet, fmt, sign } from './wallet.js';
import { createStudio } from './studio.js';
import { buildCatalog, STUDIO_ID } from './catalog.js';

export function createCasino({ q, withTx, move, seal, open, gamblingEnabled, audit, publicDir, walletUrl, log = console }) {
  const wallet = createSeamlessWallet({ q, withTx, move, open, gamblingEnabled, log });
  const studio = createStudio({ q, providerId: STUDIO_ID, secret: () => wallet.secretFor(STUDIO_ID), walletUrl, publicDir, local: wallet.local, log });
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

  // provider row + catalog upsert. Admin on/off choices are kept.
  async function setup() {
    const has = (await q('select secret_enc from casino_providers where id = $1', [STUDIO_ID])).rows[0];
    if (!has) await q('insert into casino_providers (id, name, secret_enc) values ($1, $2, $3)', [STUDIO_ID, 'Kohler Studio', seal(crypto.randomBytes(32).toString('hex'))]);
    else {
      // Kohler Studio is our own provider, so if its secret can't be decrypted (KEY_ENC changed)
      // it is simply replaced; nothing outside this server uses it
      let ok = false; try { ok = !!open(has.secret_enc); } catch { ok = false; }
      if (!ok) { await q('update casino_providers set secret_enc = $2, rotated_at = now() where id = $1', [STUDIO_ID, seal(crypto.randomBytes(32).toString('hex'))]); log.warn('[casino] Kohler Studio secret re-created'); }
    }
    for (const g of buildCatalog()) {
      await q(
        `insert into casino_games (id, provider_id, name, category, engine, theme, rtp, volatility, min_bet_cents, max_bet_cents, tags, sort)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (id) do update set name = excluded.name, category = excluded.category, engine = excluded.engine, theme = excluded.theme,
           rtp = excluded.rtp, volatility = excluded.volatility, min_bet_cents = excluded.min_bet_cents, max_bet_cents = excluded.max_bet_cents,
           tags = excluded.tags, sort = excluded.sort`,
        [g.id, STUDIO_ID, g.name, g.category, g.engine, g.theme, g.rtp, g.volatility, g.min, g.max, g.tags, g.sort]);
    }
  }

  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Sign in to play for real money.' }));
  const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    log.error('[casino]', e.message); res.status(e.http || 500).json({ error: e.http ? e.message : 'Something went wrong. Try again.' });
  });

  /* ── player-facing: /api/casino ── */
  const api = express.Router();
  api.get('/games', h(async (req, res) => {
    const on = await gamblingEnabled();
    const r = await q(
      `select g.id, g.name, g.category, g.engine, g.theme, g.rtp, g.volatility, g.min_bet_cents, g.max_bet_cents, g.tags, p.name as provider
         from casino_games g join casino_providers p on p.id = g.provider_id
        where g.active and p.active order by g.sort, g.name`);
    const recent = req.user ? (await q(
      `select game_id, max(created_at) at from casino_transactions where user_id = $1 and kind = 'bet' group by game_id order by at desc limit 12`,
      [req.user.id])).rows.map((x) => x.game_id) : [];
    res.json({
      open: on,
      games: r.rows.map((g) => ({ id: g.id, name: g.name, category: g.category, engine: g.engine, theme: g.theme, rtp: Number(g.rtp),
        volatility: g.volatility, min: Number(g.min_bet_cents), max: Number(g.max_bet_cents), tags: g.tags, provider: g.provider })),
      recent,
    });
  }));

  // Opening a game: issue a session token and the iframe URL. The token rides in
  // the URL fragment, so it never appears in server logs or Referer headers.
  api.post('/launch', h(async (req, res) => {
    const gameId = String(req.body.gameId || '');
    const g = (await q(
      `select g.*, p.launch_url, p.active as p_active from casino_games g join casino_providers p on p.id = g.provider_id where g.id = $1`, [gameId])).rows[0];
    if (!g || !g.active || !g.p_active) return res.status(404).json({ error: 'That game is not available.' });
    const demo = !!req.body.demo || !req.user;
    if (demo) {
      if (g.provider_id !== STUDIO_ID) return res.status(400).json({ error: 'Demo play is only available for Kohler Studio games.' });
      return res.json({ url: `/studio/play.html?g=${encodeURIComponent(g.id)}#demo=1`, demo: true });
    }
    if (!(await gamblingEnabled())) return res.status(403).json({ error: 'Real-money games are switched off right now. Try demo play.' });
    if (req.user.banned) return res.status(403).json({ error: 'Account suspended.' });
    const token = crypto.randomBytes(32).toString('base64url');
    await q(`insert into casino_sessions (token_hash, user_id, game_id, provider_id, expires_at) values ($1,$2,$3,$4, now() + interval '4 hours')`,
      [sha(token), req.user.id, g.id, g.provider_id]);
    if (g.provider_id === STUDIO_ID) return res.json({ url: `/studio/play.html?g=${encodeURIComponent(g.id)}#token=${token}`, demo: false });
    // External aggregator: ask it for a launch URL (contract documented in README §12)
    if (!g.launch_url) return res.status(503).json({ error: 'This provider has no launch URL configured.' });
    const secret = await wallet.secretFor(g.provider_id);
    const raw = JSON.stringify({ game_id: g.id, token, user_id: req.user.id, currency: 'USD', lobby_url: '/casino', mode: 'real' });
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await fetch(g.launch_url, { method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'x-casino-provider': g.provider_id, 'x-casino-timestamp': ts, 'x-casino-signature': sign(secret, ts, raw) }, body: raw });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) return res.status(502).json({ error: 'The game provider did not return a launch URL.' });
    res.json({ url: j.url, demo: false });
  }));

  api.get('/history', requireUser, h(async (req, res) => {
    const r = await q(
      `select t.kind, t.amount_cents, t.balance_after, t.round_id, t.transaction_id, t.status, t.created_at, g.name as game
         from casino_transactions t left join casino_games g on g.id = t.game_id
        where t.user_id = $1 and t.status <> 'tombstone' and not (t.kind = 'win' and t.amount_cents = 0) order by t.id desc limit 150`, [req.user.id]);
    res.json({ items: r.rows.map((x) => ({ ...x, amount: fmt(x.amount_cents), balance_after: fmt(x.balance_after) })) });
  }));

  /* ── admin: /api/admin/casino (full admins only) ── */
  const admin = express.Router();
  admin.get('/', h(async (_req, res) => {
    const [prov, games, ggr] = await Promise.all([
      q('select id, name, launch_url, active, created_at, rotated_at from casino_providers order by created_at'),
      q('select id, name, category, engine, rtp, active, provider_id from casino_games order by sort, name'),
      q(`select game_id,
            coalesce(sum(amount_cents) filter (where kind = 'bet' and status = 'ok'), 0)::bigint as bets,
            coalesce(sum(amount_cents) filter (where kind = 'win'), 0)::bigint as wins,
            count(*) filter (where kind = 'bet' and status = 'ok')::int as rounds,
            coalesce(sum(amount_cents) filter (where kind = 'bet' and status = 'ok' and created_at > now() - interval '24 hours'), 0)::bigint as bets_24h,
            coalesce(sum(amount_cents) filter (where kind = 'win' and created_at > now() - interval '24 hours'), 0)::bigint as wins_24h
           from casino_transactions where not is_test group by game_id`),
    ]);
    const by = Object.fromEntries(ggr.rows.map((r) => [r.game_id, r]));
    const tot = ggr.rows.reduce((a, r) => ({ bets: a.bets + Number(r.bets), wins: a.wins + Number(r.wins), b24: a.b24 + Number(r.bets_24h), w24: a.w24 + Number(r.wins_24h) }), { bets: 0, wins: 0, b24: 0, w24: 0 });
    res.json({
      providers: prov.rows,
      games: games.rows.map((g) => ({ ...g, rtp: Number(g.rtp), bets: Number(by[g.id]?.bets || 0), wins: Number(by[g.id]?.wins || 0), rounds: by[g.id]?.rounds || 0 })),
      totals: { ...tot, ggr: tot.bets - tot.wins, ggr24: tot.b24 - tot.w24 },
      pendingWins: studio.pendingWins(),
    });
  }));
  admin.patch('/games/:id', h(async (req, res) => {
    await q('update casino_games set active = $2 where id = $1', [req.params.id, !!req.body.active]);
    await audit(req, 'casino.game', { id: req.params.id, active: !!req.body.active });
    res.json({ ok: true });
  }));
  // a new aggregator: the secret is shown once, then only stored sealed
  admin.post('/providers', h(async (req, res) => {
    const id = String(req.body.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
    if (!id || id === STUDIO_ID) return res.status(400).json({ error: 'Pick a short id like "softswiss".' });
    const secret = String(req.body.secret || '') || crypto.randomBytes(32).toString('hex');
    if (secret.length < 24) return res.status(400).json({ error: 'Shared secrets must be at least 24 characters.' });
    await q('insert into casino_providers (id, name, secret_enc, launch_url) values ($1,$2,$3,$4)',
      [id, String(req.body.name || id).slice(0, 60), seal(secret), String(req.body.launch_url || '') || null]);
    await audit(req, 'casino.provider.create', { id });
    res.json({ id, secret });
  }));
  admin.post('/providers/:id/rotate', h(async (req, res) => {
    const secret = crypto.randomBytes(32).toString('hex');
    const r = await q('update casino_providers set secret_enc = $2, rotated_at = now() where id = $1 returning id', [req.params.id, seal(secret)]);
    if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
    wallet.forgetSecret(req.params.id);
    await audit(req, 'casino.provider.rotate', { id: req.params.id });
    res.json({ id: req.params.id, secret: req.params.id === STUDIO_ID ? '(used internally)' : secret });
  }));
  admin.patch('/providers/:id', h(async (req, res) => {
    await q('update casino_providers set active = $2 where id = $1', [req.params.id, !!req.body.active]);
    wallet.forgetSecret(req.params.id);
    await audit(req, 'casino.provider.active', { id: req.params.id, active: !!req.body.active });
    res.json({ ok: true });
  }));

  return { setup, api, admin, providerApi: wallet.router, studio: studio.router, wallet, sweep: () => studio.sweep() };
}
