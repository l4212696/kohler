# Kohler

A shop for digital goods (gift cards, subscriptions, top-ups) and a casino built entirely in-house:
**Survivor** (the main event), Rocket, Mines, Coin Flip, Limbo, dice, plinko, wheels, 34 slots and
blackjack/roulette. There's also the **Vault**, a shop for AI avatars, frames, win effects and the
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

## 1b. Running it on Vercel

The same code runs on Vercel. Vercel runs the server as short-lived functions instead of one
program that stays on, so a few things work differently, and the code handles them:
- **Startup.** Each cold start brings the database up to date. Migrations come from `lib/sql-bundle.js`
  because Vercel doesn't ship the `db/` folder. Run `npm run bundle-sql` after adding a migration.
- **Startup errors.** If startup can't finish, every API answer says why (for example "DATABASE_URL is
  not set"), and so does the casino page. Before, it only said "starting up" forever.
- **Pages and games.** Pages and the game client are plain files on Vercel's CDN. `/casino` and `/admin`
  map to them (`vercel.json`), and games open at `/studio/play.html?g=<game>`.
- **Casino payments.** Casino games pay out by calling the wallet code directly inside the same function,
  with the same transactions and duplicate protection. This is faster everywhere.

**Environment variables (Vercel → Project → Settings → Environment Variables).** Your `.env` is not
uploaded, so copy these across, then redeploy:
`DATABASE_URL`, `KEY_ENC` (**the exact same value as your `.env`**, or saved wallet keys can't be read),
`SESSION_SECRET`, `PUBLIC_URL=https://your-domain`, `COOKIE_SECURE=true`, `CHAIN_ENABLED`, `BTC_NETWORK`,
`MEMPOOL_API`, `DEPOSIT_MNEMONIC`, `MIN_CONFIRMATIONS`, `PLATFORM_FEE_BPS`, plus `RESEND_API_KEY`,
`MAIL_FROM`, `ALERT_EMAIL` if you use email, and a new random `CRON_SECRET`.

**Background jobs.** Vercel doesn't keep timers running between requests. These still work:
- **Deposits** are checked whenever a player opens their wallet, and every 20 seconds while the deposit
  screen is open.
- **Survivor** settles the moment a table fills.
- **Autopilot** runs on traffic.
- **Everything else** (all deposit addresses, unattended Rocket/Mines rounds, automatic payouts) runs
  from `/api/cron/tick`. `vercel.json` calls it once a day, which is the most the free plan allows. For
  every 5 minutes, add a free job at cron-job.org that calls
  `https://your-domain/api/cron/tick?key=<CRON_SECRET>`.

**Two rules to know about.** Vercel's free Hobby plan is for personal, non-commercial use only, so a site
that takes money needs Pro ($20/month). Vercel's Acceptable Use Policy also forbids content that promotes
or facilitates *unlawful* online gambling, so get the licence question settled (§9) before going live there.

## 1c. The installable app (PWA)

Kohler installs like an app: Chrome/Edge/Android show **Install app** (store footer and casino sidebar);
on iPhone it explains Share → Add to Home Screen. `public/sw.js` loads pages from the network first (so
a new deploy shows at once) and only falls back to the last copy when offline; money and account calls
are never cached. Change `VERSION` in `sw.js` if you ever need every phone to drop its cache.

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
| Vault | 100% of every sale: avatars $0.99–$19.99, custom avatars $4.99, frames, effects, Pass $9.99/30 days |
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
| Keno Boss | Pick 1–10 of 40 numbers, 10 are drawn; pays by hits. Classic pays often (top 500×), Boss pays rarely and big (top 2,500×). Each table is built from the exact odds and rounded down. Max bet $50. | 96.8–97% |
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

Games have a **Turbo** switch (top bar) that roughly halves animation time; slots, roulette, the
wheel, coin flip and limbo are also quicker by default.

## 5b. Bonuses and referrals (`lib/promos.js`)

- **First deposit doubled.** A player's first real deposit is matched 100% up to $50 (Admin → Switches &
  health → Bonuses & referrals). The old daily bonus is gone.
- **Bonus money is for playing.** It's added to the balance with a lock: it can be bet in the casino
  and Survivor, but not withdrawn or spent in the shop until the player has wagered 5× the bonus. Every
  bet counts down; when it's done (or the bonus is lost) the lock lifts. Wallets show "Includes $X bonus,
  play $Y more". The Vault and custom avatars accept bonus money (it never leaves Kohler).
- **Referrals.** Every account has a code and a link (`/r/CODE`). Sign-ups through it are linked to the
  referrer; a referral becomes *active* when that friend has deposited $10. Every 10 active referrals pay
  the referrer $10 of bonus money, then the next 10, and so on. Players see their link, progress and
  friends on Account → Invite friends. All numbers are adjustable in admin; bonuses show as a cost on
  the revenue overview.

## 6. The Vault and AI avatars (non-gambling purchases)

