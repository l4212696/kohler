// Player faces everywhere on Kohler. A player's face is their equipped avatar; anyone who
// hasn't picked one gets a free starter avatar chosen from their name, so the same player
// always looks the same. Until the catalogue exists, the generated emblem is the fallback.
//   KohlerFace.set(list)                    list from GET /api/avatars
//   KohlerFace.html(name, equip, size)      '<img …>' or the emblem svg
(function () {
  const hash = (s) => { let h = 2166136261; for (const c of String(s || '?')) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const F = {
    list: [], free: [], byId: {},
    set(list) { this.list = list || []; this.free = this.list.filter((a) => !a.price); this.byId = Object.fromEntries(this.list.map((a) => [a.id, a])); },
    url: (id, size = 128) => `/avatars/${id}/${size}.webp`,
    idFor(name, equip) { return equip?.avatar || (this.free.length ? this.free[hash(name) % this.free.length].id : null); },
    html(name, equip, size = 44, radius) {
      const id = this.idFor(name, equip);
      if (!id) return window.KohlerAvatar ? KohlerAvatar(name, { size }) : '';
      const r = radius ?? Math.round(size * 0.3);
      return `<img src="${this.url(id, size > 120 ? 512 : 128)}" width="${size}" height="${size}" alt="" loading="lazy" decoding="async"
        style="display:block;width:${size}px;height:${size}px;border-radius:${r}px;object-fit:cover;background:#151c27"
        onerror="this.onerror=null;this.outerHTML=window.KohlerAvatar?KohlerAvatar(${JSON.stringify(String(name || '?')).replace(/"/g, '&quot;')},{size:${size}}):''">`;
    },
  };
  window.KohlerFace = F;
})();
