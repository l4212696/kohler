// Kohler Studio game engines. Pure functions: an outcome depends only on the
// RNG and the player's choices, never on balances or the house wallet. Every
// RTP below is a fixed, disclosed number and is checked by simulation in tests.
import crypto from 'node:crypto';

// uniform float in [0,1) with 53 bits of randomness from the OS CSPRNG
export const rand = () => Number(crypto.randomBytes(8).readBigUInt64BE(0) >> 11n) / 2 ** 53;
export const randInt = (n) => crypto.randomInt(n);
const pickWeighted = (items, r = rand()) => { let acc = 0; for (const it of items) { acc += it.p; if (r < acc) return it; } return null; };
const floorCents = (c) => Math.floor(c + 1e-9);

/* ── slots ────────────────────────────────────────────────────────────────
   5 reels x 3 rows, one payline (the middle row), pays left to right for 3, 4
   or 5 of a kind. Symbol 6 is the jackpot symbol (5 of a kind only).
   Outcome-first: each paytable line has a probability chosen so that
   sum(p * multiplier) equals the target RTP exactly, and so the share of
   winning spins (hit rate) matches the volatility. */
const SLOT_PROFILE = {
  low:  { base: [0.5, 0.8, 1, 1.5, 2, 3], jackpot: 100, hit: 0.36 },
  medium: { base: [0.5, 1, 1.5, 2.5, 4, 8], jackpot: 500, hit: 0.27 },
  high: { base: [0.4, 1, 2, 5, 10, 25], jackpot: 2000, hit: 0.17 },
};
const COUNT_FACTOR = { 3: 1, 4: 3, 5: 10 };
const slotCache = new Map();
export function slotPaytable(volatility = 'medium', rtp = 96) {
  const key = volatility + ':' + rtp;
  if (slotCache.has(key)) return slotCache.get(key);
  const prof = SLOT_PROFILE[volatility] || SLOT_PROFILE.medium;
  const lines = [];
  prof.base.forEach((b, s) => [3, 4, 5].forEach((n) => lines.push({ symbol: s, count: n, mult: Math.round(b * COUNT_FACTOR[n] * 100) / 100 })));
  lines.push({ symbol: 6, count: 5, mult: prof.jackpot });
  const R = rtp / 100;
  // p_i ∝ mult^-a. Hit rate H(a) = R * Σw / Σ(w*m) rises with a; bisect for the target.
  const H = (a) => { let sw = 0, swm = 0; for (const l of lines) { const w = l.mult ** -a; sw += w; swm += w * l.mult; } return R * sw / swm; };
  let lo = 0, hi = 8;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (H(mid) < prof.hit) lo = mid; else hi = mid; }
  const a = (lo + hi) / 2;
  let swm = 0; for (const l of lines) swm += l.mult ** -a * l.mult;
  const k = R / swm;
  for (const l of lines) l.p = k * l.mult ** -a;
  const out = { lines, hitRate: lines.reduce((s, l) => s + l.p, 0), rtp: lines.reduce((s, l) => s + l.p * l.mult, 0) * 100 };
  slotCache.set(key, out);
  return out;
}
export function spinSlot({ volatility, rtp, betCents }) {
  const pt = slotPaytable(volatility, rtp);
  const line = pickWeighted(pt.lines);
  const grid = Array.from({ length: 5 }, () => [0, 0, 0].map(() => randInt(6)));
  // middle row (index 1) carries the result; nothing else pays
  const mid = grid.map((col) => col[1]);
  if (line) {
    for (let i = 0; i < 5; i++) mid[i] = i < line.count ? line.symbol : mid[i];
    if (line.count < 5) { // the reel after the run must break it
      let s; do { s = randInt(7); } while (s === line.symbol); mid[line.count] = s === 6 ? (line.symbol + 1) % 6 : s;
    }
  } else {
    // no win: make sure the first three on the line aren't all the same
    if (mid[0] === mid[1] && mid[1] === mid[2]) mid[2] = (mid[2] + 1 + randInt(5)) % 6;
  }
  grid.forEach((col, i) => { col[1] = mid[i]; });
  // a rare jackpot symbol may appear off the line for show; it never pays there
  if (rand() < 0.08) grid[randInt(5)][randInt(2) * 2] = 6;
  const mult = line ? line.mult : 0;
  return { grid, line: line ? { symbol: line.symbol, count: line.count } : null, mult, payoutCents: floorCents(betCents * mult) };
}

