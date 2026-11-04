// Kohler-styled QR codes: rounded modules, rounded "eyes", deep ink-to-green colouring and an
// empty centre for a logo, drawn as SVG. Scanning stays reliable because:
//  - error correction is H (up to ~30% of the code can be covered; the logo hole uses ~5%)
//  - every module is still a solid dark shape on white, nearly the size of its cell
//  - the colours are dark (both ends of the gradient are far darker than the white background)
//  - there's a quiet zone of 2 modules around it
import QRCode from 'qrcode';

export function qrSvg(text, { hole = true, ink = ['#0b0f16', '#0d4a2e'] } = {}) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size, on = (x, y) => !!qr.modules.data[y * n + x];
  const Q = 2, S = n + Q * 2;                         // quiet zone, total size in modules
  const eye = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  // a round hole in the middle for the logo, kept to whole modules
  const c = (n - 1) / 2, r = hole ? Math.max(3, Math.round(n * 0.13)) : -1;
  const inHole = (x, y) => hole && (x - c) ** 2 + (y - c) ** 2 <= r * r;

  let dots = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!on(x, y) || eye(x, y) || inHole(x, y)) continue;
    // modules that touch a neighbour are drawn a little squarer, so runs read as one shape
    const joined = (on(x + 1, y) && !eye(x + 1, y)) || (on(x, y + 1) && !eye(x, y + 1)) || (on(x - 1, y) && !eye(x - 1, y)) || (on(x, y - 1) && !eye(x, y - 1));
    const rr = joined ? 0.28 : 0.46;
    dots += `<rect x="${x + Q + 0.04}" y="${y + Q + 0.04}" width=".92" height=".92" rx="${rr}"/>`;
  }
  const eyeAt = (x, y) => `<rect x="${x + Q + 0.5}" y="${y + Q + 0.5}" width="6" height="6" rx="1.9" fill="none" stroke="url(#qi)" stroke-width="1"/>
    <rect x="${x + Q + 2}" y="${y + Q + 2}" width="3" height="3" rx="0.95" fill="url(#qi)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" shape-rendering="geometricPrecision">
  <defs><linearGradient id="qi" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ink[0]}"/><stop offset="1" stop-color="${ink[1]}"/></linearGradient></defs>
  <rect width="${S}" height="${S}" rx="${S * 0.06}" fill="#fff"/>
  <g fill="url(#qi)">${dots}</g>
  ${eyeAt(0, 0)}${eyeAt(n - 7, 0)}${eyeAt(0, n - 7)}
</svg>`;
  return { svg, modules: n, holeFraction: hole ? (2 * r + 1) / S : 0 };
}

export const qrDataUrl = (text, opts) => 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(text, opts).svg).toString('base64');
