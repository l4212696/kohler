# Kohler

A shop for digital goods (gift cards, subscriptions, top-ups) and a casino built entirely in-house:
**Survivor** (the main event), Rocket, Mines, Coin Flip, Limbo, dice, plinko, wheels, 34 slots and
blackjack/roulette. There's also the **Vault**, a shop for characters, frames, win effects and the
Kohler Pass. Players fund one balance with Bitcoin. Node/Express + Neon Postgres, one process, no build step.

| Page | Address |
|---|---|
| Shop | `/` |
| Casino (all games, Survivor, Vault, limits) | `/casino` |
| Survivor invite link | `/t/CODE` (opens the table inside the casino) |
| Admin ("Kohler Control") | `/admin` |

---

## 1. Run it

```bash
npm i
npm run forever      # runs the site and restarts it if it ever stops
```

Open **http://localhost:3001** (set `PUBLIC_URL=http://localhost:3001` in `.env` to match).

You don't need to run migrations any more. On every start the server brings the database up to
date, creates the test account and loads the game catalogue before it takes requests. While that's
happening (a few seconds after a cold start) pages show "starting up" and retry on their own.

**Test account:** `testkohler@yopmail.com` / `test1234`. It starts with $1,000 of fake money and can
top itself up from the wallet. It plays every game for real, but with fake money: Survivor seats it at a
private copy of each table, filled with simulated players. Nothing it does appears in revenue, fees or the
books. Change it with `TEST_ACCOUNT_EMAIL` / `TEST_ACCOUNT_PASSWORD` in `.env`.

If a login fails, `npm run fix -- --check you@email.com yourpassword` says exactly why. To set a new
password, use `npm run fix -- --reset you@email.com NewPassword123`.

## 2. Why buttons felt slow, and what changed

Most of the delay was the database, not the site:
- **Distance.** Your Neon database is in the US (us-east-2) and you're in Iceland. Every query
  crosses the Atlantic twice, about 100–150 ms each way.
- **Cold starts.** Neon's free plan puts the database to sleep when nobody's using it. The first click after
  that waits 1–3 seconds for it to wake.

Fixes in the code:
- While people are on the site, a ping every 4 minutes keeps the database awake, then lets it sleep.
- Lobby data is cached for a few seconds. Pages load their data in parallel instead of one request after another.
- Static files are cached by the browser.
- Buttons react immediately (disabled state, skeletons) instead of waiting for the server.

The biggest remaining win is outside the code. **Create the Neon project in Europe (Frankfurt), or host
the server in us-east-2 next to the database.** Either one removes most of the remaining delay.

## 3. How money works

Every balance is **US cents** in the `ledger` table. `users.balance_cents` is a cached total, always
changed in the same database transaction as its ledger row. Autopilot (§8) checks that they match.

### Money in: Bitcoin deposits
Each player gets their own address (from `DEPOSIT_MNEMONIC`). A watcher sees the payment and credits
dollars at the spot price after `MIN_CONFIRMATIONS`. The coins are swept to the house address.
Missed deposits can be claimed by the player and approved in **Admin → Deposits**.

### Money out: payouts, manual or automatic
A player asks to withdraw `$X` to a BTC address. Their balance is debited straight away and the
request goes into **Admin → Payouts**.

**Manual mode is the default.** Send the BTC from any wallet you like, then press **Mark paid** and
paste the transaction id. **Reject** refunds the player in full.

**What the player sees.**
- **Before confirming.** The withdraw form shows the real minimum in dollars (it's set in BTC, so it
  follows the price) and a live preview: the fee, what comes off their balance, and roughly how much BTC
  arrives. A review screen then shows the address with its first and last characters highlighted, plus
  a warning that Bitcoin payments can't be reversed. Errors are plain sentences, never codes.
- **After confirming.** A confirmation screen shows the request and its progress (Requested → Being
  sent → Sent). Their withdrawals list shows *Waiting to be sent*, *Being sent*, *Sent* (with a link to
  the payment on the blockchain) or *Refunded to your balance*.
