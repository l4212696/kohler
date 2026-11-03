// Runs before the server starts listening:
//   1. applies any database migrations that haven't run yet (same rules as npm run migrate)
//   2. makes sure the owner's fake-money test account exists
// So pulling new code and running `npm start` is enough. No separate migrate step to forget.
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';

export async function migrate(pool, dbDir, log = console) {
  const c = await pool.connect();
  try {
    await c.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name));
    // the db/ folder when it's there (your PC); the bundled copy on hosts that only ship JS (Vercel)
    const onDisk = await fs.access(path.join(dbDir, 'schema.sql')).then(() => true, () => false);
    const bundle = onDisk ? null : (await import('./sql-bundle.js')).default;
    const files = onDisk ? ['schema.sql', ...(await fs.readdir(path.join(dbDir, 'migrations')).catch(() => []))
      .filter((f) => f.endsWith('.sql')).sort().map((f) => path.join('migrations', f))] : Object.keys(bundle);
    const applied = [];
    for (const rel of files) {
      const key = rel.split(path.sep).join('/');
      if (done.has(key) || done.has(rel)) continue;
      const sql = bundle ? bundle[rel] : await fs.readFile(path.join(dbDir, rel), 'utf8');
      await c.query('begin');
      try {
        if (rel === 'schema.sql') await c.query('create extension if not exists citext');
        await c.query(sql);
        await c.query('insert into schema_migrations (name) values ($1)', [key]);
        await c.query('commit');
        applied.push(key);
      } catch (e) {
        await c.query('rollback');
        throw new Error(`migration ${key} failed: ${e.message}`);
      }
    }
    if (applied.length) log.log('[boot] migrations applied:', applied.join(', '));
    return applied;
  } finally { c.release(); }
}

// The owner's manual-testing account. Fake money only (test_mode), never a real balance.
export async function ensureTestAccount(q, { email, username, password }, log = console) {
  const hash = await bcrypt.hash(password, 10);
  const u = (await q('select id, test_mode, balance_cents from users where lower(email) = lower($1)', [email])).rows[0];
  if (!u) {
    const taken = (await q('select 1 from users where lower(username::text) = lower($1)', [username])).rows[0];
    const r = await q(`insert into users (email, username, password_hash, test_mode, balance_cents) values ($1,$2,$3,true,100000) returning id`,
      [email, taken ? username + Math.floor(Math.random() * 900 + 100) : username, hash]);
    await q(`insert into ledger (user_id, delta_cents, kind, ref, meta) values ($1, 100000, 'deposit', 'test', '{"test":true}')`, [r.rows[0].id]);
    log.log(`[boot] test account ready: ${email}`);
    return;
  }
  if (!u.test_mode) {
    // an ordinary account was registered with this email: only convert it if it holds no real money
    if (Number(u.balance_cents) !== 0) { log.warn(`[boot] ${email} holds real money, so it was left as a normal account`); return; }
    await q('update users set test_mode = true, password_hash = $2 where id = $1', [u.id, hash]);
    await q('update users set balance_cents = balance_cents + 100000 where id = $1', [u.id]);
    await q(`insert into ledger (user_id, delta_cents, kind, ref, meta) values ($1, 100000, 'deposit', 'test', '{"test":true}')`, [u.id]);
    log.log(`[boot] ${email} switched to a fake-money test account`);
  } else {
    await q('update users set password_hash = $2 where id = $1', [u.id, hash]);
  }
}
