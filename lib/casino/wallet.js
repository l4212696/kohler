// Seamless wallet: the API third-party game providers (aggregators such as
// SoftSwiss, Slotegrator, Hub88) call to move money during play. The balance
// never leaves Kohler; the game only asks us to debit (bet) and credit (win).
//
//   POST /api/casino/v1/user/authenticate   { token }
//   POST /api/casino/v1/user/balance        { token | user_id }
//   POST /api/casino/v1/game/bet            { user_id, game_id, round_id, transaction_id, amount, currency, token? }
//   POST /api/casino/v1/game/win            { user_id, game_id, round_id, transaction_id, amount, currency, token? }
//   POST /api/casino/v1/game/rollback       { user_id, game_id, round_id, transaction_id, reference_transaction_id }
//
// Every request is signed:
//   X-Casino-Provider:  provider id (casino_providers.id)
//   X-Casino-Timestamp: unix seconds (must be within 5 minutes)
//   X-Casino-Signature: hex HMAC-SHA256(secret, "<timestamp>.<raw request body>")
//
// Responses: HTTP 200 with { status: "OK", ... } or { status: "ERROR", error_code, message }.
// A bad signature is HTTP 401. Amounts are decimal strings in currency units ("12.50");
// internally everything is integer cents. Money moves only inside one database
// transaction that locks the player's row, and (provider, transaction_id) is
// unique, so retries can never pay or charge twice.
import crypto from 'node:crypto';
import express from 'express';

export const ERR = {
  INVALID_SIGNATURE: 'INVALID_SIGNATURE', INVALID_TOKEN: 'INVALID_TOKEN', SESSION_EXPIRED: 'SESSION_EXPIRED',
  USER_NOT_FOUND: 'USER_NOT_FOUND', USER_BLOCKED: 'USER_BLOCKED', INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION', TRANSACTION_ROLLED_BACK: 'TRANSACTION_ROLLED_BACK',
  ROUND_NOT_FOUND: 'ROUND_NOT_FOUND', GAME_NOT_FOUND: 'GAME_NOT_FOUND', GAME_DISABLED: 'GAME_DISABLED',
  BET_LIMIT: 'BET_LIMIT', CURRENCY_MISMATCH: 'CURRENCY_MISMATCH', ROLLBACK_NOT_SUPPORTED: 'ROLLBACK_NOT_SUPPORTED',
  BAD_REQUEST: 'BAD_REQUEST', INTERNAL_ERROR: 'INTERNAL_ERROR',
};
class CasinoError extends Error { constructor(code, message, extra = {}) { super(message || code); this.code = code; this.extra = extra; } }
const fail = (code, message, extra) => { throw new CasinoError(code, message, extra); };

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const sign = (secret, ts, raw) => crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
export const fmt = (c) => { c = Number(c); const s = c < 0 ? '-' : ''; c = Math.abs(c); return `${s}${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`; };
// "12.5" / "12.50" / 12.5 → 1250 cents, without floating point. null if malformed.
export function toCents(v) {
  const s = typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(2) : '') : String(v ?? '').trim();
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0'));
}
const ID = /^[\w.:\-]{1,128}$/;

