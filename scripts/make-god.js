import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { connectClient } from '../lib/db.js';

const email = process.argv[2] || 'l4212696@gmail.com';
const password = process.env.GOD_ADMIN_PASSWORD;
if (!password || password.length < 16) {
  console.error('Set GOD_ADMIN_PASSWORD to a strong password of at least 16 characters before running this command.');
  process.exit(1);
}

const c = await connectClient();
const hash = await bcrypt.hash(password, 12);
const r = await c.query(
  `update users set password_hash = $2, is_admin = true, admin_role = 'god'
   where lower(email) = lower($1) returning username`,
  [email, hash]
);
await c.end();
console.log(r.rowCount ? `god admin configured for ${email}` : 'user not found — register on the site first');
