// Autopilot: housekeeping and safety checks that run on their own.
//
// It rides on real traffic instead of a timer, at most once every 30 minutes
// (plus once at boot), so it never wakes a sleeping Neon database by itself.
//
// What it does
//   cleanup   expired sessions and sign-in links
//   money     every cached balance must equal the sum of its ledger rows; no negative balances
//   pool      Pool Pot books must balance; if they don't, Pool Pot is paused automatically
//   pool      countdowns that missed their draw are kicked
//   payouts   withdrawals waiting more than an hour (players are told about 30 minutes)
//   support   tickets open more than 48h
//
// Alerts are written to admin_audit as action 'alert.<code>' (shown on the admin
// dashboard) and emailed to ALERT_EMAIL (or ORDER_EMAIL) when Resend is set up.
// The same alert isn't repeated within 6 hours.

const EVERY_MS = 30 * 60 * 1000;
const REPEAT_MS = 6 * 3600 * 1000;

export function createAutopilot({ q, poolPot, payouts, sendEmail, log = console }) {
  let last = 0, running = null, lastResult = null;

  async function alert(code, message, detail = {}, level = 'warn') {
    const recent = await q(
      `select 1 from admin_audit where action = $1 and created_at > now() - make_interval(secs => $2) limit 1`,
      ['alert.' + code, REPEAT_MS / 1000]);
    if (recent.rows[0]) return false;
    await q('insert into admin_audit (user_id, action, detail) values (null, $1, $2)', ['alert.' + code, { level, message, ...detail }]);
    log.warn(`[autopilot] ${level}: ${message}`);
    const to = process.env.ALERT_EMAIL || process.env.ORDER_EMAIL;
    if (to && level !== 'info') {
      await sendEmail({ to, subject: `Kohler alert: ${message}`.slice(0, 140),
        html: `<p><b>${message}</b></p><pre>${JSON.stringify(detail, null, 2).replace(/[<>&]/g, '')}</pre><p>Open /admin for details.</p>` }).catch(() => {});
    }
    return true;
  }

  async function run() {
    const out = { at: new Date().toISOString(), checks: {}, alerts: [] };
    const step = async (name, fn) => {
      try { out.checks[name] = await fn(); } catch (e) { out.checks[name] = { error: e.message }; log.error('[autopilot]', name, e.message); }
    };

    await step('cleanup', async () => {
      const s = await q('delete from sessions where expires_at < now()');
      const m = await q(`delete from magic_links where expires_at < now() - interval '1 day'`);
      const g = await q(`delete from casino_sessions where expires_at < now() - interval '1 day'`).catch(() => ({ rowCount: 0 }));
      return { sessions: s.rowCount, links: m.rowCount, gameSessions: g.rowCount };
    });

    await step('balances', async () => {
      const drift = (await q(
        `select u.username, u.balance_cents::bigint as cached, coalesce(l.s, 0)::bigint as ledger
           from users u left join (select user_id, sum(delta_cents) s from ledger group by user_id) l on l.user_id = u.id
          where u.balance_cents <> coalesce(l.s, 0) limit 20`)).rows;
      const negative = (await q('select username, balance_cents from users where balance_cents < 0 limit 20')).rows;
      if (drift.length && await alert('balance_drift', `${drift.length} account balance(s) don't match their ledger`, { accounts: drift }, 'critical'))
        out.alerts.push('balance_drift');
      if (negative.length && await alert('negative_balance', `${negative.length} account(s) have a negative balance`, { accounts: negative }, 'critical'))
        out.alerts.push('negative_balance');
      return { drift: drift.length, negative: negative.length };
    });

    await step('pool', async () => {
      if (!poolPot) return { skipped: true };
      const b = await poolPot.books();
      const s = await poolPot.settings();
      if (!b.ok && !s.paused) {
        await q(`insert into site_settings (key, value, updated_at) values ('pool_paused', 'true', now())
                 on conflict (key) do update set value = 'true', updated_at = now()`);
        if (await alert('pool_books', `Pool Pot books are off by ${(b.drift / 100).toFixed(2)}. Pool Pot was paused automatically.`, b, 'critical'))
          out.alerts.push('pool_books');
      }
      const stuck = Number((await q(
        `select count(*)::int n from pool_rounds where status = 'countdown' and countdown_ends_at < now() - interval '2 minutes'`)).rows[0].n);
      if (stuck) {
        await poolPot.tick();
        if (await alert('pool_stuck', `${stuck} Pool Pot round(s) missed their draw time; a draw was triggered`, { stuck }, 'info')) out.alerts.push('pool_stuck');
      }
      const filled = await poolPot.sweepFills?.().catch(() => 0) || 0;
      return { books: b.ok ? 'balanced' : `off by ${b.drift}`, paused: s.paused, stuck, houseFilled: filled };
    });

    await step('withdrawals', async () => {
      const w = (await q(
        `select count(*)::int n, coalesce(sum(amount_cents), 0)::bigint total, min(created_at) oldest
           from withdrawals where status = 'pending' and created_at < now() - interval '1 hour'`)).rows[0];
      if (w.n && await alert('withdrawals_waiting', `${w.n} withdrawal(s) waiting more than an hour ($${(Number(w.total) / 100).toFixed(2)})`, w))
        out.alerts.push('withdrawals_waiting');
      const all = (await q(`select count(*)::int n from withdrawals where status = 'pending'`)).rows[0].n;
      return { pending: all, overdue: w.n };
    });

    await step('payouts', async () => (payouts ? payouts.run() : { skipped: true }));

    await step('support', async () => {
      const n = Number((await q(`select count(*)::int n from support_tickets where status = 'open' and created_at < now() - interval '48 hours'`)).rows[0].n);
      if (n && await alert('support_waiting', `${n} support ticket(s) open more than 48h`, { n }, 'info')) out.alerts.push('support_waiting');
      return { overdue: n };
    });

    lastResult = out;
    return out;
  }

  function kick() {
    if (running || Date.now() - last < EVERY_MS) return;
    last = Date.now();
    running = run().catch((e) => log.error('[autopilot]', e.message)).finally(() => { running = null; });
  }

  return {
    alert,
    run: async () => { last = Date.now(); return run(); },
    kick,
    middleware: (_req, _res, next) => { kick(); next(); },
    status: () => ({ lastRun: lastResult?.at || null, result: lastResult, nextAfter: last ? new Date(last + EVERY_MS).toISOString() : null }),
  };
}
