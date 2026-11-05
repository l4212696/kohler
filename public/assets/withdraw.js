// Withdrawals, shared by the shop wallet and the casino wallet drawer:
// amount + address with a live fee preview → a review screen → a clear confirmation,
// plus the player's list of withdrawals with plain statuses and a link to the payment.
//   KohlerWithdraw.mount(el, { api, money, esc, balance, test, cls, onDone })
//   KohlerWithdraw.list(el, { api, money, esc })
//   KohlerWithdraw.notices({ api, money, userId, toast })   (tells a returning player what changed)
(function () {
  const css = `
.kw-box{display:flex;flex-direction:column;gap:12px}
.kw-row{display:flex;gap:6px;flex-wrap:wrap}
.kw-chip{height:30px;padding:0 11px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:transparent;color:inherit;font:600 12.5px Inter,sans-serif;cursor:pointer}
.kw-chip:hover{border-color:rgba(255,255,255,.3)}
.kw-lab{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:#8b96aa}
.kw-in{height:46px;border-radius:12px;background:#07090d;border:1px solid rgba(255,255,255,.14);padding:0 14px;color:#eef2f8;font:500 15px Inter,sans-serif;width:100%;outline:0}
.kw-in:focus{border-color:rgba(0,255,102,.6)}.kw-in.bad{border-color:#ff4d6d}
.kw-hint{font-size:12.5px;color:#8b96aa;min-height:17px}.kw-hint.bad{color:#ff8fa3}.kw-hint.good{color:#9ef5bd}
.kw-sum{border-radius:14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);padding:4px 14px}
.kw-sum div{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
.kw-sum div:last-child{border-bottom:0}.kw-sum span{color:#8b96aa}.kw-sum b{font-variant-numeric:tabular-nums;text-align:right}
.kw-sum .big b{font-size:17px;color:#00ff66}
.kw-addr{font:500 13px ui-monospace,Menlo,monospace;word-break:break-all;padding:12px;border-radius:12px;background:#07090d;border:1px solid rgba(232,196,106,.45)}
.kw-addr em{font-style:normal;color:#e8c46a;font-weight:700}
.kw-warn{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:#e8c46a;background:rgba(232,196,106,.08);border:1px solid rgba(232,196,106,.3);border-radius:12px;padding:10px 12px}
.kw-btns{display:flex;gap:8px}.kw-btns>*{flex:1}
.kw-done{text-align:center;padding:6px 0}
.kw-check{width:64px;height:64px;margin:4px auto 10px;border-radius:50%;display:grid;place-items:center;background:rgba(0,255,102,.12);border:2px solid #00ff66;animation:kwpop .45s cubic-bezier(.2,1.6,.4,1)}
@keyframes kwpop{from{transform:scale(.3);opacity:0}}
.kw-done h3{font-family:Unbounded,'Bricolage Grotesque',sans-serif;font-size:20px;margin:0 0 6px;letter-spacing:-.02em}
.kw-steps{display:flex;justify-content:space-between;margin:16px 4px 4px;position:relative}
.kw-steps:before{content:"";position:absolute;left:12%;right:12%;top:11px;height:2px;background:rgba(255,255,255,.1)}
.kw-steps div{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11.5px;color:#8b96aa}
.kw-steps i{width:24px;height:24px;border-radius:50%;background:#151c27;border:2px solid rgba(255,255,255,.2)}
.kw-steps .on i{background:#00ff66;border-color:#00ff66;box-shadow:0 0 12px rgba(0,255,102,.5)}.kw-steps .on{color:#eef2f8}
.kw-steps .now i{border-color:#e8c46a;animation:kwpulse 1.4s infinite}
@keyframes kwpulse{50%{box-shadow:0 0 0 6px rgba(232,196,106,.15)}}
.kw-list{display:flex;flex-direction:column}
.kw-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.07)}
.kw-item:last-child{border-bottom:0}
.kw-item .a{font-weight:700;font-variant-numeric:tabular-nums}
.kw-item small{display:block;color:#5d6779;font-size:12px}
.kw-st{margin-left:auto;text-align:right;font-size:12.5px;font-weight:700;white-space:nowrap}
.kw-st a{display:block;font-weight:600;color:#38bdf8;text-decoration:none;margin-top:2px}
.kw-st.pending{color:#e8c46a}.kw-st.processing{color:#38bdf8}.kw-st.sent{color:#00ff66}.kw-st.rejected{color:#ff8fa3}`;
  let styled = false;
  const style = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
  const btc = (sats) => (sats / 1e8).toFixed(8).replace(/0{1,4}$/, '');
  const shortAddr = (a, esc) => a.length > 16 ? `<em>${esc(a.slice(0, 6))}</em>${esc(a.slice(6, -6))}<em>${esc(a.slice(-6))}</em>` : `<em>${esc(a)}</em>`;
  const looksLike = (a, testnet) => (testnet ? /^(tb1[a-z0-9]{20,}|[mn2][a-km-zA-HJ-NP-Z1-9]{25,34})$/ : /^(bc1[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/).test(a);
  const CHECK = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#00ff66" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

  function mount(el, o) {
    style();
    const { api, money, esc } = o, cls = { primary: 'btn neon', ghost: 'btn', ...(o.cls || {}) };
    let quote = null, amount = '', address = '', qT, seq = 0;
    const form = () => {
      el.innerHTML = `<div class="kw-box">
        <p style="margin:0;color:#8b96aa;font-size:13.5px">${o.test ? 'Processed straight away.' : 'Paid in Bitcoin, usually within 30 minutes.'}</p>
        <label class="kw-lab">Amount in USD<input class="kw-in" id="kwAmt" type="number" min="5" step="0.01" inputmode="decimal" placeholder="50.00" value="${esc(amount)}"></label>
        <div class="kw-row">${[['25%', .25], ['50%', .5], ['Max', 1]].map(([l, f]) => `<button class="kw-chip" data-f="${f}">${l}</button>`).join('')}<span style="margin-left:auto;font-size:12.5px;color:#8b96aa;align-self:center">Balance ${money(o.balance)}<span id="kwMin"></span></span></div>
        <div class="kw-hint" id="kwQ"></div>
        ${o.test ? '' : `<label class="kw-lab">Your Bitcoin address<input class="kw-in" id="kwAddr" placeholder="bc1…" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(address)}"></label><div class="kw-hint" id="kwA"></div>`}
        <button class="${cls.primary}" id="kwNext" style="height:48px" disabled>Continue</button></div>`;
      const amt = el.querySelector('#kwAmt'), addr = el.querySelector('#kwAddr'), next = el.querySelector('#kwNext');
      const ready = () => { next.disabled = !(quote && !quote.error && (o.test || looksLike(address, quote.testnet) || address.length > 20)); };
      const checkAddr = () => {
        if (!addr) return;
        const h = el.querySelector('#kwA'), v = address.trim();
        if (!v) { h.className = 'kw-hint'; h.textContent = ''; addr.classList.remove('bad'); }
        else if (quote && !looksLike(v, quote.testnet)) { h.className = 'kw-hint bad'; h.textContent = quote.testnet ? 'This server is on Bitcoin testnet: addresses start with tb1, m, n or 2.' : 'That doesn’t look like a Bitcoin address. It should start with bc1, 1 or 3.'; addr.classList.add('bad'); }
        else { h.className = 'kw-hint good'; h.textContent = 'Looks like a valid address. Double-check it in the next step.'; addr.classList.remove('bad'); }
        ready();
      };
      const fetchQuote = () => {
        clearTimeout(qT); const v = Math.round(Number(amount) * 100), my = ++seq, h = el.querySelector('#kwQ');
        if (!v) { quote = null; h.className = 'kw-hint'; h.textContent = ''; amt.classList.remove('bad'); return ready(); }
        h.className = 'kw-hint'; h.textContent = 'Working it out…';
        qT = setTimeout(async () => {
          let q; try { q = await api('/wallet/withdraw/quote?amountCents=' + v); } catch (e) { q = { error: e.message }; }
          if (my !== seq) return;
          quote = q;
          if (q.error) { h.className = 'kw-hint bad'; h.textContent = q.error; amt.classList.add('bad'); }
          else { amt.classList.remove('bad'); h.className = 'kw-hint good';
            h.textContent = o.test ? `${money(q.amount)} will leave your balance.` : `You'll receive about ${btc(q.netSats)} BTC. ${q.fee ? `Fee ${money(q.fee)}, so ${money(q.debit)} comes off your balance.` : ''}`; }
          checkAddr(); ready();
        }, 280);
      };
      amt.oninput = () => { amount = amt.value; fetchQuote(); };
      if (addr) addr.oninput = () => { address = addr.value.trim(); checkAddr(); };
      el.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
        const f = +b.dataset.f, bps = quote?.feeBps ?? o.feeBps ?? (o.test ? 0 : 100);
        amount = (Math.floor(o.balance * f / (1 + bps / 10000)) / 100).toFixed(2); amt.value = amount; fetchQuote();
      }));
      next.onclick = review;
      if (amount) fetchQuote();
      // the minimum depends on the Bitcoin price, so show it before they type
      api('/wallet/withdraw/quote?amountCents=0').then((q) => {
        const m = el.querySelector('#kwMin'); if (!m) return;
        o.minCents = q.minCents; o.feeBps = q.feeBps;
        m.textContent = ` · min ${money(q.minCents)}`;
        if (!o.test && q.balance < q.minCents) { const h = el.querySelector('#kwQ'); h.className = 'kw-hint bad'; h.textContent = `You need at least ${money(q.minCents)} to withdraw. Your balance is ${money(q.balance)}.`; }
      }).catch(() => {});
    };
    const review = () => {
      const q = quote;
      el.innerHTML = `<div class="kw-box"><h3 style="margin:0;font-family:Unbounded,'Bricolage Grotesque',sans-serif;font-size:18px">Check and confirm</h3>
        <div class="kw-sum"><div><span>You withdraw</span><b>${money(q.amount)}</b></div>
          ${q.fee ? `<div><span>Kohler fee (${(q.feeBps / 100).toFixed(q.feeBps % 100 ? 2 : 0)}%)</span><b>${money(q.fee)}</b></div>` : ''}
          <div><span>Comes off your balance</span><b>${money(q.debit)}</b></div>
          ${o.test ? '' : `<div><span>Bitcoin network fee</span><b>${q.networkFeeSats.toLocaleString()} sats</b></div>
          <div class="big"><span>You receive about</span><b>${btc(q.netSats)} BTC</b></div>`}</div>
        ${o.test ? '' : `<div class="kw-lab">To this address<div class="kw-addr">${shortAddr(address, esc)}</div></div>
          <div class="kw-warn"><span>⚠</span><span>Check the gold characters against your wallet. Bitcoin payments can't be reversed.</span></div>`}
        <div class="kw-hint bad" id="kwErr"></div>
        <div class="kw-btns"><button class="${cls.ghost}" id="kwBack" style="height:48px">Back</button><button class="${cls.primary}" id="kwGo" style="height:48px">Confirm withdrawal</button></div></div>`;
      el.querySelector('#kwBack').onclick = form;
      el.querySelector('#kwGo').onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = 'Sending request…';
        try {
          const out = await api('/wallet/withdraw', { method: 'POST', body: { amountCents: q.amount, address } });
          done(out.withdrawal, out.quote || q);
        } catch (err) {
          e.target.disabled = false; e.target.textContent = 'Confirm withdrawal';
          el.querySelector('#kwErr').textContent = err.message;
          if (err.data?.field === 'address' || err.data?.field === 'amount') setTimeout(form, 2200);
        }
      };
    };
    const done = (w, q) => {
      o.balance -= q.debit;
      try { navigator.vibrate?.([20, 40, 20]); } catch {}
      el.innerHTML = `<div class="kw-box kw-done"><div class="kw-check">${CHECK}</div>
        <h3>${o.test ? 'Withdrawal done' : 'Withdrawal requested'}</h3>
        <p style="margin:0;color:#8b96aa">${o.test ? `${money(q.amount)} left your balance.`
          : `About <b style="color:#eef2f8">${btc(q.netSats)} BTC</b> will be sent to <span style="font-family:ui-monospace,monospace">${esc(address.slice(0, 6))}…${esc(address.slice(-6))}</span>. Usually within 30 minutes${q.emails ? '. We’ll email you when it’s sent' : ''}.`}</p>
        ${o.test ? '' : `<div class="kw-steps"><div class="on"><i></i>Requested</div><div class="now"><i></i>Being sent</div><div><i></i>Sent</div></div>`}
        <button class="${cls.primary}" id="kwOk" style="height:48px;margin-top:6px">Done</button></div>`;
      el.querySelector('#kwOk').onclick = () => { amount = ''; address = ''; quote = null; form(); o.onShowList?.(); };
      o.onDone?.(w, q);
    };
    form();
  }

  async function list(el, { api, money, esc, title = 'Your withdrawals' }) {
    style();
    let ws = [];
    try { ws = (await api('/wallet/withdrawals')).withdrawals; } catch { el.innerHTML = ''; return; }
    if (!ws.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<h4 style="margin:18px 0 4px;font-size:14px">${esc(title)}</h4><div class="kw-list">${ws.map((w) => `<div class="kw-item">
      <div><span class="a">${money(w.amount)}</span><small>${new Date(w.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${w.address && !w.test ? ' · ' + esc(w.address.slice(0, 6)) + '…' + esc(w.address.slice(-4)) : ''}</small></div>
      <div class="kw-st ${w.status}">${w.test ? 'Done' : esc(w.label)}${w.explorer ? `<a href="${esc(w.explorer)}" target="_blank" rel="noopener">View payment ↗</a>` : w.txid ? `<small>ref ${esc(w.txid.slice(0, 14))}</small>` : w.status === 'pending' ? '<small>usually within 30 min</small>' : ''}</div></div>`).join('')}</div>`;
  }

  // A returning player hears about withdrawals that were sent or refunded while they were away.
  async function notices({ api, money, userId, toast }) {
    let ws, ds; try { const r = await api('/wallet/withdrawals'); ws = r.withdrawals; ds = r.deposits || []; } catch { return; }
    const key = 'kw-seen-' + userId; let seen = null;
    try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    if (seen) {
      const fresh = ws.filter((w) => !w.test && seen[w.id] && seen[w.id] !== w.status && (w.status === 'sent' || w.status === 'rejected'));
      const dep = ds.filter((d) => !seen[d.id]);
      const msgs = [...dep.map((d) => `Your deposit of ${money(d.amount)} arrived.`),
        ...fresh.map((w) => w.status === 'sent' ? `Your ${money(w.amount)} withdrawal was sent.` : `Your ${money(w.amount)} withdrawal was refunded to your balance.`)];
      msgs.forEach((m, i) => setTimeout(() => toast(m), i * 3200));
    }
    try { localStorage.setItem(key, JSON.stringify(Object.fromEntries([...ws.map((w) => [w.id, w.status]), ...ds.map((d) => [d.id, 1])]))); } catch {}
  }
  // deposits seen on the blockchain but not confirmed yet
  function incoming(list, esc) {
    style();
    if (!list?.length) return '';
    return `<div class="kw-warn" style="color:#9ef5bd;background:rgba(0,255,102,.06);border-color:rgba(0,255,102,.3);margin-top:12px"><span>⏳</span><span>${list.map((x) =>
      `Incoming ${btc(x.sats)} BTC: ${x.confs} of ${x.need} confirmations. It's added to your balance automatically once confirmed (usually 10–30 minutes).${x.explorer ? ` <a href="${esc(x.explorer)}" target="_blank" rel="noopener" style="color:#38bdf8">Track it ↗</a>` : ''}`).join('<br>')}</span></div>`;
  }
  window.KohlerWithdraw = { mount, list, notices, incoming };
})();
