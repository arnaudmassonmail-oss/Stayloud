import { test } from "node:test"; import assert from "node:assert/strict";
import { features, estimate, advise, mapPoint, makeScorer, ZERO, quality } from "../public/rephoto/align.js";

// Scène synthétique : taches et lignes à des endroits aléatoires (graine fixe).
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const SW = 400, SH = 300;
function scene() {
  const r = rng(7), img = new Float32Array(SW * SH).fill(90);
  for (let k = 0; k < 60; k++) {
    const cx = r() * SW, cy = r() * SH, rad = 6 + r() * 30, v = 40 + r() * 180;
    for (let y = Math.max(0, cy - rad | 0); y < Math.min(SH, cy + rad); y++)
      for (let x = Math.max(0, cx - rad | 0); x < Math.min(SW, cx + rad); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) img[y * SW + x] = v;
  }
  return img;
}
const SCENE = scene();
// Vue de la scène par un « appareil » : image w×h dont le centre regarde (px,py), zoom z, roulis th.
function view(w, h, { px = SW / 2, py = SH / 2, z = 1, th = 0 } = {}, light = 1) {
  const out = new Float32Array(w * h), k = (SW * 0.6) / w / z, c = Math.cos(th), s = Math.sin(th);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - (w - 1) / 2) * k, dy = (y - (h - 1) / 2) * k;
    const sx = Math.round(px + c * dx - s * dy), sy = Math.round(py + s * dx + c * dy);
    out[y * w + x] = (SCENE[Math.min(SH - 1, Math.max(0, sy)) * SW + Math.min(SW - 1, Math.max(0, sx))]) * light;
  }
  return out;
}
const W = 72, H = 54;
const REF = features(view(W, H), W, H);

test("identical framing is recognised as aligned", () => {
  const { p, score } = estimate(REF, features(view(W, H, {}, 0.6), W, H), W, H);
  assert.ok(score > 0.8, `score ${score}`);
  assert.ok(quality(p) >= 85, `quality ${quality(p)}`);
  assert.equal(advise(p, score).items.length, 0);
});

test("camera aimed too far left → advice to aim right", () => {
  // L'appareil regarde plus à gauche : la scène apparaît décalée vers la droite.
  const { p, score } = estimate(REF, features(view(W, H, { px: SW / 2 - 20 }), W, H), W, H);
  assert.ok(score > 0.6, `score ${score}`);
  assert.ok(p.tx > 0.05, `tx ${p.tx}`);
  assert.equal(advise(p, score).items[0].key, "x");
  assert.match(advise(p, score).items[0].text, /droite/);
});

test("camera aimed too high → advice to aim lower", () => {
  const { p, score } = estimate(REF, features(view(W, H, { py: SH / 2 - 15 }), W, H), W, H);
  assert.ok(p.ty > 0.04, `ty ${p.ty}`);
  assert.match(advise(p, score).items[0].text, /bas/);
});

test("too close → step back; too far → step forward", () => {
  const near = estimate(REF, features(view(W, H, { z: 1.2 }), W, H), W, H);
  assert.ok(Math.abs(near.p.ls - Math.log(1.2)) < 0.05, `ls ${near.p.ls}`);
  assert.match(advise(near.p, near.score).items[0].text, /Reculez/);
  const far = estimate(REF, features(view(W, H, { z: 0.85 }), W, H), W, H);
  assert.match(advise(far.p, far.score).items[0].text, /Avancez/);
});

test("phone rolled counter-clockwise → turn it clockwise", () => {
  // Le téléphone tourné dans le sens inverse des aiguilles : la scène paraît tournée dans le sens horaire.
  const { p, score } = estimate(REF, features(view(W, H, { th: -5 * Math.PI / 180 }), W, H), W, H);
  assert.ok(Math.abs(p.th - 5 * Math.PI / 180) < 1.5 * Math.PI / 180, `th ${p.th}`);
  assert.match(advise(p, score).items.find(i => i.key === "r").text, /dans le sens des aiguilles/);
});

test("an unrelated image is not recognised", () => {
  const r = rng(99), noise = new Float32Array(W * H).map(() => r() * 255);
  const { score } = estimate(REF, features(noise, W, H), W, H);
  assert.equal(advise(ZERO, score).found, false);
});

test("mapPoint is consistent with the scorer's transform", () => {
  const p = { tx: 0.05, ty: -0.03, ls: 0.1, th: 0.05 };
  const [x, y] = mapPoint(p, W, H, (W - 1) / 2, (H - 1) / 2);
  assert.ok(Math.abs(x - ((W - 1) / 2 + 0.05 * W)) < 1e-9 && Math.abs(y - ((H - 1) / 2 - 0.03 * W)) < 1e-9);
  assert.ok(makeScorer(REF, REF, W, H)(ZERO) > 0.999);
});
