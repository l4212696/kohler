import * as btc from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import crypto from 'node:crypto';

const TESTNET = process.env.BTC_NETWORK === 'testnet';
let API = (process.env.MEMPOOL_API || 'https://mempool.space/api').replace(/\/$/, '');
// testnet addresses can't be looked up on the mainnet explorer: point testnet at testnet4
if (TESTNET && /^https:\/\/mempool\.space\/api$/.test(API)) {
  API = 'https://mempool.space/testnet4/api';
  console.warn('[chain] BTC_NETWORK=testnet but MEMPOOL_API is the mainnet explorer; using https://mempool.space/testnet4/api');
}
const NET = TESTNET ? btc.TEST_NETWORK : btc.NETWORK;
const COIN = TESTNET ? 1 : 0;
const PHRASE = process.env.DEPOSIT_MNEMONIC || '';
const MIN_CONF = Number(process.env.MIN_CONFIRMATIONS || 2);
const SATS_PER_BTC = 100_000_000;

export const chainEnabled = () => process.env.CHAIN_ENABLED === 'true';

async function api(path, init = {}) {
  const r = await fetch(API + path, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers: { 'user-agent': 'kohler/1.0', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`mempool ${r.status} ${path}`);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

/* ── price ── */

let priceCache = { at: 0, usd: 0 };

export async function btcPriceUsd() {
  if (Date.now() - priceCache.at < 30_000 && priceCache.usd > 0) return priceCache.usd;
  try {
    const p = await api('/v1/prices');
    const usd = Number(p.USD);
    if (usd > 0) priceCache = { at: Date.now(), usd };
  } catch {
    try {
      const r = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      const usd = Number(j.data?.amount);
      if (usd > 0) priceCache = { at: Date.now(), usd };
    } catch { /* keep stale */ }
  }
  if (!priceCache.usd) throw new Error('no BTC price feed');
  return priceCache.usd;
}

export const satsToUsd = (sats, price) => (sats / SATS_PER_BTC) * price;
export const usdCentsToSats = (cents, price) => Math.round((cents / 100 / price) * SATS_PER_BTC);
export const satsToUsdCents = (sats, price) => Math.round((sats / SATS_PER_BTC) * price * 100);

/* ── derivation (BIP84, native segwit) ── */

let root;
function rootKey() {
  if (!root) {
    if (!validateMnemonic(PHRASE, wordlist)) throw new Error('DEPOSIT_MNEMONIC invalid');
    root = HDKey.fromMasterSeed(mnemonicToSeedSync(PHRASE));
  }
  return root;
}

const childAt = (idx) => rootKey().derive(`m/84'/${COIN}'/0'/0/${idx}`);

export function deriveAddress(idx) {
  return btc.p2wpkh(childAt(idx).publicKey, NET).address;
}

export function derivePrivKey(idx) {
  return childAt(idx).privateKey;
}

// Payout hot wallet: its own account branch (…/1'/0/0), never shared with a deposit address.
export function hotWallet() {
  const k = rootKey().derive(`m/84'/${COIN}'/1'/0/0`);
  return { address: btc.p2wpkh(k.publicKey, NET).address, keyHex: Buffer.from(k.privateKey).toString('hex') };
}

export async function addressBalance(address) {
  const a = await api(`/address/${address}`);
  const c = a.chain_stats || {}, m = a.mempool_stats || {};
  return (c.funded_txo_sum || 0) - (c.spent_txo_sum || 0) + (m.funded_txo_sum || 0) - (m.spent_txo_sum || 0);
}

export async function sweepAddress(idx, toAddress) {
  const priv = derivePrivKey(idx);
  const source = paymentFor(priv);
  const dest = normalizeAddress(toAddress);
  const utxos = (await api(`/address/${source.address}/utxo`))
    .filter((u) => u.status?.confirmed)
    .sort((a, b) => b.value - a.value);
  if (!utxos.length) return { swept: false, reason: 'empty' };

  const rate = await feeRate();
  const fee = Math.ceil((VSIZE_BASE + VSIZE_IN * utxos.length + VSIZE_OUT) * rate);
  const total = utxos.reduce((sum, u) => sum + Number(u.value), 0);
  const amount = total - fee;
  if (amount < DUST) return { swept: false, reason: 'below dust', total, fee };

  const tx = new btc.Transaction();
  for (const u of utxos) {
    tx.addInput({
      ...source,
      txid: hexToBytes(u.txid),
      index: u.vout,
      witnessUtxo: { script: source.script, amount: BigInt(u.value) },
    });
  }
  tx.addOutputAddress(dest, BigInt(amount), NET);
  tx.sign(priv);
  tx.finalize();
  const txid = await api('/tx', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: tx.hex,
  });
  return { swept: true, txid: String(txid).trim(), amount, fee, inputs: utxos.length };
}

/* ── address handling ── */

// where a player can see their payment on the blockchain
export const explorerTx = (txid) => /^[0-9a-f]{64}$/i.test(String(txid || '')) ? `${TESTNET ? 'https://mempool.space/testnet4' : 'https://mempool.space'}/tx/${txid}` : null;
export const addressHint = () => (TESTNET ? 'a testnet address starts with tb1, m, n or 2' : 'a Bitcoin address starts with bc1, 1 or 3');
export const isTestnet = () => TESTNET;

export function isValidAddress(addr) {
  try {
    btc.Address(NET).decode(String(addr).trim());
    return true;
  } catch {
    return false;
  }
}

export function normalizeAddress(addr) {
  return btc.Address(NET).decode(String(addr).trim()).toString();
}

function privFrom(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('no key');
  if (s.length >= 50 && /^[5KLc9]/.test(s)) return btc.WIF(NET).decode(s).privateKey;
  const hex = s.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('key must be WIF or 32-byte hex');
  return Buffer.from(hex, 'hex');
}

const paymentFor = (priv) => btc.p2wpkh(btc.utils.pubECDSA(priv, true), NET);

export function addressForKey(input) {
  return paymentFor(privFrom(input)).address;
}

/* ── payouts ── */

const VSIZE_IN = 68;
const VSIZE_OUT = 31;
const VSIZE_BASE = 11;
const DUST = 546;

async function feeRate() {
  try {
    const f = await api('/v1/fees/recommended');
    return Math.max(1, Math.min(Number(f.halfHourFee) || 4, 200));
  } catch {
    return 4;
  }
}

export async function sendBtc(input, toAddress, amountSats) {
  const priv = privFrom(input);
  const pay = paymentFor(priv);
  const dest = normalizeAddress(toAddress);
  const amount = Math.round(Number(amountSats));
  if (amount < DUST) throw new Error('below dust');

  const utxos = (await api(`/address/${pay.address}/utxo`))
    .filter((u) => u.status?.confirmed)
    .sort((a, b) => b.value - a.value);
  if (!utxos.length) throw new Error('no confirmed utxos in source wallet');

  const rate = await feeRate();
  const picked = [];
  let total = 0;
  let fee = 0;
  for (const u of utxos) {
    picked.push(u);
    total += u.value;
    fee = Math.ceil((VSIZE_BASE + VSIZE_IN * picked.length + VSIZE_OUT * 2) * rate);
    if (total >= amount + fee) break;
  }
  if (total < amount + fee) throw new Error(`insufficient utxos: have ${total}, need ${amount + fee}`);

  const tx = new btc.Transaction();
  for (const u of picked) {
    tx.addInput({
      ...pay,
      txid: hexToBytes(u.txid),
      index: u.vout,
      witnessUtxo: { script: pay.script, amount: BigInt(u.value) },
    });
  }
  tx.addOutputAddress(dest, BigInt(amount), NET);
  const change = total - amount - fee;
  if (change > DUST) tx.addOutputAddress(pay.address, BigInt(change), NET);

  tx.sign(priv);
  tx.finalize();

  const txid = await api('/tx', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: tx.hex,
  });
  return { txid: String(txid).trim(), fee, inputs: picked.length };
}

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
}

