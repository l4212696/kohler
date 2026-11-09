// Image checks and resizing for the Avatar Factory. Uses sharp when it's installed
// (npm i installs it); without it, images are stored as they arrive and only exact
// duplicates are caught.
import crypto from 'node:crypto';

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { sharp = null; }
export const getSharp = () => sharp;

export class QualityError extends Error {}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// 64-bit difference hash: near-identical pictures get near-identical hashes
async function dHash(img) {
  const px = await img.clone().resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}
export function hamming(a, b) {
  if (!a || !b) return 64;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

// The backup painter (Pollinations) stamps "pollinations.ai" in the bottom-right corner, inside
// the last ~7% of the picture. Keeping the top 90% as a centred square removes it and keeps the
// face (portraits are head-and-shoulders, so only the chest gets a little shorter).
export async function trimWatermark(buffer) {
  if (!sharp) return buffer;
  const m = await sharp(buffer).metadata();
  const side = Math.round(Math.min(m.width, m.height) * 0.9);
  return sharp(buffer).extract({ left: Math.floor((m.width - side) / 2), top: 0, width: side, height: side }).jpeg({ quality: 92 }).toBuffer();
}

export async function processImage(buffer, { keepOriginal = false, trim = false, checks = true } = {}) {
  if (!buffer || (checks && buffer.length < 8000)) throw new QualityError('image is empty or tiny');
  if (trim && sharp) buffer = await trimWatermark(buffer);
  const sha = sha256(buffer);
  if (!sharp) {
    const f = [{ size: '512', mime: 'image/jpeg', data: buffer }, { size: '128', mime: 'image/jpeg', data: buffer }];
    if (keepOriginal) f.push({ size: 'orig', mime: 'image/jpeg', data: buffer });
    return { sha, phash: null, width: null, height: null, bytes: buffer.length, files: f };
  }
  let meta;
  try { meta = await sharp(buffer).metadata(); } catch { throw new QualityError('image could not be decoded'); }
  if (!meta.width || meta.width < 256 || meta.height < 256) throw new QualityError(`image too small (${meta.width}×${meta.height})`);
  const side = Math.min(meta.width, meta.height);
  const square = sharp(buffer).extract({ left: Math.floor((meta.width - side) / 2), top: Math.floor((meta.height - side) / 2), width: side, height: side });
  // blank, washed-out or near-black renders are rejected and regenerated
  const st = await square.clone().stats();
  const ch = st.channels.slice(0, 3), mean = ch.reduce((a, c) => a + c.mean, 0) / 3, sd = ch.reduce((a, c) => a + c.stdev, 0) / 3;
  if (checks && sd < 18) throw new QualityError('image is nearly flat (no character)');
  if (checks && (mean < 14 || mean > 245)) throw new QualityError('image is almost all black or white');
  // the face sits in the middle: the centre must carry detail too
  const c = Math.floor(side / 4), centre = await square.clone().extract({ left: c, top: c, width: side - 2 * c, height: side - 2 * c }).stats();
  if (checks && centre.channels.slice(0, 3).reduce((a, x) => a + x.stdev, 0) / 3 < 12) throw new QualityError('centre of the image is empty');
  const [w512, w128, phash] = await Promise.all([
    square.clone().resize(512, 512).webp({ quality: 82 }).toBuffer(),
    square.clone().resize(128, 128).webp({ quality: 80 }).toBuffer(),
    dHash(square),
  ]);
  const files = [{ size: '512', mime: 'image/webp', data: w512 }, { size: '128', mime: 'image/webp', data: w128 }];
  if (keepOriginal) files.push({ size: 'orig', mime: meta.format === 'png' ? 'image/png' : 'image/jpeg', data: buffer });
  return { sha, phash, width: side, height: side, bytes: buffer.length, files };
}