- **Emails, when `RESEND_API_KEY` and `MAIL_FROM` are set.** Sent when the request is made, when it's
  paid (manually, by key, or automatically), when it's refunded, and when a deposit arrives.
- **Coming back later.** A returning player is told on screen if a withdrawal was sent or refunded, or
  a deposit arrived, while they were away.
- **Deposits on the way.** Incoming deposits show up as *Incoming, 1 of 2 confirmations* before they're
  credited.
- **Deposits below `MIN_DEPOSIT_SATS`.** These used to be ignored silently. Now they become a claim in
  Admin → Deposits, with an alert for you and an email to the player.

**Automatic mode** is one switch in Admin → Payouts or on the Overview page. When it's on, Kohler signs
and sends a withdrawal from its **hot wallet** by itself, but only if it passes every rule:

| Rule | Default |
|---|---|
| Max per withdrawal | $200 |
| Max per day, all players together | $1,000 |
| Account age | at least 24 hours |
| Has deposited before | yes |
| No critical alert in the last 6 hours | always |

Anything that fails a rule waits for you, as in manual mode. The hot wallet's address and balance are
shown in Admin → Payouts. Fund it with only a few days of payouts. **Sweep deposits here** makes
deposits land in the hot wallet, so it refills itself.

How a payout moves: `waiting → processing → sent`. If the network answer is lost while it's being
sent, it stays in **processing** and raises a critical alert, because Kohler can't know whether the coins
left. Check the address on a block explorer. If nothing went out, press **Requeue**.

Automatic payouts need `CHAIN_ENABLED=true` and `DEPOSIT_MNEMONIC`. **Your `.env` has
`BTC_NETWORK=testnet`, so only test coins move.** To go live, set `BTC_NETWORK=mainnet`,
`MEMPOOL_API=https://mempool.space/api` and a brand-new mnemonic stored offline. Then do one small
deposit and one withdrawal end to end before announcing anything.

### Where Kohler makes money
| Source | How |
|---|---|
| Survivor | 10% of the knocked-out stake, every round |
| Casino | Everything players lose. All games are ours, so there's no provider share. RTP 96–99%. |
| Vault | 100% of every sale (characters $0.99–$49.99, frames, effects, Pass $9.99/30 days) |
| Shop | `PLATFORM_FEE_BPS` (1%) on purchases and deposits. Kohler Pass holders pay no fee on purchases. |
| Withdrawals | 1% fee |

The Overview page in Admin adds these up for today, the last 30 days and the last 14 days as a chart.
Test accounts are never counted.

## 4. Survivor

Everyone at a table stakes the same. When the last seat fills, a provably fair draw knocks out one
player (two at 10-seat tables). Everyone else gets their stake back plus an equal share of the
knocked-out stake, minus Kohler's 10%.

| Mode | Seats | Knocked out | Survivor's winnings on a $10 stake |
|---|---|---|---|
| Duel | 2 | 1 | +$9.00 |
| Classic | 3 | 1 | +$4.50 |
| Squad | 5 | 1 | +$2.25 |
| Blitz | 10 | 2 | +$2.25 |

```
fee     = floor(stake × knocked_out × fee_bps / 10000)
share   = floor((stake × knocked_out − fee) / survivors)       (dust goes to the fee)
pick i  = int(sha256(serverSeed : sha256(seat seeds joined "|") : roundId : i)[0..13], 16) mod seats still in
```
The server seed's hash is published before anyone sits, and every seat adds its own seed. Players can
re-run any past draw in their browser ("tap to verify").

**Sharing.** Players open a private table (name, size, stake) and share `/t/CODE`. In a group chat the
link shows a preview card ("Survive Midnight Den: $5 in, survivors win +$2.25 each") and opens straight
into the table. No second sign-in: the casino uses the same account as the shop.

