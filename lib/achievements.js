// Streaks, XP and badges.
//
// Daily play streak: a day counts when the player places at least one real bet (casino or a
// settled Survivor round). Days are UTC. Missing a day resets it. The streak multiplies XP:
//   day 1 ×1 · day 2 ×1.1 · days 3–6 ×1.25 · 7–13 ×1.5 · 14–29 ×1.75 · 30+ ×2
// XP: 1 per $1 staked, times the streak multiplier (cents carry over, so small bets add up).
// Badges are earned once and kept forever; some also unlock a Vault item.

export const STREAK_STEPS = [[30, 2], [14, 1.75], [7, 1.5], [3, 1.25], [2, 1.1], [1, 1]];
export const streakMult = (s) => (STREAK_STEPS.find(([d]) => s >= d) || [0, 1])[1];
export const TIERS = [['Bronze', 10], ['Silver', 50], ['Gold', 200], ['Obsidian', 1000]];

// id → { name, desc, icon (emoji), reward (Vault item id, optional), hidden (not listed until earned) }
export const BADGES = {
  first_bet:     { name: 'First Bet', desc: 'Place your first bet.', icon: '🎲' },
  first_win:     { name: 'Winner', desc: 'Win anything.', icon: '🏆' },
  depositor:     { name: 'Funded', desc: 'Make your first deposit.', icon: '💳' },
  streak_3:      { name: 'On a Roll', desc: 'Play 3 days in a row.', icon: '🔥', reward: 'fr-ember' },
  streak_7:      { name: 'Week Warrior', desc: 'Play 7 days in a row.', icon: '⚔️', reward: 'fr-blaze' },
  streak_14:     { name: 'Unstoppable', desc: 'Play 14 days in a row.', icon: '🚀', reward: 'fx-phoenix' },
  streak_30:     { name: 'Legend of the Month', desc: 'Play 30 days in a row.', icon: '👑', reward: 'fr-eternal' },
  tier_bronze:   { name: 'Bronze', desc: 'Reach 10 XP.', icon: '🥉' },
  tier_silver:   { name: 'Silver', desc: 'Reach 50 XP.', icon: '🥈', reward: 'fi-chrome' },
  tier_gold:     { name: 'Gold', desc: 'Reach 200 XP.', icon: '🥇', reward: 'fr-gilded' },
  tier_obsidian: { name: 'Obsidian', desc: 'Reach 1,000 XP.', icon: '🖤', reward: 'th-obsidian' },
  big_win_10:    { name: 'Nice Hit', desc: 'Win $10 or more in one go.', icon: '💵' },
  big_win_100:   { name: 'Big Fish', desc: 'Win $100 or more in one go.', icon: '🐟', reward: 'fx-siren' },
  big_win_1000:  { name: 'Whale', desc: 'Win $1,000 or more in one go.', icon: '🐋' },
  high_roller:   { name: 'High Roller', desc: 'Bet $100 or more at once.', icon: '🎩' },
  survivor_1:    { name: 'Survived', desc: 'Survive a Survivor round.', icon: '🛡️' },
  survivor_25:   { name: 'Last One Standing', desc: 'Survive 25 Survivor rounds.', icon: '🦾', reward: 'fr-standing' },
  referrer_1:    { name: 'Recruiter', desc: 'One friend you invited deposits.', icon: '🤝' },
  referrer_10:   { name: 'Crowd Pleaser', desc: 'Ten friends you invited deposit.', icon: '📣', reward: 'fr-crowd' },
  collector_5:   { name: 'Collector', desc: 'Own 5 Vault items you bought.', icon: '🧳' },
  collector_25:  { name: 'Curator', desc: 'Own 25 Vault items you bought.', icon: '🏛️', reward: 'th-gallery' },
};
export const BADGE_IDS = Object.keys(BADGES);
export const REWARD_ITEMS = new Set(Object.values(BADGES).map((b) => b.reward).filter(Boolean));

const WIN_KINDS = new Set(['casino_win', 'pool_payout', 'payout']);

