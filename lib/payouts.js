// Automatic BTC payouts. OFF until an admin switches it on (Admin → Payouts).
//
// Money for payouts sits in a dedicated hot wallet derived from DEPOSIT_MNEMONIC
// (path m/84'/coin'/1'/0/0, separate from every deposit address). Fund it, or
// point deposit sweeps at it, and Kohler pays withdrawals that pass every rule:
//   • amount ≤ payouts_max_cents         • 24h auto total ≤ payouts_daily_cents
//   • account older than min age hours    • account made a real deposit (if required)
//   • not banned, not a test account      • no critical money alert in the last 6h
// Anything else stays pending for a person, with the reason written on it.
//
// States: pending → processing (claimed, sending) → sent. If sending fails before
// the transaction left Kohler, it goes back to pending. If the result is unknown
// (timeout), it stays in processing and raises an alert so nobody pays twice.

export function createPayouts({ q, withTx, chain, alert = async () => {}, notify = () => {}, log = console }) {
  async function settings() {
    const m = Object.fromEntries((await q(`select key, value from site_settings where key like 'payouts\\_%'`)).rows.map((r) => [r.key, r.value]));
    const n = (k, d) => (Number.isFinite(Number(m[k])) ? Number(m[k]) : d);
    return {
      auto: m.payouts_auto === 'true', maxCents: n('payouts_max_cents', 20000), dailyCents: n('payouts_daily_cents', 100000),
      minAgeHours: n('payouts_min_age_hours', 24), requireDeposit: m.payouts_require_deposit !== 'false',
    };
  }
  function hot() {
    try { return chain.chainEnabled() ? chain.hotWallet() : null; } catch (e) { return null; }
  }

  let running = null;
  async function run({ force = false } = {}) {
    if (running) return running;
    running = (async () => {
      const s = await settings();
      if (!s.auto && !force) return { skipped: 'automatic payouts are off' };
      const w = hot();
      if (!w) return { skipped: 'chain disabled or DEPOSIT_MNEMONIC missing' };
      const critical = (await q(`select 1 from admin_audit where action in ('alert.balance_drift','alert.pool_books','alert.payout_unknown')
                                  and created_at > now() - interval '6 hours' limit 1`)).rows[0];
      if (critical) return { skipped: 'a money alert fired in the last 6 hours; payouts wait for a person' };
      const pending = (await q(`select id from withdrawals where status = 'pending' order by created_at limit 10`)).rows;
      const out = { sent: 0, held: 0, failed: 0 };
      for (const { id } of pending) {
        const claim = await withTx(async (c) => {
          const r = (await c.query(
            `select w.*, u.created_at as user_created, u.banned, u.test_mode,
                    (exists (select 1 from seen_deposits d where d.user_id = w.user_id)
                      or exists (select 1 from deposit_claims d where d.user_id = w.user_id and d.status = 'approved')) as deposited
               from withdrawals w join users u on u.id = w.user_id where w.id = $1 and w.status = 'pending' for update of w skip locked`, [id])).rows[0];
          if (!r) return null;
          const day = Number((await c.query(
            `select coalesce(sum(amount_cents), 0) s from withdrawals where auto and status in ('sent','processing') and handled_at > now() - interval '24 hours'`)).rows[0].s);
          const why = r.banned ? 'account is suspended'
            : r.test_mode ? 'test account'
            : Number(r.amount_cents) > s.maxCents ? `above the $${(s.maxCents / 100).toFixed(2)} auto-pay limit`
            : day + Number(r.amount_cents) > s.dailyCents ? 'daily auto-pay limit reached'
            : Date.now() - new Date(r.user_created).getTime() < s.minAgeHours * 3600e3 ? `account younger than ${s.minAgeHours}h`
            : s.requireDeposit && !r.deposited ? 'no real deposit on this account yet'
            : null;
          if (why) { if (r.note !== 'manual review: ' + why) await c.query('update withdrawals set note = $2 where id = $1', [id, 'manual review: ' + why]); return { held: true }; }
          await c.query(`update withdrawals set status = 'processing', auto = true, note = 'sending automatically', handled_at = now() where id = $1`, [id]);
          return { w: r };
        });
        if (!claim) continue;
        if (claim.held) { out.held++; continue; }
        const wd = claim.w;
        try {
          const { txid, fee } = await chain.sendBtc(w.keyHex, wd.address, Number(wd.amount_sats));
          await q(`update withdrawals set status = 'sent', tx_hash = $2, fee_sats = $3, note = 'paid automatically', handled_at = now() where id = $1`, [wd.id, txid, fee]);
          out.sent++;
          notify(wd.id, 'sent');
        } catch (e) {
          const msg = String(e.message || e);
          // these all fail before anything is broadcast, so the withdrawal can safely wait for a retry
          const safe = /no confirmed utxos|insufficient utxos|below dust|invalid|decode|mempool 4\d\d/i.test(msg);
          if (safe) {
            await q(`update withdrawals set status = 'pending', auto = false, note = $2 where id = $1`, [wd.id, 'auto payout failed: ' + msg.slice(0, 200)]);
            await alert('payout_failed', `Automatic payout failed and went back to the queue: ${msg.slice(0, 120)}`, { withdrawal: wd.id });
            out.failed++;
            if (/utxo|insufficient/i.test(msg)) break;    // hot wallet is empty: stop trying the rest
          } else {
            await q(`update withdrawals set note = $2 where id = $1`, [wd.id, 'result unknown, check the hot wallet on a block explorer before doing anything: ' + msg.slice(0, 160)]);
            await alert('payout_unknown', 'An automatic payout may or may not have gone out. Automatic payouts are held until you check it.', { withdrawal: wd.id }, 'critical');
            out.failed++; break;
          }
        }
      }
      if (out.sent || out.failed) log.log('[payouts]', JSON.stringify(out));
      return out;
    })().finally(() => { running = null; });
    return running;
  }
  let t = null;
  const kick = () => { clearTimeout(t); t = setTimeout(() => run().catch((e) => log.error('[payouts]', e.message)), 1500); t.unref?.(); };

  async function status() {
    const s = await settings(), w = hot();
    let balanceSats = null;
    if (w) try { balanceSats = await chain.addressBalance(w.address); } catch { balanceSats = null; }
    const k = (await q(`select
        count(*) filter (where status = 'pending')::int as pending, coalesce(sum(amount_cents) filter (where status = 'pending'), 0)::bigint as pending_cents,
        count(*) filter (where status = 'processing')::int as processing,
        coalesce(sum(amount_cents) filter (where auto and status = 'sent' and handled_at > now() - interval '24 hours'), 0)::bigint as auto_24h
      from withdrawals`)).rows[0];
    return { settings: s, hotWallet: w ? { address: w.address, balanceSats } : null, queue: { ...k, pending_cents: Number(k.pending_cents), auto_24h: Number(k.auto_24h) } };
  }
  return { run, kick, settings, status, hot };
}