`/casino#/vault`. Nothing here changes odds; it's how players look and show off.
- **Avatars** are hyper-exaggerated 3D meme portraits painted by AI (Cloudflare Workers AI, FLUX.1
  Schnell). A player's avatar shows in their Survivor seat, the casino header and the shop. Anyone
  without one gets a free one picked from their name.
- **Starter collection (100):** about a third free, then $0.99 / $2.99 / $6.99 / $19.99. Every one is a
  different character. Rename or reprice any of them in Admin.
- **Custom avatars ($4.99 for 4):** the player describes what they want in their own words (up to 200
  characters), optionally picks a mood and a scene, and gets four versions only they can use. Kohler's
  house style, the portrait framing and "family-friendly, fully clothed, no text" are always wrapped
  around their words. Failed paints are refunded; an order still unpainted after a day is refunded in full.
- **Frames, win effects and the Kohler Pass** are unchanged. The old hand-drawn characters are retired.

**What players can't make.** A word filter refuses nudity, violence, drugs, hate symbols, children,
real people, brands and other franchises, then Llama Guard (on the same Cloudflare account) gets a
second look at anything that passes. Admins see exactly what each player typed and can remove any
custom avatar.

### Avatar setup (5 minutes, free)
1. Create an account at dash.cloudflare.com and copy your **Account ID**.
2. My Profile → API Tokens → Create Token → **Workers AI** template. Copy the token.
3. Add `CF_ACCOUNT_ID` and `CF_API_TOKEN` to your environment variables (Vercel: Settings →
   Environment Variables) and redeploy.
4. Open **Admin → Avatar factory**, press **Test connection** (it paints one sample pug), then **Start**.

The free plan covers about 150 images a day. When it runs out the factory rests until midnight UTC.
Every image is checked (decodes, not blank, not a near-duplicate), saved as the original plus 512px and
128px WebP in your Neon database, and served from `/avatars/<id>/<size>.webp` with year-long caching.
New starter avatars wait for your approval (or switch on "Publish without review").

**On Vercel** there's no always-on server, so painting borrows time from requests: visitors browsing
the site keep it going in the background, the admin page paints continuously while it's open, the daily
cron paints for a few minutes, and a player waiting on a custom order paints their own order by watching
it. Set Settings → Functions → Function Max Duration to 60s so a picture always has time to finish.

**Backup painter.** When Cloudflare is out of free allowance or refuses the key, Pollinations
(free, no key) takes over at one picture every 2 minutes (`AVATAR_BACKUP_GAP_SECS`), and Cloudflare is
tried again every 10 minutes. `AVATAR_BACKUP=off` turns the backup off. A picture that can't be painted
four times is refunded; a refused key never leaves an order waiting silently.

**The starter collection** is your own list of 100 characters (`STARTER` in `lib/avatars/style.js`).
New starter avatars wait for your approval in Admin → Avatar factory; the Vault tells admins when some
are waiting.

**Free and paid are kept apart.** The starter collection only uses `CF_ACCOUNT_ID`. Set
`CF_CUSTOM_ACCOUNT_ID` / `CF_CUSTOM_API_TOKEN` to paint custom avatars on a separate Workers Paid
account ($5/month, no daily cap). Without them, custom avatars share the free account.
Cost: about $0.003 to paint four.

Prices and items are in `lib/vault.js` and `lib/avatars/`. Sales are in **Admin → Vault sales**.

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
| Avatar factory | Connection test, progress, today's free allowance, review/approve/reject, prices and names, custom avatar price and sales, remove a custom avatar |
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

## 8b. Security

- **Admin two-factor sign-in.** Every admin signs in with a password and a 6-digit code from an
  authenticator app (set up on first admin sign-in, asked again every 12 hours). Setting it up needs the
  password, codes can't be reused, and 6 wrong codes lock it for 5 minutes. Lost phone: another owner
  resets it from Players, or set `ADMIN_2FA=off` for a moment and remove it again.
- **Password guessing.** 10 wrong passwords lock that account's password sign-in for 15 minutes. Unknown
  accounts and wrong passwords get the same answer. All rate limits live in Postgres, so they hold on
  Vercel where many copies of the server run at once.
- **Other websites can't act for a player.** Cookies are HttpOnly, SameSite=Lax and https-only on
  Vercel, and every change must come from Kohler's own pages. Pages can't be framed by other sites.
- **Money.** Bonus money can be played but not withdrawn or spent in the shop until it's wagered (see Bonuses below).
  Automatic payouts also wait for a person when the password changed in the last 24 hours or the
  player's balance doesn't match their ledger. Banning someone signs them out everywhere.
- **Checklist.** Admin → Switches & health lists what's set up and what isn't (KEY_ENC, https,
  CRON_SECRET, 2FA, email, mainnet).

## 8c. Going live on Bitcoin mainnet

Do this once the legal side is done. It takes about an hour, most of it waiting for confirmations.

