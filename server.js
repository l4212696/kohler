import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { makePool } from './lib/db.js'
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import * as house from './lib/house.js';
import * as chain from './lib/chain.js';
import { createPoolPot } from './lib/pool.js';
import { createAutopilot } from './lib/autopilot.js';
import { createCasino } from './lib/casino/index.js';
import { migrate, ensureTestAccount } from './lib/boot.js';
import { createVault } from './lib/vault.js';
import { createAvatars } from './lib/avatars/index.js';
import { createLimiter, securityHeaders, sameOrigin, newTotpSecret, checkTotp, otpauthUrl } from './lib/security.js';
import QRCode from 'qrcode';
import { createPayouts } from './lib/payouts.js';
import fs from 'node:fs/promises';
import { appendFileSync, existsSync } from 'node:fs';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Express 4 doesn't catch async throws and Node 24 exits on the rejection.
function asyncSafe(router) {
  for (const m of ['get', 'post', 'patch', 'put', 'delete']) {
    const orig = router[m].bind(router);
    router[m] = (p, ...hs) => orig(p, ...hs.map((h) => typeof h === 'function'
      ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next) : h));
  }
  return router;
}
asyncSafe(app);
const pool = makePool();

const q = (t, p) => pool.query(t, p);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const cents = (n) => Math.round(Number(n) || 0);
const feeBps = () => Math.max(0, Math.round(Number(process.env.PLATFORM_FEE_BPS || 100)));
const feeFor = (amount) => Math.ceil(Math.max(0, Number(amount)) * feeBps() / 10000);
const usd = (c) => `$${(c / 100).toFixed(2)}`;
let gamblingCache = { at: 0, v: false };
async function gamblingEnabled() {
  if (Date.now() - gamblingCache.at < 5000) return gamblingCache.v;
  const r = await q("select value from site_settings where key = 'gambling_enabled'");
  gamblingCache = { at: Date.now(), v: r.rows[0]?.value === 'true' };
  return gamblingCache.v;
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ crypto at rest Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

// KEY_ENC encrypts secrets at rest (wallet keys, provider secrets). AES-256 needs exactly
// 32 bytes = 64 hex characters. A wrong-length key used to stop the whole site from booting
// ("Invalid key length"); now a short or malformed key is stretched to 32 bytes with SHA-256,
// which is safe because nothing could ever have been encrypted with the invalid key.
const KEY = (() => {
  const raw = String(process.env.KEY_ENC || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (raw) {
    console.warn(`[kohler] KEY_ENC is ${raw.length} characters, not 64 hex characters. Using a 32-byte key derived from it, so keep this KEY_ENC unchanged.`);
    return crypto.createHash('sha256').update(raw).digest();
  }
  // Serverless hosts (Vercel) can't write files and run many copies at once, so a random key
  // would differ between copies. Derive one from the database URL instead: stable everywhere.
  if (process.env.VERCEL) {
    console.warn('[kohler] KEY_ENC is not set. Using a key derived from DATABASE_URL. Add KEY_ENC (64 hex characters) to your environment variables.');
    return crypto.createHash('sha256').update('kohler-key:' + (process.env.DATABASE_URL || '')).digest();
  }
  const fresh = crypto.randomBytes(32).toString('hex');
  try {
    appendFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'), `\nKEY_ENC=${fresh}\n`);
    console.warn('[kohler] KEY_ENC was missing, so a new one was generated and saved to .env. Back up your .env file.');
    return Buffer.from(fresh, 'hex');
  } catch {
    console.warn('[kohler] KEY_ENC is missing and .env could not be written. Using a key derived from DATABASE_URL; set KEY_ENC (64 hex characters).');
    return crypto.createHash('sha256').update('kohler-key:' + (process.env.DATABASE_URL || '')).digest();
  }
})();

function seal(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function open(sealed) {
  if (!sealed) return null;
  const [i, t, d] = sealed.split(':');
  const dc = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(i, 'base64'));
  dc.setAuthTag(Buffer.from(t, 'base64'));
  return Buffer.concat([dc.update(Buffer.from(d, 'base64')), dc.final()]).toString('utf8');
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ middleware Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

app.set('trust proxy', 1);
// keep the exact bytes for game-provider calls: their HMAC signature covers the raw body
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { if (req.url.startsWith('/api/casino/v1')) req.rawBody = Buffer.from(buf); } }));
app.use(cookieParser());
app.use(securityHeaders);
// anything that changes data must come from Kohler's own pages (game providers sign their calls instead)
app.use('/api', sameOrigin({ exempt: ['/api/casino/v1', '/api/cron/'] }));
// Pool Pot became Survivor, which lives inside the casino; PoolWars was replaced by Kohler originals
app.get(['/pool', '/pool.html', '/survivor', '/studio/poolwars'], (req, res) => res.redirect(302, '/casino#/survivor'));
// pages revalidate every time (fast 304s); icons, fonts and images are cached for a day
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, file) => res.setHeader('cache-control', /\.(svg|png|jpg|jpeg|webp|woff2?)$/.test(file) ? 'public, max-age=86400' : 'no-cache'),
}));

// until migrations have run, API calls get a clear "starting" answer instead of SQL errors
// On serverless hosts every cold start boots, so a request waits (up to 9s) for startup instead of
// failing, and if startup can't finish the answer says exactly why.
let booted = false, bootError = null, bootPromise = null;
const ensureBooted = () => (booted ? Promise.resolve() : (bootPromise ||= bootSequence().finally(() => { bootPromise = null; })));
app.use('/api', async (req, res, next) => {
  if (booted || req.path === '/health') return next();
  await Promise.race([ensureBooted(), new Promise((r) => setTimeout(r, 9000))]);
  if (booted) return next();
  res.status(503).json({ error: bootError ? `Kohler can't start: ${bootError}` : 'Kohler is starting up. Try again in a few seconds.', reason: bootError });
});

// Keep Neon awake while people are using the site (no cold-start lag on clicks),
// and let it sleep 15 minutes after the last visitor. DB_KEEPWARM=false turns this off.
let lastHit = 0;
app.use('/api', (_req, _res, next) => { lastHit = Date.now(); next(); });
// on Vercel, visitors' requests lend the avatar painter their spare time (see lib/avatars nudge)
app.use('/api', (req, _res, next) => { if (booted && req.method === 'GET' && process.env.VERCEL) avatars.nudge().catch(() => {}); next(); });
if (process.env.DB_KEEPWARM !== 'false') setInterval(() => { if (Date.now() - lastHit < 15 * 60_000) pool.query('select 1').catch(() => {}); }, 4 * 60_000).unref();

// tiny read cache for public lists that every visitor loads
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}
const bust = (prefix) => { for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k); };
app.use('/api/admin', (req, _res, next) => { if (req.method !== 'GET') bust('groups'); next(); });

// rate limits live in Postgres so they hold across every serverless instance (lib/security.js)
const limiter = createLimiter(q);
const limit = limiter.limit;

async function userFromReq(req) {
  const token = req.cookies?.kohler;
  if (!token) return null;
  const r = await q(
    `select u.*, s.mfa_at as session_mfa_at from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`, [sha(token)]
  );
  return r.rows[0] || null;
}

app.use(async (req, res, next) => {
  req.user = await userFromReq(req);
  // a suspended account can still look, but can't move money or change anything
  if (req.user?.banned && !['GET', 'HEAD'].includes(req.method) && req.path.startsWith('/api/') && req.path !== '/api/auth/logout')
    return res.status(403).json({ error: 'Account suspended.' });
  next();
});

const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'sign in' }));
const requireAdmin = (req, res, next) =>
  req.user?.is_admin ? next() : res.status(403).json({ error: 'admin only' });
const requireGod = (req, res, next) =>
  req.user?.is_admin && req.user?.admin_role === 'god'
    ? next() : res.status(403).json({ error: 'god admin only' });
const requireGambling = (req, res, next) =>
  gamblingEnabled().then((enabled) => enabled ? next() : res.status(404).json({ error: 'not available' })).catch(next);

const pub = (u) => u && {
  id: u.id, email: u.email, username: u.username, balance: Number(u.balance_cents),
  xp: u.xp, streak: u.streak, isAdmin: u.is_admin, adminRole: u.admin_role, testMode: !!u.test_mode,
  equip: u.equip || {}, passUntil: u.pass_until && new Date(u.pass_until) > new Date() ? u.pass_until : null,
};
const hasPass = (u) => !!u?.pass_until && new Date(u.pass_until) > new Date();

async function issueSession(res, userId) {
  const token = chain.randomHex(32);
  await q("insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')",
    [sha(token), userId]);
  res.cookie('kohler', token, {
    httpOnly: true, sameSite: 'lax', maxAge: 30 * 864e5, path: '/',
    // https-only whenever the site is on https (always on Vercel); COOKIE_SECURE=false only for local http
    secure: process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && (!!process.env.VERCEL || !!res.req?.secure)),
  });
  return token;
}
// compared against when the account doesn't exist, so both cases take the same time
const DUMMY_HASH = bcrypt.hashSync('kohler-no-such-account', 10);
const adminNeeds2fa = (u) => !!u?.is_admin && process.env.ADMIN_2FA !== 'off';

async function audit(req, action, detail = {}) {
  await q('insert into admin_audit (user_id, action, detail) values ($1,$2,$3)',
    [req.user?.id || null, action, detail]);
}

