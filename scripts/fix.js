// npm run fix                         migrate, switch gambling + Pool Pot on, make every
//                                     current user a full admin, create the test account
// npm run fix -- --reset WHO PASSWORD  set a new password for an account (email or username)
// npm run fix -- --check WHO PASSWORD  explain exactly why a login fails
// npm run fix -- --test-password PW    set the password of the "testmode" account
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { connectClient, withRetry } from '../lib/db.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, n = 1) => { const i = args.indexOf(name); return i < 0 ? null : args.slice(i + 1, i + 1 + n); };
const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = (m) => console.log('  \x1b[31m✗\x1b[0m ' + m);
const info = (m) => console.log('    ' + m);

console.log('\nKohler fix\n');

// 1. database
let c;
try {
  const host = new URL(process.env.DATABASE_URL || 'postgres://missing').hostname;
  c = await withRetry(connectClient, { tries: 4, label: 'connect' });
  ok(`database reachable (${host})`);
} catch (e) {
  bad('cannot reach the database: ' + (e.code || e.message));
  const m = `${e.code} ${e.message}`;
  if (/DATABASE_URL/.test(m)) info('DATABASE_URL is missing from .env.');
  else if (/ENOTFOUND|EAI_AGAIN/.test(m)) info('The Neon host name does not resolve. Check internet/VPN and that DATABASE_URL is copied exactly.');
  else if (/28P01|password authentication/.test(m)) info('Neon rejected the password in DATABASE_URL. Copy a fresh connection string from the Neon console.');
  else if (/quota|exceeded|suspend|limit/i.test(m)) info('Neon suspended the compute: the free plan ran out of compute hours or transfer for this month. Upgrade or wait for the reset.');
  else if (/ETIMEDOUT|ECONNREFUSED|ENETUNREACH/.test(m)) info('Port 5432 is blocked on this network, or Neon is waking up. Try again, or another network.');
  info('Every login fails while this is broken. That is the most common cause of "login doesn\'t work".');
  process.exit(1);
}

// 2. migrations (includes 006 Pool Pot and 007 test mode)
const mig = spawnSync(process.execPath, [path.join(dir, 'migrate.js')], { encoding: 'utf8' });
if (mig.status !== 0) { bad('migrations failed'); console.log(mig.stdout, mig.stderr); process.exit(1); }
const applied = (mig.stdout.match(/^applied .*/gm) || []);
ok(applied.length ? `migrations applied: ${applied.map((l) => l.slice(8)).join(', ')}` : 'migrations up to date');

// 3. switches
for (const key of ['gambling_enabled', 'pool_enabled']) {
  await c.query(`insert into site_settings (key, value, updated_at) values ($1, 'true', now())
                 on conflict (key) do update set value = 'true', updated_at = now()`, [key]);
}
ok('gambling switch ON, Pool Pot ON');

// 4. password tools
const reset = flag('--reset', 2);
if (reset?.length === 2) {
  const [who, pw] = reset;
  if (pw.length < 8) { bad('new password must be at least 8 characters'); process.exit(1); }
  const r = await c.query(
    `update users set password_hash = $2 where lower(email) = lower($1) or lower(username::text) = lower($1) returning username, email`,
    [who, await bcrypt.hash(pw, 10)]);
  if (!r.rowCount) bad(`no account matches "${who}"`);
  else {
    await c.query('delete from sessions where user_id in (select id from users where lower(email) = lower($1) or lower(username::text) = lower($1))', [who]);
    ok(`password reset for ${r.rows[0].username} <${r.rows[0].email}>`);
  }
}
const check = flag('--check', 2);
if (check?.length === 2) {
  const [who, pw] = check;
  const r = await c.query('select username, email, password_hash, banned from users where lower(email) = lower($1) or lower(username::text) = lower($1)', [who]);
  const u = r.rows[0];
  if (!u) bad(`login check: no account with email or username "${who}"`);
  else if (!u.password_hash) bad(`login check: ${u.username} has no password set. Use --reset.`);
  else if (u.banned) bad(`login check: ${u.username} is suspended.`);
  else if (!(await bcrypt.compare(pw, u.password_hash))) bad(`login check: wrong password for ${u.username}. (npm run make-god replaces the god account's password with GOD_ADMIN_PASSWORD.) Use --reset.`);
  else ok(`login check: ${u.username} + that password is correct. If the site still fails, open it at http://localhost:${process.env.PORT || 3001} (not the .html file directly).`);
}

// 5. every current real user becomes a full admin
const promoted = await c.query(
  `update users set is_admin = true, admin_role = 'god' where not test_mode and not (is_admin and admin_role = 'god')
   returning username, email`);
const admins = await c.query(`select username, email from users where is_admin and admin_role = 'god' and not test_mode order by created_at`);
ok(`${admins.rowCount} full admin${admins.rowCount === 1 ? '' : 's'}${promoted.rowCount ? ` (${promoted.rowCount} promoted now)` : ''}`);
for (const a of admins.rows) info(`${a.username}  <${a.email}>`);

// 6. test account
const tpw = flag('--test-password')?.[0];
const t = (await c.query(`select id, username from users where username = 'testmode'`)).rows[0];
if (!t) {
  const pw = tpw || crypto.randomBytes(6).toString('base64url');
  await c.query('begin');
  const r = await c.query(
    `insert into users (email, username, password_hash, test_mode, balance_cents) values ('testmode@test.kohler', 'testmode', $1, true, 100000) returning id`,
    [await bcrypt.hash(pw, 10)]);
  await c.query(`insert into ledger (user_id, delta_cents, kind, ref, meta) values ($1, 100000, 'deposit', 'test', '{"test":true}')`, [r.rows[0].id]);
  await c.query('commit');
  ok('test account created with $1,000 of fake money');
  info(`username: testmode    password: ${pw}`);
} else {
  await c.query('update users set test_mode = true where id = $1', [t.id]);
  if (tpw) {
    await c.query('update users set password_hash = $2 where id = $1', [t.id, await bcrypt.hash(tpw, 10)]);
    ok(`test account password set: testmode / ${tpw}`);
  } else ok('test account exists: username testmode (pass --test-password NEWPW to change its password)');
}

// 7. config warnings that break sign-in
if (process.env.COOKIE_SECURE === 'true' && /^http:/.test(process.env.PUBLIC_URL || 'http:'))
  bad('COOKIE_SECURE=true on plain http: browsers drop the session cookie, so you get logged straight back out. Set COOKIE_SECURE=false for local use.');
const port = String(process.env.PORT || 3001);
const pubPort = (() => { try { const u = new URL(process.env.PUBLIC_URL || ''); return u.port || (u.protocol === 'https:' ? '443' : '80'); } catch { return null; } })();
if (/localhost|127\.0\.0\.1/.test(process.env.PUBLIC_URL || '') && pubPort !== port)
  bad(`PUBLIC_URL is ${process.env.PUBLIC_URL} but the server listens on port ${port}. Open http://localhost:${port}, and set PUBLIC_URL to match (sign-in links use it).`);
if (process.env.CHAIN_ENABLED === 'true')
  info('Note: CHAIN_ENABLED=true polls the database every 15s, so Neon never sleeps and the free plan\'s compute hours run out mid-month.');

await c.end();
console.log(`\nDone. Start with  npm run forever  and open http://localhost:${port}\n`);