**How the money flows.** Every player gets their own deposit address, made from one recovery phrase
(`DEPOSIT_MNEMONIC`). When a deposit confirms, the player is credited and the coins are swept to the
**parent address**. Withdrawals are paid from the **hot wallet** (also made from the phrase, path
`m/84'/0'/1'/0/0`). Admin → Payouts shows both.

1. **Use a fresh database for launch.** Testnet balances are fake money and testnet deposit addresses
   don't work on mainnet. In Neon, create a new project (or an empty branch), copy its connection
   string, and set it as `DATABASE_URL` for Production. Kohler builds every table on first start.
2. **Make a new recovery phrase** on your own computer, ideally offline:
   `npm run newseed`. Write the 24 words on paper. Never reuse the testnet phrase or a personal wallet's.
3. **Get a parent address from a wallet you control offline.** A hardware wallet (Trezor, Ledger,
   Coldcard) or Sparrow Wallet: copy one receive address (`bc1q…`). This is where deposits end up, so
   most of the money stays offline.
4. **Set the environment variables** in Vercel (Settings → Environment Variables, Production), then redeploy:

   | Variable | Value |
   |---|---|
   | `CHAIN_ENABLED` | `true` |
   | `BTC_NETWORK` | `mainnet` (anything except `testnet` is mainnet) |
   | `DEPOSIT_MNEMONIC` | the 24 words from step 2 |
   | `MEMPOOL_API` | leave unset (uses `https://mempool.space/api`) |
   | `MIN_CONFIRMATIONS` | `2` (raise to `3` if you take large deposits) |
   | `MIN_DEPOSIT_SATS`, `MIN_WITHDRAW_SATS`, `WITHDRAW_FEE_SATS` | defaults 20000 / 50000 / 800 |
   | `KEY_ENC` | 64 hex characters, set **before** launch and never changed |
   | `PUBLIC_URL` | `https://your-domain` |
   | `CRON_SECRET`, `TEST_ACCOUNT_PASSWORD` | long random strings |

   Also in Vercel: Settings → Functions → **Function Max Duration** → 60 seconds (avatar painting needs it).
5. **Sign in to Admin**, set up two-factor, then Admin → Payouts → **Where deposits go**: paste the
   parent address from step 3 and check it character by character. (Or press **Sweep deposits here**
   to use the hot wallet instead; simpler, but then all funds sit online.)
6. **Fund the hot wallet** with about one day of withdrawals. Its address is on Admin → Payouts. Top it
   up from your cold wallet when it runs low.
7. **Test with your own money:** deposit about $10 from your own wallet; it should show as "on the way"
   within a minute and be credited after 2 confirmations (~20 minutes), then appear on the parent address.
   Withdraw $5 back to your own wallet and confirm it arrives. Check Admin → Switches & health has no alerts.
8. **Keep automatic payouts off for the first week** and approve withdrawals by hand. Then switch them on
   with small caps (e.g. $100 per withdrawal, $500 a day); anything larger still waits for you.

If you ever think the phrase leaked: set `CHAIN_ENABLED=false`, sweep the hot wallet to your cold wallet,
make a new phrase, set it, and run `delete from deposit_addresses;` in the Neon SQL editor so every player gets a new address.

## 9. Recommendations

1. **Move the database to Europe** (or the server to the US). It's the biggest speed gain left (§2).
2. **Neon plan.** The free plan's 100 compute-hours run out around day 16 if the site is busy around the
   clock, and then every request fails. Move to the Launch plan (about $20 a month) before real money.
3. **Get legal advice for your country before taking real bets.** Most places need a licence, age checks
   and location blocking.
4. **Host it properly** with HTTPS (Render, Railway, Fly or a small VPS), with `COOKIE_SECURE=true`.
5. **Start payouts manual**, switch automatic on with low caps after a week of clean books, then raise the caps.
6. **Grow Vault revenue:** a new legendary avatar drop each month, limited-time frames, and Pass-only avatars.

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
lib/security.js        rate limits, admin 2FA codes, security headers, same-origin check
lib/vault.js           Vault items (frames, effects, Pass), buying, equipping
lib/avatars/           AI avatars: style.js (art direction, prompts, filters), providers.js (Cloudflare),
                       images.js (checks, WebP, duplicates), index.js (queue, shop, custom orders, admin)
lib/payouts.js         automatic BTC payouts and their rules
lib/autopilot.js       self-checks, alerts, cleanup
lib/chain.js           Bitcoin: addresses, deposits, sweeping, hot wallet, signing
lib/casino/            wallet.js (signed wallet API), studio.js (our games' server), engines.js (maths), catalog.js
public/casino.html     the casino: lobby, Survivor, Vault, limits
public/assets/         survivor.js, vault.js, characters.js, brand.js (logo, coin, win effects), avatar.js, icons/
public/studio/play.html  game client for every original, slot and table
public/index.html      shop     public/admin.html  Kohler Control     public/kohler.css  shop styles
db/migrations/         009 = Survivor, Vault, payouts · 010 = order contact · 011 = avatars · 013 = security
```
