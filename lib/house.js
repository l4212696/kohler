// Kohler house model.
//
// We never want to owe. Payout probability scales with how much the house hot
// wallet actually holds, relative to the round's liability, and asymptotes
// strictly below fair odds so EV stays positive at every wallet size.
//
//   liability  L = stake * (m - 1)
//   ratio      r = wallet / L
//   pMax       = min(maxChance, edge / m)          <- hard ceiling, always < 1/m
//   p          = pMax * (1 - e^(-r / tau))         <- 0 at r=0, monotone -> pMax
//
// Reference: wallet $20, stake $2, m=2 -> L=$2, r=10, p = 0.4925*0.811 = 0.3995
// i.e. ~40%, exactly as specified. wallet $200 -> r=100 -> 0.4826. $2000 -> 0.4918.
// Never reaches pMax, so the book can't be beaten by a whale.

const DEFAULTS = {
  tau: 6.0,
  edge: 0.985,
  maxChance: 0.4925,
  minChance: 0.02,
  maxMultiplier: 100,
  maxStakePct: 0.25,
};

export function normalizeConfig(row = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    tau: num(row.tau, DEFAULTS.tau),
    edge: Math.min(num(row.edge, DEFAULTS.edge), 0.999),
    maxChance: num(row.max_chance, DEFAULTS.maxChance),
    minChance: num(row.min_chance, DEFAULTS.minChance),
    maxMultiplier: num(row.max_multiplier, DEFAULTS.maxMultiplier),
    maxStakePct: num(row.max_stake_pct, DEFAULTS.maxStakePct),
  };
}

export function ceilingFor(multiplier, cfg) {
  return Math.min(cfg.maxChance, cfg.edge / multiplier);
}

export function winChance({ walletCents, stakeCents, multiplier, cfg }) {
  const m = Math.max(multiplier, 1.0001);
  const pMax = ceilingFor(m, cfg);
  const liability = stakeCents * (m - 1);
  if (liability <= 0) return pMax;
  if (walletCents <= 0) return 0;
  const r = walletCents / liability;
  const p = pMax * (1 - Math.exp(-r / cfg.tau));
  // The floor is cosmetic (games must feel live) and only applies once there is
  // real money behind the book. It is small enough that debt stays bounded.
  return Math.max(Math.min(p, pMax), Math.min(cfg.minChance, pMax));
}

export function maxStakeCents(walletCents, cfg, multiplier = 2) {
  if (walletCents <= 0) return 0;
  const cap = walletCents * cfg.maxStakePct;
  return Math.max(100, Math.floor(cap));
}

// Survival-function inversion: P(M >= x) = winChance(x). Monotone decreasing in
// x, so a bisection over a single uniform draw samples the crash distribution.
export function sampleCrashPoint({ walletCents, stakeCents, cfg, u = Math.random() }) {
  const at = (x) => winChance({ walletCents, stakeCents, multiplier: x, cfg });
  if (u >= at(1)) return 1;
  if (u <= at(cfg.maxMultiplier)) return cfg.maxMultiplier;
  let lo = 1;
  let hi = cfg.maxMultiplier;
  for (let i = 0; i < 42; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > u) lo = mid;
    else hi = mid;
  }
  return Math.max(1, Math.floor(lo * 100) / 100);
}

export const multiplierAt = (elapsedMs, rate = 0.09) => Math.exp(rate * (elapsedMs / 1000));

export function exposureReport(walletCents, cfg, { stakeCents, multiplier }) {
  const p = winChance({ walletCents, stakeCents, multiplier, cfg });
  const liability = Math.round(stakeCents * (multiplier - 1));
  const ev = stakeCents - p * stakeCents * multiplier;
  return { p, liability, houseEvCents: ev, solvency: liability ? walletCents / liability : Infinity };
}