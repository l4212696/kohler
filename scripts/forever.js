// npm run forever
// Keeps Kohler running: restarts server.js whenever it stops, with a short
// back-off so a crash loop can't spin the CPU. Output goes to the terminal and
// to logs/kohler-YYYY-MM-DD.log (the last 14 days are kept).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const logDir = path.join(root, 'logs');
fs.mkdirSync(logDir, { recursive: true });

const day = () => new Date().toISOString().slice(0, 10);
const write = (line) => {
  process.stdout.write(line);
  try { fs.appendFileSync(path.join(logDir, `kohler-${day()}.log`), line); } catch {}
};
const prune = () => {
  const cutoff = Date.now() - 14 * 864e5;
  for (const f of fs.readdirSync(logDir)) {
    const p = path.join(logDir, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
  }
};

let child, stopping = false, restarts = 0, startedAt = 0;

function start() {
  prune();
  startedAt = Date.now();
  write(`\n[forever] ${new Date().toISOString()} starting server.js\n`);
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (s) => s.on('data', (d) => write(String(d).split('\n').map((l, i, a) => (l || i < a.length - 1 ? `${new Date().toISOString().slice(11, 19)} ${l}` : '')).join('\n')));
  pipe(child.stdout); pipe(child.stderr);
  child.on('exit', (code, sig) => {
    if (stopping) return process.exit(0);
    // a process that ran for 5+ minutes was healthy: reset the back-off
    if (Date.now() - startedAt > 5 * 60_000) restarts = 0;
    const wait = Math.min(60_000, 1000 * 2 ** restarts++);
    write(`[forever] server exited (${sig || code}); restarting in ${wait / 1000}s\n`);
    setTimeout(start, wait);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; child?.kill('SIGTERM'); setTimeout(() => process.exit(0), 9000); });
start();
