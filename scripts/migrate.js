import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectClient, withRetry } from '../lib/db.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(dir, '..', 'db');

const files = ['schema.sql'];
try {
  const extra = (await fs.readdir(path.join(dbDir, 'migrations'))).filter((f) => f.endsWith('.sql')).sort();
  files.push(...extra.map((f) => path.join('migrations', f)));
} catch {}

const client = await withRetry(connectClient, { label: 'connect', tries: 8 });
console.log('connected');

await client.query(`create table if not exists schema_migrations (
  name text primary key, applied_at timestamptz not null default now())`);
const { rows } = await client.query('select name from schema_migrations');
const done = new Set(rows.map((r) => r.name.replace(/\\/g, '/')));  // Windows recorded backslashes

for (const rel of files) {
  const key = rel.split(path.sep).join('/');
  if (done.has(key)) { console.log('skip', key); continue; }
  const sql = await fs.readFile(path.join(dbDir, rel), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into schema_migrations (name) values ($1)', [key]);
    await client.query('commit');
    console.log('applied', rel);
  } catch (e) {
    await client.query('rollback');
    console.error('FAILED', rel, '—', e.message);
    await client.end();
    process.exit(1);
  }
}

const chk = await client.query("select count(*)::int n from house_state where id = 1");
console.log('house_state rows:', chk.rows[0].n);
await client.end();
console.log('done');