export function createSeamlessWallet({ q, withTx, move, open, gamblingEnabled, log = console, windowSec = 300 }) {
  /* ── provider secrets (cached for a minute) ── */
  const secrets = new Map();
  async function secretFor(providerId) {
    const hit = secrets.get(providerId);
    if (hit && hit.at > Date.now() - 60_000) return hit.secret;
    const r = (await q('select secret_enc from casino_providers where id = $1 and active', [providerId])).rows[0];
    const secret = r ? open(r.secret_enc) : null;
    secrets.set(providerId, { secret, at: Date.now() });
    return secret;
  }
  const forgetSecret = (id) => secrets.delete(id);

  /* ── signature middleware ── */
  async function verifySignature(req, res, next) {
    try {
      const provider = String(req.get('x-casino-provider') || '');
      const ts = String(req.get('x-casino-timestamp') || '');
      const got = String(req.get('x-casino-signature') || '').replace(/^sha256=/, '').toLowerCase();
      const bad = (message) => res.status(401).json({ status: 'ERROR', error_code: ERR.INVALID_SIGNATURE, message });
      if (!provider || !/^\d{9,11}$/.test(ts) || !/^[0-9a-f]{64}$/.test(got)) return bad('Missing or malformed signature headers.');
      if (Math.abs(Date.now() / 1000 - Number(ts)) > windowSec) return bad('Timestamp outside the allowed window.');
      const secret = await secretFor(provider);
      if (!secret) return bad('Unknown or inactive provider.');
      const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
      const want = Buffer.from(sign(secret, ts, raw), 'hex');
      if (!crypto.timingSafeEqual(want, Buffer.from(got, 'hex'))) return bad('Signature does not match.');
      req.provider = provider;
      next();
    } catch (e) {
      log.error('[casino] signature', e.message);
      res.status(500).json({ status: 'ERROR', error_code: ERR.INTERNAL_ERROR, message: 'internal error' });
    }
  }

  /* ── sessions ── */
  async function sessionFor(token, c) {
    const run = c ? (t, p) => c.query(t, p) : q;
    if (typeof token !== 'string' || token.length < 20) fail(ERR.INVALID_TOKEN, 'Session token missing or malformed.');
    const s = (await run(
      `select s.*, u.username, u.balance_cents, u.banned, u.test_mode from casino_sessions s join users u on u.id = s.user_id
        where s.token_hash = $1`, [sha(token)])).rows[0];
    if (!s) fail(ERR.INVALID_TOKEN, 'Unknown session token.');
    if (new Date(s.expires_at) < new Date()) fail(ERR.SESSION_EXPIRED, 'Session expired. Reopen the game.');
    return s;
  }

  async function authenticate(provider, body) {
    const s = await sessionFor(body.token);
    if (s.provider_id !== provider) fail(ERR.INVALID_TOKEN, 'Token was issued to another provider.');
    if (s.banned) fail(ERR.USER_BLOCKED, 'Player account is suspended.');
    // sliding expiry: an active game keeps its session alive for 4 more hours
    await q(`update casino_sessions set last_seen = now(), expires_at = greatest(expires_at, now() + interval '4 hours') where token_hash = $1`, [sha(body.token)]);
    return { user_id: s.user_id, username: s.username, balance: fmt(s.balance_cents), currency: s.currency, game_id: s.game_id, test: !!s.test_mode };
  }

  async function balance(provider, body) {
    let userId = body.user_id;
    if (body.token) { const s = await sessionFor(body.token); if (s.provider_id !== provider) fail(ERR.INVALID_TOKEN); userId = s.user_id; }
    if (!ID.test(String(userId || ''))) fail(ERR.BAD_REQUEST, 'user_id required.');
    const u = (await q('select balance_cents from users where id::text = $1', [userId])).rows[0];
    if (!u) fail(ERR.USER_NOT_FOUND, 'No such player.');
    return { user_id: userId, balance: fmt(u.balance_cents), currency: 'USD' };
  }

  function parseMove(body, kind) {
    for (const k of ['user_id', 'game_id', 'round_id', 'transaction_id'])
      if (!ID.test(String(body[k] ?? ''))) fail(ERR.BAD_REQUEST, `${k} is required (1-128 chars: letters, digits, _ . : -).`);
    const cents = toCents(body.amount);
    if (cents === null) fail(ERR.BAD_REQUEST, 'amount must be a decimal like "1.50".');
    if (kind === 'bet' && cents <= 0) fail(ERR.BAD_REQUEST, 'Bet amount must be above zero.');
    if (body.currency && String(body.currency).toUpperCase() !== 'USD') fail(ERR.CURRENCY_MISMATCH, 'This wallet is in USD.');
    return { userId: String(body.user_id), gameId: String(body.game_id), roundId: String(body.round_id), txId: String(body.transaction_id), cents };
  }

  // the core: one transaction, player row locked, idempotent on (provider, transaction_id)
  async function moveMoney(provider, body, kind) {
    const m = parseMove(body, kind);
    const reqHash = sha([kind, m.userId, m.gameId, m.roundId, m.cents].join('|'));
    const game = (await q('select * from casino_games where id = $1 and provider_id = $2', [m.gameId, provider])).rows[0];
    if (!game) fail(ERR.GAME_NOT_FOUND, 'This provider has no game with that id.');
    if (body.token) {
      const s = await sessionFor(body.token);
      if (s.user_id !== m.userId || s.provider_id !== provider) fail(ERR.INVALID_TOKEN, 'Token does not belong to this player.');
    }
    const allowed = kind === 'bet' ? await gamblingEnabled() : true;

    try {
      return await withTx(async (c) => {
        const u = (await c.query(
          'select id, balance_cents, banned, test_mode, pool_cooloff_until from users where id::text = $1 for update', [m.userId])).rows[0];
        if (!u) fail(ERR.USER_NOT_FOUND, 'No such player.');

        const prior = (await c.query('select * from casino_transactions where provider_id = $1 and transaction_id = $2', [provider, m.txId])).rows[0];
        if (prior) {
          if (prior.request_hash === reqHash && prior.kind === kind)
            return { user_id: m.userId, transaction_id: m.txId, round_id: m.roundId, balance: fmt(u.balance_cents), currency: 'USD', duplicate: true };
          fail(ERR.DUPLICATE_TRANSACTION, 'This transaction_id was already used for a different request.');
        }

        if (kind === 'bet') {
          const tomb = (await c.query(
            `select 1 from casino_transactions where provider_id = $1 and ref_transaction_id = $2 and kind = 'rollback'`, [provider, m.txId])).rows[0];
          if (tomb) fail(ERR.TRANSACTION_ROLLED_BACK, 'This bet was rolled back before it arrived.');
          if (!allowed || !game.active) fail(ERR.GAME_DISABLED, 'This game is not available right now.');
          if (u.banned) fail(ERR.USER_BLOCKED, 'Player account is suspended.');
          if (u.pool_cooloff_until && new Date(u.pool_cooloff_until) > new Date()) fail(ERR.USER_BLOCKED, 'Player is on a self-imposed cool-off.');
          if (m.cents < Number(game.min_bet_cents) || m.cents > Number(game.max_bet_cents))
            fail(ERR.BET_LIMIT, `Bet must be between ${fmt(game.min_bet_cents)} and ${fmt(game.max_bet_cents)}.`);
          if (Number(u.balance_cents) < m.cents) fail(ERR.INSUFFICIENT_FUNDS, 'Not enough balance.', { balance: fmt(u.balance_cents) });
          await move(c, u.id, -m.cents, 'casino_bet', m.txId, { provider, game: m.gameId, round: m.roundId, test: u.test_mode || undefined });
        } else {
          const bet = (await c.query(
            `select 1 from casino_transactions where provider_id = $1 and round_id = $2 and user_id = $3 and kind = 'bet' and status = 'ok' limit 1`,
            [provider, m.roundId, u.id])).rows[0];
          if (!bet) fail(ERR.ROUND_NOT_FOUND, 'No open bet for this player in that round.');
          if (m.cents > 0) await move(c, u.id, m.cents, 'casino_win', m.txId, { provider, game: m.gameId, round: m.roundId, test: u.test_mode || undefined });
        }
        const bal = Number((await c.query('select balance_cents from users where id = $1', [u.id])).rows[0].balance_cents);
        await c.query(
          `insert into casino_transactions (provider_id, transaction_id, kind, user_id, game_id, round_id, amount_cents, balance_after, request_hash, is_test)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [provider, m.txId, kind, u.id, m.gameId, m.roundId, m.cents, bal, reqHash, !!u.test_mode]);
        return { user_id: m.userId, transaction_id: m.txId, round_id: m.roundId, balance: fmt(bal), currency: 'USD' };
      });
    } catch (e) {
      // two different players racing on the same transaction_id: the unique key wins
      if (e.code === '23505') fail(ERR.DUPLICATE_TRANSACTION, 'This transaction_id was already used.');
      throw e;
    }
  }

  async function rollback(provider, body) {
    for (const k of ['user_id', 'transaction_id', 'reference_transaction_id'])
      if (!ID.test(String(body[k] ?? ''))) fail(ERR.BAD_REQUEST, `${k} is required.`);
    const userId = String(body.user_id), txId = String(body.transaction_id), ref = String(body.reference_transaction_id);
    const reqHash = sha(['rollback', userId, ref].join('|'));
    return withTx(async (c) => {
      const u = (await c.query('select id, balance_cents, test_mode from users where id::text = $1 for update', [userId])).rows[0];
      if (!u) fail(ERR.USER_NOT_FOUND, 'No such player.');
      const prior = (await c.query('select * from casino_transactions where provider_id = $1 and transaction_id = $2', [provider, txId])).rows[0];
      if (prior) {
        if (prior.request_hash === reqHash) return { user_id: userId, transaction_id: txId, balance: fmt(u.balance_cents), currency: 'USD', duplicate: true };
        fail(ERR.DUPLICATE_TRANSACTION, 'This transaction_id was already used for a different request.');
      }
      const orig = (await c.query('select * from casino_transactions where provider_id = $1 and transaction_id = $2 for update', [provider, ref])).rows[0];
      let refunded = 0, status = 'ok';
      if (!orig) status = 'tombstone';             // rollback arrived first: block the bet if it ever shows up
      else {
        if (orig.user_id !== u.id) fail(ERR.BAD_REQUEST, 'Referenced transaction belongs to another player.');
        if (orig.kind !== 'bet') fail(ERR.ROLLBACK_NOT_SUPPORTED, 'Only bets can be rolled back.');
        if (orig.status === 'ok') {
          refunded = Number(orig.amount_cents);
          await move(c, u.id, refunded, 'casino_rollback', txId, { provider, ref, round: orig.round_id, test: u.test_mode || undefined });
          await c.query(`update casino_transactions set status = 'rolled_back' where id = $1`, [orig.id]);
        }
      }
      const bal = Number((await c.query('select balance_cents from users where id = $1', [u.id])).rows[0].balance_cents);
      await c.query(
        `insert into casino_transactions (provider_id, transaction_id, kind, user_id, game_id, round_id, amount_cents, balance_after, ref_transaction_id, request_hash, status, is_test)
         values ($1,$2,'rollback',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [provider, txId, u.id, String(body.game_id || orig?.game_id || ''), String(body.round_id || orig?.round_id || ''), refunded, bal, ref, reqHash, status, !!u.test_mode]);
      return { user_id: userId, transaction_id: txId, balance: fmt(bal), currency: 'USD', refunded: fmt(refunded) };
    });
  }

  /* ── HTTP: provider-facing ── */
  const handle = (fn) => async (req, res) => {
    try {
      res.json({ status: 'OK', ...(await fn(req.provider, req.body || {})) });
    } catch (e) {
      if (e instanceof CasinoError) return res.json({ status: 'ERROR', error_code: e.code, message: e.message, ...e.extra });
      log.error('[casino] internal', e.message);
      res.json({ status: 'ERROR', error_code: ERR.INTERNAL_ERROR, message: 'Internal error. Retry with the same transaction_id.' });
    }
  };
  const router = express.Router();
  router.use(verifySignature);
  router.post('/user/authenticate', handle(authenticate));
  router.post('/user/balance', handle(balance));
  router.post('/game/bet', handle((p, b) => moveMoney(p, b, 'bet')));
  router.post('/game/win', handle((p, b) => moveMoney(p, b, 'win')));
  router.post('/game/rollback', handle(rollback));
  router.use((req, res) => res.status(404).json({ status: 'ERROR', error_code: ERR.BAD_REQUEST, message: 'Unknown endpoint.' }));

  return { router, verifySignature, authenticate, moveMoney, rollback, secretFor, forgetSecret, sha };
}
