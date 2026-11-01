// REPRISE — estimation de l'écart de cadrage entre une photo de référence et l'image en direct.
//
// Les deux images sont réduites (≈ 3 900 pixels), transformées en « carte des contours »
// (gradient adouci et normalisé, donc peu sensible aux différences de lumière ou de couleur),
// puis on cherche la transformation qui superpose le mieux la référence sur le direct :
//   point de la référence r  →  point du direct  c + s·R(θ)·(r − c) + t
// (c = centre de l'image, s = échelle, θ = rotation, t = décalage).
// Les paramètres sont indépendants de la résolution :
//   tx, ty : décalage en fraction de la largeur de l'image
//   ls     : logarithme de l'échelle (ls > 0 : la scène paraît plus grande qu'avant)
//   th     : rotation en radians (th > 0 : la scène paraît tournée dans le sens horaire)

export const PIXELS = 3900;

/** Taille d'analyse pour un rapport largeur / hauteur donné. */
export function analysisSize(aspect, pixels = PIXELS) {
  const w = Math.max(16, Math.round(Math.sqrt(pixels * aspect)));
  const h = Math.max(16, Math.round(w / aspect));
  return { w, h };
}

/** RGBA (ImageData.data) → niveaux de gris. */
export function toGray(rgba, n) {
  const g = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return g;
}

function boxBlur(src, w, h) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = x > 0 ? src[i - 1] : src[i], b = x < w - 1 ? src[i + 1] : src[i];
    tmp[i] = (a + src[i] + b) / 3;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = y > 0 ? tmp[i - w] : tmp[i], b = y < h - 1 ? tmp[i + w] : tmp[i];
    out[i] = (a + tmp[i] + b) / 3;
  }
  return out;
}

/** Carte des contours adoucie, moyenne 0 et écart-type 1. */
export function features(gray, w, h) {
  let g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1];
    const gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1];
    g[i] = Math.sqrt(Math.sqrt(gx * gx + gy * gy)); // racine : les contours forts ne dominent pas tout
  }
  g = boxBlur(boxBlur(g, w, h), w, h);
  let m = 0;
  for (let i = 0; i < g.length; i++) m += g[i];
  m /= g.length;
  let v = 0;
  for (let i = 0; i < g.length; i++) { g[i] -= m; v += g[i] * g[i]; }
  const sd = Math.sqrt(v / g.length) || 1;
  for (let i = 0; i < g.length; i++) g[i] /= sd;
  return g;
}

/** Point de la référence (coordonnées d'analyse) → position dans le direct. */
export function mapPoint(p, w, h, x, y) {
  const cx = (w - 1) / 2, cy = (h - 1) / 2, s = Math.exp(p.ls), c = Math.cos(p.th), sn = Math.sin(p.th);
  const dx = x - cx, dy = y - cy;
  return [cx + s * (c * dx - sn * dy) + p.tx * w, cy + s * (sn * dx + c * dy) + p.ty * w];
}

/**
 * Renvoie score(p, pas) : corrélation (−1 à 1) entre le direct et la référence déplacée par p.
 * −1 si les deux images se recouvrent trop peu.
 */
export function makeScorer(ref, live, w, h) {
  const cx = (w - 1) / 2, cy = (h - 1) / 2, B = 2;
  return function score(p, step = 1) {
    const s = Math.exp(p.ls), c = Math.cos(p.th) / s, sn = Math.sin(p.th) / s, Tx = p.tx * w, Ty = p.ty * w;
    let n = 0, total = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let y = B; y < h - B; y += step) {
      const dy = y - cy - Ty;
      for (let x = B; x < w - B; x += step) {
        total++;
        const dx = x - cx - Tx;
        const rx = cx + c * dx + sn * dy, ry = cy - sn * dx + c * dy;
        if (rx < 0 || ry < 0 || rx >= w - 1 || ry >= h - 1) continue;
        const x0 = rx | 0, y0 = ry | 0, fx = rx - x0, fy = ry - y0, i = y0 * w + x0;
        const a = (ref[i] * (1 - fx) + ref[i + 1] * fx) * (1 - fy) + (ref[i + w] * (1 - fx) + ref[i + w + 1] * fx) * fy;
        const b = live[y * w + x];
        n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
      }
    }
    if (n < total * 0.35) return -1;
    const den = (n * saa - sa * sa) * (n * sbb - sb * sb);
    return den > 0 ? (n * sab - sa * sb) / Math.sqrt(den) : -1;
  };
}