**Kohler seats on slow tables.** You asked for house bots on big tables that don't fill. Here is how
that works, and why it's set up this way:
- Only public tables with 5+ seats (Squad, Blitz). Never private tables, never Duel or Classic.
- If at least one real player is waiting and nobody has joined for `survivor_house_after_secs` (30s),
  Kohler takes the missing seats, up to `survivor_house_max` (2), but only if that fills the table.
- **Kohler's seats are shown as "Kohler" with a House tag,** and they play the same draw at the same odds.
  They're never disguised as players. Hidden house players would be a deceptive practice: if players
  noticed, it would destroy trust in the "provably fair" promise, and it's the kind of thing that gets
  payment accounts closed.
- **What they earn.** A Kohler seat is just another player at the same odds, and it pays its share of
  the 10% fee like everyone else. On its own it loses about 2% of its stake per round on average. The
  round it completes earns Kohler the **full** fee, though. On a $10 Squad table that's +$1.00 in fee
  against about −$0.20 for the Kohler seat, so every round it rescues is profit. Players also don't
  abandon a stalled table, so more rounds get played. "Kohler seats net" in Admin → Survivor tracks the seats' own result.
- Turn it off, change the wait or the max in **Admin → Survivor → Kohler seats**, or per table.

Players also get a daily stake limit and a cool-off (24h, 7d, 30d) at `/casino#/limits`.

## 5. The casino

Everything is in one page at `/casino`. The lobby features Survivor first, then the Kohler Originals,
slots and table games.

| Game | How it works | RTP |
|---|---|---|
| Rocket | The multiplier climbs as e^(0.07·t). Cash out before it crashes. Crash point = 0.99/U, capped at 1000×. The server settles on its own clock, so auto cash-out works even if the page is closed. | 99% |
| Mines | 5×5 grid with 1–24 mines. Payout after k gems = 0.99 ÷ P(surviving k picks). | 99% |
| Coin Flip | The Kohler coin: Gold or Crown, pays 1.96×. | 98% |
| Limbo | Pick a target t. Pays t× with probability 0.99/t. | 99% |
| Dice, Plinko, Wheels | | 96–99% |
| Slots (34) | Exact by construction | 95.8–96.5% |
| Roulette / Blackjack | European single zero / basic strategy | 97.3% / ≈98.9% |

Every round ends with clear feedback: a win shows the payout and the profit; a push says "Bet back"; a partial return shows what came back; a loss shows the amount lost in red with a short shake. The balance in the header shows every change as a green + or a red −.

Every result is decided on the server with the OS random generator. Nothing in the browser can change
it, and outcomes never look at balances. Signed-out visitors can play anything in demo mode.

**Removed:** Live Casino (it needs licensed studios and a revenue share), outside providers, PoolWars
(its results were decided in the browser) and the old instant games in the shop (their odds depended on
the house wallet). `/pool` and `/survivor` now redirect into the casino. The seamless wallet API
(`/api/casino/v1`, HMAC-signed) is still in place, because Kohler's own games use it. Adding an outside
provider later needs a gaming licence and a contract with them.

## 6. The Vault (non-gambling purchases)

`/casino#/vault`. Nothing here changes odds; it's how players look and show off.
- **Characters (24):** 6 free, 8 common ($0.99–$1.99), 6 rare ($4.99), 2 epic ($9.99), Midas $24.99,
  Zenith $49.99. Legendary characters glow. A player's character sits in their Survivor seat where the
  whole table sees it, so every sale advertises the next one.
- **Frames:** rings around the avatar, $1.99–$19.99.
- **Win effects:** confetti (free), coin shower, fireworks, lightning, royal gold. They play on big wins
  and on surviving.
- **Kohler Pass ($9.99 / 30 days, stacks):** no shop fee, 2× daily bonus, Pass frame and badge.

Prices and items are in `lib/vault.js`. Sales are in **Admin → Vault sales**.

## 7. Admin ("Kohler Control", `/admin`)

Sign in at `/admin` with an owner account. Every existing account was made an owner earlier;
change roles in **Players**.

