// Image providers for the Avatar Factory. Every provider has the same shape:
//   { id, model, configured, generate({ prompt, seed }) → { buffer, neurons } }
// The starter catalogue only ever uses the free provider. Custom (paid) avatars use their
// own provider, so a separate paid account or service can be plugged in without touching
// the catalogue. API keys stay on the server; the browser never sees them.

export class QuotaError extends Error { constructor(m, until) { super(m); this.until = until; } }
export class RetryError extends Error {}
export class ConfigError extends Error {}
export class RejectError extends Error {}   // the image or prompt itself was refused: retry with a new seed

const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 1, 0, 0); return d; };
// published pricing: $0.000053 per 512×512 tile + $0.00011 per step, $0.011 per 1,000 neurons
export const neuronsFor = (steps, side = 1024) => Math.ceil(((side / 512) ** 2 * 0.000053 + steps * 0.00011) / 0.011 * 1000);

export function cloudflare({ id, accountId, token, model = '@cf/black-forest-labs/flux-1-schnell', steps = 4, guardModel = '@cf/meta/llama-guard-3-8b' }) {
  const neurons = neuronsFor(steps);
  const acceptsSeed = !/flux-1-schnell/.test(model);
  return {
    id, model, steps, neurons, configured: !!(accountId && token),
    async generate({ prompt, seed }) {
      let r;
      try {
        r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          // FLUX.1 Schnell on Workers AI takes only prompt and steps; a seed is refused ("Bad input")
          body: JSON.stringify(acceptsSeed ? { prompt, steps, seed } : { prompt, steps }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (e) { throw new RetryError(`can't reach Cloudflare (${e.cause?.code || e.name || e.message})`); }
      const j = await r.json().catch(() => null);
      const errs = j?.errors || [];
      const msg = errs.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`;
      if (r.status === 429 || errs.some((e) => e.code === 4006 || /free allocation|neurons|rate limit/i.test(e.message || '')))
        throw new QuotaError(`Cloudflare daily allowance used up (${msg})`, nextUtcMidnight());
      if (r.status === 401 || r.status === 403 || errs.some((e) => [10000, 10001, 9109, 7003].includes(e.code)))
        throw new ConfigError(`Cloudflare refused the account ID or API token (${msg}). Check CF_ACCOUNT_ID and CF_API_TOKEN.`);
      if (r.status === 408 || r.status >= 500 || errs.some((e) => e.code === 3007)) throw new RetryError(msg);
      // "Bad input" (5006) means the request itself is wrong for this model: retrying won't help
      if (errs.some((e) => e.code === 5006) && /properties|required property|must be|type/i.test(msg) && !/nsfw|safety|flagged/i.test(msg)) throw new ConfigError(`Cloudflare rejected the request for ${model} (${msg}). Check AVATAR_MODEL.`);
      if (!r.ok || !j?.success) throw new RejectError(msg);
      const b64 = j.result?.image;
      if (typeof b64 !== 'string' || !b64.length) throw new RetryError('Cloudflare returned no image');
      return { buffer: Buffer.from(b64, 'base64'), neurons };
    },
    // a second opinion on a player's own words before we paint them (Llama Guard on the same
    // account). Returns false only when the model says the prompt is unsafe; any error lets the
    // word filter's verdict stand.
    async moderate(text) {
      try {
        const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${guardModel}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: `Draw an avatar picture of: ${text}` }] }),
          signal: AbortSignal.timeout(15_000),
        });
        const j = await r.json().catch(() => null);
        const out = j?.result?.response ?? j?.result;
        if (typeof out === 'string') return !/^\s*unsafe/i.test(out);
        if (out && typeof out === 'object' && out.safe === false) return false;
        return true;
      } catch { return true; }
    },
  };
}

// Backup painter: Pollinations (free, no key). It refuses requests that come faster than about
// one every two minutes, so the factory spaces its calls (see AVATAR_BACKUP_GAP_SECS) and treats
// a refusal as "wait", never as a picture. Only used when Cloudflare can't paint right now.
export function pollinations({ id = 'pollinations', base = 'https://image.pollinations.ai/prompt/', size = 512, gapSecs = 120 } = {}) {
  return {
    id, model: 'pollinations', steps: 0, neurons: 0, configured: true, backup: true, gapSecs,
    async generate({ prompt, seed }) {
      const url = `${base}${encodeURIComponent(prompt.slice(0, 900))}?width=${size}&height=${size}&seed=${(seed >>> 0) % 1_000_000_000}&nologo=true&private=true`;
      let r;
      try { r = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { accept: 'image/*' } }); }
      catch (e) { throw new RetryError(`can't reach Pollinations (${e.cause?.code || e.name || e.message})`); }
      const type = r.headers.get('content-type') || '';
      if (r.status === 429 || r.status === 402) throw new QuotaError(`Pollinations asked us to slow down (HTTP ${r.status})`, new Date(Date.now() + gapSecs * 1000));
      if (r.status >= 500 || r.status === 408) throw new RetryError(`Pollinations HTTP ${r.status}`);
      if (!r.ok) throw new RejectError(`Pollinations HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
      // a "limit reached" notice sometimes comes back as a page, not a picture: never keep it
      if (!type.startsWith('image/')) {
        const t = (await r.text().catch(() => '')).slice(0, 200);
        if (/limit|rate|queue|too many/i.test(t)) throw new QuotaError(`Pollinations limit reached (${t.slice(0, 80)})`, new Date(Date.now() + gapSecs * 1000));
        throw new RetryError(`Pollinations sent ${type || 'no content type'} instead of an image`);
      }
      return { buffer: Buffer.from(await r.arrayBuffer()), neurons: 0 };
    },
  };
}

// Offline stand-in for tests and demos: draws a distinct abstract "face" per seed.
export function mock({ id = 'mock', sharp, quotaAfter = Infinity, dupEvery = 0, failAll = null }) {
  let calls = 0;
  return {
    id, model: 'mock', steps: 4, neurons: neuronsFor(4), configured: true,
    async moderate(text) { return !/forbidden/i.test(text); },
    async generate({ prompt, seed }) {
      if (failAll === 'config') throw new ConfigError('mock: Cloudflare refused the account ID or API token');
      if (failAll === 'quota') throw new QuotaError('mock allowance used up', new Date(Date.now() + 3_600_000));
      if (++calls > quotaAfter) throw new QuotaError('mock allowance used up', new Date(Date.now() + 3_600_000));
      if (!sharp) throw new ConfigError('mock provider needs sharp');
      const s = dupEvery && calls % dupEvery === 0 ? 42 : seed, h = (n) => ((s * 2654435761 + n * 40503) >>> 0) % 360;
      // a random scene per seed: background split, face position, size and colours all vary
      const r = (k) => ((Math.imul(s ^ (k * 0x9e3779b1), 2654435761) >>> 0) % 1000) / 1000;
      const cx = 300 + r(1) * 424, cy = 360 + r(2) * 300, R = 200 + r(3) * 200;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
        <rect width="1024" height="1024" fill="hsl(${r(4) * 360},70%,${15 + r(5) * 40}%)"/>
        <polygon points="0,${r(6) * 1024} 1024,${r(7) * 1024} 1024,1024 0,1024" fill="hsl(${r(8) * 360},75%,${30 + r(9) * 40}%)"/>
        ${Array.from({ length: 6 }, (_, i) => `<rect x="${r(20 + i) * 900}" y="${r(30 + i) * 900}" width="${60 + r(40 + i) * 300}" height="${60 + r(50 + i) * 300}" fill="hsl(${r(60 + i) * 360},85%,${30 + r(70 + i) * 50}%)" opacity=".8" transform="rotate(${r(80 + i) * 90} 512 512)"/>`).join('')}
        <ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${R * (0.8 + r(10) * 0.5)}" fill="hsl(${r(11) * 360},60%,${35 + r(12) * 35}%)"/>
        <circle cx="${cx - R * 0.35}" cy="${cy - R * 0.2}" r="${R * (0.12 + r(13) * 0.12)}" fill="#fff"/><circle cx="${cx + R * 0.35}" cy="${cy - R * 0.2}" r="${R * (0.12 + r(14) * 0.12)}" fill="#fff"/>
        <circle cx="${cx - R * 0.33}" cy="${cy - R * 0.18}" r="${R * 0.07}" fill="#111"/><circle cx="${cx + R * 0.37}" cy="${cy - R * 0.18}" r="${R * 0.07}" fill="#111"/>
        <rect x="${cx - R * (0.2 + r(15) * 0.3)}" y="${cy + R * 0.3}" width="${R * (0.4 + r(15) * 0.6)}" height="${R * (0.1 + r(16) * 0.3)}" rx="20" fill="#2a0d14"/>
      </svg>`;
      return { buffer: await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer(), neurons: neuronsFor(4) };
    },
  };
}

export function providersFromEnv(env, sharp) {
  const gapSecs = Math.max(10, Number(env.AVATAR_BACKUP_GAP_SECS || 120));
  if (env.AVATAR_PROVIDER === 'mock') {
    const m = mock({ id: 'mock', sharp, quotaAfter: Number(env.AVATAR_MOCK_QUOTA_AFTER || Infinity), dupEvery: Number(env.AVATAR_MOCK_DUP_EVERY || 0), failAll: env.AVATAR_MOCK_FAIL });
    const b = env.AVATAR_BACKUP === 'off' ? null : { ...mock({ id: 'mock-backup', sharp }), backup: true, gapSecs };
    return { catalogue: m, custom: env.AVATAR_MOCK_FAIL ? m : mock({ id: 'mock-custom', sharp }), backup: b };
  }
  const backup = env.AVATAR_BACKUP === 'off' ? null : pollinations({ gapSecs });
  const catalogue = cloudflare({ id: 'cloudflare-free', accountId: env.CF_ACCOUNT_ID, token: env.CF_API_TOKEN, model: env.AVATAR_MODEL || undefined, steps: 4 });
  // custom avatars: a separate (paid) Cloudflare account when set, otherwise the same account
  const separate = !!(env.CF_CUSTOM_ACCOUNT_ID && env.CF_CUSTOM_API_TOKEN);
  const custom = env.AVATAR_CUSTOM_PROVIDER === 'off' ? null : cloudflare({
    id: separate ? 'cloudflare-paid' : 'cloudflare-shared',
    accountId: separate ? env.CF_CUSTOM_ACCOUNT_ID : env.CF_ACCOUNT_ID,
    token: separate ? env.CF_CUSTOM_API_TOKEN : env.CF_API_TOKEN,
    model: env.AVATAR_CUSTOM_MODEL || undefined,
    steps: Math.min(8, Math.max(1, Number(env.AVATAR_CUSTOM_STEPS || 4))),
  });
  return { catalogue, custom, backup };
}