/* ── roulette (European, single zero, RTP 97.30%) ─────────────────────── */
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const OUTSIDE = {
  red: (n) => RED.has(n), black: (n) => n > 0 && !RED.has(n), odd: (n) => n % 2 === 1, even: (n) => n > 0 && n % 2 === 0,
  low: (n) => n >= 1 && n <= 18, high: (n) => n >= 19, dozen1: (n) => n >= 1 && n <= 12, dozen2: (n) => n >= 13 && n <= 24,
  dozen3: (n) => n >= 25, col1: (n) => n > 0 && n % 3 === 1, col2: (n) => n > 0 && n % 3 === 2, col3: (n) => n > 0 && n % 3 === 0,
};
const PAYS = { red: 2, black: 2, odd: 2, even: 2, low: 2, high: 2, dozen1: 3, dozen2: 3, dozen3: 3, col1: 3, col2: 3, col3: 3 };
export function validateRouletteBets(bets) {
  if (!Array.isArray(bets) || !bets.length || bets.length > 40) return null;
  const out = [];
  for (const b of bets) {
    const cents = Math.round(Number(b.cents));
    if (!(cents > 0)) return null;
    if (/^n\d{1,2}$/.test(b.on) && Number(b.on.slice(1)) <= 36) out.push({ on: b.on, cents });
    else if (OUTSIDE[b.on]) out.push({ on: b.on, cents });
    else return null;
  }
  return out;
}
export function spinRoulette(bets) {
  const n = randInt(37);
  let payout = 0;
  for (const b of bets) {
    if (b.on[0] === 'n') { if (Number(b.on.slice(1)) === n) payout += b.cents * 36; }
    else if (OUTSIDE[b.on](n)) payout += b.cents * PAYS[b.on];
  }
  return { number: n, color: n === 0 ? 'green' : RED.has(n) ? 'red' : 'black', payoutCents: payout };
}

/* ── dice (roll under, RTP 99%) ─────────────────────────────────────────── */
export function rollDice({ target, betCents }) {
  const t = Math.min(95, Math.max(2, Math.round(Number(target) * 100) / 100));
  const roll = randInt(10000) / 100;              // 0.00 – 99.99
  const mult = Math.floor((99 / t) * 10000) / 10000;
  const win = roll < t;
  return { roll, target: t, mult, win, payoutCents: win ? floorCents(betCents * mult) : 0 };
}

/* ── plinko (RTP ≈ 99%) ──────────────────────────────────────────────────── */
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
const plinkoCache = new Map();
export function plinkoTable(rows = 12, risk = 'medium') {
  const key = rows + risk;
  if (plinkoCache.has(key)) return plinkoCache.get(key);
  const g = { low: 1.6, medium: 2.6, high: 4 }[risk] || 2.6;
  const floor = { low: 0.5, medium: 0.3, high: 0.2 }[risk] || 0.3;
  const p = Array.from({ length: rows + 1 }, (_, k) => binom(rows, k) / 2 ** rows);
  const s = p.map((_, k) => (Math.abs(k - rows / 2) / (rows / 2)) ** g);
  // m_k = floor + c * s_k, solve c for EV 0.99, then round down to 2 decimals
  const c = (0.99 - floor) / p.reduce((a, pk, k) => a + pk * s[k], 0);
  const mult = s.map((sk) => Math.floor((floor + c * sk) * 100) / 100);
  const out = { rows, risk, mult, p, rtp: p.reduce((a, pk, k) => a + pk * mult[k], 0) * 100 };
  plinkoCache.set(key, out);
  return out;
}
export function dropPlinko({ rows, risk, betCents }) {
  const t = plinkoTable(rows, risk);
  const path = Array.from({ length: rows }, () => randInt(2));
  const bin = path.reduce((a, b) => a + b, 0);
  return { path, bin, mult: t.mult[bin], payoutCents: floorCents(betCents * t.mult[bin]) };
}

/* ── wheel ─────────────────────────────────────────────────────────────────
   Every segment is equally likely, so RTP is simply the average segment. */
const WHEEL_SHAPES = {
  low: [[0, 6], [1.2, 9], [1.5, 4], [2.4, 1]],              // 20 segments, 96.00%
  medium: [[0, 16], [1.5, 6], [2, 5], [3, 2], [4, 1]],       // 30 segments, 96.67%
  high: [[0, 27], [4.8, 1], [9, 1], [15, 1]],                // 30 segments, 96.00%
};
const wheelCache = new Map();
export function wheelTable(risk = 'medium') {
  if (wheelCache.has(risk)) return wheelCache.get(risk);
  const shape = WHEEL_SHAPES[risk] || WHEEL_SHAPES.medium;
  // spread each value evenly round the wheel so equal values don't bunch together
  const segs = shape.flatMap(([m, c], j) => Array.from({ length: c }, (_, k) => ({ m, key: ((k + 0.5) / c + j * 0.29) % 1 })))
    .sort((x, y) => x.key - y.key).map((x) => x.m);
  const out = { risk, segments: segs, rtp: segs.reduce((a, m) => a + m, 0) / segs.length * 100 };
  wheelCache.set(risk, out);
  return out;
}
export function spinWheel({ risk, betCents }) {
  const t = wheelTable(risk);
  const index = randInt(t.segments.length);
  return { index, mult: t.segments[index], payoutCents: floorCents(betCents * t.segments[index]) };
}