/** Score minimal pour considérer la scène reconnue (deux images sans rapport donnent ≈ 0,2–0,3). */
export const FOUND = 0.4;

export const ZERO = Object.freeze({ tx: 0, ty: 0, ls: 0, th: 0 });
const DEG = Math.PI / 180;

/** Recherche grossière sur tout l'espace (décalage ±30 %, échelle ±30 %, rotation ±8°). */
export function globalSearch(score, w, h, start = ZERO) {
  let best = { ...start }, bestV = score(best, 2);
  const zv = score(ZERO, 2);
  if (zv > bestV) { best = { ...ZERO }; bestV = zv; }
  const ratio = h / w;
  for (const ls of [-0.28, -0.14, 0, 0.14, 0.28])
    for (const th of [-8 * DEG, -4 * DEG, 0, 4 * DEG, 8 * DEG])
      for (let ty = -0.3 * ratio; ty <= 0.3 * ratio + 1e-9; ty += 0.035)
        for (let tx = -0.3; tx <= 0.3 + 1e-9; tx += 0.035) {
          const p = { tx, ty, ls, th }, v = score(p, 2);
          if (v > bestV) { bestV = v; best = p; }
        }
  return best;
}

/** Affinage local (montée de gradient à pas décroissants). */
export function refine(score, p0, maxEvals = 120) {
  const keys = ['tx', 'ty', 'ls', 'th'];
  const step = { tx: 0.02, ty: 0.02, ls: 0.04, th: 0.03 };
  const min = { tx: 0.0015, ty: 0.0015, ls: 0.002, th: 0.0015 };
  let p = { ...p0 }, v = score(p), evals = 1;
  while (evals < maxEvals && keys.some(k => step[k] >= min[k])) {
    let improved = false;
    for (const k of keys) {
      if (step[k] < min[k]) continue;
      for (const sg of [1, -1]) {
        const q = { ...p, [k]: p[k] + sg * step[k] }, vq = score(q);
        evals++;
        if (vq > v) { p = q; v = vq; improved = true; break; }
      }
    }
    if (!improved) for (const k of keys) step[k] /= 2;
  }
  return { p, score: v };
}

/** Estimation complète (recherche globale + affinage). */
export function estimate(ref, live, w, h, start) {
  const score = makeScorer(ref, live, w, h);
  return refine(score, globalSearch(score, w, h, start));
}

/** Qualité de l'alignement, de 0 à 100. */
export function quality(p) {
  const d = Math.hypot(p.tx, p.ty) / 0.03, s = p.ls / 0.035, r = p.th / (1.5 * DEG);
  return Math.round(100 * Math.exp(-0.5 * (d * d + s * s + r * r)));
}

/**
 * Conseils à afficher, du plus important au moins important.
 * conf = score de corrélation : en dessous de 0,4 la scène n'est pas reconnue.
 */
export function advise(p, conf) {
  if (!(conf >= FOUND)) return { found: false, quality: 0, items: [{ key: 'lost', icon: '🔍', text: 'Scène pas encore reconnue : visez à peu près le même endroit' }] };
  const items = [];
  const add = (key, err, icon, text) => items.push({ key, err, icon, text });
  if (Math.abs(p.tx) > 0.012) add('x', Math.abs(p.tx) / 0.012, p.tx > 0 ? '→' : '←', p.tx > 0 ? 'Visez un peu plus à droite' : 'Visez un peu plus à gauche');
  if (Math.abs(p.ty) > 0.012) add('y', Math.abs(p.ty) / 0.012, p.ty > 0 ? '↓' : '↑', p.ty > 0 ? 'Visez un peu plus bas' : 'Visez un peu plus haut');
  if (Math.abs(p.ls) > 0.025) add('z', Math.abs(p.ls) / 0.025, p.ls > 0 ? '⤺' : '⤻', p.ls > 0 ? 'Reculez un peu' : 'Avancez un peu');
  if (Math.abs(p.th) > 1 * DEG) add('r', Math.abs(p.th) / (1 * DEG), p.th > 0 ? '↻' : '↺', p.th > 0 ? 'Tournez le téléphone dans le sens des aiguilles d’une montre' : 'Tournez le téléphone dans le sens inverse des aiguilles d’une montre');
  items.sort((a, b) => b.err - a.err);
  return { found: true, quality: quality(p), items };
}