/* ── deposits ── */

let tipCache = { at: 0, h: 0 };

export async function tipHeight() {
  if (Date.now() - tipCache.at < 15_000) return tipCache.h;
  const h = Number(await api('/blocks/tip/height'));
  tipCache = { at: Date.now(), h };
  return h;
}

// Returns confirmed-or-not incoming payments for one address. Cheap enough to
// poll per address on a small book; move to an Electrum/Esplora websocket or a
// self-hosted node once you pass a few hundred open deposit addresses.
export async function scanAddress(address) {
  const [txs, tip] = await Promise.all([api(`/address/${address}/txs`), tipHeight()]);
  const out = [];
  for (const tx of txs) {
    const hits = (tx.vout || []).filter((v) => v.scriptpubkey_address === address);
    if (!hits.length) continue;
    const sats = hits.reduce((a, v) => a + Number(v.value || 0), 0);
    const confs = tx.status?.block_height ? tip - tx.status.block_height + 1 : 0;
    out.push({ txid: tx.txid, sats, confs, vouts: hits.map((v) => v.vout) });
  }
  return out;
}

// Checks deposit addresses for payments. On a normal server it polls every 15 seconds. On
// serverless hosts (Vercel) timers don't run while idle, so `check(address)` is also called
// when a player opens their wallet and from the cron endpoint, and `sweep()` checks them all.
export function watchDeposits({ addresses, onCredit, onPending, pollMs = 60_000, log = console, poll = true }) {
  if (!chainEnabled()) { log.warn('[chain] deposits disabled'); return null; }
  const lastScan = new Map(), skipped = new Set();
  let busy = false, netDownLogged = 0;

  // returns false when the explorer is unreachable, so a sweep stops early
  async function checkOne(addr, { force = false } = {}) {
    if (!isValidAddress(addr.address)) {
      if (!skipped.has(addr.address)) { skipped.add(addr.address); log.warn('[chain] skipping deposit address that is not valid on this network:', addr.address); }
      return true;
    }
    if (!force && Date.now() - (lastScan.get(addr.address) || 0) < pollMs) return true;
    lastScan.set(addr.address, Date.now());
    let found;
    try { found = await scanAddress(addr.address); } catch (e) {
      // one line every 10 minutes while the explorer is unreachable, not one per address per tick
      if (/fetch failed|ENOTFOUND|ECONNRE|ETIMEDOUT|EAI_AGAIN/.test(e.message + (e.cause?.code || ''))) {
        if (Date.now() - netDownLogged > 600_000) { netDownLogged = Date.now(); log.error(`[chain] can't reach ${API} (${e.cause?.code || e.message}). Deposits are credited once it's reachable again.`); }
        return false;
      }
      log.error('[chain] scan', addr.address, e.message); return true;
    }
    for (const tx of found) {
      if (tx.confs < MIN_CONF) { onPending?.({ address: addr.address, txid: tx.txid, sats: tx.sats, confs: tx.confs, need: MIN_CONF }); continue; }
      await onCredit({ txKey: `${tx.txid}:${addr.address}`, address: addr.address, idx: addr.idx, sats: tx.sats, txid: tx.txid });
    }
    return true;
  }
  const sweep = async ({ force = false } = {}) => {
    if (busy) return;
    busy = true;
    try {
      for (const entry of await addresses()) {
        const addr = typeof entry === 'string' ? { address: entry } : entry;
        if (!(await checkOne(addr, { force }))) break;
      }
    } catch (e) {
      log.error('[chain] tick', e.message);
    } finally {
      busy = false;
    }
  };
  if (poll) { setInterval(sweep, 15_000).unref?.(); sweep(); }
  return {
    sweep,
    // one player's address, at most every 15 seconds
    check: async (entry) => {
      const addr = typeof entry === 'string' ? { address: entry } : entry;
      if (Date.now() - (lastScan.get(addr.address) || 0) < 15_000) return;
      await checkOne(addr, { force: true });
    },
  };
}

export const randomHex = (n = 32) => crypto.randomBytes(n).toString('hex');