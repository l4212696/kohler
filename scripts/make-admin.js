import 'dotenv/config';
import { connectClient } from '../lib/db.js';

const who = process.argv[2], role = process.argv[3];
if (!who || (role && !['god', 'finance', 'catalog'].includes(role))) {
  console.error('usage: npm run make-admin -- you@example.com [god|finance|catalog]   (no role: keeps their current one)');
  process.exit(1);
}
const c = await connectClient();
const r = await c.query(`update users set is_admin = true${role ? ', admin_role = $2' : ''} where email = $1 or username = $1 returning username, admin_role`,
  role ? [who, role] : [who]);
await c.end();
console.log(r.rowCount ? `admin: ${r.rows[0].username} (${r.rows[0].admin_role})` : 'user not found — register on the site first');