export function createAchievements({ q }) {
  // give badges (and their reward items) inside the caller's transaction; returns the new ones
  async function award(c, userId, ids) {
    const want = [...new Set(ids)].filter((id) => BADGES[id]);
    if (!want.length) return [];
    const got = (await c.query(`insert into user_badges (user_id, badge_id) select $1, unnest($2::text[])
                                 on conflict do nothing returning badge_id`, [userId, want])).rows.map((r) => r.badge_id);
    if (!got.length) return [];
    await c.query(`update users set badges = (select array(select distinct unnest(coalesce(badges, '{}') || $2::text[]))) where id = $1`, [userId, got]);
    const rewards = got.map((id) => BADGES[id].reward).filter(Boolean);
    if (rewards.length) await c.query(`insert into user_items (user_id, item_id, price_cents, is_test)
                                        select $1, unnest($2::text[]), 0, (select test_mode from users where id = $1) on conflict do nothing`, [userId, rewards]);
    return got;
  }

  // a real bet of `stakeCents`: advance the daily streak and add XP (inside the caller's transaction)
  async function played(c, userId, stakeCents) {
    const multSql = STREAK_STEPS.map(([d, m]) => `when ns >= ${d} then ${m}`).join(' ');
    const r = (await c.query(`
      with cur as (select id, xp, xp_bank_cents, ns, case ${multSql} else 1 end as mult from (
                     select id, xp, xp_bank_cents,
                       case when last_play_day = current_date then streak when last_play_day = current_date - 1 then streak + 1 else 1 end as ns
                     from users where id = $1) z)
      update users u set streak = cur.ns, best_streak = greatest(u.best_streak, cur.ns), last_play_day = current_date,
             xp = u.xp + floor((u.xp_bank_cents + round($2::bigint * cur.mult)) / 100)::int,
             xp_bank_cents = ((u.xp_bank_cents + round($2::bigint * cur.mult))::bigint % 100)
        from cur where u.id = cur.id
      returning u.xp, u.streak, u.badges`, [userId, Math.max(0, Math.round(stakeCents))])).rows[0];
    if (!r) return [];
    const has = new Set(r.badges || []), want = [];
    if (!has.has('first_bet')) want.push('first_bet');
    if (stakeCents >= 10000) want.push('high_roller');
    for (const [d, id] of [[3, 'streak_3'], [7, 'streak_7'], [14, 'streak_14'], [30, 'streak_30']]) if (r.streak >= d && !has.has(id)) want.push(id);
    for (const [name, x] of TIERS) if (r.xp >= x && !has.has('tier_' + name.toLowerCase())) want.push('tier_' + name.toLowerCase());
    return award(c, userId, want.filter((id) => !has.has(id)));
  }

  // every money move passes through here (server.js move): wins and deposits earn badges
  async function onMove(c, userId, delta, kind, row) {
    const has = new Set(row?.badges || []), want = [];
    if (WIN_KINDS.has(kind) && delta > 0) {
      if (!has.has('first_win')) want.push('first_win');
      for (const [amt, id] of [[1000, 'big_win_10'], [10000, 'big_win_100'], [100000, 'big_win_1000']]) if (delta >= amt && !has.has(id)) want.push(id);
      if (kind === 'pool_payout' && (!has.has('survivor_1') || !has.has('survivor_25'))) {
        const n = Number((await c.query(`select count(*)::int n from ledger where user_id = $1 and kind = 'pool_payout'`, [userId])).rows[0].n);
        if (n >= 1) want.push('survivor_1'); if (n >= 25) want.push('survivor_25');
      }
    }
    if (kind === 'deposit' && delta > 0 && !has.has('depositor') && !row?.test_mode) want.push('depositor');
    if (kind === 'casino_bet' && delta < 0) return [...await played(c, userId, -delta), ...await award(c, userId, want.filter((id) => !has.has(id)))];
    return award(c, userId, want.filter((id) => !has.has(id)));
  }

  async function collector(c, userId) {
    const n = Number((await c.query(`select count(*)::int n from user_items where user_id = $1 and price_cents > 0`, [userId])).rows[0].n);
    return award(c, userId, [n >= 5 && 'collector_5', n >= 25 && 'collector_25'].filter(Boolean));
  }
  async function referrals(c, userId, active) {
    return award(c, userId, [active >= 1 && 'referrer_1', active >= 10 && 'referrer_10'].filter(Boolean));
  }

  // what the player sees
  const effectiveStreak = (u) => {
    if (!u?.last_play_day) return 0;
    const day = new Date(u.last_play_day); const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const diff = Math.round((today - Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())) / 864e5);
    return diff <= 1 ? Number(u.streak || 0) : 0;
  };
  const playedToday = (u) => { if (!u?.last_play_day) return false; const d = new Date(u.last_play_day); const t = new Date(); return d.getUTCFullYear() === t.getUTCFullYear() && d.getUTCMonth() === t.getUTCMonth() && d.getUTCDate() === t.getUTCDate(); };
  function progress(u) {
    const s = effectiveStreak(u), next = [...STREAK_STEPS].reverse().find(([d]) => d > s);
    return { streak: s, bestStreak: Number(u?.best_streak || 0), playedToday: playedToday(u), mult: streakMult(Math.max(1, s)), nextStep: next ? { days: next[0], mult: next[1] } : null };
  }
  async function list(userId) {
    const r = userId ? (await q('select badge_id, earned_at, seen from user_badges where user_id = $1', [userId])).rows : [];
    const by = Object.fromEntries(r.map((x) => [x.badge_id, x]));
    return BADGE_IDS.map((id) => ({ id, ...BADGES[id], earned: !!by[id], earnedAt: by[id]?.earned_at || null }));
  }
  async function unseen(userId) {
    const r = await q(`update user_badges set seen = true where user_id = $1 and not seen returning badge_id`, [userId]);
    return r.rows.map((x) => ({ id: x.badge_id, ...BADGES[x.badge_id] })).filter((b) => b.name);
  }
  return { award, played, onMove, collector, referrals, progress, list, unseen, effectiveStreak };
}