/* ── blackjack ────────────────────────────────────────────────────────────
   Continuous shuffle (every card drawn from a full deck), dealer stands on all
   17s, blackjack pays 3:2, double on any first two cards, no split, no
   insurance. RTP ≈ 99.3% with basic strategy (see tests). */
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
export const drawCard = () => ({ r: RANKS[randInt(13)], s: SUITS[randInt(4)] });
const val = (c) => (c.r === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r));
export function handValue(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { t += val(c); if (c.r === 'A') aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { total: t, soft: aces > 0 };
}
const isBJ = (cards) => cards.length === 2 && handValue(cards).total === 21;

export function bjDeal(betCents) {
  const s = { bet: betCents, player: [drawCard(), drawCard()], dealer: [drawCard(), drawCard()], doubled: false, done: false };
  if (isBJ(s.player) || isBJ(s.dealer)) return bjSettle(s);
  return s;
}
export function bjAct(s, action) {
  if (s.done) throw new Error('round over');
  if (action === 'hit') { s.player.push(drawCard()); if (handValue(s.player).total >= 21) return bjFinish(s); return s; }
  if (action === 'stand') return bjFinish(s);
  if (action === 'double') {
    if (s.player.length !== 2) throw new Error('double only on two cards');
    s.doubled = true; s.bet *= 2; s.player.push(drawCard()); return bjFinish(s);
  }
  throw new Error('unknown action');
}
function bjFinish(s) {
  if (handValue(s.player).total <= 21) while (handValue(s.dealer).total < 17) s.dealer.push(drawCard());
  return bjSettle(s);
}
function bjSettle(s) {
  const p = handValue(s.player).total, d = handValue(s.dealer).total;
  const pbj = isBJ(s.player) && !s.doubled, dbj = isBJ(s.dealer);
  let pay = 0, result;
  if (pbj && dbj) { pay = s.bet; result = 'push'; }
  else if (pbj) { pay = floorCents(s.bet * 2.5); result = 'blackjack'; }
  else if (dbj) { result = 'dealer blackjack'; }
  else if (p > 21) { result = 'bust'; }
  else if (d > 21 || p > d) { pay = s.bet * 2; result = 'win'; }
  else if (p === d) { pay = s.bet; result = 'push'; }
  else { result = 'lose'; }
  return Object.assign(s, { done: true, payoutCents: pay, result, playerTotal: p, dealerTotal: d });
}
// basic strategy for this rule set (no split), used by tests to measure RTP
export function basicStrategy(player, dealerUp) {
  const { total, soft } = handValue(player); const up = Math.min(val(dealerUp), 11) === 11 ? 11 : val(dealerUp);
  const two = player.length === 2;
  if (soft) {
    if (total >= 19) return total === 19 && up === 6 && two ? 'double' : 'stand';
    if (total === 18) return up >= 3 && up <= 6 && two ? 'double' : up <= 8 ? 'stand' : 'hit';
    if (total === 17) return up >= 3 && up <= 6 && two ? 'double' : 'hit';
    if (total >= 15) return up >= 4 && up <= 6 && two ? 'double' : 'hit';
    return up >= 5 && up <= 6 && two ? 'double' : 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (total === 11) return two ? 'double' : 'hit';
  if (total === 10) return up <= 9 && two ? 'double' : 'hit';
  if (total === 9) return up >= 3 && up <= 6 && two ? 'double' : 'hit';
  return 'hit';
}

/* ── Kohler originals ─────────────────────────────────────────────────────── */

// Coin Flip: call it, paid 1.96× (RTP 98%)
export const COIN_MULT = 1.96;
export function flipCoin({ side, betCents }) {
  const result = randInt(2) ? 'heads' : 'tails';
  const win = result === side;
  return { result, side, win, mult: COIN_MULT, payoutCents: win ? floorCents(betCents * COIN_MULT) : 0 };
}

// Limbo: pick a target; the result is 0.99/U, so P(result ≥ t) = 0.99/t and RTP is 99% at every target
export function limboResult() { return Math.min(1_000_000, Math.max(1, Math.floor((0.99 / (1 - rand())) * 100) / 100)); }
export function playLimbo({ target, betCents }) {
  const t = Math.min(1_000_000, Math.max(1.01, Math.floor(Number(target) * 100) / 100));
  const result = limboResult();
  const win = result >= t;
  return { target: t, result, win, payoutCents: win ? floorCents(betCents * t) : 0 };
}

/* ── Keno Boss ───────────────────────────────────────────────────────────
   40 numbers, the player picks 1–10, we draw 10. The chance of k hits is
   hypergeometric. Each pick count has its own paytable, built so the RTP is just
   under the target (rounding always goes down), with a cap on the top prize.
   "classic" pays more often; "boss" pays rarely but much bigger. */
export const KENO = { size: 40, draw: 10, maxPicks: 10, rtp: 0.97 };
const KENO_RISK = { classic: { base: 2.6, cap: 500, start: (n) => Math.max(1, Math.ceil(n * 0.35)) }, boss: { base: 6, cap: 2500, start: (n) => Math.max(1, Math.ceil(n * 0.55)) } };
const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
export const kenoProb = (n, k) => (choose(KENO.draw, k) * choose(KENO.size - KENO.draw, n - k)) / choose(KENO.size, n);
const kenoCache = new Map();
export function kenoPaytable(picks, risk = 'classic') {
  const n = Math.min(KENO.maxPicks, Math.max(1, Math.round(Number(picks) || 0))), R = KENO_RISK[risk] ? risk : 'classic', key = n + R;
  if (kenoCache.has(key)) return kenoCache.get(key);
  const P = KENO_RISK[R], m = P.start(n);
  // shape: nothing below m hits, then growing steeply; scale to the RTP, cap, re-scale the rest
  let w = Array.from({ length: n + 1 }, (_, k) => (k >= m ? Math.pow(P.base, k - m) : 0));
  let mult = w.slice();
  for (let pass = 0; pass < 8; pass++) {
    const capped = mult.map((x) => x >= P.cap);
    const fixedEv = mult.reduce((a, x, k) => a + (capped[k] ? P.cap * kenoProb(n, k) : 0), 0);
    const freeEv = w.reduce((a, x, k) => a + (capped[k] ? 0 : x * kenoProb(n, k)), 0);
    const scale = freeEv > 0 ? (KENO.rtp - fixedEv) / freeEv : 0;
    mult = w.map((x, k) => (capped[k] ? P.cap : x * scale));
  }
  mult = mult.map((x) => (x > 0 ? Math.floor(Math.min(P.cap, x) * 100) / 100 : 0));
  const rtp = mult.reduce((a, x, k) => a + x * kenoProb(n, k), 0);
  const t = { picks: n, risk: R, mult, rtp: Math.round(rtp * 10000) / 100, odds: mult.map((_, k) => kenoProb(n, k)) };
  kenoCache.set(key, t);
  return t;
}
export function kenoDraw() {
  const pool = Array.from({ length: KENO.size }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) { const j = randInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, KENO.draw);
}
export function validateKenoPicks(picks) {
  if (!Array.isArray(picks)) return null;
  const set = [...new Set(picks.map((x) => Math.round(Number(x))))].filter((x) => x >= 1 && x <= KENO.size);
  return set.length >= 1 && set.length <= KENO.maxPicks && set.length === picks.length ? set.sort((a, b) => a - b) : null;
}
export function playKeno({ picks, risk, betCents }) {
  const table = kenoPaytable(picks.length, risk), drawn = kenoDraw();
  const hits = picks.filter((x) => drawn.includes(x));
  const m = table.mult[hits.length] || 0;
  return { picks, drawn, hits, risk: table.risk, mult: m, win: m > 0, payoutCents: m > 0 ? floorCents(betCents * m) : 0 };
}

// Rocket: the crash point uses the same 0.99/U law (1% of rounds end at 1.00×).
// The multiplier grows as e^(0.07·seconds), measured on the server clock.
export const ROCKET_RATE = 0.07;
export const rocketAt = (ms) => Math.floor(Math.exp(ROCKET_RATE * (ms / 1000)) * 100) / 100;
export const rocketMsFor = (m) => (Math.log(m) / ROCKET_RATE) * 1000;
export const crashPoint = () => Math.min(1000, limboResult());

// Mines: 25 tiles, m mines. After k safe picks the payout is 0.99 × the inverse
// probability of having survived k picks, so RTP is 99% whenever you cash out.
export function minesMult(m, k) {
  let p = 1;
  for (let i = 0; i < k; i++) p *= (25 - m - i) / (25 - i);
  return k === 0 ? 1 : Math.floor((0.99 / p) * 100) / 100;
}
export function placeMines(m) {
  const tiles = Array.from({ length: 25 }, (_, i) => i);
  for (let i = 24; i > 0; i--) { const j = randInt(i + 1); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
  return tiles.slice(0, m).sort((a, b) => a - b);
}