// Email through Resend. The last failure is kept so Admin → Switches & health can show it.
const mailState = { lastError: null, lastErrorAt: null, lastOkAt: null };
const mailFrom = () => String(process.env.MAIL_FROM || '').trim();
const mailIsSandbox = () => /@resend\.dev\b/i.test(mailFrom());
function explainResend(status, body) {
  const m = String(body?.message || body?.error || body || '');
  if (status === 401 || /api key is invalid|invalid api key/i.test(m)) return 'Resend refused the API key. Create a new one at resend.com/api-keys and update RESEND_API_KEY.';
  if (/only send testing emails to your own email/i.test(m) || (status === 403 && mailIsSandbox()))
    return `MAIL_FROM uses Resend's test address (${mailFrom()}), which can only email the address you signed up to Resend with. Verify your own domain at resend.com/domains, then set MAIL_FROM to something like "Kohler <hello@yourdomain.com>".`;
  if (/domain is not verified|not verified/i.test(m)) return `The domain in MAIL_FROM (${mailFrom()}) isn't verified in Resend yet. Add the DNS records shown at resend.com/domains and wait until it says Verified.`;
  if (/invalid `from` field|from.*invalid/i.test(m)) return `MAIL_FROM isn't a valid sender. Use "Kohler <hello@yourdomain.com>" or just hello@yourdomain.com (no extra quotes).`;
  if (status === 422 && /to/i.test(m)) return `Resend says the recipient address is invalid (${m}).`;
  if (status === 429) return 'Resend rate limit reached. Emails resume in a moment.';
  return `Resend ${status}: ${m.slice(0, 240)}`;
}
async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !mailFrom()) {
    console.warn('[email] skipped: RESEND_API_KEY and MAIL_FROM are required');
    return false;
  }
  let r;
  try {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + String(process.env.RESEND_API_KEY).trim(), 'content-type': 'application/json' },
      body: JSON.stringify({ from: mailFrom(), to, subject, html, ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    mailState.lastError = `Couldn't reach Resend (${e.cause?.code || e.name}).`; mailState.lastErrorAt = new Date();
    throw new Error(mailState.lastError);
  }
  if (!r.ok) {
    const txt = await r.text(); let body = txt; try { body = JSON.parse(txt); } catch {}
    mailState.lastError = explainResend(r.status, body); mailState.lastErrorAt = new Date();
    throw new Error(mailState.lastError);
  }
  mailState.lastOkAt = new Date();
  return true;
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ ledger Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

async function move(client, userId, delta, kind, ref = null, meta = {}) {
  await client.query('update users set balance_cents = balance_cents + $2 where id = $1', [userId, delta]);
  await client.query('insert into ledger (user_id, delta_cents, kind, ref, meta) values ($1,$2,$3,$4,$5)',
    [userId, delta, kind, ref, meta]);
}

async function withTx(fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

async function houseCfg() {
  const r = await q('select * from house_state where id = 1');
  return { row: r.rows[0], cfg: house.normalizeConfig(r.rows[0]) };
}

// Bankroll is sats, converted to USD cents at spot on every request. A BTC
// drawdown shrinks the book automatically, which is exactly what we want.
async function bankroll() {
  const { row, cfg } = await houseCfg();
  const price = await chain.btcPriceUsd();
  return { row, cfg, price, cents: chain.satsToUsdCents(Number(row.balance_sats), price) };
}

async function houseMove(deltaSats, kind, ref = null) {
  const d = Math.round(deltaSats);
  await q('update house_state set balance_sats = greatest(0, balance_sats + $1), updated_at = now() where id = 1', [d]);
  await q('insert into house_ledger (delta_sats, kind, ref) values ($1,$2,$3)', [d, kind, ref]);
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ auth Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

app.post('/api/auth/register', async (req, res) => {
  if (!(await limit(`reg:${req.ip}`, 8, 60_000))) return res.status(429).json({ error: 'slow down' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad email' });
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'username 3-24, alphanumeric' });
  if (password.length < 8) return res.status(400).json({ error: 'password min 8' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await q(
      'insert into users (email, username, password_hash) values ($1,$2,$3) returning *',
      [email, username, hash]
    );
    await issueSession(res, r.rows[0].id);
    res.json({ user: pub(r.rows[0]) });
  } catch (e) {
    res.status(409).json({ error: /username/.test(e.detail || '') ? 'username taken' : 'email taken' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!(await limit(`login:${req.ip}`, 20, 60_000))) return res.status(429).json({ error: 'slow down' });
  const who = String(req.body.who || '').trim();
  const password = String(req.body.password || '');
  if (!who || !password) return res.status(400).json({ error: 'Enter your email or username and your password.' });
  let r;
  try {
    r = await q('select * from users where lower(email) = lower($1) or lower(username::text) = lower($1)', [who]);
  } catch (e) {
    console.error('[login] database error:', e.code || e.message);
    return res.status(503).json({ error: 'The database is unreachable right now. Run `npm run fix` on the server to see why.' });
  }
  const u = r.rows[0];
  const WRONG = 'Wrong email, username or password.';
  if (!u) { await bcrypt.compare(password, DUMMY_HASH); return res.status(401).json({ error: WRONG }); }
  // 10 wrong passwords in 15 minutes locks the account's password sign-in for the rest of the window
  if ((await limiter.count(`loginfail:${u.id}`)) >= 10)
    return res.status(429).json({ error: 'Too many wrong passwords for this account. Try again in 15 minutes, or use "Email me a link".' });
  if (!u.password_hash) return res.status(401).json({ error: 'This account has no password yet. Use "Email me a link".' });
  if (!(await bcrypt.compare(password, u.password_hash))) {
    await limiter.hit(`loginfail:${u.id}`, 15 * 60_000);
    return res.status(401).json({ error: WRONG });
  }
  if (u.banned) return res.status(403).json({ error: 'account suspended' });
  limiter.clear(`loginfail:${u.id}`);
  await issueSession(res, u.id);
  res.json({ user: pub(u), needs2fa: adminNeeds2fa(u) ? (u.totp_enabled ? 'verify' : 'setup') : null });
});

app.post('/api/auth/logout', async (req, res) => {
  const t = req.cookies?.kohler;
  if (t) await q('delete from sessions where token_hash = $1', [sha(t)]);
  res.clearCookie('kohler').json({ ok: true });
});

app.post('/api/auth/magic', async (req, res) => {
  if (!(await limit(`magic:${req.ip}`, 6, 60_000))) return res.status(429).json({ error: 'slow down' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const r = await q('select id from users where lower(email) = $1', [email]);
  if (!r.rows[0]) return res.json({ ok: true });
  const token = chain.randomHex(32);
  await q("insert into magic_links (token_hash, user_id, expires_at) values ($1,$2, now() + interval '20 minutes')",
    [sha(token), r.rows[0].id]);
  const link = `${process.env.PUBLIC_URL}/api/auth/magic/${token}`;
  if (process.env.RESEND_API_KEY) {
    await sendEmail({
      to: email, subject: 'Your Kohler sign-in link',
      html: `<p><a href="${link}">Sign in</a> - expires in 20 minutes.</p>`,
    }).catch((e) => console.error('[email] magic link failed', e.message));
  } else console.log('\n[magic] sign-in link for', email, '->', link, '\n');
  res.json({ ok: true, emailed: !!process.env.RESEND_API_KEY });
});

app.get('/api/auth/magic/:token', async (req, res) => {
  const r = await q(
    `update magic_links set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now() returning user_id`, [sha(req.params.token)]
  );
  if (!r.rows[0]) return res.redirect('/#/login?magic=expired');
  await issueSession(res, r.rows[0].user_id);
  res.redirect('/#/wallet');
});

app.post('/api/auth/password', requireUser, async (req, res) => {
  const current = req.body?.current, next = String(req.body?.next || '');
  if (next.length < 8 || next.length > 200) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
  if (!(await limit(`pw:${req.user.id}`, 10, 15 * 60_000))) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (req.user.password_hash && !(await bcrypt.compare(String(current || ''), req.user.password_hash)))
    return res.status(401).json({ error: 'wrong current password' });
  await q('update users set password_hash = $2, password_changed_at = now() where id = $1', [req.user.id, await bcrypt.hash(next, 10)]);
  await q('delete from sessions where user_id = $1 and token_hash <> $2', [req.user.id, sha(req.cookies.kohler)]);
  res.json({ ok: true });
});

app.post('/api/auth/username', requireUser, async (req, res) => {
  const username = String(req.body.username || '').trim();
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'invalid username' });
  try {
    await q('update users set username = $2 where id = $1', [req.user.id, username]);
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'taken' }); }
});

app.get('/api/me', (req, res) => res.json({ user: pub(req.user) }));

/* ── two-factor sign-in (TOTP) — required for every admin unless ADMIN_2FA=off ── */
const sessionHash = (req) => sha(String(req.cookies?.kohler || ''));
const MFA_HOURS = 12;   // an admin re-enters a code every 12 hours, even on the same device
const mfaFresh = (u) => !!u?.session_mfa_at && Date.now() - new Date(u.session_mfa_at).getTime() < MFA_HOURS * 3600e3;
app.get('/api/auth/2fa', requireUser, (req, res) => res.json({
  required: adminNeeds2fa(req.user), enabled: !!req.user.totp_enabled, verified: mfaFresh(req.user),
}));
app.post('/api/auth/2fa/setup', requireUser, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Two-factor sign-in is for admin accounts.' });
  if (req.user.totp_enabled) return res.status(409).json({ error: 'Two-factor sign-in is already on.' });
  if (!(await limit(`2fa:${req.user.id}`, 10, 15 * 60_000))) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  // a stolen session alone can't enrol the thief's phone: the password is needed too
  if (!req.user.password_hash || !(await bcrypt.compare(String(req.body?.password || ''), req.user.password_hash)))
    return res.status(401).json({ error: 'Enter your password to set this up.' });
  const secret = newTotpSecret();
  await q('update users set totp_pending_enc = $2 where id = $1', [req.user.id, seal(secret)]);
  const url = otpauthUrl(secret, req.user.email || req.user.username);
  res.json({ secret, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
});
app.post('/api/auth/2fa/enable', requireUser, async (req, res) => {
  if (!req.user.is_admin || req.user.totp_enabled) return res.status(400).json({ error: 'Nothing to turn on.' });
  if (!(await limit(`2fa:${req.user.id}`, 10, 15 * 60_000))) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const pending = req.user.totp_pending_enc ? open(req.user.totp_pending_enc) : null;
  const step = checkTotp(pending, req.body?.code);
  if (step === null) return res.status(400).json({ error: 'That code didn\'t match. Check the time on your phone and try the newest code.' });
  await q(`update users set totp_secret_enc = totp_pending_enc, totp_pending_enc = null, totp_enabled = true, totp_last_step = $2 where id = $1`, [req.user.id, step]);
  await q('update sessions set mfa_at = now() where token_hash = $1', [sessionHash(req)]);
  await audit(req, '2fa.enabled');
  res.json({ ok: true });
});
app.post('/api/auth/2fa/verify', requireUser, async (req, res) => {
  if (!req.user.totp_enabled) return res.status(400).json({ error: 'Two-factor sign-in isn\'t on for this account.' });
  if (!(await limit(`2fa:${req.user.id}`, 6, 5 * 60_000))) return res.status(429).json({ error: 'Too many wrong codes. Wait 5 minutes.' });
  const step = checkTotp(open(req.user.totp_secret_enc), req.body?.code);
  // a code works once: the same 30-second code can't be replayed
  if (step === null || step <= Number(req.user.totp_last_step || 0)) return res.status(400).json({ error: 'That code didn\'t work. Wait for the next one and try again.' });
  await q('update users set totp_last_step = $2 where id = $1', [req.user.id, step]);
  await q('update sessions set mfa_at = now() where token_hash = $1', [sessionHash(req)]);
  limiter.clear(`2fa:${req.user.id}`);
  res.json({ ok: true });
});
app.get('/api/storefront', async (_req, res) => {
  const gambling = await gamblingEnabled();
  const pool = await q("select value from site_settings where key = 'pool_enabled'").catch(() => ({ rows: [] }));
  res.json({ gamblingEnabled: gambling, poolEnabled: gambling && pool.rows[0]?.value === 'true', feeBps: feeBps() });
});

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ shop Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

const groupCard = `
  select g.id, g.slug, g.name, g.logo_url, g.country, g.category, g.tags, g.is_gambling,
         min(p.price_cents) filter (where p.active) as from_cents,
         count(p.id) filter (where p.active) as option_count
    from product_groups g
    left join products p on p.group_id = g.id
   where g.active
   group by g.id`;

app.get('/api/groups', async (_req, res) => {
  const r = await cached('groups', 15_000, () => q(`${groupCard} order by g.sort, g.created_at desc limit 200`));
  const enabled = await gamblingEnabled();
  res.json({ groups: r.rows.filter((g) => enabled || !g.is_gambling) });
});

app.get('/api/groups/:slug', async (req, res) => {
  const r = await q(`${groupCard.replace('where g.active', 'where g.active and g.slug = $1')}`, [req.params.slug]);
  if (!r.rows[0] || (r.rows[0].is_gambling && !(await gamblingEnabled()))) return res.status(404).json({ error: 'not found' });
  const opts = await q(
    'select id, name, price_cents, stock from products where group_id = $1 and active order by sort, price_cents',
    [r.rows[0].id]
  );
  const desc = await q('select description from product_groups where id = $1', [r.rows[0].id]);
  res.json({ group: { ...r.rows[0], description: desc.rows[0].description }, options: opts.rows });
});

app.post('/api/orders', requireUser, async (req, res) => {
  if (req.user.banned) return res.status(403).json({ error: 'suspended' });
  const productId = String(req.body.productId || '');
  // how to reach the buyer about this order: what they typed at checkout, else their account email
  const contact = String(req.body.contact || req.user.email || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
  const note = String(req.body.note || '').trim().slice(0, 300);
  if (contact.length < 5) return res.status(400).json({ error: 'Add an email or phone number so we can reach you about this order.' });
  const gambling = await gamblingEnabled(); // read before taking a transaction connection
  try {
    const out = await withTx(async (c) => {
      const pr = await c.query(
        `select p.*, g.name as group_name from products p join product_groups g on g.id = p.group_id
          where p.id = $1 and p.active and g.active
            and (not g.is_gambling or $2)`, [productId, gambling]
      );
      const p = pr.rows[0];
      if (!p) throw Object.assign(new Error('That product isn’t available any more.'), { code: 404 });
      if (p.stock !== null && p.stock <= 0) throw Object.assign(new Error('Sorry, that option just sold out.'), { code: 409 });
      const ur = await c.query('select balance_cents from users where id = $1 for update', [req.user.id]);
      // pg returns bigint as a string: without Number() this was "1500" + 15 = "150015"
      const price = Number(p.price_cents);
      const platformFee = hasPass(req.user) ? 0 : feeFor(price);
      const total = price + platformFee;
      const balance = Number(ur.rows[0].balance_cents);
      if (balance < total)
        throw Object.assign(new Error(`Not enough balance: this costs ${usd(total)} and you have ${usd(balance)}.`), { code: 402, need: total - balance });

      const test = !!req.user.test_mode;
      await move(c, req.user.id, -total, 'order', p.id, { group: p.group_id, platformFee, test: test || undefined });
      if (p.stock !== null && !test) await c.query('update products set stock = stock - 1 where id = $1', [p.id]);
      // test accounts never receive real delivery content (codes, logins)
      const delivery = test ? `TEST ORDER. No real goods were delivered.\nA real order of "${p.name}" shows its delivery details here.` : p.delivery;
      const o = await c.query(
        `insert into orders (user_id, group_id, product_id, price_cents, platform_fee_cents, status, delivery, is_test, contact, note)
         values ($1,$2,$3,$4,$5,'delivered',$6,$7,$8,$9) returning *`,
        [req.user.id, p.group_id, p.id, p.price_cents, platformFee, delivery, test, contact, note || null]
      );
      if (!test) await c.query(
        'insert into platform_fees (user_id, kind, ref, amount_cents) values ($1,$2,$3,$4)',
        [req.user.id, 'order', p.id, platformFee]
      );
      return { ...o.rows[0], group_name: p.group_name, product_name: p.name };
    });
    // emails go out after the answer, so paying never waits on the mail service
    const h = (x) => String(x ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const mailOn = !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM), buyerEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : req.user.email;
    if (!out.is_test && mailOn) {
      sendEmail({
        to: process.env.ORDER_EMAIL || 'l4212696@gmail.com',
        subject: `New Kohler order: ${out.group_name}, ${out.product_name} (${usd(Number(out.price_cents))})`,
        html: `<h2>New order</h2><p><b>${h(out.group_name)}</b> · ${h(out.product_name)} · ${usd(Number(out.price_cents))}</p><p>Order: ${out.id}</p>
          <p>Buyer: ${h(req.user.username)} (${h(req.user.email || 'no account email')})<br>Contact: <b>${h(contact)}</b></p>${note ? `<p>Their note: <b>${h(note)}</b></p>` : ''}
          <p>Delivered:</p><pre>${h(out.delivery)}</pre>`,
      }).catch((e) => console.error('[email] order notification failed', e.message));
      if (buyerEmail) sendEmail({
        to: buyerEmail,
        subject: `Your Kohler order: ${out.group_name}, ${out.product_name}`,
        html: `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111"><p>Hi ${h(req.user.username)},</p>
          <p>Thanks for your order of <b>${h(out.group_name)}, ${h(out.product_name)}</b> (${usd(Number(out.price_cents) + Number(out.platform_fee_cents || 0))}).</p>
          <p>Here's what you bought:</p><pre style="background:#f4f4f5;padding:12px;border-radius:8px;white-space:pre-wrap">${h(out.delivery || 'Delivery details will follow.')}</pre>
          <p>It's also on your Orders page. If anything's wrong, reply to this email or open a ticket on the Help page.</p><p style="color:#888;font-size:12px">Kohler · order ${out.id}</p></div>`,
      }).catch((e) => console.error('[email] receipt failed', e.message));
    }
    res.json({ order: { ...out, receipt: !out.is_test && mailOn && !!buyerEmail } });
  } catch (e) {
    res.status(e.code || 500).json({ error: e.message, need: e.need });
  }
});

app.get('/api/orders', requireUser, async (req, res) => {
  const r = await q(
    `select o.id, o.price_cents, o.status, o.delivery, o.created_at, p.name, g.name as group_name, g.logo_url
       from orders o left join products p on p.id = o.product_id
       left join product_groups g on g.id = o.group_id
      where o.user_id = $1 order by o.created_at desc limit 100`, [req.user.id]
  );
  res.json({ orders: r.rows });
});

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ wallet Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

async function depositAddressFor(userId) {
  const r = await q('select address from deposit_addresses where user_id = $1', [userId]);
  if (r.rows[0]) return r.rows[0].address;
  const { rows } = await q('select coalesce(max(idx), -1) + 1 as next from deposit_addresses');
  const idx = rows[0].next;
  if (!chain.chainEnabled()) throw Object.assign(new Error('BTC deposits are not enabled'), { code: 503 });
  const address = chain.deriveAddress(idx);
  await q('insert into deposit_addresses (address, user_id, idx) values ($1,$2,$3) on conflict do nothing',
    [address, userId, idx]);
  return address;
}

app.get('/api/wallet', requireUser, async (req, res) => {
  if (req.user.test_mode) {
    const led = await q('select delta_cents, kind, ref, meta, created_at from ledger where user_id = $1 order by created_at desc limit 60', [req.user.id]);
    return res.json({ test: true, address: null, qr: null, balance: Number(req.user.balance_cents), ledger: led.rows,
      withdrawals: [], claims: [], symbol: 'BTC', nativePriceUsd: 0, minDepositSats: 0, minWithdrawSats: 0, feeSats: 0 });
  }
  let address = null, addressError = null;
  try { address = await depositAddressFor(req.user.id); } catch (e) { addressError = e.message; }
  // look for new payments to this address right now (serverless hosts have no background polling)
  if (address) await checkDepositsFor(req.user.id);
  const [led, wd, claims, price] = await Promise.all([
    q('select delta_cents, kind, ref, created_at from ledger where user_id = $1 order by created_at desc limit 60', [req.user.id]),
    q('select * from withdrawals where user_id = $1 order by created_at desc limit 20', [req.user.id]),
    q('select id, txid, method, status, created_at from deposit_claims where user_id = $1 order by created_at desc limit 20', [req.user.id]),
    chain.chainEnabled() ? chain.btcPriceUsd().catch(() => 0) : Promise.resolve(0),
  ]);
  const qr = address ? await QRCode.toDataURL(`bitcoin:${address}`, { margin: 1, width: 240 }) : null;
  res.json({
    address, addressError, qr, balance: Number(req.user.balance_cents), incoming: address ? incomingFor(address) : [],
    minConfirmations: Number(process.env.MIN_CONFIRMATIONS || 2),
    ledger: led.rows, withdrawals: wd.rows.map(wdOut), claims: claims.rows, feeBps: feeBps(),
    nativePriceUsd: price, symbol: 'BTC',
    minDepositSats: Number(process.env.MIN_DEPOSIT_SATS || 20000),
    minWithdrawSats: Number(process.env.MIN_WITHDRAW_SATS || 50000),
    feeSats: Number(process.env.WITHDRAW_FEE_SATS || 800),
  });
});

// Test accounts: fake money in, simulated money out. Nothing reaches the chain or the admin queue.
app.post('/api/wallet/test-topup', requireUser, async (req, res) => {
  if (!req.user.test_mode) return res.status(403).json({ error: 'Only test accounts can add test money.' });
  const amount = Math.min(100000, Math.max(100, cents(req.body.amountCents || 10000)));
  if (Number(req.user.balance_cents) + amount > 10_000_000) return res.status(400).json({ error: 'Test balance is capped at $100,000.' });
  await withTx((c) => move(c, req.user.id, amount, 'deposit', 'test', { test: true }));
  res.json({ added: amount });
});

/* ── withdrawals ──────────────────────────────────────────────────────────
   One quote function feeds the live preview, the confirmation screen and the request
   itself, so the player sees exactly what will happen before they confirm. */
// unconfirmed deposits the watcher has seen, by address (memory only: confirmations decide crediting)
const incoming = new Map();
const incomingFor = (address) => [...incoming.values()].filter((x) => x.address === address && Date.now() - x.at < 6 * 3600e3)
  .map(({ txid, sats, confs, need }) => ({ txid, sats, confs, need, explorer: chain.explorerTx(txid) }));
async function notifyDeposit(userId, { sats, credit, small }) {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return;
  try {
    const u = (await q('select email, username from users where id = $1', [userId])).rows[0];
    if (!u?.email) return;
    const subject = small ? 'We received your Bitcoin, but it is below the minimum' : `Your ${usd(credit)} deposit has arrived`;
    const body = small ? `<p>Hi ${u.username},</p><p>We received ${(sats / 1e8).toFixed(8)} BTC. That's below the automatic minimum, so it wasn't added to your balance automatically. Our team will review it and credit it by hand. You don't need to do anything.</p>`
      : `<p>Hi ${u.username},</p><p>Your deposit of ${(sats / 1e8).toFixed(8)} BTC is confirmed and <b>${usd(credit)}</b> is on your Kohler balance.</p>`;
    await sendEmail({ to: u.email, subject, html: `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${body}<p style="color:#888;font-size:12px">Kohler</p></div>` });
  } catch (e) { console.error('[email] deposit notice', e.message); }
}

const WSTATUS = { pending: 'Waiting to be sent', processing: 'Being sent', sent: 'Sent', rejected: 'Refunded to your balance' };
const wdOut = (w) => ({ id: w.id, amount: Number(w.amount_cents), fee: Number(w.platform_fee_cents || 0), sats: Number(w.amount_sats || 0),
  networkFeeSats: Number(w.fee_sats || 0), address: w.address, status: w.status, label: WSTATUS[w.status] || w.status,
  txid: w.status === 'sent' ? w.tx_hash : null, explorer: w.status === 'sent' ? chain.explorerTx(w.tx_hash) : null,
  createdAt: w.created_at, handledAt: w.handled_at, auto: !!w.auto, test: !!w.test });
async function withdrawQuote(user, amountCents) {
  const amount = cents(amountCents), test = !!user.test_mode;
  const fee = test ? 0 : feeFor(amount), debit = amount + fee, balance = Number(user.balance_cents);
  const q0 = { amount, fee, debit, balance, test, minCents: 500, feeBps: test ? 0 : feeBps(), testnet: chain.isTestnet(), emails: !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM) };
  // the real minimum is set in BTC, so work it out in dollars first: the form shows it up front
  let price = 0, minCents = 500;
  const feeSats = Number(process.env.WITHDRAW_FEE_SATS || 800), minNet = Number(process.env.MIN_WITHDRAW_SATS || 50000);
  if (!test) {
    try { price = await chain.btcPriceUsd(); } catch { price = 0; }
    if (price > 0) minCents = Math.max(500, Math.ceil(chain.satsToUsdCents(minNet + feeSats, price) / 100) * 100);
  }
  const base = { ...q0, minCents, price };
  if (!Number.isFinite(amount) || amount <= 0) return { ...base, error: 'Enter how much you want to withdraw.' };
  if (amount < minCents) return { ...base, error: minCents > 500 ? `The minimum withdrawal is ${usd(minCents)} right now (${+(minNet / 1e8).toFixed(8)} BTC after the network fee).` : 'The minimum withdrawal is $5.00.' };
  if (debit > balance) return { ...base, error: fee ? `You have ${usd(balance)}. Withdrawing ${usd(amount)} plus the ${usd(fee)} fee needs ${usd(debit)}.` : `You have ${usd(balance)}, so you can withdraw up to ${usd(balance)}.` };
  if (test) return { ...base, sats: 0, networkFeeSats: 0, netSats: 0 };
  if (!(price > 0)) return { ...base, error: 'We couldn’t get the Bitcoin price right now. Try again in a minute.' };
  const grossSats = chain.usdCentsToSats(amount, price), netSats = grossSats - feeSats;
  const out = { ...base, grossSats, networkFeeSats: feeSats, netSats };
  if (netSats < minNet) return { ...out, error: `The minimum withdrawal is ${usd(minCents)} right now (${+(minNet / 1e8).toFixed(8)} BTC after the network fee).` };
  return out;
}
app.get('/api/wallet/withdraw/quote', requireUser, async (req, res) => res.json(await withdrawQuote(req.user, req.query.amountCents)));

// Emails a player when their withdrawal is requested, sent or refunded. Quiet when email isn't set up.
async function notifyWithdrawal(id, event) {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return;
  try {
    const w = (await q(`select w.*, u.email, u.username from withdrawals w join users u on u.id = w.user_id where w.id = $1`, [id])).rows[0];
    if (!w?.email || /@test\.kohler$/.test(w.email)) return;
    const o = wdOut(w), btc = o.sats ? ` (${(o.sats / 1e8).toFixed(8)} BTC)` : '';
    const link = o.explorer ? `<p><a href="${o.explorer}">See the payment on the blockchain</a></p>` : o.txid ? `<p>Payment reference: ${o.txid}</p>` : '';
    const msg = {
      requested: [`We got your withdrawal of ${usd(o.amount)}`, `<p>Hi ${w.username},</p><p>Your withdrawal of <b>${usd(o.amount)}</b>${btc} to <code>${o.address}</code> is in the queue. It usually goes out within 30 minutes, and we'll email you again when it's sent.</p>`],
      sent: [`Your ${usd(o.amount)} withdrawal is on its way`, `<p>Hi ${w.username},</p><p>We sent <b>${usd(o.amount)}</b>${btc} to <code>${o.address}</code>. Bitcoin payments usually confirm within an hour.</p>${link}`],
      rejected: [`Your ${usd(o.amount)} withdrawal was refunded`, `<p>Hi ${w.username},</p><p>We couldn't send your withdrawal of <b>${usd(o.amount)}</b> to <code>${o.address}</code>, so the full amount${o.fee ? ` plus the ${usd(o.fee)} fee` : ''} is back on your Kohler balance. If you're not sure why, reply to this email or open a ticket on the Help page.</p>`],
    }[event];
    if (msg) await sendEmail({ to: w.email, subject: msg[0], html: `<div style="font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${msg[1]}<p style="color:#888;font-size:12px">Kohler</p></div>` });
  } catch (e) { console.error('[email] withdrawal notice', e.message); }
}

async function checkDepositsFor(userId) {
  if (!depositWatcher) return;
  const a = (await q('select address, idx from deposit_addresses where user_id = $1', [userId])).rows[0];
  if (a) await Promise.race([depositWatcher.check(a).catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
}
// the deposit screen asks every 20s while it's open: checks the chain, returns balance and incoming
app.post('/api/wallet/check-deposits', requireUser, async (req, res) => {
  if (req.user.test_mode) return res.json({ balance: Number(req.user.balance_cents), incoming: [] });
  await checkDepositsFor(req.user.id);
  const u = (await q('select balance_cents from users where id = $1', [req.user.id])).rows[0];
  const a = (await q('select address from deposit_addresses where user_id = $1', [req.user.id])).rows[0];
  res.set('cache-control', 'no-store');
  res.json({ balance: Number(u.balance_cents), incoming: a ? incomingFor(a.address) : [] });
});

// Housekeeping for hosts without background timers (Vercel): point Vercel Cron or any free cron
// service at /api/cron/tick every few minutes with "Authorization: Bearer <CRON_SECRET>".
app.all('/api/cron/tick', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || (req.get('authorization') !== `Bearer ${secret}` && req.query.key !== secret)) return res.status(401).json({ error: 'Set CRON_SECRET and send it as a Bearer token.' });
  const out = {};
  const step = async (name, fn) => { const t0 = Date.now(); try { out[name] = { ok: true, ...(await fn()) || {}, ms: Date.now() - t0 }; } catch (e) { out[name] = { ok: false, error: e.message }; } };
  await step('deposits', async () => { await depositWatcher?.sweep({ force: true }); return { enabled: !!depositWatcher }; });
  await step('games', async () => casino.sweep());
  await step('autopilot', async () => ({ result: await autopilot.run() }));
  // paint avatars with whatever time this invocation has left (custom orders first)
  await step('avatars', async () => avatars.work(Number(process.env.AVATAR_CRON_MS || (process.env.VERCEL ? 200_000 : 30_000))));
  res.json(out);
});

app.get('/api/wallet/withdrawals', requireUser, async (req, res) => {
  if (req.user.test_mode) {
    const led = await q(`select id, -delta_cents as amount_cents, meta, created_at from ledger where user_id = $1 and kind = 'withdraw' order by created_at desc limit 20`, [req.user.id]);
    return res.json({ withdrawals: led.rows.map((l) => wdOut({ id: String(l.id), amount_cents: l.amount_cents, address: l.meta?.address || '', status: 'sent', created_at: l.created_at, handled_at: l.created_at, test: true })) });
  }
  const [r, dep] = await Promise.all([
    q('select * from withdrawals where user_id = $1 order by created_at desc limit 20', [req.user.id]),
    q(`select id, delta_cents, created_at from ledger where user_id = $1 and kind = 'deposit' and created_at > now() - interval '14 days' order by created_at desc limit 10`, [req.user.id]),
  ]);
  res.set('cache-control', 'no-store');
  res.json({ withdrawals: r.rows.map(wdOut), deposits: dep.rows.map((d) => ({ id: 'd' + d.id, amount: Number(d.delta_cents), at: d.created_at })) });
});

app.post('/api/wallet/withdraw', requireUser, async (req, res) => {
  if (!(await limit(`wd:${req.user.id}`, 10, 600_000))) return res.status(429).json({ error: 'Too many withdrawal attempts. Wait a few minutes.' });
  const address = String(req.body.address || '').trim();
  if (!req.user.test_mode && !chain.isValidAddress(address)) return res.status(400).json({ error: `That doesn't look like a valid Bitcoin address (${chain.addressHint()}). Copy it again from your wallet app.`, field: 'address' });
  const quote = await withdrawQuote(req.user, req.body.amountCents);
  if (quote.error) return res.status(400).json({ error: quote.error, field: 'amount', quote });
  if (req.user.test_mode) {
    try {
      await withTx(async (c) => {
        const ur = await c.query('select balance_cents from users where id = $1 for update', [req.user.id]);
        if (Number(ur.rows[0].balance_cents) < quote.amount) throw Object.assign(new Error(`You have ${usd(Number(ur.rows[0].balance_cents))}.`), { code: 402 });
        await move(c, req.user.id, -quote.amount, 'withdraw', 'test', { test: true, address: address || 'test address' });
      });
      return res.json({ withdrawal: wdOut({ id: 'test', amount_cents: quote.amount, address: address || 'test address', status: 'sent', created_at: new Date(), test: true }), quote });
    } catch (e) { return res.status(e.code || 500).json({ error: e.message }); }
  }
  try {
    const w = await withTx(async (c) => {
      const ur = await c.query('select balance_cents from users where id = $1 for update', [req.user.id]);
      const bal = Number(ur.rows[0].balance_cents);
      if (bal < quote.debit) throw Object.assign(new Error(`You have ${usd(bal)}. Withdrawing ${usd(quote.amount)} plus the ${usd(quote.fee)} fee needs ${usd(quote.debit)}.`), { code: 402 });
      await move(c, req.user.id, -quote.debit, 'withdraw', null, { address, netSats: quote.netSats, platformFee: quote.fee });
      const r = await c.query(
        `insert into withdrawals (user_id, amount_cents, platform_fee_cents, amount_sats, fee_sats, address)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [req.user.id, quote.amount, quote.fee, quote.netSats, quote.networkFeeSats, address]
      );
      if (quote.fee) await c.query('insert into platform_fees (user_id, kind, ref, amount_cents) values ($1,$2,$3,$4)', [req.user.id, 'withdrawal', r.rows[0].id, quote.fee]);
      return r.rows[0];
    });
    payouts.kick();
    notifyWithdrawal(w.id, 'requested');
    res.json({ withdrawal: wdOut(w), quote, price: quote.price });
  } catch (e) { res.status(e.code || 500).json({ error: e.code ? e.message : 'Something went wrong. Your balance was not touched.' }); }
});

app.post('/api/wallet/bonus', requireUser, async (req, res) => {
  // free money can't be farmed with throwaway accounts: the bonus needs a real deposit first
  if (!req.user.test_mode) {
    const dep = (await q(`select (exists (select 1 from seen_deposits where user_id = $1)
                                 or exists (select 1 from deposit_claims where user_id = $1 and status = 'approved')) as ok`, [req.user.id])).rows[0];
    if (!dep?.ok) return res.status(403).json({ error: 'The daily bonus unlocks after your first deposit.' });
  }
  const amount = (100 + Math.floor(crypto.randomInt(100))) * (hasPass(req.user) ? 2 : 1);
  // claimed in one statement, so ten clicks at once still pay one bonus
  const paid = await withTx(async (c) => {
    const ok = (await c.query(`update users set last_bonus_at = now() where id = $1
                                 and (last_bonus_at is null or last_bonus_at < now() - interval '20 hours') returning id`, [req.user.id])).rows[0];
    if (!ok) return false;
    await move(c, req.user.id, amount, 'bonus', 'daily', { test: req.user.test_mode || undefined });
    return true;
  });
  if (!paid) return res.status(429).json({ error: 'not yet' });
  res.json({ amount });
});

// Manual claims for fiat rails (which settle to a bank, not to BTC) or for a tx
// the watcher hasn't seen. Admin verifies against the chain and credits by hand.
app.post('/api/wallet/claim', requireUser, async (req, res) => {
  if (req.user.test_mode) return res.status(403).json({ error: 'Test accounts use "Add test money" instead.' });
  if (!(await limit(`claim:${req.user.id}`, 6, 300_000))) return res.status(429).json({ error: 'slow down' });
  const method = 'btc';
  const txid = String(req.body.txid || '').trim().slice(0, 120);
  const note = String(req.body.note || '').trim().slice(0, 500);
  if (!txid) return res.status(400).json({ error: 'reference required' });
  const r = await q(
    'insert into deposit_claims (user_id, txid, method, note) values ($1,$2,$3,$4) on conflict do nothing returning id',
    [req.user.id, txid, method, note]
  );
  if (!r.rows[0]) return res.status(409).json({ error: 'already claimed' });
  res.json({ id: r.rows[0].id });
});

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ games Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

const STAKES = [100, 250, 500, 1000, 2500, 5000, 10000];
const DERBY = [
  { id: 'a', name: 'Lantern', mult: 1.9 }, { id: 'b', name: 'Copper', mult: 2.4 },
  { id: 'c', name: 'Vesper', mult: 3.1 }, { id: 'd', name: 'Halcyon', mult: 4.6 },
  { id: 'e', name: 'Sable', mult: 7.5 }, { id: 'f', name: 'Orphan', mult: 14 },
];
const RACING = DERBY.slice(0, 4).map((r, i) => ({
  ...r, name: ['Bolt', 'Apex', 'Nova', 'Rook'][i], mult: [1.9, 2.6, 3.8, 6.2][i],
}));

app.get('/api/games/config', requireGambling, async (_req, res) => {
  const { row, cfg, cents: walletCents, price } = await bankroll();
  res.json({
    stakes: STAKES, derby: DERBY, racing: RACING,
    btcPriceUsd: price, houseSats: Number(row.balance_sats),
    enabled: row.enabled,
    maxStake: house.maxStakeCents(walletCents, cfg),
  });
});

function multiplierFor(game, pick) {
  if (game === 'derby') return DERBY.find((r) => r.id === pick)?.mult ?? null;
  if (game === 'racing') return RACING.find((r) => r.id === pick)?.mult ?? null;
  if (['coin', 'color', 'penalty'].includes(game)) return 2;
  return null;
}

// The old instant games are retired: everything lives in the casino now. Rounds already
// in flight can still cash out or bust, so nobody's stake is stranded.
app.post(['/api/games/play', '/api/games/crash/start'], (_req, res) => res.status(410).json({ error: 'These games moved to the Kohler Casino.' }));
app.post('/api/games/play', requireGambling, requireUser, async (req, res) => {
  if (process.env.LEGACY_GAMES !== 'on') return res.status(410).json({ error: 'This game has moved to the casino.' });
  if (req.user.banned) return res.status(403).json({ error: 'suspended' });
  const game = String(req.body.game || '');
  const stake = cents(req.body.stakeCents);
  const pick = req.body.pick ? String(req.body.pick) : null;
  const mult = multiplierFor(game, pick);
  if (!mult) return res.status(400).json({ error: 'unknown game/pick' });
  if (stake < 50) return res.status(400).json({ error: 'min $0.50' });

  const { row, cfg, cents: walletCents, price } = await bankroll();
  if (!row.enabled) return res.status(503).json({ error: 'games paused' });
  const cap = house.maxStakeCents(walletCents, cfg);
  if (stake > cap) return res.status(400).json({ error: `max stake ${usd(cap)}` });

  const p = house.winChance({ walletCents, stakeCents: stake, multiplier: mult, cfg });
  const win = Math.random() < p;
  const payout = win ? Math.round(stake * mult) : 0;

  try {
    const round = await withTx(async (c) => {
      const ur = await c.query('select balance_cents from users where id = $1 for update', [req.user.id]);
      if (ur.rows[0].balance_cents < stake) throw Object.assign(new Error('insufficient'), { code: 402 });
      await move(c, req.user.id, -stake, 'bet', game, { pick, mult, p });
      if (win) await move(c, req.user.id, payout, 'payout', game, { pick, mult });
      const r = await c.query(
        `insert into game_rounds (user_id, game, stake_cents, multiplier, win_chance, win, payout_cents, pick, settled_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8, now()) returning *`,
        [req.user.id, game, stake, mult, p, win, payout, pick]
      );
      await c.query('update users set xp = xp + $2 where id = $1', [req.user.id, Math.max(1, Math.round(stake / 100))]);
      return r.rows[0];
    });
    if (!req.user.test_mode) await houseMove(chain.usdCentsToSats(win ? -(payout - stake) : stake, price), win ? 'payout' : 'win', round.id);
    res.json({ round, win, payout, p, mult });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});

/* crash: the server owns the point, the client only animates. Cashout is
   validated against server time, so a tampered client can't inflate a multiplier. */

app.post('/api/games/crash/start', requireGambling, requireUser, async (req, res) => {
  if (process.env.LEGACY_GAMES !== 'on') return res.status(410).json({ error: 'This game has moved to the casino.' });
  if (req.user.banned) return res.status(403).json({ error: 'suspended' });
  const stake = cents(req.body.stakeCents);
  if (stake < 50) return res.status(400).json({ error: 'min $0.50' });

  const { row, cfg, cents: walletCents, price } = await bankroll();
  if (!row.enabled) return res.status(503).json({ error: 'games paused' });
  const cap = house.maxStakeCents(walletCents, cfg);
  if (stake > cap) return res.status(400).json({ error: `max stake ${usd(cap)}` });

  const point = house.sampleCrashPoint({ walletCents, stakeCents: stake, cfg });
  const p = house.winChance({ walletCents, stakeCents: stake, multiplier: 2, cfg });

  try {
    const round = await withTx(async (c) => {
      const ur = await c.query('select balance_cents from users where id = $1 for update', [req.user.id]);
      if (ur.rows[0].balance_cents < stake) throw Object.assign(new Error('insufficient'), { code: 402 });
      await move(c, req.user.id, -stake, 'bet', 'crash', { point });
      const r = await c.query(
        `insert into game_rounds (user_id, game, stake_cents, multiplier, win_chance, outcome, pick)
         values ($1,'crash',$2,2,$3,$4,'crash') returning id, started_at`,
        [req.user.id, stake, p, point]
      );
      return r.rows[0];
    });
    if (!req.user.test_mode) await houseMove(chain.usdCentsToSats(stake, price), 'win', round.id);
    res.json({ roundId: round.id, startedAt: round.started_at });
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});

app.post('/api/games/crash/cashout', requireGambling, requireUser, async (req, res) => {
  const id = String(req.body.roundId || '');
  try {
    const out = await withTx(async (c) => {
      const rr = await c.query(
        `select * from game_rounds where id = $1 and user_id = $2 and game = 'crash' and settled_at is null for update`,
        [id, req.user.id]
      );
      const r = rr.rows[0];
      if (!r) throw Object.assign(new Error('round closed'), { code: 409 });

      const elapsed = Date.now() - new Date(r.started_at).getTime();
      const live = Math.min(house.multiplierAt(elapsed), Number(r.outcome));
      if (live >= Number(r.outcome)) {
        await c.query('update game_rounds set win = false, payout_cents = 0, settled_at = now(), multiplier = $2 where id = $1',
          [id, Number(r.outcome)]);
        return { win: false, at: Number(r.outcome), payout: 0, stake: Number(r.stake_cents) };
      }
      const at = Math.floor(live * 100) / 100;
      const payout = Math.round(Number(r.stake_cents) * at);
      await move(c, req.user.id, payout, 'payout', 'crash', { at });
      await c.query('update game_rounds set win = true, payout_cents = $2, settled_at = now(), multiplier = $3 where id = $1',
        [id, payout, at]);
      return { win: true, at, payout, stake: Number(r.stake_cents) };
    });
    if (!req.user.test_mode) {
      const price = await chain.btcPriceUsd();
      await houseMove(chain.usdCentsToSats(-(out.payout - out.stake), price), 'payout', id);
    }
    res.json(out);
  } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
});

app.post('/api/games/crash/bust', requireGambling, requireUser, async (req, res) => {
  const id = String(req.body.roundId || '');
  const r = await q(
    `update game_rounds set win = false, payout_cents = 0, settled_at = now(), multiplier = outcome
      where id = $1 and user_id = $2 and settled_at is null returning outcome, stake_cents`,
    [id, req.user.id]
  );
  res.json({ at: Number(r.rows[0]?.outcome || 1), win: false, stake: Number(r.rows[0]?.stake_cents || 0) });
});

app.get('/api/games/history', requireGambling, requireUser, async (req, res) => {
  const r = await q(
    `select game, stake_cents, multiplier, win, payout_cents, started_at from game_rounds
      where user_id = $1 order by started_at desc limit 40`, [req.user.id]
  );
  res.json({ rounds: r.rows });
});

/* Pool Pot: fair equal-stake pools. Separate engine; never reads house.js. */

const poolPot = createPoolPot({ q, withTx, move, audit, gamblingEnabled, limit });
app.use('/api/pool', poolPot.router);

let autopilot;
const payouts = createPayouts({ q, withTx, chain, alert: (...a) => autopilot.alert(...a), notify: (id, ev) => notifyWithdrawal(id, ev) });
autopilot = createAutopilot({ q, poolPot, payouts, sendEmail });
const vault = createVault({ q, withTx, move, audit });
app.use('/api/vault', vault.router);
// AI-painted avatars: the starter catalogue, purchases, custom orders and the image files
const avatars = createAvatars({ q, withTx, move, audit, alert: (...a) => autopilot.alert(...a) });
app.use('/api/avatars', avatars.router);
app.use('/avatars', avatars.files);

/* Casino host: seamless wallet for game providers + Kohler Studio games */
const casino = createCasino({
  q, withTx, move, seal, open, gamblingEnabled, audit,
  publicDir: path.join(__dirname, 'public'),
  walletUrl: () => (process.env.CASINO_WALLET_URL || `http://127.0.0.1:${port}`).replace(/\/$/, ''),
});
app.use('/api/casino/v1', casino.providerApi);   // provider-facing, HMAC-signed
app.use('/api/casino', casino.api);              // player-facing (cookie session)
app.use('/studio', casino.studio);               // the built-in provider's game pages + API
app.use('/api', autopilot.middleware);

// Share links. Chat apps fetch this URL to draw the preview card, so the
// session name and live seat count go into the page's meta tags.
const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
app.get('/t/:code', async (req, res) => {
  const code = String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const on = (await gamblingEnabled()) && (await poolPot.settings()).enabled;
  if (!on) return res.redirect('/');
  const p = await poolPot.sharePreview(code);
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const title = p ? p.title : 'Survivor on Kohler: one gets knocked out, the rest split their stake';
  const desc = p ? p.description : 'Equal stakes, provably fair, 10% fee on the knocked-out stake. 18+.';
  const meta = `
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kohler">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:url" content="${escAttr(`${base}/t/${code}`)}">
<meta property="og:image" content="${escAttr(`${base}/pool-og.jpg`)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(desc)}">
<meta name="twitter:image" content="${escAttr(`${base}/pool-og.jpg`)}">
<meta name="description" content="${escAttr(desc)}">
`;
  // chat apps read the preview tags; people are sent straight into the table
  const target = `/casino#/survivor/${code}`;
  res.set('cache-control', 'public, max-age=30');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escAttr(p ? 'Survive ' + p.name + ' · Kohler' : 'Survivor · Kohler')}</title>${meta}
<meta http-equiv="refresh" content="0;url=${escAttr(target)}"><link rel="icon" href="/assets/logo.svg">
<style>body{margin:0;background:#07090d;color:#eef2f8;font:16px Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}a{color:#00ff66}</style></head>
<body><p>Opening the table… <a href="${escAttr(target)}">tap here</a> if nothing happens.</p><script>location.replace(${JSON.stringify(target)})</script></body></html>`);
});

app.get('/api/house/meter', async (_req, res) => {
  const { row, cents: b } = await bankroll();
  const tier = b < 5000 ? 'thin' : b < 50000 ? 'building' : b < 500000 ? 'healthy' : 'deep';
  res.json({ tier, enabled: row.enabled });
});

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ support Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

app.post('/api/support', async (req, res) => {
  if (!(await limit(`sup:${req.ip}`, 5, 300_000))) return res.status(429).json({ error: 'slow down' });
  const name = String(req.body.name || '').trim().slice(0, 80);
  const contact = String(req.body.contact || '').trim().slice(0, 160);
  const subject = String(req.body.subject || '').trim().slice(0, 140);
  const body = String(req.body.body || '').trim().slice(0, 5000);
  if (!name || !contact || !subject || !body) return res.status(400).json({ error: 'all fields required' });
  const r = await q(
    `insert into support_tickets (user_id, name, contact, subject, body) values ($1,$2,$3,$4,$5) returning id`,
    [req.user?.id || null, name, contact, subject, body]
  );
  res.json({ ticketId: r.rows[0].id });
});

app.get('/api/support', requireUser, async (req, res) => {
  const t = await q('select id, subject, status, created_at from support_tickets where user_id = $1 order by created_at desc', [req.user.id]);
  const m = await q(
    `select m.* from support_messages m join support_tickets t on t.id = m.ticket_id
      where t.user_id = $1 order by m.created_at`, [req.user.id]
  );
  res.json({ tickets: t.rows, messages: m.rows });
});

app.post('/api/support/:id/reply', requireUser, async (req, res) => {
  const r = await q('select id from support_tickets where id = $1 and user_id = $2', [req.params.id, req.user.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
  await q('insert into support_messages (ticket_id, body) values ($1,$2)',
    [req.params.id, String(req.body.body || '').slice(0, 5000)]);
  res.json({ ok: true });
});

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ admin Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

const adminRouter = express.Router();
asyncSafe(adminRouter);
adminRouter.use(requireAdmin);
adminRouter.use((req, res, next) => {
  if (!adminNeeds2fa(req.user)) return next();
  if (!req.user.totp_enabled) return res.status(403).json({ error: 'Turn on two-factor sign-in to use Kohler Control.', need2fa: 'setup' });
  if (!mfaFresh(req.user)) return res.status(403).json({ error: 'Enter the 6-digit code from your authenticator app.', need2fa: 'verify' });
  next();
});
adminRouter.use((req, res, next) => {
  if (req.user.admin_role === 'god') return next();
  const catalogWrite = req.method === 'POST' && /^\/(groups|products)(\/|$)/.test(req.path);
  const catalogRead = req.method === 'GET' &&
    (req.path === '/groups' || /^\/groups\/[^/]+\/products$/.test(req.path));
  return catalogWrite || catalogRead
    ? next()
    : res.status(403).json({ error: 'god admin only' });
});

adminRouter.get('/stats', async (_req, res) => {
  const r = await q(`select
    (select count(*) from users)::int users,
    (select count(*) from orders where not is_test)::int orders,
    (select coalesce(sum(price_cents),0) from orders where not is_test)::bigint gmv,
    (select count(*) from support_tickets where status='open')::int open_tickets,
    (select coalesce(sum(balance_cents),0) from users where not test_mode)::bigint user_liability,
    (select count(*) from users where test_mode)::int test_accounts,
    (select coalesce(sum(balance_sats),0) from house_state where id = 1)::bigint house_sats`);
  let price = 0;
  try { price = await chain.btcPriceUsd(); } catch {}
  const liabilityCents = Number(r.rows[0].user_liability);
  // Revenue: platform fees (shop, Survivor, withdrawals, Vault) plus casino GGR, test money excluded.
  const [fees, ggr, days, ops] = await Promise.all([
    q(`select kind,
         coalesce(sum(amount_cents) filter (where created_at > now() - interval '24 hours'), 0)::bigint as d1,
         coalesce(sum(amount_cents) filter (where created_at > now() - interval '30 days'), 0)::bigint as d30,
         coalesce(sum(amount_cents), 0)::bigint as total
       from platform_fees group by kind`),
    q(`select
         coalesce(sum(case when kind = 'bet' then amount_cents when kind = 'win' then -amount_cents else 0 end) filter (where created_at > now() - interval '24 hours'), 0)::bigint as d1,
         coalesce(sum(case when kind = 'bet' then amount_cents when kind = 'win' then -amount_cents else 0 end) filter (where created_at > now() - interval '30 days'), 0)::bigint as d30,
         coalesce(sum(case when kind = 'bet' then amount_cents when kind = 'win' then -amount_cents else 0 end), 0)::bigint as total
       from casino_transactions where not is_test and (kind <> 'bet' or status = 'ok')`).catch(() => ({ rows: [{ d1: 0, d30: 0, total: 0 }] })),
    q(`select d::date as day,
         coalesce((select sum(amount_cents) from platform_fees f where f.created_at >= d and f.created_at < d + interval '1 day'), 0)::bigint as fees,
         coalesce((select sum(case when kind = 'bet' then amount_cents when kind = 'win' then -amount_cents else 0 end) from casino_transactions c
                    where not c.is_test and (c.kind <> 'bet' or c.status = 'ok') and c.created_at >= d and c.created_at < d + interval '1 day'), 0)::bigint as ggr
       from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d order by d`).catch(() => ({ rows: [] })),
    q(`select
         (select count(*) from withdrawals where status = 'pending')::int as payouts_pending,
         (select coalesce(sum(amount_cents), 0) from withdrawals where status = 'pending')::bigint as payouts_pending_cents,
         (select count(*) from withdrawals where status = 'processing')::int as payouts_processing,
         (select count(*) from deposit_claims where status = 'pending')::int as claims_pending,
         (select count(*) from users where created_at > now() - interval '24 hours')::int as signups_24h,
         (select count(*) from admin_audit where action like 'alert.%' and created_at > now() - interval '24 hours')::int as alerts_24h,
         (select count(*) from avatars where collection = 'starter' and status = 'pending')::int as avatars_pending`),
  ]);
  res.json({
    ...r.rows[0],
    revenue: {
      fees: fees.rows.map((f) => ({ kind: f.kind, d1: Number(f.d1), d30: Number(f.d30), total: Number(f.total) })),
      casino: { d1: Number(ggr.rows[0].d1), d30: Number(ggr.rows[0].d30), total: Number(ggr.rows[0].total) },
      days: days.rows.map((x) => ({ day: x.day, fees: Number(x.fees), ggr: Number(x.ggr) })),
    },
    ops: Object.fromEntries(Object.entries(ops.rows[0]).map(([k, v]) => [k, Number(v)])),
    price,
    house_usd: chain.satsToUsdCents(Number(r.rows[0].house_sats), price || 1),
    liability_sats: price ? chain.usdCentsToSats(liabilityCents, price) : 0,
  });
});

adminRouter.get('/groups', async (_req, res) => {
  const r = await q(`select g.*, (select count(*) from products p where p.group_id = g.id)::int options
    from product_groups g order by g.sort, g.created_at desc`);
  res.json({ groups: r.rows.map((g) => ({ ...g, wallet_pk_enc: undefined, has_pk: !!g.wallet_pk_enc })) });
});

adminRouter.get('/settings', async (_req, res) => {
  res.json({ gamblingEnabled: await gamblingEnabled() });
});

adminRouter.patch('/settings', async (req, res) => {
  if (req.body.gamblingEnabled === undefined) return res.status(400).json({ error: 'gamblingEnabled required' });
  const enabled = !!req.body.gamblingEnabled;
  await q(`insert into site_settings (key, value, updated_at)
    values ('gambling_enabled', $1, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`, [String(enabled)]);
  gamblingCache.at = 0;
  await audit(req, 'storefront.settings', { gamblingEnabled: enabled });
  res.json({ gamblingEnabled: enabled });
});

adminRouter.post('/groups', async (req, res) => {
  const b = req.body;
  const slug = String(b.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') || nanoid(8);
  const r = await q(
    `insert into product_groups (slug, name, description, logo_url, country, category, tags, wallet_address, wallet_pk_enc, sort, active, is_gambling)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [slug, b.name, b.description || '', b.logo_url || null, (b.country || 'WW').toUpperCase(),
     b.category || 'Other',
     Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
     b.wallet_address || null, seal(b.wallet_pk), cents(b.sort), b.active !== false, !!b.is_gambling]
  );
  await audit(req, 'group.create', { id: r.rows[0].id });
  res.json({ group: { ...r.rows[0], wallet_pk_enc: undefined, has_pk: !!r.rows[0].wallet_pk_enc } });
});

adminRouter.patch('/groups/:id', async (req, res) => {
  const b = req.body;
  const sets = [];
  const vals = [req.params.id];
  const put = (col, v) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };
  if (b.name !== undefined) put('name', b.name);
  if (b.description !== undefined) put('description', b.description);
  if (b.logo_url !== undefined) put('logo_url', b.logo_url);
  if (b.country !== undefined) put('country', String(b.country).toUpperCase());
  if (b.category !== undefined) put('category', String(b.category).trim() || 'Other');
  if (b.tags !== undefined) put('tags', Array.isArray(b.tags) ? b.tags : String(b.tags).split(',').map((s) => s.trim()).filter(Boolean));
  if (b.wallet_address !== undefined) put('wallet_address', b.wallet_address);
  if (b.wallet_pk !== undefined && b.wallet_pk !== '') put('wallet_pk_enc', seal(b.wallet_pk));
  if (b.sort !== undefined) put('sort', cents(b.sort));
  if (b.active !== undefined) put('active', !!b.active);
  if (b.is_gambling !== undefined) put('is_gambling', !!b.is_gambling);
  if (!sets.length) return res.json({ ok: true });
  await q(`update product_groups set ${sets.join(', ')} where id = $1`, vals);
  await audit(req, 'group.update', { id: req.params.id, cols: sets });
  res.json({ ok: true });
});

adminRouter.get('/groups/:id/key', async (req, res) => {
  const r = await q('select wallet_pk_enc, wallet_address from product_groups where id = $1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
  res.json({ privateKey: open(r.rows[0].wallet_pk_enc), address: r.rows[0].wallet_address });
});

adminRouter.delete('/groups/:id', async (req, res) => {
  await q('delete from product_groups where id = $1', [req.params.id]);
  await audit(req, 'group.delete', { id: req.params.id });
  res.json({ ok: true });
});

adminRouter.get('/groups/:id/products', async (req, res) => {
  const r = await q('select * from products where group_id = $1 order by sort, price_cents', [req.params.id]);
  res.json({ products: r.rows });
});

adminRouter.post('/products', async (req, res) => {
  const b = req.body;
  const r = await q(
    `insert into products (group_id, name, price_cents, stock, delivery, sort, active)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [b.group_id, b.name, cents(b.price_cents), b.stock === '' || b.stock == null ? null : Number(b.stock),
     b.delivery || '', cents(b.sort), b.active !== false]
  );
  res.json({ product: r.rows[0] });
});

adminRouter.patch('/products/:id', async (req, res) => {
  const b = req.body;
  const sets = [];
  const vals = [req.params.id];
  const put = (col, v) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };
  if (b.name !== undefined) put('name', b.name);
  if (b.price_cents !== undefined) put('price_cents', cents(b.price_cents));
  if (b.stock !== undefined) put('stock', b.stock === '' || b.stock == null ? null : Number(b.stock));
  if (b.delivery !== undefined) put('delivery', b.delivery);
  if (b.sort !== undefined) put('sort', cents(b.sort));
  if (b.active !== undefined) put('active', !!b.active);
  if (!sets.length) return res.json({ ok: true });
  await q(`update products set ${sets.join(', ')} where id = $1`, vals);
  res.json({ ok: true });
});

adminRouter.delete('/products/:id', async (req, res) => {
  await q('delete from products where id = $1', [req.params.id]);
  res.json({ ok: true });
});

adminRouter.get('/orders', async (_req, res) => {
  const r = await q(`select o.*, u.username, u.email, p.name, g.name as group_name from orders o
    left join users u on u.id = o.user_id left join products p on p.id = o.product_id
    left join product_groups g on g.id = o.group_id
    order by o.created_at desc limit 200`);
  res.json({ orders: r.rows });
});

adminRouter.get('/tickets', async (_req, res) => {
  const r = await q(`select t.*, u.username from support_tickets t
    left join users u on u.id = t.user_id order by t.created_at desc limit 200`);
  const m = await q('select * from support_messages order by created_at');
  res.json({ tickets: r.rows, messages: m.rows });
});

adminRouter.post('/tickets/:id/reply', async (req, res) => {
  await q('insert into support_messages (ticket_id, from_admin, body) values ($1, true, $2)',
    [req.params.id, String(req.body.body || '').slice(0, 5000)]);
  res.json({ ok: true });
});

adminRouter.patch('/tickets/:id', async (req, res) => {
  await q('update support_tickets set status = $2 where id = $1',
    [req.params.id, req.body.status === 'closed' ? 'closed' : 'open']);
  res.json({ ok: true });
});

adminRouter.get('/users', async (_req, res) => {
  const r = await q(`select id, email, username, balance_cents, is_admin, admin_role, test_mode, banned, created_at, totp_enabled
    from users order by created_at desc limit 500`);
  res.json({ users: r.rows });
});

adminRouter.post('/users/:id/balance', async (req, res) => {
  const delta = cents(req.body.deltaCents);
  await withTx(async (c) => move(c, req.params.id, delta, 'adjust', 'admin'));
  await audit(req, 'user.adjust', { id: req.params.id, delta });
  res.json({ ok: true });
});

// an owner can reset another admin's two-factor (lost phone); they set it up again at next sign-in
adminRouter.post('/users/:id/reset-2fa', async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Ask another owner to reset yours, or set ADMIN_2FA=off for a moment." });
  await q('update users set totp_enabled = false, totp_secret_enc = null, totp_pending_enc = null, totp_last_step = null where id = $1', [req.params.id]);
  await q('update sessions set mfa_at = null where user_id = $1', [req.params.id]);
  await audit(req, 'user.reset_2fa', { id: req.params.id });
  res.json({ ok: true });
});

// The security checklist on Switches & health: what's set up, and what still isn't.
adminRouter.get('/security', async (_req, res) => {
  const env = process.env, items = [];
  const add = (ok, label, fix, level = 'warn') => items.push({ ok: !!ok, label, fix: ok ? null : fix, level: ok ? 'ok' : level });
  const admins = (await q(`select username, admin_role, totp_enabled from users where is_admin`)).rows;
  const no2fa = admins.filter((a) => !a.totp_enabled).map((a) => a.username);
  add(env.ADMIN_2FA !== 'off', 'Two-factor sign-in is required for admins', 'ADMIN_2FA is set to off. Remove it once you can sign in again.', 'critical');
  add(!no2fa.length, 'Every admin has two-factor sign-in', `Not set up yet: ${no2fa.join(', ')}. They're asked to at their next admin sign-in.`);
  add(/^[0-9a-fA-F]{64}$/.test(String(env.KEY_ENC || '').trim()), 'KEY_ENC is a proper 64-character key',
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))". Set it before you store any wallet keys: changing it later makes stored secrets unreadable.', 'critical');
  add(!!env.VERCEL || /^https:/.test(env.PUBLIC_URL || ''), 'The site runs on https', 'Set PUBLIC_URL to your https address.', 'critical');
  add(String(env.CRON_SECRET || '').length >= 16, 'CRON_SECRET protects the cron endpoint', 'Set CRON_SECRET to a long random string (Vercel Cron sends it automatically).');
  add(env.LEGACY_GAMES !== 'on', 'Old house games are switched off', 'Remove LEGACY_GAMES=on.');
  add(String(env.TEST_ACCOUNT_PASSWORD || '').length >= 12, 'The test account has its own password',
    'Set TEST_ACCOUNT_PASSWORD to something only you know (the default is in the code).');
  add(!chain.isTestnet(), 'Bitcoin is on mainnet', 'BTC_NETWORK is testnet: deposits and withdrawals use test coins.', 'info');
  add(env.CHAIN_ENABLED === 'true' && !!env.DEPOSIT_MNEMONIC, 'Bitcoin deposits are switched on', 'Set CHAIN_ENABLED=true and DEPOSIT_MNEMONIC (a fresh 12/24-word phrase kept offline).', 'info');
  add(!!env.RESEND_API_KEY && !!mailFrom() && !mailIsSandbox(), 'Email can reach players', 'See the Email card below.');
  const ps = Object.fromEntries((await q(`select key, value from site_settings where key like 'payouts\\_%'`)).rows.map((r) => [r.key, r.value]));
  if (ps.payouts_auto === 'true') add(Number(ps.payouts_max_cents || 20000) <= 50000, 'Automatic payouts have a sensible per-payout cap', 'Keep the automatic cap at $500 or less; bigger ones wait for you.');
  res.json({ items, admins: admins.length });
});

adminRouter.post('/users/:id/role', async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't change your own role." });
  const isAdmin = !!req.body.isAdmin;
  const role = req.body.role === 'god' ? 'god' : 'catalog';
  await q('update users set is_admin = $2, admin_role = $3 where id = $1', [req.params.id, isAdmin, role]);
  await audit(req, 'user.role', { id: req.params.id, isAdmin, role });
  res.json({ ok: true });
});

// Switching modes zeroes the balance through the ledger, so fake money can
// never become real money (or the reverse).
adminRouter.post('/users/:id/test-mode', async (req, res) => {
  const on = !!req.body.testMode;
  try {
    await withTx(async (c) => {
      const u = (await c.query('select balance_cents, test_mode from users where id = $1 for update', [req.params.id])).rows[0];
      if (!u) throw Object.assign(new Error('not found'), { code: 404 });
      if (u.test_mode === on) return;
      if (!u.test_mode && Number(u.balance_cents) !== 0)
        throw Object.assign(new Error('This account holds real money. Zero it, or use a fresh account, before switching to test mode.'), { code: 409 });
      if (u.test_mode && Number(u.balance_cents) !== 0)
        await move(c, req.params.id, -Number(u.balance_cents), 'adjust', 'test-reset', { test: true });
      await c.query('update users set test_mode = $2 where id = $1', [req.params.id, on]);
      if (on) await move(c, req.params.id, 100000, 'deposit', 'test', { test: true });
    });
  } catch (e) { return res.status(e.code || 500).json({ error: e.message }); }
  await audit(req, 'user.test_mode', { id: req.params.id, on });
  res.json({ ok: true });
});

adminRouter.post('/users/test-account', async (req, res) => {
  const username = String(req.body.username || 'testmode').trim();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'username 3-24, letters, numbers, _' });
  if (password.length < 8) return res.status(400).json({ error: 'password min 8' });
  try {
    const u = await withTx(async (c) => {
      const r = await c.query(
        `insert into users (email, username, password_hash, test_mode) values ($1,$2,$3,true) returning id, username`,
        [`${username.toLowerCase()}@test.kohler`, username, await bcrypt.hash(password, 10)]);
      await move(c, r.rows[0].id, 100000, 'deposit', 'test', { test: true });
      return r.rows[0];
    });
    await audit(req, 'user.test_account', { id: u.id, username });
    res.json({ user: u });
  } catch (e) { res.status(409).json({ error: 'That username is taken.' }); }
});

adminRouter.post('/users/:id/ban', async (req, res) => {
  await q('update users set banned = $2 where id = $1', [req.params.id, !!req.body.banned]);
  if (req.body.banned) await q('delete from sessions where user_id = $1', [req.params.id]);
  res.json({ ok: true });
});

adminRouter.get('/house', async (_req, res) => {
  const { row, cfg, cents: walletCents, price } = await bankroll();
  const table = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5].map((b) => {
    const sats = Math.round(b * 1e8);
    const c = chain.satsToUsdCents(sats, price);
    return {
      sats,
      usd: chain.satsToUsd(sats, price),
      p2x: house.winChance({ walletCents: c, stakeCents: 200, multiplier: 2, cfg }),
      p10x: house.winChance({ walletCents: c, stakeCents: 200, multiplier: 10, cfg }),
    };
  });
  res.json({ house: row, cfg, price, bankrollCents: walletCents, table });
});

adminRouter.patch('/house', async (req, res) => {
  const b = req.body;
  const sets = [];
  const vals = [];
  const put = (col, v) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };
  if (b.balanceSats !== undefined) put('balance_sats', Math.round(Number(b.balanceSats)));
  if (b.tau !== undefined) put('tau', Number(b.tau));
  if (b.edge !== undefined) put('edge', Number(b.edge));
  if (b.maxChance !== undefined) put('max_chance', Number(b.maxChance));
  if (b.minChance !== undefined) put('min_chance', Number(b.minChance));
  if (b.maxMultiplier !== undefined) put('max_multiplier', Number(b.maxMultiplier));
  if (b.maxStakePct !== undefined) put('max_stake_pct', Number(b.maxStakePct));
  if (b.walletAddress !== undefined) { if (b.walletAddress && !chain.isValidAddress(String(b.walletAddress))) return res.status(400).json({ error: 'Not a valid Bitcoin address.' }); put('wallet_address', b.walletAddress || null); }
  if (b.enabled !== undefined) put('enabled', !!b.enabled);
  if (!sets.length) return res.json({ ok: true });
  await q(`update house_state set ${sets.join(', ')}, updated_at = now() where id = 1`, vals);
  await audit(req, 'house.update', b);
  res.json({ ok: true });
});

adminRouter.post('/house/topup', async (req, res) => {
  await houseMove(Math.round(Number(req.body.deltaSats || 0)), 'topup');
  res.json({ ok: true });
});

// Reads the real balance off the house address. Run it after every deposit or
// withdrawal Ã¢â‚¬â€ the algorithm is only honest while this figure is honest.
adminRouter.post('/house/sync', async (_req, res) => {
  const { row } = await houseCfg();
  if (!row.wallet_address) return res.status(400).json({ error: 'no house address set' });
  if (!chain.isValidAddress(row.wallet_address)) return res.status(400).json({ error: 'house address invalid' });
  try {
    const utxos = await fetch(`${process.env.MEMPOOL_API}/address/${row.wallet_address}/utxo`)
      .then((r) => (r.ok ? r.json() : []));
    const sats = utxos.filter((u) => u.status?.confirmed).reduce((a, u) => a + Number(u.value), 0);
    await q('update house_state set balance_sats = $1, updated_at = now() where id = 1', [sats]);
    await audit(req, 'house.sync', { sats });
    res.json({ sats });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

adminRouter.get('/withdrawals', async (_req, res) => {
  const r = await q(`select w.*, u.username from withdrawals w left join users u on u.id = w.user_id
    order by w.created_at desc limit 200`);
  res.json({ withdrawals: r.rows });
});

adminRouter.post('/withdrawals/:id/send', async (req, res) => {
  const r = await q('select * from withdrawals where id = $1 and status = $2', [req.params.id, 'pending']);
  const w = r.rows[0];
  if (!w) return res.status(404).json({ error: 'not found' });
  if (!chain.chainEnabled()) return res.status(400).json({ error: 'chain disabled' });
  try {
    const { txid, fee } = await chain.sendBtc(req.body.privateKey, w.address, Number(w.amount_sats));
    await q('update withdrawals set status = $2, tx_hash = $3, fee_sats = $4, handled_at = now() where id = $1',
      [w.id, 'sent', txid, fee]);
    await houseMove(-Number(w.amount_sats), 'withdraw', w.id).catch((e) => console.error('[house] ledger', e.message));
    await audit(req, 'withdrawal.send', { id: w.id, txid, sats: Number(w.amount_sats) });
    notifyWithdrawal(w.id, 'sent');
    res.json({ txid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Manual payout: you paid the user yourself (exchange, hardware wallet, any app)
// and record the transaction here. Nothing is signed or broadcast by Kohler.
adminRouter.post('/withdrawals/:id/mark-sent', async (req, res) => {
  const txid = String(req.body.txid || '').trim();
  const note = String(req.body.note || '').trim().slice(0, 300);
  if (!txid) return res.status(400).json({ error: 'Paste the transaction id (or a payment reference) first.' });
  const r = await q(
    `update withdrawals set status = 'sent', tx_hash = $2, handled_at = now() where id = $1 and status = 'pending' returning *`,
    [req.params.id, txid.slice(0, 120)]);
  if (!r.rows[0]) return res.status(404).json({ error: 'No pending withdrawal with that id.' });
  await audit(req, 'withdrawal.mark_sent', { id: req.params.id, txid, note, amount_cents: Number(r.rows[0].amount_cents) });
  notifyWithdrawal(req.params.id, 'sent');
  res.json({ ok: true, txid });
});

adminRouter.post('/withdrawals/:id/reject', async (req, res) => {
  const r = await q('select * from withdrawals where id = $1 and status = $2', [req.params.id, 'pending']);
  const w = r.rows[0];
  if (!w) return res.status(404).json({ error: 'not found' });
  // refund what was actually debited: amount plus the platform fee
  const fee = Number(w.platform_fee_cents || 0);
  await withTx(async (c) => {
    await move(c, w.user_id, Number(w.amount_cents) + fee, 'adjust', 'withdraw-rejected', { withdrawal: w.id, feeRefunded: fee });
    if (fee) await c.query('insert into platform_fees (user_id, kind, ref, amount_cents) values ($1,$2,$3,$4)', [w.user_id, 'withdrawal_refund', w.id, -fee]);
    await c.query('update withdrawals set status = $2, handled_at = now() where id = $1', [w.id, 'rejected']);
  });
  await audit(req, 'withdrawal.reject', { id: w.id, refunded: Number(w.amount_cents) + fee });
  notifyWithdrawal(w.id, 'rejected');
  res.json({ ok: true });
});

adminRouter.get('/claims', async (_req, res) => {
  const r = await q(`select c.*, u.username from deposit_claims c
    left join users u on u.id = c.user_id where c.status = 'pending' order by c.created_at`);
  res.json({ claims: r.rows });
});

adminRouter.post('/claims/:id/approve', async (req, res) => {
  const r = await q('select * from deposit_claims where id = $1 and status = $2', [req.params.id, 'pending']);
  const c = r.rows[0];
  if (!c) return res.status(404).json({ error: 'not found' });

  const price = await chain.btcPriceUsd();
  let sats = Number(req.body.sats || c.sats || 0);
  if (c.method === 'btc' && !sats) {
    const tx = await fetch(`${process.env.MEMPOOL_API}/tx/${c.txid}`)
      .then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!tx) return res.status(400).json({ error: 'tx not found on chain' });
    sats = (tx.vout || []).reduce((a, v) => a + Number(v.value || 0), 0);
  }
  if (sats <= 0) return res.status(400).json({ error: 'sats required' });

  const credit = chain.satsToUsdCents(sats, price);
  await withTx(async (cl) => {
    await move(cl, c.user_id, credit, 'deposit', c.txid, { method: c.method, sats, price });
    await cl.query('update deposit_claims set status = $2, sats = $3, handled_at = now() where id = $1',
      [c.id, 'approved', sats]);
  });
  if (c.method === 'btc') await houseMove(sats, 'deposit', c.txid);
  res.json({ credited: credit });
});

adminRouter.post('/claims/:id/reject', async (req, res) => {
  await q("update deposit_claims set status = 'rejected', handled_at = now() where id = $1", [req.params.id]);
  res.json({ ok: true });
});

adminRouter.use('/pool', poolPot.admin);   // god-only via the role middleware above
adminRouter.use('/casino', casino.admin);
adminRouter.use('/vault', vault.admin);
adminRouter.use('/avatars', avatars.admin);

/* payouts: manual by default, automatic when switched on */
adminRouter.get('/payouts', async (_req, res) => {
  const parent = (await q('select wallet_address from house_state where id = 1')).rows[0]?.wallet_address || null;
  res.json({ ...(await payouts.status()), parent, network: chain.isTestnet() ? 'testnet' : 'mainnet' });
});
// where every deposit is swept to (the "parent" address): your cold wallet, or the hot wallet
adminRouter.post('/payouts/parent', async (req, res) => {
  const addr = String(req.body?.address || '').trim();
  if (!chain.isValidAddress(addr)) return res.status(400).json({ error: `That isn't a valid ${chain.isTestnet() ? 'testnet' : 'mainnet'} Bitcoin address (${chain.addressHint()}).` });
  await q('update house_state set wallet_address = $1, updated_at = now() where id = 1', [addr]);
  await audit(req, 'payouts.parent', { address: addr });
  res.json({ parent: addr });
});
adminRouter.patch('/payouts', async (req, res) => {
  const b = req.body || {}, put = (k, v) => q(`insert into site_settings (key, value, updated_at) values ($1,$2,now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, String(v)]);
  if (b.auto !== undefined) await put('payouts_auto', !!b.auto);
  if (b.maxCents !== undefined) await put('payouts_max_cents', Math.max(0, Math.round(Number(b.maxCents))));
  if (b.dailyCents !== undefined) await put('payouts_daily_cents', Math.max(0, Math.round(Number(b.dailyCents))));
  if (b.minAgeHours !== undefined) await put('payouts_min_age_hours', Math.max(0, Math.round(Number(b.minAgeHours))));
  if (b.requireDeposit !== undefined) await put('payouts_require_deposit', !!b.requireDeposit);
  await audit(req, 'payouts.settings', b);
  if (b.auto) payouts.kick();
  res.json(await payouts.status());
});
adminRouter.post('/payouts/run', async (req, res) => { await audit(req, 'payouts.run'); res.json(await payouts.run({ force: true })); });
adminRouter.post('/payouts/use-hot-wallet', async (req, res) => {
  const w = payouts.hot();
  if (!w) return res.status(400).json({ error: 'Bitcoin is not enabled (CHAIN_ENABLED / DEPOSIT_MNEMONIC).' });
  await q('update house_state set wallet_address = $1, updated_at = now() where id = 1', [w.address]);
  await audit(req, 'payouts.sweep_to_hot', { address: w.address });
  res.json({ address: w.address });
});
// a payout stuck in "processing" after you've checked the blockchain: send it back to the queue
adminRouter.post('/withdrawals/:id/requeue', async (req, res) => {
  const r = await q(`update withdrawals set status = 'pending', auto = false, note = 'requeued by admin after checking' where id = $1 and status = 'processing' returning id`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'No payout in processing with that id.' });
  await audit(req, 'withdrawal.requeue', { id: req.params.id });
  res.json({ ok: true });
});

adminRouter.get('/email', (_req, res) => {
  const from = mailFrom();
  res.json({ keySet: !!process.env.RESEND_API_KEY, from, sandbox: mailIsSandbox(), orderTo: process.env.ORDER_EMAIL || null,
    alertTo: process.env.ALERT_EMAIL || process.env.ORDER_EMAIL || null, ...mailState });
});
adminRouter.post('/email/test', async (req, res) => {
  const to = String(req.body?.to || req.user.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'Enter an email address to send the test to.' });
  if (!process.env.RESEND_API_KEY || !mailFrom()) return res.status(400).json({ error: 'Set RESEND_API_KEY and MAIL_FROM first (Vercel: Settings → Environment Variables, then redeploy).' });
  try {
    await sendEmail({ to, subject: 'Kohler test email', html: '<p>Email from Kohler is working.</p>' });
    await audit(req, 'email.test', { to });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
adminRouter.get('/autopilot', async (_req, res) => {
  const alerts = await q(`select action, detail, created_at from admin_audit where action like 'alert.%' order by created_at desc limit 30`);
  res.json({ ...autopilot.status(), alerts: alerts.rows });
});
adminRouter.post('/autopilot/run', async (req, res) => {
  await audit(req, 'autopilot.run');
  res.json(await autopilot.run());
});

app.use('/api/admin', adminRouter);

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ deposit watcher Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

let depositWatcher = null;
if (chain.chainEnabled()) {
  depositWatcher = chain.watchDeposits({
    poll: !process.env.VERCEL,
    addresses: async () => (await q('select address, idx from deposit_addresses')).rows,
    // seen on the blockchain but not confirmed yet: the player's wallet shows it as incoming
    onPending: ({ address, txid, sats, confs, need }) => { incoming.set(address + ':' + txid, { address, txid, sats, confs, need, at: Date.now() }); },
    onCredit: async ({ txKey, address, idx, sats, txid }) => {
      incoming.delete(address + ':' + txid);
      const owner = await q('select user_id from deposit_addresses where address = $1', [address]);
      const userId = owner.rows[0]?.user_id;
      if (!userId) return;
      if (sats < Number(process.env.MIN_DEPOSIT_SATS || 20000)) {
        // too small to credit automatically: never silently ignored. It becomes a claim an admin
        // can approve, the admin gets an alert and the player an email.
        const c = await q(`insert into deposit_claims (user_id, txid, sats, method, note) values ($1,$2,$3,'btc',$4)
                           on conflict do nothing returning id`, [userId, txid || txKey, sats, `below the ${process.env.MIN_DEPOSIT_SATS || 20000}-sat minimum, flagged automatically`]).catch(() => ({ rows: [] }));
        if (c.rows[0]) {
          autopilot.alert('deposit_small_' + (txid || txKey).slice(0, 16), `A deposit of ${sats} sats is below the minimum. Review it in Admin → Deposits.`, { userId, sats }, 'warn').catch(() => {});
          notifyDeposit(userId, { sats, small: true });
        }
        return;
      }

      const price = await chain.btcPriceUsd();
      const grossCredit = chain.satsToUsdCents(sats, price);
      const platformFee = feeFor(grossCredit);
      const credit = grossCredit - platformFee;
      if (credit < 100) return;

      const fresh = await withTx(async (c) => {
        const ins = await c.query(
          `insert into seen_deposits (tx_key, user_id, sats, credited_cents, price_usd)
           values ($1,$2,$3,$4,$5) on conflict do nothing returning tx_key`,
          [txKey, userId, sats, credit, price]
        );
        if (!ins.rows[0]) return false;
        await move(c, userId, credit, 'deposit', txKey, { sats, price, platformFee });
        await c.query(
          'insert into platform_fees (user_id, kind, ref, amount_cents, amount_sats) values ($1,$2,$3,$4,$5)',
          [userId, 'deposit', txKey, platformFee, sats - chain.usdCentsToSats(credit, price)]
        );
        return true;
      });
      if (fresh) { await houseMove(sats, 'deposit', txKey); notifyDeposit(userId, { sats, credit }); }

      const house = await q('select wallet_address from house_state where id = 1');
      const parent = house.rows[0]?.wallet_address;
      if (!parent || !chain.isValidAddress(parent)) {
        console.error('[chain] deposit credited but parent address is not configured');
        return;
      }
      try {
        const swept = await chain.sweepAddress(idx, parent);
        if (swept.swept) console.log(`[chain] swept ${swept.amount} sats from ${address} to parent in ${swept.txid}`);
      } catch (e) {
        console.error('[chain] sweep failed', address, e.message);
      }
    },
  });
}

app.use((err, _req, res, _next) => {
  console.error('[err]', err.message);
  res.status(err.code && Number.isInteger(err.code) ? err.code : 500).json({ error: err.message || 'server error' });
});
process.on('unhandledRejection', (e) => console.error('[unhandled]', e?.message || e));
process.on('uncaughtException', (e) => {
  console.error('[fatal]', e?.stack || e);
  setTimeout(() => process.exit(1), 200); // npm run forever restarts it
});
/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ boot Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */

// Point an uptime monitor here. 200 = app and database fine, 503 = database unreachable.
app.get('/health', async (_req, res) => {
  const t0 = Date.now();
  try {
    await Promise.race([q('select 1'), new Promise((_, no) => setTimeout(() => no(new Error('db timeout')), 8000))]);
    res.json({ ok: true, db: 'up', dbMs: Date.now() - t0, uptimeSec: Math.round(process.uptime()) });
  } catch (e) {
    res.status(503).json({ ok: false, db: 'down', error: e.message, uptimeSec: Math.round(process.uptime()) });
  }
});
// pages: served from public/ on a normal server. On serverless hosts public/ is on the CDN and not
// next to this code, so the page addresses redirect to the files the CDN serves.
const PUBLIC = path.join(__dirname, 'public'), hasPublic = existsSync(path.join(PUBLIC, 'index.html'));
const page = (file) => (req, res) => (hasPublic ? res.sendFile(path.join(PUBLIC, file)) : res.redirect(302, '/' + file + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));
app.get(['/admin', '/admin/'], page('admin.html'));
app.get(['/casino', '/casino/'], page('casino.html'));
app.use((req, res) => (hasPublic ? res.sendFile(path.join(PUBLIC, 'index.html')) : req.path === '/' ? res.status(404).send('Not found') : res.redirect(302, '/')));

const port = process.env.PORT || 3001;
let bootTries = 0;
async function bootSequence() {
  try {
    await migrate(pool, path.join(__dirname, 'db'));
    await ensureTestAccount(q, { email: process.env.TEST_ACCOUNT_EMAIL || 'testkohler@yopmail.com', username: 'testkohler',
      password: process.env.TEST_ACCOUNT_PASSWORD || 'test1234' }).catch((e) => console.error('[boot] test account', e.message));
    // the casino catalogue is not allowed to keep the shop and sign-in offline
    await casino.setup().catch((e) => console.error('[boot] casino catalogue:', e.message, '(the rest of the site is up; it retries on next start)'));
    booted = true; bootError = null;
    if (!process.env.VERCEL) avatars.boot();
    console.log('[boot] ready: database up to date, casino catalog loaded');
    poolPot.start().catch((e) => console.error('[pool] start', e.message));
    setTimeout(() => autopilot.kick(), 10_000).unref();
  } catch (e) {
    bootError = !process.env.DATABASE_URL ? 'DATABASE_URL is not set. Add it to your environment variables (on Vercel: Project → Settings → Environment Variables), then redeploy.'
      : /ENOTFOUND|ECONNREFUSED|timeout|password authentication|does not exist/i.test(e.message) ? `the database is unreachable (${e.message}). Check DATABASE_URL.` : e.message;
    const wait = Math.min(60, 5 * ++bootTries);
    console.error(`[boot] ${bootError} Retrying in ${wait}s.`);
    setTimeout(() => ensureBooted(), wait * 1000).unref?.();
  }
}
ensureBooted();
// a normal server listens on PORT; Vercel imports the app and runs it as a function
const server = process.env.VERCEL ? null : app.listen(port, () => {
  console.log(`kohler on :${port}  →  http://localhost:${port}`);
  if (!chain.chainEnabled()) console.log('[chain] disabled: deposits and payouts are stubs');
});
export default app;

// stop cleanly on restarts/deploys: finish in-flight requests, then exit
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(`[kohler] ${sig}: shutting down`);
  poolPot.stop();
  if (!server) return pool.end().finally(() => process.exit(0));
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
});
