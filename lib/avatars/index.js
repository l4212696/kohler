// Kohler Avatar Factory: a persistent queue that paints the starter catalogue on the free
// Cloudflare allowance (pausing until the allowance resets) and paints custom avatars that
// players buy. Every image is checked, de-duplicated, resized and stored in Postgres.
import express from 'express';
import crypto from 'node:crypto';
import { planCatalogue, buildPrompt, buildShortPrompt, customSpec, CUSTOM_OPTIONS, TIERS, STYLE } from './style.js';
import { providersFromEnv, providerFor, MODELS, QuotaError, ConfigError, RetryError, RejectError } from './providers.js';
import { processImage, trimWatermark, hamming, getSharp, QualityError } from './images.js';

const MAX_ATTEMPTS = 4;
const N = (v) => (v === null || v === undefined ? null : Number(v));
// Kohler Pass perks on avatars: every Epic is free to wear, owner-picked avatars are free to wear,
// and Legendary avatars cost 30% less. "Free to wear" lasts while the Pass does.
export const PASS_LEGENDARY_PCT = 70;
export const passPrice = (cents) => Math.round(Number(cents) * PASS_LEGENDARY_PCT / 100);
export const passActive = (u) => !!u?.pass_until && new Date(u.pass_until) > new Date();
const passPerk = (a) => a.tier === 'epic' || !!a.pass_free;

