import 'dotenv/config';
import dns from 'node:dns/promises';
import net from 'node:net';
import { connectClient } from '../lib/db.js';

const raw = process.env.DATABASE_URL;
if (!raw) { console.error('DATABASE_URL missing'); process.exit(1); }

const u = new URL(raw);
console.log('host:', u.hostname, 'port:', u.port || 5432, 'user:', u.username, 'db:', u.pathname.slice(1));
console.log('pooled endpoint:', u.hostname.includes('-pooler'));

try {
  const recs = await dns.lookup(u.hostname, { all: true });
  console.log('resolves to:', recs.map((r) => `${r.address} (v${r.family})`).join(', '));
} catch (e) { console.log('DNS failed:', e.message); }

await new Promise((res) => {
  const s = net.connect({ host: u.hostname, port: Number(u.port || 5432), timeout: 8000 });
  s.on('connect', () => { console.log('TCP: reachable'); s.destroy(); res(); });
  s.on('timeout', () => { console.log('TCP: timed out'); s.destroy(); res(); });
  s.on('error', (e) => { console.log('TCP:', e.code || e.message); res(); });
});

try {
  const c = await connectClient();
  const r = await c.query("select current_database() db, (select count(*) from information_schema.tables where table_schema='public') tables");
  console.log('SQL: connected —', r.rows[0].tables, 'tables in public');
  await c.end();
} catch (e) { console.log('SQL:', e.code || e.message); }