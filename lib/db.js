import dns from 'node:dns';
import pg from 'pg';

// Windows and some ISPs hand back unroutable IPv6 first; force IPv4 and let
// retries absorb Neon's cold-start window instead of dying on the first socket.
dns.setDefaultResultOrder('ipv4first');

const ssl = { rejectUnauthorized: false };

function connString() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set — check .env');
  const u = new URL(raw);
  u.searchParams.delete('sslmode');        // set in code; silences the pg warning
  u.searchParams.delete('uselibpqcompat');
  return u.toString();
}

export function makePool() {
  const pool = new pg.Pool({
    connectionString: connString(),
    ssl,
    max: 10,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 30_000,
  });
  // Neon drops idle sockets when it scales to zero. Without this listener the
  // 'error' event on an idle client is unhandled and takes the whole server down.
  pool.on('error', (e) => console.error('[db] idle connection dropped:', e.code || e.message));
  return pool;
}

export async function connectClient() {
  const c = new pg.Client({ connectionString: connString(), ssl, connectionTimeoutMillis: 20_000 });
  await c.connect();
  return c;
}

export async function withRetry(fn, { tries = 6, base = 800, label = 'db' } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (i === tries) break;
      const wait = base * 2 ** (i - 1);
      console.log(`[${label}] ${e.code || e.message} — retry ${i}/${tries - 1} in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}