export function createAvatars({ q, withTx, move, audit, alert = () => {}, log = console, env = process.env }) {
  // lib/legends.js plugs in here: it decides who may wear a legendary portrait and hears when one is painted
  let legends = null;
  const useLegends = (l) => { legends = l; };
  const prov = providersFromEnv(env, getSharp());
  const st = { stateAt: 0, configAt: { catalogue: 0, custom: 0 }, nudgeAt: 0, running: false, timer: null, quotaUntil: { catalogue: null, custom: null }, configError: { catalogue: null, custom: null }, lastError: null, listCache: null };

  async function settings() {
    const m = Object.fromEntries((await q(`select key, value from site_settings where key like 'avatars\\_%'`)).rows.map((r) => [r.key, r.value]));
    const n = (k, d) => (Number.isFinite(Number(m[k])) ? Number(m[k]) : d);
    return {
      target: n('avatars_target', 100), dailyImages: n('avatars_daily_images', 150),
      autoApprove: m.avatars_auto_approve === 'true', paused: m.avatars_paused === 'true',
      customEnabled: m.avatars_custom_enabled !== 'false', customPrice: n('avatars_custom_price_cents', 499), customImages: Math.min(6, Math.max(1, n('avatars_custom_images', 4))),
    };
  }
  const putSetting = (k, v) => q(`insert into site_settings (key, value, updated_at) values ($1,$2,now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, String(v)]);
  const today = () => new Date().toISOString().slice(0, 10);
  const usedToday = async (kind) => N((await q(`select coalesce(sum(images), 0)::int n from avatar_usage where day = $1 and kind = $2`, [today(), kind])).rows[0].n);
  const quotaActive = (kind) => st.quotaUntil[kind] && st.quotaUntil[kind] > new Date();
  // quota and key problems are stored too, so every serverless instance knows about them
  async function loadState() {
    if (st.stateAt > Date.now() - 15_000) return;
    const m = Object.fromEntries((await q(`select key, value from site_settings where key like 'avatars\\_state\\_%'`)).rows.map((r) => [r.key, r.value]));
    for (const k of ['catalogue', 'custom']) {
      const until = m['avatars_state_quota_' + k] ? new Date(m['avatars_state_quota_' + k]) : null;
      st.quotaUntil[k] = until && until > new Date() ? until : null;
      st.configError[k] = m['avatars_state_error_' + k] || null;
      st.configAt[k] = m['avatars_state_errorat_' + k] ? Date.parse(m['avatars_state_errorat_' + k]) : 0;
    }
    st.stateAt = Date.now();
  }
  const saveState = (key, v) => putSetting('avatars_state_' + key, v ?? '').then(() => { st.stateAt = 0; }).catch(() => {});
  const clearErrors = async () => { st.configError.catalogue = null; st.configError.custom = null; for (const k of ['error_catalogue', 'error_custom', 'errorat_catalogue', 'errorat_custom', 'quota_catalogue', 'quota_custom']) await saveState(k, ''); };
  // A refused key or bad request pauses that painter for 10 minutes, then it tries again (keys get
  // fixed, outages end). It never blocks forever.
  const CONFIG_RETRY_MS = 10 * 60_000;
  const configBlocked = (kind) => !!st.configError[kind] && Date.now() - (st.configAt[kind] || 0) < CONFIG_RETRY_MS;
  const primaryFor = (kind) => (kind === 'custom' ? prov.custom : prov.catalogue);
  const primaryReady = (kind, s, usedCat) => !!primaryFor(kind)?.configured && !configBlocked(kind) && !quotaActive(kind)
    && (kind !== 'catalogue' || usedCat < s.dailyImages);
  const kindAllowed = (kind, s) => (kind === 'custom' ? s.customEnabled : !s.paused);
  const customReady = (s) => s.customEnabled && (!!prov.custom?.configured || !!prov.backup);
  // the backup painter allows one picture every couple of minutes, shared by every server instance
  const BACKUP_KEY = 'avatars_backup_next_at';
  async function backupNextAt() {
    const v = (await q('select value from site_settings where key = $1', [BACKUP_KEY])).rows[0]?.value;
    const t = v ? Date.parse(v) : 0;
    return Number.isFinite(t) ? t : 0;
  }
  const setBackupNext = (when) => putSetting(BACKUP_KEY, new Date(when).toISOString());
  // runs on Vercel after the answer has gone out (the request's waitUntil), so painting carries on
  // while people browse, without anyone having to keep a page open
  const waitUntil = (p) => { try { const c = globalThis[Symbol.for('@vercel/request-context')]?.get?.(); if (c?.waitUntil) { c.waitUntil(p); return true; } } catch {} return false; };

  /* ── planning: keep the starter catalogue at its target size ── */
  async function ensureCatalogue() {
    const s = await settings();
    if (s.paused || (!prov.catalogue.configured && !prov.backup)) return 0;
    const have = (await q(`select
        (select count(*) from avatars where collection = 'starter' and status in ('approved','pending'))::int as live,
        (select count(*) from avatar_jobs where kind = 'catalogue' and status in ('queued','running') and coalesce(spec->>'collection','starter') = 'starter')::int as queued`)).rows[0];
    const missing = s.target - have.live - have.queued;
    if (missing <= 0) return 0;
    const used = await q(`select subject, lower(name) as name from avatars where collection = 'starter' and status in ('approved','pending')
                          union all select spec->>'subject', lower(spec->>'name') from avatar_jobs where kind = 'catalogue' and status in ('queued','running') and coalesce(spec->>'collection','starter') = 'starter'`);
    const plan = planCatalogue(missing, new Set(used.rows.map((r) => r.subject)), new Set(used.rows.map((r) => r.name)), crypto.randomInt(2 ** 31));
    for (const p of plan) await q(`insert into avatar_jobs (kind, spec) values ('catalogue', $1)`, [p]);
    if (plan.length) log.log(`[avatars] planned ${plan.length} new starter avatars`);
    return plan.length;
  }

  /* ── the worker: one image at a time, custom orders first ── */
  // A job left "running" by a function that was stopped mid-paint goes back in the queue. It counts
  // as an attempt, so a host whose time limit is too short fails (and refunds) instead of looping.
  async function reclaimStalled() {
    const r = await q(`update avatar_jobs set attempts = attempts + 1,
         status = case when attempts + 1 >= $1 then 'failed' else 'queued' end,
         last_error = 'stopped before the picture came back (the server''s time limit may be too short)', next_at = now(), updated_at = now()
       where status = 'running' and updated_at < now() - interval '150 seconds' returning order_id, status`, [MAX_ATTEMPTS]);
    for (const x of r.rows) if (x.order_id && x.status === 'failed') await settleOrder(x.order_id);
  }
  async function routes(only) {
    await loadState();
    const s = await settings(), usedCat = await usedToday('catalogue'), out = {};
    let backupFree = null;
    for (const kind of ['custom', 'catalogue']) {
      if ((only && !only.includes(kind)) || !kindAllowed(kind, s)) continue;
      if (primaryReady(kind, s, usedCat)) out[kind] = 'primary';
      else if (prov.backup) { backupFree ??= (await backupNextAt()) <= Date.now(); if (backupFree) out[kind] = 'backup'; }
    }
    return { s, out };
  }
  async function claim(only) {
    await reclaimStalled();
    const { s, out } = await routes(only), kinds = Object.keys(out);
    if (!kinds.length) return null;
    return withTx(async (c) => {
      const j = (await c.query(`select * from avatar_jobs where status = 'queued' and next_at <= now() and kind = any($1)
                                order by (kind = 'custom') desc, (spec->>'collection' = 'legendary') desc nulls last, created_at limit 1 for update skip locked`, [kinds])).rows[0];
      if (!j) return null;
      const route = out[j.kind];
      if (route === 'backup') {
        // take the next backup slot; if another server instance just took it, leave the job queued
        await c.query(`insert into site_settings (key, value, updated_at) values ($1, '', now()) on conflict (key) do nothing`, [BACKUP_KEY]);
        const got = (await c.query(`update site_settings set value = $2, updated_at = now() where key = $1
                                      and (value = '' or value::timestamptz <= now()) returning key`,
          [BACKUP_KEY, new Date(Date.now() + prov.backup.gapSecs * 1000).toISOString()])).rows[0];
        if (!got) return null;
      }
      await c.query(`update avatar_jobs set status = 'running', updated_at = now() where id = $1`, [j.id]);
      return { ...j, settings: s, route };
    });
  }
  // what a waiting player is told, and when it's worth asking again
  async function waitInfo(kind) {
    const { s, out } = await routes([kind]);
    if (out[kind]) return { painter: out[kind] === 'backup' ? 'backup' : 'main', nextAt: null };
    if (!kindAllowed(kind, s)) return { painter: null, nextAt: null, note: 'paused' };
    const backupAt = prov.backup ? await backupNextAt() : 0;
    const primaryAt = configBlocked(kind) ? (st.configAt[kind] || 0) + CONFIG_RETRY_MS : quotaActive(kind) ? +st.quotaUntil[kind] : 0;
    const next = [backupAt, primaryAt].filter((t) => t > Date.now());
    return { painter: prov.backup ? 'backup' : 'main', nextAt: next.length ? new Date(Math.min(...next)) : null,
      note: configBlocked(kind) && !prov.backup ? 'main painter unreachable' : null };
  }

  async function isDuplicate(img, kind) {
    if ((await q('select 1 from avatars where sha256 = $1', [img.sha])).rows[0]) return true;
    if (kind !== 'catalogue' || !img.phash) return false;
    const r = await q(`select phash from avatars where collection = 'starter' and status <> 'rejected' and phash is not null`);
    // distance ≤ 4 of 64 bits = the same picture give or take compression; different characters
    // in the same centred pose sit well above that
    return r.rows.some((x) => hamming(x.phash, img.phash) <= 4);
  }

  async function runJob(job) {
    const p = job.route === 'backup' ? prov.backup : primaryFor(job.kind), spec = job.spec;
    const seed = (Number(spec.seed) || crypto.randomInt(2 ** 31)) + job.attempts * 7919;
    const legend = spec.collection === 'legendary';
    const prompt = legend ? (p.backup ? spec.shortPrompt || spec.prompt : spec.prompt) : p.backup ? buildShortPrompt(spec) : buildPrompt(spec);
    try {
      const out = await p.generate({ prompt, seed });
      await q(`insert into avatar_usage (day, provider, kind, images, neurons) values ($1,$2,$3,1,$4)
               on conflict (day, provider, kind) do update set images = avatar_usage.images + 1, neurons = avatar_usage.neurons + excluded.neurons`, [today(), p.id, job.kind, out.neurons || 0]);
      const wm = /pollinations/.test(p.id);   // the backup painter's watermark is cut off before anything is stored
      const img = await processImage(out.buffer, { keepOriginal: job.kind === 'catalogue', trim: wm });
      if (await isDuplicate(img, legend ? 'legendary' : job.kind)) throw new QualityError('too similar to an avatar we already have');
      // a legendary portrait always waits for approval in Kohler Control → Legends
      const status = legend ? 'pending' : job.kind === 'custom' || job.settings.autoApprove ? 'approved' : 'pending';
      await withTx(async (c) => {
        const a = (await c.query(
          `insert into avatars (collection, owner_id, order_id, name, status, tier, price_cents, category, subject, personality, accessory, background, extra,
                                prompt, seed, provider, model, sha256, phash, width, height, bytes, approved_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, case when $5 = 'approved' then now() end) returning id`,
          [job.kind === 'custom' ? 'custom' : legend ? 'legendary' : 'starter', job.user_id, job.order_id, spec.name || 'My avatar', status,
           job.kind === 'custom' ? 'custom' : spec.tier || 'free', job.kind === 'custom' || legend ? 0 : spec.price ?? TIERS[spec.tier || 'free'].price,
           spec.category, spec.subject, spec.personality, spec.accessory, spec.background, spec.extra || spec.userPrompt || null,
           prompt, seed, p.id, p.model, img.sha, img.phash, img.width, img.height, img.bytes])).rows[0];
        for (const f of img.files) await c.query('insert into avatar_files (avatar_id, size, mime, data) values ($1,$2,$3,$4)', [a.id, f.size, f.mime, f.data]);
        if (wm) await c.query('update avatars set wm_trimmed = true where id = $1', [a.id]);
        if (!legend && job.kind !== 'custom' && spec.tier === 'rare') await c.query('update avatars set supply = 25 where id = $1', [a.id]);   // rare = limited edition
        if (legend) await legends?.painted(c, spec.legendId, a.id);
        await c.query(`update avatar_jobs set status = 'done', avatar_id = $2, last_error = null, updated_at = now() where id = $1`, [job.id, a.id]);
      });
      st.listCache = null; st.lastError = null;
      if (job.order_id) await settleOrder(job.order_id);
      return 'ok';
    } catch (e) {
      // "wait" answers don't count as attempts: the job goes straight back so the other painter can take it
      if (e instanceof QuotaError) {
        if (p.backup) await setBackupNext(e.until);
        else { st.quotaUntil[job.kind] = e.until; await saveState('quota_' + job.kind, e.until.toISOString()); }
        await q(`update avatar_jobs set status = 'queued', next_at = now(), last_error = $2, updated_at = now() where id = $1`, [job.id, e.message]);
        log.warn(`[avatars] ${job.kind} via ${p.id}: ${e.message}. Resuming at ${e.until.toISOString()}`);
        return 'quota';
      }
      if (e instanceof ConfigError && !p.backup) {
        if (st.configError[job.kind] !== e.message) Promise.resolve(alert('avatars_config', e.message, {}, 'critical')).catch(() => {});
        st.configError[job.kind] = e.message; st.configAt[job.kind] = Date.now();
        await saveState('error_' + job.kind, e.message); await saveState('errorat_' + job.kind, new Date().toISOString());
        await q(`update avatar_jobs set status = 'queued', next_at = now(), last_error = $2, updated_at = now() where id = $1`, [job.id, e.message]);
        log.error('[avatars]', e.message);
        return 'config';
      }
      const attempts = job.attempts + 1, fatal = attempts >= MAX_ATTEMPTS;
      st.lastError = `${e.message} (${job.kind})`;
      const wait = e instanceof QualityError || e instanceof RejectError ? 2 : Math.min(120, 15 * 2 ** attempts);
      await q(`update avatar_jobs set status = $2, attempts = $3, last_error = $4, next_at = now() + make_interval(secs => $5), updated_at = now() where id = $1`,
        [job.id, fatal ? 'failed' : 'queued', attempts, String(e.message).slice(0, 300), wait]);
      if (!(e instanceof QualityError)) log.warn(`[avatars] ${job.kind} attempt ${attempts} failed: ${e.message}`);
      if (fatal && job.order_id) await settleOrder(job.order_id);
      return 'retry';
    }
  }

  // Paint for up to budgetMs, then stop cleanly (a job is never started with less than 20s
  // left). This is how serverless hosts paint: the cron, the admin page and players waiting on
  // a custom order each lend it a slice of time.
  async function work(budgetMs = 25_000, only = null) {
    const end = Date.now() + budgetMs, out = { painted: 0, tried: 0 };
    try {
      await refundStale();
      if (!only || only.includes('catalogue')) await ensureCatalogue();
      const reserve = Math.min(20_000, budgetMs / 2);
      while (Date.now() < end - reserve || (out.tried === 0 && Date.now() < end)) {
        const job = await claim(only); if (!job) break;
        out.tried++;
        if ((await runJob(job)) === 'ok') out.painted++;
      }
    } catch (e) { log.error('[avatars] work', e.message); out.error = e.message; }
    return out;
  }

  // Serverless: any visitor's request can lend the painter its spare time (at most one instance
  // at a time, every 40 seconds), so the collection fills while people use the site.
  async function nudge() {
    if (!serverless || Date.now() - st.nudgeAt < 40_000) return;
    st.nudgeAt = Date.now();
    try {
      const work_ = (await q(`select exists (select 1 from avatar_jobs where status in ('queued','running')) as jobs,
          (select count(*) from avatars where collection = 'starter' and status in ('approved','pending'))::int as have`)).rows[0];
      const s = await settings();
      if (!work_.jobs && (s.paused || work_.have >= s.target)) return;
      await q(`insert into site_settings (key, value, updated_at) values ('avatars_nudge_at', '', now()) on conflict (key) do nothing`);
      const got = (await q(`update site_settings set value = now()::text, updated_at = now() where key = 'avatars_nudge_at'
                              and (value = '' or value::timestamptz < now() - interval '40 seconds') returning key`)).rows[0];
      if (got) waitUntil(work(Number(env.AVATAR_NUDGE_MS || 40_000)));
    } catch (e) { log.warn('[avatars] nudge', e.message); }
  }

  async function tick() {
    if (st.running) return;
    st.running = true; clearTimeout(st.timer);
    try {
      await refundStale();
      await ensureCatalogue();
      let n = 0;
      for (; n < 300; n++) {
        const job = await claim(); if (!job) break;
        await runJob(job);
      }
      st.idleTick = n === 0;
    } catch (e) { log.error('[avatars] worker', e.message); }
    finally { st.running = false; schedule(); }
  }
  // wake up for the next queued job or the allowance reset; idle otherwise so the database can sleep
  async function schedule() {
    try {
      const r = (await q(`select min(next_at) as at from avatar_jobs where status = 'queued'`)).rows[0];
      if (!r.at) return;
      // nothing could be painted last time (waiting on a painter): look again in 20s, not 2s
      const ms = Math.min(6 * 3600e3, Math.max(st.idleTick ? 20_000 : 2000, new Date(r.at) - Date.now() + 500));
      st.timer = setTimeout(() => tick(), ms); st.timer.unref?.();
    } catch {}
  }
  const serverless = !!env.VERCEL;
  const kick = () => { if (!serverless) setImmediate(() => tick()); };

  /* ── custom orders ── */
  async function settleOrder(orderId) {
    await withTx(async (c) => {
      const o = (await c.query('select * from avatar_orders where id = $1 for update', [orderId])).rows[0];
      if (!o || o.status !== 'generating') return;
      const j = (await c.query(`select count(*) filter (where status = 'done')::int done, count(*) filter (where status = 'failed')::int failed,
                                      count(*) filter (where status in ('queued','running'))::int open from avatar_jobs where order_id = $1`, [orderId])).rows[0];
      if (j.open) return;
      // pay back the share of the price for every picture that couldn't be painted
      const refund = j.done ? Math.floor(o.price_cents * j.failed / o.images) : o.price_cents;
      if (refund) {
        await move(c, o.user_id, refund, 'avatar_refund', o.id, { failed: j.failed, test: o.is_test || undefined });
        if (!o.is_test) await c.query(`insert into platform_fees (user_id, kind, ref, amount_cents) values ($1,'avatar',$2,$3)`, [o.user_id, o.id, -refund]);
      }
      await c.query(`update avatar_orders set status = $2, refunded_cents = $3, done_at = now() where id = $1`, [orderId, j.done ? 'ready' : 'refunded', refund]);
    });
  }
  // an order still waiting after a day (allowance used up, provider down) is cancelled and refunded.
  // A day, not less, so the daily cron gets a chance to paint orders nobody stayed to watch.
  async function refundStale() {
    const r = await q(`select id from avatar_orders where status = 'generating' and created_at < now() - interval '26 hours'`);
    for (const o of r.rows) {
      await q(`update avatar_jobs set status = 'failed', last_error = 'timed out, refunded' where order_id = $1 and status in ('queued','running')`, [o.id]);
      await settleOrder(o.id);
    }
  }

  /* ── reads ── */
  async function list() {
    if (st.listCache && st.listCache.at > Date.now() - 30_000) return st.listCache.rows;
    const r = await q(`select a.id, a.name, a.tier, a.price_cents, a.category, a.supply, a.pass_free,
        (select count(*)::int from user_items i where i.item_id = 'av:' || a.id and not i.is_test) as sold
        from avatars a where a.collection = 'starter' and a.status = 'approved' order by a.sort, a.approved_at, a.created_at`);
    const rows = r.rows.map((a) => ({ id: a.id, name: a.name, tier: a.tier, price: a.price_cents, category: a.category, ...(passPerk(a) ? { passFree: true } : {}),
      ...(a.supply != null ? { supply: a.supply, left: Math.max(0, a.supply - a.sold) } : {}) }));
    st.listCache = { at: Date.now(), rows };
    return rows;
  }
  async function canUse(userId, id) {
    const a = (await q(`select id, collection, owner_id, status, price_cents, tier, pass_free from avatars where id = $1`, [id])).rows[0];
    if (!a || a.status !== 'approved') return false;
    if (a.collection === 'custom') return a.owner_id === userId;
    if (a.collection === 'legendary') return legends ? legends.canWear(userId, id) : false;
    if (a.price_cents === 0) return true;
    if (passPerk(a) && passActive((await q('select pass_until from users where id = $1', [userId])).rows[0])) return true;
    return !!(await q(`select 1 from user_items where user_id = $1 and item_id = $2`, [userId, 'av:' + id])).rows[0];
  }

  /* ── public API: /api/avatars ── */
  const router = express.Router();
  const h = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { log.error('[avatars]', e.message); res.status(e.code || 500).json({ error: e.code ? e.message : 'Something went wrong.' }); });
  const need = (req, res) => (req.user ? true : (res.status(401).json({ error: 'Sign in first.' }), false));
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

  router.get('/', h(async (req, res) => {
    const [items, s] = await Promise.all([list(), settings()]);
    let owned = [], mine = [], orders = [];
    if (req.user) {
      [owned, mine, orders] = await Promise.all([
        q(`select item_id from user_items where user_id = $1 and item_id like 'av:%'`, [req.user.id]).then((r) => r.rows.map((x) => x.item_id.slice(3))),
        q(`select id, name, created_at from avatars where owner_id = $1 and status = 'approved' order by created_at desc`, [req.user.id]).then((r) => r.rows),
        q(`select id, status, images, created_at from avatar_orders where user_id = $1 and status = 'generating' order by created_at desc`, [req.user.id]).then((r) => r.rows),
      ]);
    }
    res.set('cache-control', 'no-store');
    const review = req.user?.is_admin ? N((await q(`select count(*)::int n from avatars where collection = 'starter' and status = 'pending'`)).rows[0].n) : undefined;
    res.json({ avatars: items, owned, mine, pending: orders, equip: req.user?.equip || {}, review, pass: passActive(req.user), passLegendaryPct: PASS_LEGENDARY_PCT,
      custom: { enabled: customReady(s), price: s.customPrice, images: s.customImages } });
  }));
  router.get('/custom/options', (_req, res) => res.json(CUSTOM_OPTIONS()));
  router.post('/buy', h(async (req, res) => {
    if (!need(req, res)) return;
    const id = String(req.body?.id || '');
    const out = await withTx(async (c) => {
      // the avatar row is locked so two buyers can't both take the last copy of a limited edition
      const a = (await c.query(`select * from avatars where id = $1 and collection = 'starter' and status = 'approved' for update`, [id])).rows[0];
      if (!a) fail(404, 'That avatar isn’t available.');
      if (!a.price_cents) fail(400, 'That avatar is free. Just use it.');
      const u = (await c.query('select id, balance_cents, bonus_locked_cents, test_mode, banned, pass_until from users where id = $1 for update', [req.user.id])).rows[0];
      if (u.banned) fail(403, 'Account suspended.');
      const pass = passActive(u);
      if (pass && passPerk(a)) fail(400, 'It’s free with your Kohler Pass. Just use it.');
      a.price_cents = pass && a.tier === 'legendary' ? passPrice(a.price_cents) : Number(a.price_cents);
      if ((await c.query('select 1 from user_items where user_id = $1 and item_id = $2', [u.id, 'av:' + id])).rows[0]) fail(409, 'You already own this avatar.');
      if (a.supply != null) {
        const sold = N((await c.query(`select count(*)::int n from user_items where item_id = $1 and not is_test`, ['av:' + id])).rows[0].n);
        if (sold >= a.supply) fail(409, a.supply === 1 ? 'Someone already owns this one of one.' : 'Sold out. Every copy has been taken.');
      }
      if (Number(u.balance_cents) < a.price_cents) fail(402, 'Not enough balance.');
      await move(c, u.id, -a.price_cents, 'vault', 'av:' + id, { name: a.name, test: u.test_mode || undefined });
      await c.query('insert into user_items (user_id, item_id, price_cents, is_test) values ($1,$2,$3,$4)', [u.id, 'av:' + id, a.price_cents, !!u.test_mode]);
      await c.query(`update users set equip = (coalesce(equip, '{}') - 'character' - 'avatar_mode') || jsonb_build_object('avatar', $2::text) where id = $1`, [u.id, id]);
      if (!u.test_mode) await c.query(`insert into platform_fees (user_id, kind, ref, amount_cents) values ($1, 'vault', $2, $3)`, [u.id, 'av:' + id, a.price_cents]);
      return (await c.query('select balance_cents, equip from users where id = $1', [u.id])).rows[0];
    });
    st.listCache = null;   // copies left changed
    res.json({ ok: true, balance: Number(out.balance_cents), equip: out.equip });
  }));
  router.post('/equip', h(async (req, res) => {
    if (!need(req, res)) return;
    if (req.body?.default === true) {
      const r = await q(`update users set equip = (coalesce(equip, '{}') - 'avatar') || jsonb_build_object('avatar_mode', 'default') where id = $1 returning equip`, [req.user.id]);
      return res.json({ equip: r.rows[0].equip });
    }
    const id = req.body?.id ? String(req.body.id) : null;
    if (id && !(await canUse(req.user.id, id))) fail(403, 'You don’t own that avatar yet.');
    const r = await q(id ? `update users set equip = (coalesce(equip, '{}') - 'character' - 'avatar_mode') || jsonb_build_object('avatar', $2::text) where id = $1 returning equip`
                         : `update users set equip = coalesce(equip, '{}') - 'avatar' - 'avatar_mode' where id = $1 returning equip`, id ? [req.user.id, id] : [req.user.id]);
    res.json({ equip: r.rows[0].equip });
  }));
  router.post('/custom', h(async (req, res) => {
    if (!need(req, res)) return;
    const s = await settings();
    if (!customReady(s)) fail(503, 'Custom avatars aren’t available right now.');
    const { spec, error } = customSpec(req.body || {});
    if (error) fail(400, error);
    if (spec.userPrompt && prov.custom?.moderate && !(await prov.custom.moderate(spec.userPrompt)))
      fail(400, 'That description isn’t allowed. Describe a made-up, family-friendly character.');
    const busy = N((await q(`select count(*)::int n from avatar_orders where user_id = $1 and status = 'generating'`, [req.user.id])).rows[0].n);
    if (busy >= 2) fail(429, 'You already have avatars being painted. Wait for those first.');
    const order = await withTx(async (c) => {
      const u = (await c.query('select id, username, balance_cents, test_mode, banned from users where id = $1 for update', [req.user.id])).rows[0];
      if (u.banned) fail(403, 'Account suspended.');
      if (Number(u.balance_cents) < s.customPrice) fail(402, 'Not enough balance.');
      const o = (await c.query(`insert into avatar_orders (user_id, price_cents, images, spec, is_test) values ($1,$2,$3,$4,$5) returning *`,
        [u.id, s.customPrice, s.customImages, spec, !!u.test_mode])).rows[0];
      await move(c, u.id, -s.customPrice, 'avatar_custom', o.id, { test: u.test_mode || undefined });
      if (!u.test_mode) await c.query(`insert into platform_fees (user_id, kind, ref, amount_cents) values ($1,'avatar',$2,$3)`, [u.id, o.id, s.customPrice]);
      for (let i = 0; i < s.customImages; i++)
        await c.query(`insert into avatar_jobs (kind, order_id, user_id, spec) values ('custom', $1, $2, $3)`,
          [o.id, u.id, { ...spec, name: `${u.username}'s ${spec.short}`, seed: crypto.randomInt(2 ** 31) }]);
      return o;
    });
    await audit?.(req, 'avatars.custom_order', { order: order.id, price: order.price_cents });
    kick();
    res.json({ order: order.id });
  }));
  router.get('/custom/:id', h(async (req, res) => {
    if (!need(req, res)) return;
    let o = (await q('select * from avatar_orders where id = $1 and user_id = $2', [req.params.id, req.user.id])).rows[0];
    if (!o) fail(404, 'Order not found.');
    if (o.status === 'generating' && serverless) {
      await work(Number(env.AVATAR_POLL_MS || 20_000), ['custom']);
      o = (await q('select * from avatar_orders where id = $1', [o.id])).rows[0];
    }
    const [av, ahead] = await Promise.all([
      q(`select id, name from avatars where order_id = $1 order by created_at`, [o.id]),
      q(`select count(*)::int n from avatar_jobs where kind = 'custom' and status in ('queued','running') and created_at < $1`, [o.created_at]),
    ]);
    res.set('cache-control', 'no-store');
    const w = o.status === 'generating' ? await waitInfo('custom') : null;
    res.json({ id: o.id, status: o.status, images: o.images, refunded: o.refunded_cents, avatars: av.rows, ahead: ahead.rows[0].n,
      painter: w?.painter || null, nextAt: w?.nextAt || null, note: w?.note || null,
      waitingUntil: w?.nextAt && !w.painter ? w.nextAt : null });
  }));

  // image files: /avatars/<id>/<128|512|orig>.webp. Ids never change content, so browsers cache them for a year.
  const files = express.Router(), mem = new Map();
  files.get('/:id/:size.:ext', h(async (req, res) => {
    const size = ['128', '512', 'orig'].includes(req.params.size) ? req.params.size : '128';
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).end();
    const key = req.params.id + size;
    let f = mem.get(key);
    if (!f) {
      f = (await q(`select f.mime, f.data, a.status from avatar_files f join avatars a on a.id = f.avatar_id where f.avatar_id = $1 and f.size = $2`, [req.params.id, size])).rows[0];
      if (!f) return res.status(404).end();
      if (f.status === 'approved' && size !== 'orig') { mem.set(key, f); if (mem.size > 400) mem.delete(mem.keys().next().value); }
    }
    if (f.status !== 'approved' && !req.user?.is_admin) return res.status(404).end();
    res.set({ 'content-type': f.mime, 'cache-control': f.status === 'approved' ? 'public, max-age=31536000, immutable' : 'private, no-store' });
    res.end(f.data);
  }));

  /* ── admin: /api/admin/avatars ── */
  const admin = express.Router();
  async function status() {
    await loadState();
    const s = await settings();
    const [prog, usage, sales, fails] = await Promise.all([
      q(`select
          count(*) filter (where collection = 'starter' and status = 'approved')::int approved,
          count(*) filter (where collection = 'starter' and status = 'pending')::int pending,
          count(*) filter (where collection = 'starter' and status = 'rejected')::int rejected,
          count(*) filter (where collection = 'custom')::int customs,
          (select count(*) from avatar_jobs where kind = 'catalogue' and status in ('queued','running'))::int queued,
          (select count(*) from avatar_jobs where kind = 'custom' and status in ('queued','running'))::int custom_queued,
          (select count(*) from avatar_jobs where status = 'failed' and kind = 'catalogue')::int failed
        from avatars`),
      q(`select kind, provider, images, neurons from avatar_usage where day = $1`, [today()]),
      q(`select count(*)::int orders, coalesce(sum(price_cents - refunded_cents), 0)::bigint revenue,
                coalesce(sum(price_cents - refunded_cents) filter (where created_at > now() - interval '30 days'), 0)::bigint revenue30
           from avatar_orders where not is_test`),
      q(`select last_error, count(*)::int n from avatar_jobs where last_error is not null and updated_at > now() - interval '24 hours' group by 1 order by 2 desc limit 5`),
    ]);
    return {
      settings: s,
      providers: {
        catalogue: { id: prov.catalogue.id, model: prov.catalogue.model, configured: prov.catalogue.configured, quotaUntil: quotaActive('catalogue') ? st.quotaUntil.catalogue : null, error: st.configError.catalogue },
        backup: prov.backup ? { id: prov.backup.id, gapSecs: prov.backup.gapSecs, nextAt: await backupNextAt().then((t) => (t > Date.now() ? new Date(t) : null)) } : null,
        custom: prov.custom ? { id: prov.custom.id, model: prov.custom.model, configured: prov.custom.configured, quotaUntil: quotaActive('custom') ? st.quotaUntil.custom : null, error: st.configError.custom } : null,
        imageTools: !!getSharp(),
      },
      running: st.running, lastError: st.lastError, serverless,
      progress: prog.rows[0],
      usage: usage.rows, freeNeurons: 10000, neuronsPerImage: prov.catalogue.neurons,
      sales: { ...sales.rows[0], revenue: Number(sales.rows[0].revenue), revenue30: Number(sales.rows[0].revenue30) },
      recentErrors: fails.rows,
      style: STYLE,
    };
  }
  admin.get('/', h(async (req, res) => {
    const which = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
    const [s, items, customs] = await Promise.all([
      status(),
      q(`select id, name, status, tier, price_cents, category, subject, personality, accessory, background, created_at, supply, pass_free, source, model,
            (select count(*)::int from user_items i where i.item_id = 'av:' || a.id and not i.is_test) as sold from avatars a
          where collection = 'starter' ${which ? 'and status = $1' : ''} order by (status = 'pending') desc, created_at desc limit 400`, which ? [which] : []),
      q(`select a.id, a.name, a.created_at, a.extra, u.username from avatars a left join users u on u.id = a.owner_id
          where a.collection = 'custom' and a.status = 'approved' order by a.created_at desc limit 60`),
    ]);
    res.json({ ...s, avatars: items.rows, customs: customs.rows });
  }));
  admin.post('/start', h(async (req, res) => {
    await putSetting('avatars_paused', false); await clearErrors();
    await audit?.(req, 'avatars.start'); kick(); res.json(await status());
  }));
  // the admin page calls this in a loop while it's open: each call paints for ~25 seconds
  admin.post('/work', h(async (req, res) => { const r = await work(Number(env.AVATAR_ADMIN_MS || 25_000)); res.json({ ...r, ...(await status()) }); }));
  admin.post('/pause', h(async (req, res) => { await putSetting('avatars_paused', true); await audit?.(req, 'avatars.pause'); res.json(await status()); }));
  admin.post('/more', h(async (req, res) => {
    const s = await settings(), add = Math.min(200, Math.max(1, Math.round(Number(req.body?.count) || 20)));
    await putSetting('avatars_target', s.target + add); await audit?.(req, 'avatars.more', { add }); kick(); res.json(await status());
  }));
  admin.post('/retry-failed', h(async (req, res) => {
    await q(`update avatar_jobs set status = 'queued', attempts = 0, next_at = now() where status = 'failed' and kind = 'catalogue'`);
    kick(); res.json(await status());
  }));
  admin.post('/approve-all', h(async (req, res) => {
    const r = await q(`update avatars set status = 'approved', approved_at = now() where collection = 'starter' and status = 'pending' returning id`);
    st.listCache = null; await audit?.(req, 'avatars.approve_all', { n: r.rows.length }); res.json({ approved: r.rows.length });
  }));
  admin.patch('/settings', h(async (req, res) => {
    const b = req.body || {};
    if (b.autoApprove !== undefined) await putSetting('avatars_auto_approve', !!b.autoApprove);
    if (b.customEnabled !== undefined) await putSetting('avatars_custom_enabled', !!b.customEnabled);
    if (b.customPrice !== undefined) await putSetting('avatars_custom_price_cents', Math.max(0, Math.round(Number(b.customPrice))));
    if (b.target !== undefined) await putSetting('avatars_target', Math.min(1000, Math.max(0, Math.round(Number(b.target)))));
    if (b.dailyImages !== undefined) await putSetting('avatars_daily_images', Math.min(170, Math.max(0, Math.round(Number(b.dailyImages)))));
    await audit?.(req, 'avatars.settings', b); kick(); res.json(await status());
  }));
  admin.patch('/:id', h(async (req, res) => {
    const b = req.body || {}, sets = [], vals = [req.params.id];
    const put = (col, v) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(v); };
    if (['approved', 'rejected', 'pending'].includes(b.status)) { put('status', b.status); if (b.status === 'approved') sets.push('approved_at = coalesce(approved_at, now())'); }
    if (b.tier && TIERS[b.tier]) {
      put('tier', b.tier); if (b.price === undefined) put('price_cents', TIERS[b.tier].price);
      if (b.tier === 'rare' && b.supply === undefined) sets.push('supply = coalesce(supply, 10)');   // rare = limited edition
    }
    if (b.price !== undefined) put('price_cents', Math.max(0, Math.round(Number(b.price))));
    if (b.name) put('name', String(b.name).slice(0, 40));
    if (b.passFree !== undefined) put('pass_free', !!b.passFree);
    // limited editions: how many copies exist (blank/null = unlimited, 1 = one of one)
    if (b.supply !== undefined) {
      const v = b.supply === null || b.supply === '' ? null : Math.round(Number(b.supply));
      if (v !== null && !(v >= 1 && v <= 100000)) fail(400, 'Copies must be 1 or more, or blank for unlimited.');
      if (v !== null) {
        const sold = N((await q(`select count(*)::int n from user_items where item_id = $1 and not is_test`, ['av:' + req.params.id])).rows[0].n);
        if (v < sold) fail(400, `${sold} ${sold === 1 ? 'copy is' : 'copies are'} already sold, so it can't go below ${sold}.`);
      }
      put('supply', v);
    }
    if (!sets.length) return res.json({ ok: true });
    await q(`update avatars set ${sets.join(', ')} where id = $1`, vals);
    st.listCache = null; mem.clear();
    await audit?.(req, 'avatars.update', { id: req.params.id, ...b });
    if (b.status === 'rejected') kick();   // the factory paints a replacement
    res.json({ ok: true });
  }));
  // remove a player's custom avatar (inappropriate content): it stops showing everywhere
  admin.post('/custom/:id/remove', h(async (req, res) => {
    const r = await q(`update avatars set status = 'rejected' where id = $1 and collection = 'custom' returning owner_id`, [req.params.id]);
    if (r.rows[0]) await q(`update users set equip = equip - 'avatar' where id = $1 and equip->>'avatar' = $2`, [r.rows[0].owner_id, req.params.id]);
    mem.clear(); await audit?.(req, 'avatars.custom_remove', { id: req.params.id }); res.json({ ok: true });
  }));
  // one real image to prove the keys work, stored nowhere
  admin.post('/test', h(async (req, res) => {
    const which = req.body?.which === 'custom' ? prov.custom : prov.catalogue;
    if (!which?.configured) fail(400, 'Add CF_ACCOUNT_ID and CF_API_TOKEN to your environment variables (Vercel: Settings → Environment Variables, then redeploy) first.');
    const t0 = Date.now();
    try {
      const out = await which.generate({ prompt: buildPrompt({ subject: 'a pug', personality: 'overconfident', accessory: 'oversized_sunglasses', background: 'colourful_studio', texture: 'ultra detailed realistic fur' }), seed: 7 });
      await clearErrors();
      res.json({ ok: true, ms: Date.now() - t0, bytes: out.buffer.length, preview: 'data:image/jpeg;base64,' + out.buffer.toString('base64') });
    } catch (e) { res.status(400).json({ error: e.message }); }
  }));

  /* ── avatars the owner makes by hand: painted now with a chosen model, or uploaded ── */
  async function addAvatar({ img, name, tier, price, supply, passFree, legendId, prompt, provider, model, source, status }) {
    tier = TIERS[tier] ? tier : 'common';
    const collection = legendId ? 'legendary' : 'starter';
    return withTx(async (c) => {
      const a = (await c.query(
        `insert into avatars (collection, name, status, tier, price_cents, prompt, provider, model, sha256, phash, width, height, bytes, supply, pass_free, source, approved_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, case when $3 = 'approved' then now() end) returning id`,
        [collection, String(name || 'New avatar').slice(0, 40), status, legendId ? 'legendary' : tier, legendId ? 0 : Math.max(0, Math.round(Number(price ?? TIERS[tier].price))),
         prompt || '(uploaded image)', provider, model, img.sha, img.phash, img.width, img.height, img.bytes,
         legendId ? null : supply === '' || supply == null ? null : Math.max(1, Math.round(Number(supply))), legendId ? false : !!passFree, source])).rows[0];
      for (const f of img.files) await c.query('insert into avatar_files (avatar_id, size, mime, data) values ($1,$2,$3,$4)', [a.id, f.size, f.mime, f.data]);
      if (legendId) await legends?.painted(c, legendId, a.id);
      return a.id;
    }).catch((e) => { if (e.code === '23505') fail(409, 'That exact picture is already in the collection.'); throw e; });
  }
  admin.get('/models', h(async (_req, res) => {
    const cf = !!(env.CF_ACCOUNT_ID && env.CF_API_TOKEN) || env.AVATAR_PROVIDER === 'mock';
    res.json({ models: MODELS.map((m) => ({ ...m, ready: m.id.startsWith('pollinations') || cf })), tiers: Object.fromEntries(Object.entries(TIERS).map(([k, v]) => [k, v.price])), style: STYLE?.name || null });
  }));
  // paint one picture now; it lands in "To review" (or as a Legend's new portrait)
  admin.post('/create', h(async (req, res) => {
    const b = req.body || {}, text = String(b.prompt || '').trim().slice(0, 1500);
    if (text.length < 3) fail(400, 'Describe the character first.');
    const p = providerFor(String(b.model || MODELS[0].id), env, getSharp());
    if (!p) fail(400, 'Pick a model.');
    if (!p.configured) fail(400, 'That model needs CF_ACCOUNT_ID and CF_API_TOKEN on the server.');
    // the house style wraps the description so it matches the rest of the collection
    const prompt = b.houseStyle === false ? text : buildPrompt({ subject: text, personality: b.personality || '', accessory: '', background: b.background || '', texture: '' }).replace(/\s+,/g, ',');
    let out;
    try { out = await p.generate({ prompt, seed: crypto.randomInt(2 ** 31) }); }
    catch (e) { fail(e instanceof QuotaError ? 429 : 502, `${MODELS.find((m) => m.id === b.model)?.name || 'The painter'} couldn’t paint it: ${e.message}`); }
    const img = await processImage(out.buffer, { keepOriginal: true, trim: /pollinations/.test(p.id) }).catch((e) => fail(422, `The picture came back unusable (${e.message}). Try again.`));
    const id = await addAvatar({ img, name: b.name, tier: b.tier, price: b.price, supply: b.supply, passFree: b.passFree, legendId: b.legendId || null, prompt, provider: p.id, model: p.model, source: 'admin-ai', status: 'pending' });
    st.listCache = null; await audit?.(req, 'avatars.create', { id, model: b.model });
    res.json({ id });
  }));
  // upload a finished picture (an artist's work, for example). It goes live straight away
  // in the collection, or becomes a Legend's new portrait waiting for approval.
  admin.post('/upload', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '8mb' }), h(async (req, res) => {
    const b = req.query || {};
    if (!Buffer.isBuffer(req.body) || req.body.length < 200) fail(400, 'Pick an image file.');
    const img = await processImage(req.body, { keepOriginal: true, checks: false }).catch((e) => fail(422, `That file can’t be used: ${e.message}`));
    const id = await addAvatar({ img, name: b.name, tier: b.tier, price: b.price, supply: b.supply, passFree: b.passFree === 'true', legendId: b.legendId || null, provider: 'upload', model: null, source: 'upload', status: b.legendId ? 'pending' : 'approved' });
    st.listCache = null; await audit?.(req, 'avatars.upload', { id, legend: b.legendId || null });
    res.json({ id });
  }));

  // pictures painted by the backup painter before update 19 still carry its watermark: cut it off
  // once, from the stored original (or the 512 if there's no original), and remember it's done
  async function fixWatermarks(max = 40) {
    if (!getSharp()) return 0;
    const r = await q(`select id from avatars where provider like 'pollinations%' and not wm_trimmed and status <> 'rejected' order by created_at limit $1`, [max]);
    let n = 0;
    for (const { id } of r.rows) {
      try {
        const f = (await q(`select size, data from avatar_files where avatar_id = $1 and size in ('orig','512')`, [id])).rows;
        const src = (f.find((x) => x.size === 'orig') || f.find((x) => x.size === '512'))?.data;
        if (!src) { await q('update avatars set wm_trimmed = true where id = $1', [id]); continue; }
        const img = await processImage(await trimWatermark(src), { keepOriginal: f.some((x) => x.size === 'orig'), checks: false }).catch((e) => (log.warn('[avatars] watermark', id, e.message), null));
        if (!img) { await q('update avatars set wm_trimmed = true where id = $1', [id]); continue; }
        await withTx(async (c) => {
          for (const x of img.files) await c.query('update avatar_files set data = $3, mime = $4 where avatar_id = $1 and size = $2', [id, x.size, x.data, x.mime]);
          await c.query('update avatars set wm_trimmed = true, sha256 = $2, phash = coalesce($3, phash) where id = $1', [id, img.sha, img.phash]);
        });
        n++;
      } catch (e) { log.warn('[avatars] watermark', id, e.message); }
    }
    if (n) { mem.clear(); st.listCache = null; log.log(`[avatars] trimmed the watermark off ${n} pictures`); }
    return n;
  }
  admin.post('/fix-watermarks', h(async (req, res) => { const n = await fixWatermarks(200); await audit?.(req, 'avatars.fix_watermarks', { n }); res.json({ fixed: n }); }));

  function boot() { kick(); }
  return { router, files, admin, kick, boot, work, nudge, status, list, canUse, useLegends, fixWatermarks };
}
