// Security helpers: rate limits that hold across serverless instances, two-factor codes (TOTP)
// for admins, security headers and a same-origin check for anything that changes data.
import crypto from 'node:crypto';

/* ── rate limits ──
   Kept in Postgres, so every Vercel instance sees the same counts (an in-memory counter resets
   whenever a new instance starts, which makes password guessing cheap). If the database call
   fails, an in-memory counter takes over rather than letting the request through unchecked. */
export function createLimiter(q) {
  const mem = new Map();
  const memHit = (key, windowMs) => {
    const now = Date.now(), b = mem.get(key) || { n: 0, reset: now + windowMs };
    if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
    b.n++; mem.set(key, b);
    if (mem.size > 5000) for (const [k, v] of mem) if (now > v.reset) mem.delete(k);
    return b.n;
  };
  async function hit(key, windowMs) {
    try {
      const r = await q(
        `insert into rate_limits (key, n, reset_at) values ($1, 1, now() + make_interval(secs => $2))
         on conflict (key) do update set
           n = case when rate_limits.reset_at < now() then 1 else rate_limits.n + 1 end,
           reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => $2) else rate_limits.reset_at end
         returning n`, [key, windowMs / 1000]);
      if (Math.random() < 0.01) q(`delete from rate_limits where reset_at < now() - interval '1 hour'`).catch(() => {});
      return Number(r.rows[0].n);
    } catch { return memHit(key, windowMs); }
  }
  async function count(key) {
    try { return Number((await q(`select n from rate_limits where key = $1 and reset_at > now()`, [key])).rows[0]?.n || 0); }
    catch { const b = mem.get(key); return b && Date.now() <= b.reset ? b.n : 0; }
  }
  const clear = (key) => q('delete from rate_limits where key = $1', [key]).catch(() => mem.delete(key));
  // true while under the limit; every call counts
  const limit = async (key, max, windowMs) => (await hit(key, windowMs)) <= max;
  return { limit, hit, count, clear };
}

/* ── TOTP (RFC 6238): the 6-digit codes from Google Authenticator, 1Password, Authy… ── */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, v = 0, out = '';
  for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(v << (5 - bits)) & 31];
  return out;
}
export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, v = 0; const out = [];
  for (const ch of clean) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newTotpSecret = () => base32(crypto.randomBytes(20));
export function totpAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
// Accepts the code for now, 30s ago or 30s ahead (phone clocks drift). Returns the time step it
// matched, so the caller can refuse the same code twice.
export function checkTotp(secret, code, now = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const step = Math.floor(now / 30_000);
  for (const d of [0, -1, 1]) {
    const want = Buffer.from(totpAt(secret, step + d)), got = Buffer.from(c);
    if (crypto.timingSafeEqual(want, got)) return step + d;
  }
  return null;
}
export const otpauthUrl = (secret, account, issuer = 'Kohler') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/* ── headers ──
   Vercel serves the HTML files itself, so vercel.json carries the same headers for those. */
export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/* ── same-origin check ──
   Session cookies are SameSite=Lax and the API only reads JSON, which already stops other sites
   from acting as a signed-in player. This is a second lock: a browser request that changes
   anything must come from Kohler's own pages. Signed server-to-server calls are exempt. */
export function sameOrigin({ exempt = [] } = {}) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || exempt.some((p) => req.originalUrl.startsWith(p))) return next();
    const origin = req.get('origin') || '';
    const fetchSite = req.get('sec-fetch-site');
    if (fetchSite === 'cross-site') return res.status(403).json({ error: 'Blocked: this request came from another website.' });
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { host = 'invalid'; }
      const own = [req.get('x-forwarded-host'), req.get('host')].filter(Boolean).map((h) => h.split(',')[0].trim());
      const extra = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean).map((o) => { try { return new URL(o).host; } catch { return o; } });
      if (!own.includes(host) && !extra.includes(host)) return res.status(403).json({ error: 'Blocked: this request came from another website.' });
    }
    next();
  };
}