| Page | What you do there |
|---|---|
| Overview | Revenue today/30 days, the 14-day chart, where money comes from, what's owed to players, what needs you, alerts, and quick switches (games on/off, Survivor open, automatic payouts) |
| Payouts | Automatic on/off, rules, hot wallet, the queue: Mark paid / Reject / Requeue |
| Deposits | Approve or reject deposit claims |
| Players | Search, adjust balances (written to the ledger), owner/catalog roles, test mode, ban, new test accounts |
| Survivor | Switches, fee, Kohler seats, tables (create, close and refund, per-table fill), recent rounds, the books check |
| Casino | Money kept today and all-time, per-game stats, switch any game off |
| Vault sales | Sales today/30 days, Pass revenue, best sellers |
| Catalog / Orders / Support | Shop brands and options, orders, reply to tickets |
| Switches & health | The site-wide games switch, the last Autopilot run, all alerts |

**Catalog editors** only see Catalog. Every sensitive action is written to `admin_audit`.

## 8. Autopilot

| Protection | What it does |
|---|---|
| `npm run forever` | Restarts the server whenever it stops, with daily logs in `logs/` |
| Boot sequence | Migrations, test account, catalogue, then it starts serving. It retries if the database is asleep. |
| Database drop-outs | Logged; the next request reconnects |
| `/health` | 200 when the app and the database answer. Point an uptime monitor at it. |
| Self-checks (every 30 min while there are visitors) | Clears expired sessions; checks every balance against its ledger; checks the Survivor books and **pauses Survivor** if they're off; settles stuck rounds; fills stalled tables; runs automatic payouts; flags old withdrawals and tickets |
| Alerts | Shown in Admin; emailed to `ALERT_EMAIL` when `RESEND_API_KEY` is set |

Still needs a person: keeping the hot wallet funded, anything outside the payout rules, paying for
hosting and Neon, and reading alerts.

## 9. Recommendations

1. **Move the database to Europe** (or the server to the US). It's the biggest speed gain left (§2).
2. **Neon plan.** The free plan's 100 compute-hours run out around day 16 if the site is busy around the
   clock, and then every request fails. Move to the Launch plan (about $20 a month) before real money.
3. **Get legal advice for your country before taking real bets.** Most places need a licence, age checks
   and location blocking.
4. **Host it properly** with HTTPS (Render, Railway, Fly or a small VPS), with `COOKIE_SECURE=true`.
5. **Start payouts manual**, switch automatic on with low caps after a week of clean books, then raise the caps.
6. **Grow Vault revenue:** a new legendary character each month, limited-time frames, and Pass-only characters.

## 10. Commands

| Command | Purpose |
|---|---|
| `npm run forever` | Production: automatic restarts and logs |
| `npm start` / `npm run dev` | Run once / auto-reload while editing |
| `npm run fix` | Repair tool: switches on, admins, login diagnosis |
| `npm run migrate` | Migrations only (also run on every start) |

## 11. Where things are

```
server.js              routes, boot sequence, admin API, share links, health
lib/boot.js            migrations + test account at start-up
lib/pool.js            Survivor: rounds, fair draw, Kohler seats, sandbox, admin API
lib/vault.js           Vault items, buying, equipping
lib/payouts.js         automatic BTC payouts and their rules
lib/autopilot.js       self-checks, alerts, cleanup
lib/chain.js           Bitcoin: addresses, deposits, sweeping, hot wallet, signing
lib/casino/            wallet.js (signed wallet API), studio.js (our games' server), engines.js (maths), catalog.js
public/casino.html     the casino: lobby, Survivor, Vault, limits
public/assets/         survivor.js, vault.js, characters.js, brand.js (logo, coin, win effects), avatar.js, icons/
public/studio/play.html  game client for every original, slot and table
public/index.html      shop     public/admin.html  Kohler Control     public/kohler.css  shop styles
db/migrations/         009 = Survivor, Vault, payouts
```
