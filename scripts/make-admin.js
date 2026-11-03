import 'dotenv/config';
import { connectClient } from '../lib/db.js';

const who = process.argv[2];
if (!who) { console.error('usage: npm run make-admin -- you@example.com'); process.exit(1); }
const c = await connectClient();
const r = await c.query('update users set is_admin = true where email = $1 or username = $1 returning username', [who]);
await c.end();
console.log(r.rowCount ? `admin: ${r.rows[0].username}` : 'user not found — register on the site first');