// The scenery of each shot, built as geometry after the reference paintings in
// materials/incoming/ (which are looked at, not loaded): which painting each thing follows
// is noted where it is built, and catalogued in materials/INDEX.md.
//
// Each scene is one merged mesh. Colours are the pigment of a full-strength wash; the
// painting pass (shaders.js) thins them where the light falls and thickens them in shade.
import * as THREE from 'three';
import { Builder, K, FACE, hex, mixc, mat, rng, noise2, fbm2, shaft, sector, block, rock, puff, lathe, limb, terrain, rect, slabOf, archHole } from './build.js';
import { RUINS, colX, LAKE, FOREST, TOWER, SUMMIT, SHORE, past } from './layout.js';

const V3lerp = (a, c, k, dy = 0) => [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k + dy, a[2] + (c[2] - a[2]) * k];

const HALF = Math.PI / 2;
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const between = (rnd, a, b) => a + (b - a) * rnd();

// Where the camera and the traveller go during a shot, so that nothing is built in their way.
function clearance(shot) {
  const cams = [], figs = [];
  for (let t = -4; t <= shot.dur + 6; t += 0.04) { cams.push(shot.frame(t).cam.pos); figs.push(shot.figure(t).pos); }
  // Is a thing of radius r, reaching up to height `top`, at (x, z) clear of both?
  return (x, z, r, top, camGap = 0.5, figGap = 1.2) =>
    cams.every((p) => p[1] > top + 0.5 || Math.hypot(p[0] - x, p[2] - z) > r + camGap) &&
    figs.every((p) => p[1] > top + 1.2 || Math.hypot(p[0] - x, p[2] - z) > r + figGap);
}

// ---- small things, shared by the scenes -------------------------------------------------
// When the fleck we follow (shots.js) first comes within `reach` of a place: lamps light then.
function passing(shot, reach = 2.4) {
  const pts = [];
  for (let t = -1.5; t <= shot.dur + 1.5; t += 0.04) pts.push([t, shot.wisp(t)]);
  return (x, y, z, r = reach) => { for (const [t, p] of pts) if (Math.hypot(p[0] - x, p[1] - y, p[2] - z) < r) return t; return 1e4; };
}
// When a height that only rises (a wash coming up) reaches y.
const whenUp = (rise, y, t0, t1) => { if (rise(t1) < y) return 1e4; let a = t0, c = t1; for (let i = 0; i < 20; i++) { const m = (a + c) / 2; if (rise(m) < y) a = m; else c = m; } return c; };
// Grass: a few blades from one root, held at the ground (K.BLADE: the wind bends them, and whoever passes).
function tuft(b, rnd, x, z, { y = 0, h = 0.45, n = 6, spread = 0.16, lean = 0.45, color }) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, d = spread * Math.sqrt(rnd()), bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d, hh = h * between(rnd, 0.5, 1.15), l = lean * hh * between(rnd, 0.2, 1);
    b.add(limb([[bx, y - 0.04, bz], [bx + Math.cos(a) * l * 0.3, y + hh * 0.55, bz + Math.sin(a) * l * 0.3], [bx + Math.cos(a) * l, y + hh, bz + Math.sin(a) * l]], [0.012 + 0.014 * hh, 0.009 + 0.01 * hh, 0.002], 3),
      { kind: K.BLADE, face: FACE.SMOOTH, color: mixc(color, [1, 1, 1], between(rnd, -0.12, 0.16)), extra: (vx, vy) => Math.max(0, vy - y) });
  }
}
// Creeper hanging from (x, y, z): a strand held at its top, with leaves down it.
function vine(b, rnd, x, y, z, len, color) {
  const id = b.id(), dx = between(rnd, -0.25, 0.25), dz = between(rnd, -0.25, 0.25), held = (vx, vy) => Math.max(0, y - vy);
  b.add(limb([[x, y + 0.05, z], [x + dx * 0.3, y - len * 0.4, z + dz * 0.3], [x + dx * 0.8, y - len * 0.8, z + dz * 0.8], [x + dx, y - len, z + dz]], [0.03, 0.024, 0.016, 0.004], 4),
    { kind: K.BLADE, face: FACE.SMOOTH, color, id, extra: held });
  for (let q = 0.25; q < len; q += between(rnd, 0.22, 0.42)) {
    const k = q / len, a = rnd() * 6.283, r = between(rnd, 0.07, 0.12) * (1 - 0.4 * k);
    b.add(new THREE.SphereGeometry(r, 5, 4), { kind: K.BLADE, face: FACE.SMOOTH, id, extra: held, color: mixc(color, [1, 1, 1], between(rnd, 0, 0.3)),
      m: mat([x + dx * k + Math.cos(a) * 0.09, y - q, z + dz * k + Math.sin(a) * 0.09], [rnd() * 3, a, 0], [1, 0.35, 1.5]) });
  }
}
// A lantern whose top is at (x, y, z): a cap, a paper body that lights at shot time `on`, a foot.
function lantern(b, x, y, z, on, { metal, paper, s = 1 }) {
  const dark = { kind: K.DARK, face: FACE.FACET, color: metal };
  b.add(new THREE.ConeGeometry(0.15 * s, 0.1 * s, 6), { ...dark, m: mat([x, y - 0.05 * s, z]) });
  b.add(new THREE.CylinderGeometry(0.1 * s, 0.085 * s, 0.24 * s, 6), { kind: K.LAMP, face: FACE.FACET, color: paper, extra: on, m: mat([x, y - 0.22 * s, z]) });
  b.add(new THREE.CylinderGeometry(0.11 * s, 0.11 * s, 0.03 * s, 6), { ...dark, m: mat([x, y - 0.355 * s, z]) });
}
// A tall jar, standing or lying.
function urn(b, x, z, color, { s = 1, lie = 0, seed = 1 } = {}) {
  const prof = [[0.16, 0], [0.19, 0.03], [0.13, 0.09], [0.26, 0.32], [0.34, 0.58], [0.32, 0.8], [0.2, 1.0], [0.13, 1.08], [0.13, 1.16], [0.2, 1.21], [0.2, 1.25], [0.14, 1.25]].map(([r, y]) => [r * s, y * s]);
  b.add(lathe(prof, 20), { kind: K.STONE, face: FACE.SMOOTH, color, m: lie ? mat([x, 0.33 * s, z], [HALF, lie, 0]) : mat([x, 0, z], [0, seed, 0]), rest: lie ? 0 : null });
}

// ---- growth (v13): what keeps a place from being bare ------------------------------------
// A soft ball with few faces, for what is small on the picture.
const blob = (r, seed, lumps = 0.2) => puff(r, seed, lumps, 11, 8);
// A bush: a few soft balls sitting on the ground, each its own wash, like a crown without a
// trunk. (Made of few-faced balls of one wash they were boulders.)
function bush(b, rnd, x, y, z, r, colors, { n = 4, squash = 0.82 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, d = i ? r * between(rnd, 0.4, 0.8) : 0, s = i ? between(rnd, 0.45, 0.75) : 0.85;
    b.add(puff(r * s, rnd() * 50, 0.24, 16, 11), { kind: K.PUFF, face: FACE.SMOOTH, color: mixc(pick(rnd, colors), [1, 1, 1], between(rnd, -0.08, 0.2)),
      m: mat([x + Math.cos(a) * d, y + r * s * squash * 0.7 + (i ? between(rnd, 0, 0.35) * r : 0), z + Math.sin(a) * d], [rnd() * 3, rnd() * 3, 0], [1, squash, 1]) });
  }
}
// A cypress: a tall flame of foliage on a short trunk. Built of soft balls one over another,
// smaller as they go up, all one thing (as a single stretched ball it read as a slab of stone).
function cypress(b, rnd, x, z, h, color, y = 0) {
  const w = h * between(rnd, 0.1, 0.13), id = b.id(), lean = between(rnd, -0.025, 0.025) * h, n = 7;
  b.add(limb([[x, y - 0.3, z], [x, y + h * 0.2, z]], [w * 0.22, w * 0.16], 6), { kind: K.DARK, face: FACE.SMOOTH, color: mixc(color, [0.3, 0.25, 0.2], 0.5), id });
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1), r = w * (0.62 + 0.5 * Math.sin(Math.PI * Math.min(1, 0.18 + k * 0.95)) - 0.42 * k * k);
    b.add(blob(r, rnd() * 40, 0.16), { kind: K.PUFF, face: FACE.SMOOTH, id, color: mixc(color, [1, 1, 1], 0.2 * k + between(rnd, -0.03, 0.03)),
      m: mat([x + lean * k + between(rnd, -0.1, 0.1) * w, y + h * (0.2 + 0.72 * k), z + between(rnd, -0.1, 0.1) * w], [0, rnd() * 3, 0], [1, 1.9, 1]) });
  }
}
// A small tree for the middle distance and beyond: a trunk and a crown of a few soft balls.
function smallTree(b, rnd, x, y, z, h, colors, trunk, { n = 4, fine = false } = {}) {
  const r = h * between(rnd, 0.24, 0.32), cy = y + h * 0.72, lean = between(rnd, -0.06, 0.06) * h, id = b.id();
  b.add(limb([[x, y - 0.4, z], [x + lean * 0.4, y + h * 0.4, z], [x + lean, cy, z]], [h * 0.03, h * 0.022, h * 0.013], 5), { kind: K.PALE, face: FACE.SMOOTH, color: trunk, id, extra: -2 });
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, d = i ? r * between(rnd, 0.3, 0.6) : 0, s = i ? between(rnd, 0.55, 0.8) : 1;
    b.add(fine ? puff(r * s, rnd() * 40, 0.22, 16, 11) : blob(r * s, rnd() * 40, 0.18), { kind: K.PUFF, face: FACE.SMOOTH, color: mixc(pick(rnd, colors), [1, 1, 1], between(rnd, -0.05, 0.15)),
      m: mat([x + lean + Math.cos(a) * d, cy + (i ? between(rnd, -0.3, 0.5) * r : 0), z + Math.sin(a) * d], [rnd() * 3, rnd() * 3, 0]) });
  }
}
// Flowers: a patch of small heads on thin stalks (they bend like the grass). y: the ground, a height or a function of (x, z).
function flowers(b, rnd, x, z, { y = 0, n = 9, spread = 0.5, h = 0.3, r = 0.035, colors, stalk }) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, d = spread * Math.sqrt(rnd()), fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d, gy = typeof y === 'function' ? y(fx, fz) : y;
    const hh = h * between(rnd, 0.6, 1.2), lx = between(rnd, -0.06, 0.06), id = b.id(), held = (vx, vy) => Math.max(0, vy - gy), rr = r * between(rnd, 0.8, 1.3);
    b.add(limb([[fx, gy - 0.03, fz], [fx + lx * 0.5, gy + hh * 0.6, fz], [fx + lx, gy + hh, fz]], [0.008, 0.007, 0.005], 3), { kind: K.BLADE, face: FACE.SMOOTH, color: stalk, id, extra: held });
    b.add(new THREE.SphereGeometry(rr, 6, 4), { kind: K.BLADE, face: FACE.SMOOTH, color: mixc(pick(rnd, colors), [1, 1, 1], between(rnd, 0, 0.2)), id, extra: held, m: mat([fx + lx, gy + hh + rr * 0.4, fz], [0, 0, 0], [1, 0.7, 1]) });
  }
}
// Creeper wound up something round that stands at (x, z): from y0 to y1, `turns` times round, r from its middle line.
function climber(b, rnd, x, z, r, y0, y1, turns, color) {
  const id = b.id(), pts = [], a0 = rnd() * 6.283, n = Math.max(3, Math.ceil((y1 - y0) / 0.5));
  for (let k = 0; k <= n; k++) { const a = a0 + (turns * 6.283 * k) / n; pts.push([x + Math.cos(a) * r, y0 + ((y1 - y0) * k) / n, z + Math.sin(a) * r]); }
  b.add(limb(pts, pts.map((_, k) => 0.04 - 0.026 * (k / n)), 5), { kind: K.PALE, face: FACE.SMOOTH, color, id });
  for (let k = 1; k < n; k++) for (let j = 0; j < 2; j++) {
    const p = pts[k], a = rnd() * 6.283;
    b.add(new THREE.SphereGeometry(between(rnd, 0.07, 0.12), 5, 4), { kind: K.BLADE, face: FACE.SMOOTH, id, extra: 0.25, color: mixc(color, [1, 1, 1], between(rnd, 0.05, 0.4)),
      m: mat([p[0] + Math.cos(a) * 0.1, p[1] + between(rnd, -0.25, 0.25), p[2] + Math.sin(a) * 0.1], [rnd() * 3, a, 0], [1, 0.35, 1.5]) });
  }
}

// ---------------------------------------------------------------------------- 2 灰
// A column: plinth and base, a shaft built of drums, a capital. `stump` cuts it off at that
// fraction of its height; `hang` leaves the top part of the shaft, of that fraction,
// hanging under the capital (as in R3f_3). Returns the height of the top of the capital.
function column(b, { x, z, h = 10.5, r = 0.62, flutes = 20, order = 'doric', color, stump = 1, hang = 0, drums = 4, seed = 1, y = 0 }) {
  const rnd = rng(seed), k = r / 0.62, tone = () => mixc(color, [1, 1, 1], between(rnd, -0.07, 0.1));
  const stone = { kind: K.STONE, face: FACE.FACET };
  b.add(block(2.8 * r, 0.24 * k, 2.8 * r, 0.02, seed), { ...stone, color: tone(), m: mat([x, y + 0.12 * k, z]) });
  const baseY = y + 0.24 * k;
  b.add(lathe([[1.36, 0], [1.36, 0.1], [1.22, 0.15], [1.3, 0.21], [1.3, 0.26], [1.1, 0.31], [1.06, 0.37], [1.0, 0.4]].map(([a, c]) => [a * r, c * k]), 28),
    { ...stone, face: FACE.SMOOTH, color: tone(), m: mat([x, baseY, z]) });
  const y0 = baseY + 0.4 * k;
  const piece = (from, to, extra) => {
    const turn = between(rnd, -0.04, 0.04);
    b.add(shaft({ r, h, from, to, flutes, seed: seed + from, ...extra }), { ...stone, color: tone(), m: mat([x + between(rnd, -0.012, 0.012), y0, z + between(rnd, -0.012, 0.012)], [0, turn, 0]) });
  };
  const cuts = Array.from({ length: drums + 1 }, (_, i) => (h * i) / drums + (i > 0 && i < drums ? between(rnd, -0.3, 0.3) : 0));
  const top = h * stump;
  for (let i = 0; i < drums; i++) {
    if (cuts[i] >= top - 0.2) break;
    const last = cuts[i + 1] >= top - 0.2;
    piece(cuts[i], last ? top : cuts[i + 1], last && stump < 1 ? { breakTop: 0.5 * k + 0.25 } : {});
  }
  if (stump < 1 && !hang) return y0 + top;
  if (hang) piece(h * (1 - hang), h, { breakBase: 0.5 * k + 0.2 });
  // Capital: the shaft is 0.86 r wide at its top.
  b.add(lathe([[0.88, 0], [0.9, 0.1], [0.99, 0.14], [1.3, 0.34], [1.34, 0.42]].map(([a, c]) => [a * r, c * k]), 28),
    { ...stone, face: FACE.SMOOTH, color: tone(), m: mat([x, y0 + h, z]) });
  if (order === 'ionic') {
    for (const s of [1, -1]) {
      b.add(new THREE.CylinderGeometry(0.34 * r, 0.34 * r, 2.2 * r, 18), { ...stone, face: FACE.SMOOTH, color: tone(), m: mat([x + s * 1.2 * r, y0 + h + 0.2 * k, z], [HALF, 0, 0]) });
    }
  }
  b.add(block(2.9 * r, 0.3 * k, 2.9 * r, 0.02, seed + 3), { ...stone, color: tone(), m: mat([x, y0 + h + 0.57 * k, z]) });
  return y0 + h + 0.72 * k;
}

function ruins(material, shot) {
  const b = new Builder(21), rnd = rng(210), free = clearance(shot), lintels = new Set();
  b.heart = [25, 0, 40]; b.reach = 240;      // lintels: which bays of the colonnade still carry one
  const stone = { kind: K.STONE, face: FACE.FACET };
  const COOL = hex('#B0BAC6'), ARCH = hex('#93AABF'), WARM = hex('#B5AFA8'), BEIGE = hex('#CBC1B1'), MOSS = hex('#B3B8AE');
  const tone = (c, a = 0.08) => mixc(c, [1, 1, 1], between(rnd, -a, a));

  // The colonnade behind the path (after R3f_3: cool fluted columns under the remains of a
  // lintel, one snapped with its top still hanging). It stands on a long step.
  {
    const { z, pitch, n, x0 } = RUINS.row;
    const state = Array.from({ length: n }, () => { const q = rnd(); return q < 0.68 ? 'whole' : q < 0.8 ? 'stump' : q < 0.88 ? 'hang' : 'gone'; });
    for (let i = 10; i <= RUINS.aisle.to; i++) state[i] = 'whole';        // the stretch we fly along stands
    state[13] = 'hang';                                     // the one we look up at from the walk
    const tops = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * pitch, s = state[i];
      for (const [w, d, y] of [[pitch + 0.02, 3.6, 0.2], [pitch + 0.02, 2.9, 0.55]]) {
        b.add(block(w, 0.4, d, 0.03, i * 7 + y), { ...stone, color: tone(COOL, 0.06), m: mat([x, y, z]) });
      }
      if (s === 'gone') { tops.push(0); continue; }
      const top = column(b, { x, z, y: 0.75, color: COOL, seed: 300 + i, stump: s === 'whole' ? 1 : between(rnd, 0.28, 0.55), hang: s === 'hang' ? between(rnd, 0.22, 0.3) : 0 });
      tops.push(s === 'stump' ? 0 : top);
      if (s === 'stump' && rnd() < 0.7) {
        // The rest of it lies where it fell.
        const a = between(rnd, 0, Math.PI);
        b.add(shaft({ r: 0.56, h: 30, from: 0, to: between(rnd, 1.6, 3), breakTop: 0.4, breakBase: 0.4, seed: i }),
          { ...stone, color: tone(COOL), m: mat([x + between(rnd, -1.5, 1.5), 0, z - between(rnd, 2.6, 4.5)], [HALF, a, 0]), rest: -0.08 });
      }
    }
    for (let i = 0; i < n - 1; i++) {
      if (!tops[i] || !tops[i + 1] || rnd() < 0.14) continue;
      const x = x0 + (i + 0.5) * pitch, y = tops[i];
      lintels.add(i);
      b.add(block(pitch - 0.06, 0.95, 1.7, 0.05, i * 3 + 1), { ...stone, color: tone(COOL), m: mat([x, y + 0.48, z], [0, 0, between(rnd, -0.006, 0.006)]) });
      if (rnd() < 0.72) {
        b.add(block(pitch - between(rnd, 0.06, 1.2), 0.5, 1.9, 0.05, i * 3 + 2), { ...stone, color: tone(COOL), m: mat([x + between(rnd, -0.3, 0.3), y + 1.21, z]) });
        if (rnd() < 0.6) b.add(block(pitch - between(rnd, 0.1, 1.6), 0.26, 2.3, 0.04, i * 3 + 3), { ...stone, color: tone(COOL), m: mat([x + between(rnd, -0.4, 0.4), y + 1.6, z]) });
      }
    }
  }

  // The aisle: a second row behind part of the colonnade, a floor between the two, beams
  // overhead from row to row; and where it ends, its roof come down across it: two lengths
  // of architrave fallen aslant, and the drums of a column. Whoever flies down the aisle
  // has to leave it there, between two columns.
  {
    const { z: zA, pitch } = RUINS.row, { z: zB, from, to, fall } = RUINS.aisle, mid = (zA + zB) / 2, top = 12.61;
    for (let i = from; i <= to; i++) {
      const x = colX(i);
      b.add(block(pitch + 0.02, 0.4, zB - zA + 2.9, 0.03, i * 5 + 1), { ...stone, color: tone(COOL, 0.06), m: mat([x, 0.55, mid]) });
      column(b, { x, z: zB, y: 0.75, color: COOL, seed: 700 + i });
      if (i < to) b.add(block(pitch - 0.06, 0.95, 1.7, 0.05, i * 3 + 7), { ...stone, color: tone(COOL), m: mat([x + pitch / 2, top + 0.48, zB]) });
      if (i % 2 === 0 && x < fall - 6) b.add(block(1.3, 0.85, zB - zA + 1.2, 0.05, i + 40), { ...stone, color: tone(COOL), m: mat([x, top + 0.42, mid]) });
    }
    b.add(block(1.7, 1.0, 12.4, 0.06, 71), { ...stone, color: tone(COOL), m: mat([fall, 6.2, mid], [1.05, 0.06, 0]) });
    b.add(block(1.5, 0.9, 11.2, 0.06, 72), { ...stone, color: tone(COOL), m: mat([fall + 1.3, 4.6, mid + 0.2], [-0.82, -0.1, 0]) });
    for (const [dx, dz, a] of [[-1.2, -1.6, 0.5], [0.8, 1.4, 2.1], [2.2, -0.4, 1.2]]) {
      b.add(shaft({ r: 0.6, h: 30, from: 0, to: between(rnd, 1.8, 2.8), breakTop: 0.4, breakBase: 0.3, seed: dx }), { ...stone, color: tone(COOL), m: mat([fall + dx, 0, mid + dz], [HALF, a, 0]), rest: 0.72 });
    }
  }

  // The nearer row, on the other side of the walk (after R4f_3: a plain Ionic column, a
  // fluted one, and a fluted stump, in a warmer grey).
  for (const off of [-46, 0, 46]) {
    column(b, { x: off - 20, z: 19.4, h: 11.6, r: 0.74, flutes: 0, order: 'ionic', color: WARM, seed: 400 + off, drums: 3 });
    column(b, { x: off - 13.3, z: 18.8, h: 11.6, r: 0.72, order: 'ionic', color: WARM, seed: 410 + off });
    if (off) column(b, { x: off - 4.6, z: 19, h: 11.6, r: 0.72, color: WARM, seed: 420 + off, stump: 0.6 });
  }
  // On the walk itself: a length of column fallen across it, to be gone round, and two
  // columns, one whole and one broken off, to go between.
  {
    const { drum, gate } = RUINS;
    b.add(shaft({ r: 0.62, h: 30, from: 0, to: drum.len, breakTop: 0.35, breakBase: 0.3, seed: 5 }), { ...stone, color: tone(WARM), m: mat([drum.x, 0, drum.z - drum.len / 2], [HALF, 0, 0]), rest: -0.06 });
    gate.forEach((g, i) => column(b, { x: g.x, z: g.z, h: 11.2, r: 0.66, color: WARM, seed: 430 + i, stump: g.stump }));
  }

  // The great broken arch (after R2w2_3: the left pillar whole, most of the ring standing,
  // the right pillar snapped short; a steel blue).
  {
    const { z, lx } = RUINS.arch, rise = 22, rin = 11, rout = 14.4, cx = lx + (rin + rout) / 2, deep = 4.2;
    b.add(block(6.4, 1.6, 6.4, 0.06, 1), { ...stone, color: tone(ARCH), m: mat([lx, 0.8, z]) });
    b.add(block(5.5, 0.8, 5.5, 0.05, 2), { ...stone, color: tone(ARCH), m: mat([lx, 2.0, z]) });
    const cuts = [0, 5.6, 11.6, 17];
    for (let i = 0; i < 3; i++) {
      b.add(shaft({ r: 2.35, h: 17, from: cuts[i], to: cuts[i + 1], flutes: 0, taper: 0.06, seed: i }),
        { ...stone, color: tone(ARCH), m: mat([lx + between(rnd, -0.04, 0.04), 2.4, z], [0, rnd(), 0]) });
    }
    b.add(lathe([[2.25, 0], [2.3, 0.3], [2.9, 0.9], [3.0, 1.1]], 28), { ...stone, face: FACE.SMOOTH, color: tone(ARCH), m: mat([lx, 19.4, z]) });
    b.add(block(6.5, 1.5, 5.4, 0.06, 3), { ...stone, color: tone(ARCH), m: mat([lx, 21.25, z]) });
    // Voussoirs, from the left springing over the crown and part of the way down.
    const n = 11, step = (Math.PI * 0.83) / n;
    for (let i = 0; i < n; i++) {
      const a0 = -HALF + i * step, key = i === 6;
      b.add(sector({ r0: rin - (key ? 0.25 : 0), r1: rout + (key ? 0.9 : between(rnd, -0.12, 0.15)), a0: a0 + 0.006, a1: a0 + step - 0.006, y0: -deep / 2 - (key ? 0.25 : 0), y1: deep / 2 + (key ? 0.25 : 0), seg: 3 }),
        { ...stone, color: tone(ARCH, 0.1), m: mat([cx, rise, z], [HALF, 0, 0]) });
    }
    // The right pillar: two drums and a third, tilted, with a broken top.
    const rx = cx + (rin + rout) / 2;
    b.add(shaft({ r: 2.3, h: 17, from: 0, to: 5.2, flutes: 0, taper: 0.06 }), { ...stone, color: tone(ARCH), m: mat([rx, 0, z], [0, 0.4, 0.02]) });
    b.add(shaft({ r: 2.3, h: 17, from: 5.2, to: 9.6, flutes: 0, taper: 0.06 }), { ...stone, color: tone(ARCH), m: mat([rx - 0.1, 0, z], [0, 1.1, 0.02]) });
    b.add(shaft({ r: 2.3, h: 17, from: 0, to: 4.6, flutes: 0, taper: 0.06, breakTop: 1.3, seed: 9 }), { ...stone, color: tone(ARCH), m: mat([rx - 0.35, 9.55, z], [0, 2, 0.07]) });
    // What came down.
    for (const [dx, dz, a] of [[4.5, -5, 0.5], [9, -8, 2.1], [-3, -6.5, 1.2]]) {
      b.add(sector({ r0: rin, r1: rout, a0: 0, a1: step, y0: -deep / 2, y1: deep / 2 }), { ...stone, color: tone(ARCH, 0.1), m: mat([rx + dx - 8, 0, z + dz + 6], [a * 0.2, a, 0.3]), rest: -0.3 });
    }
  }

  // The far aqueduct (after R1w_1: two tiers of round arches in a pale warm stone, one end
  // fallen in steps). Built in one piece and pierced; its courses are drawn by the painter.
  {
    const { z, deep } = RUINS.aqueduct, bay = 10, pier = 3.4, top = 33.6;      // beyond it lies the lake: we fly through one of its arches
    const run = (x0, x1, ragged, low) => {
      const outline = low
        ? [[x0, 0], [x1, 0], [x1, 9], [x1 - 1.5, 10.5], [x1 - 2, 16], [x1 - 4.5, 17], [x1 - 5, low]]
        : [[x0, 0], [x1, 0], [x1, top]];
      if (ragged) {
        for (const [dx, y] of [[18, top], [16, top], [15.4, 31], [13, 30.4], [12.2, 27], [9, 26], [8.4, 22], [5.5, 21], [4.6, 15], [2.4, 13.5], [1.8, 8], [0, 6.5]]) outline.push([x0 + dx, y]);
      } else outline.push([x0 + 6, low], [x0 + 5, low - 4], [x0 + 2.2, low - 5], [x0 + 1.4, low - 11], [x0, low - 12]);
      const holes = [];
      const first = ragged ? x0 + 21 : x0 + 8, lastX = low ? x1 - 9 : x1;
      for (let x = first; x + bay - pier <= lastX; x += bay) {
        holes.push(archHole(x + (bay - pier) / 2, 0.05, bay - pier, 19));
        if (!low) for (const s of [-1, 1]) holes.push(archHole(x + (bay - pier) / 2 + s * 1.9, 26.8, 1.5, 28.9));
      }
      b.add(slabOf(outline, holes, deep), { ...stone, color: (x, y) => mixc(BEIGE, [1, 1, 1], (fbm2(x * 0.05, y * 0.08, 3) - 0.5) * 0.22), extra: 1.3, m: mat([0, 0, z]) });
      if (low) return;
      // String courses, and the piers standing a little proud of the wall.
      for (const [y, h, from] of [[24.5, 1, 9.5], [33.1, 1, 16.5]]) {
        b.add(block(x1 - x0 - from, h, deep + 0.9, 0.04, y), { ...stone, color: tone(BEIGE), m: mat([(x0 + from + x1) / 2, y, z + deep / 2]) });
      }
      for (let x = first - pier / 2; x <= x1; x += bay) {
        b.add(block(2.5, 24, deep + 0.7, 0.03, x), { ...stone, color: tone(BEIGE, 0.05), extra: 1.3, m: mat([x, 12, z + deep / 2]) });
        b.add(block(3.9, 0.7, deep + 1.1, 0.03, x + 1), { ...stone, color: tone(BEIGE), m: mat([x, 19, z + deep / 2]) });
      }
    };
    run(-52, 150, true);
    run(-92, -66, false, 25);
    for (let i = 0; i < 9; i++) {
      b.add(rock(between(rnd, 1.2, 2.6), i, 1), { ...stone, color: tone(BEIGE), m: mat([between(rnd, -66, -50), 0, z + between(rnd, -3, 7)], [rnd() * 3, rnd() * 3, 0]), rest: -0.4 });
    }
  }

  // Fallen stone (after R5f_3 and R5f_4): drums on their sides, squared blocks, broken rock.
  const litter = (x, z, s = 1) => {
    const q = rnd(), col = tone(rnd() < 0.5 ? MOSS : WARM), a = rnd() * Math.PI;
    if (q < 0.3) b.add(shaft({ r: 0.62 * s, h: 10, from: 0, to: between(rnd, 1.1, 2.2) * s, flutes: rnd() < 0.6 ? 20 : 0, breakTop: 0.25, seed: x }), { ...stone, color: col, m: mat([x, 0, z], [HALF + between(rnd, -0.1, 0.1), a, 0]), rest: -0.06 });
    else if (q < 0.42) b.add(shaft({ r: 0.7 * s, h: 10, from: 0, to: 1.3 * s, flutes: 0, seed: x }), { ...stone, color: col, m: mat([x, 0, z], [0, a, 0]), rest: 0 });
    else if (q < 0.7) b.add(block(between(rnd, 1, 1.9) * s, between(rnd, 0.8, 1.4) * s, between(rnd, 0.9, 1.5) * s, 0.08, x), { ...stone, color: col, m: mat([x, 0, z], [between(rnd, -0.12, 0.12), a, between(rnd, -0.1, 0.1)]), rest: -0.05 });
    else b.add(rock(between(rnd, 0.4, 0.95) * s, x * 3.1, 1), { ...stone, color: col, m: mat([x, 0, z], [rnd() * 3, a, rnd() * 3]), rest: -0.12 });
  };
  for (const [x0, x1, z0, z1, n] of [[5, 25, 7.2, 11, 13], [-60, -40, 6, 11, 9], [-30, 44, 45, 50, 12], [44, 82, 54, 60, 8]]) {
    for (let i = 0; i < n; i++) {
      const x = between(rnd, x0, x1), z = between(rnd, z0, z1);
      if (free(x, z, 1.4, 2.5)) litter(x, z, z > 30 ? 1.3 : 1);
    }
  }
  for (let i = 0; i < 26; i++) {                                 // small stones over the ground
    const x = between(rnd, -30, 40), z = between(rnd, 12, 60);
    if (Math.abs(z - 24) > 1.6 && free(x, z, 0.5, 1)) b.add(rock(between(rnd, 0.12, 0.34), i * 1.7, 0), { ...stone, color: tone(WARM), m: mat([x, 0, z], [rnd() * 3, rnd() * 3, 0]), rest: -0.05 });
  }

  // The walk is paved: large flags, some gone, none quite level; and set in it, where the
  // walk ends, a round stone cut in rings (RUINS.dais), where the first colour falls.
  {
    const PAVE = hex('#C2BFBA'), { dais, gate, drum } = RUINS;
    for (let r = 0; r < 4; r++) for (let x = -25; x < 9.5; x += 1.56) {
      const zz = 21.55 + r * 1.52, px = x + (r % 2 ? 0.78 : 0);
      if (rnd() < 0.18 || Math.hypot(px - dais.x, zz - dais.z) < dais.r + 0.75 || gate.some((g) => Math.hypot(px - g.x, zz - g.z) < 1.5)) continue;
      b.add(block(1.5 - between(rnd, 0, 0.12), 0.09, 1.46 - between(rnd, 0, 0.12), 0.02, px * 3 + r), { ...stone, color: tone(PAVE, 0.06), m: mat([px, 0.025 + between(rnd, 0, 0.02), zz], [between(rnd, -0.012, 0.012), between(rnd, -0.03, 0.03), between(rnd, -0.012, 0.012)]) });
    }
    const R = dais.r;
    b.add(lathe([[0, 0.14], [0.2, 0.14], [0.22, 0.1], [0.42, 0.1], [0.44, 0.14], [0.66, 0.14], [0.68, 0.11], [R - 0.22, 0.11], [R - 0.2, 0.15], [R, 0.15], [R + 0.03, 0.0]], 40), { ...stone, face: FACE.SMOOTH, color: tone(hex('#CDCBC8'), 0.03), m: mat([dais.x, 0, dais.z]) });
    for (let i = 0; i < 12; i++) {                               // the stones set round it
      const a0 = (i / 12) * Math.PI * 2;
      b.add(sector({ r0: R + 0.06, r1: R + 0.62, a0: a0 + 0.02, a1: a0 + Math.PI / 6 - 0.02, y0: -0.02, y1: 0.07 + between(rnd, 0, 0.02), seg: 3 }), { ...stone, color: tone(PAVE, 0.07), m: mat([dais.x, 0, dais.z]) });
    }
    // Grass in the joints and at the foot of everything that stands; jars; creeper from the lintels.
    const GRASS = hex('#A3AB9C'), IVY = hex('#8E9C8C');
    for (let i = 0; i < 230; i++) {
      const x = between(rnd, -30, 12), z = between(rnd, 16, 31.5);
      if (Math.hypot(x - dais.x, z - dais.z) < dais.r + 0.7 || Math.hypot(x - 0.9, z - 24) < 1.5) continue;
      tuft(b, rnd, x, z, { h: between(rnd, 0.22, 0.6), n: 4 + Math.floor(rnd() * 5), color: GRASS });
    }
    const feet = [...gate.map((g) => [g.x, g.z, 0.95]), [drum.x, drum.z, 1.0], [drum.x, drum.z - 1.4, 0.9], [-20, 19.4, 1.1], [-13.3, 18.8, 1.1], ...Array.from({ length: 16 }, (_, i) => [colX(8 + i), RUINS.row.z - 2.0, 0.5])];
    for (const [fx, fz, fr] of feet) for (let i = 0; i < 7; i++) { const a = rnd() * 6.283; tuft(b, rnd, fx + Math.cos(a) * fr, fz + Math.sin(a) * fr * (fr < 0.6 ? 0.3 : 1), { h: between(rnd, 0.35, 0.8), n: 6, color: GRASS }); }
    for (const [x, z, s, lie] of [[-15.6, 20.5, 1.1, 0], [-7.3, 27.2, 0.95, 0], [-6.5, 27.6, 0.7, 0], [5.3, 21.0, 1.0, 0], [-2.4, 20.4, 0.9, 0.7], [7.8, 27.9, 1.15, 0]]) {
      if (free(x, z, 0.5, 1.5)) urn(b, x, z, tone(WARM, 0.05), { s, lie, seed: x });
    }
    const { z: zA, pitch } = RUINS.row, { z: zB, from, to, fall } = RUINS.aisle, lint = 12.6;
    for (let i = 9; i < to; i++) for (let k = 0; k < 3; k++) if (lintels.has(i) && rnd() < 0.75) vine(b, rnd, colX(i) + between(rnd, 0.8, pitch - 0.8), lint, zA + between(rnd, -0.8, 0.8), between(rnd, 1.2, 3.4), IVY);
    for (let i = from; i < to; i++) for (let k = 0; k < 2; k++) if (rnd() < 0.7) vine(b, rnd, colX(i) + between(rnd, 0.8, pitch - 0.8), lint, zB + between(rnd, -0.8, 0.8), between(rnd, 1.0, i >= to - 3 ? 1.9 : 3.0), IVY);
    for (let i = from; i <= to; i += 2) if (colX(i) < fall - 6) for (let k = 0; k < 4; k++) vine(b, rnd, colX(i) + between(rnd, -0.6, 0.6), lint, between(rnd, zA + 1.2, zB - 1.2), between(rnd, 0.9, 2.6), IVY);
  }
  // (v13) The ruin was stone on bare ground. Things grow in it and round it now: cypresses in
  // twos and threes behind the colonnade and beyond the walk, round trees looking over the
  // lintels, bushes at the foot of the stones, flowers in the grass, creeper up the columns;
  // and far off the same city goes on: a temple front at the end of the walk, lone columns.
  {
    const { dais, gate } = RUINS;
    const CYP = hex('#7F8E88'), LEAF = [hex('#93A39A'), hex('#A7B4A8'), hex('#869890')], BLOOM = [hex('#EFEAE0'), hex('#E6DCC6'), hex('#D9DDE6')], STALK = hex('#9AA391'), IVY2 = hex('#8E9C8C');
    const COOLTREE = { core: hex('#6E8A8C'), mid: hex('#8AA6A4'), rim: hex('#B5C9C4'), trunk: hex('#A5A7A6') };
    for (const [x, z, n] of [[-34, 47, 3], [-12, 50, 2], [8, 47.5, 3], [33, 50, 2], [70, 47, 3], [86, 38, 2], [-44, 12, 3], [-27, 9.5, 2], [12, 6, 3], [34, 12, 2], [-58, 26, 2], [96, 60, 3], [-70, 44, 3], [24, 60, 2], [-8, 64, 3]]) {
      for (let i = 0; i < n; i++) {                              // (cypresses were tried here: in pencil a tall dark form among columns reads as one more broken stone)
        const cx = x + i * between(rnd, 2.6, 3.8), cz = z + between(rnd, -2, 2), h = between(rnd, 7.5, 13);
        if (free(cx, cz, h * 0.24, h, 1.2, 1.5)) tree(b, { x: cx, z: cz, h, cy: h * 0.74, r: h * 0.2, palette: COOLTREE, seed: 1300 + x + i, puffs: 8, seg: [14, 10] });
      }
    }
    for (const [x, z, h] of [[-22, 46.5, 19], [1, 48.5, 21], [20, 46, 18.5], [44, 50, 20], [-48, 45, 17.5], [78, 50, 19], [-40, 2, 18], [2, 0, 20], [48, 4, 18], [-64, 8, 19]]) {
      if (free(x, z, 5.2, h, 1.5, 2)) tree(b, { x, z, h, cy: h * 0.76, r: h * 0.22, palette: COOLTREE, seed: 1200 + x, puffs: 13 });
    }
    for (let i = 0; i < 90; i++) {
      const x = between(rnd, -56, 92), z = pick(rnd, [between(rnd, 7, 19), between(rnd, 29, 32.4), between(rnd, 43, 58)]), r = between(rnd, 0.3, 0.75);
      if (free(x, z, r + 0.3, r * 1.5, 1.0, 1.2)) bush(b, rnd, x, 0, z, r, LEAF, { n: 3 + Math.floor(rnd() * 3) });
    }
    for (let i = 0; i < 52; i++) {
      const x = between(rnd, -28, 14), z = between(rnd, 17, 31);
      if ((Math.abs(z - 24) < 1.3 && rnd() < 0.7) || Math.hypot(x - dais.x, z - dais.z) < dais.r + 0.8) continue;      // few on the walk itself
      flowers(b, rnd, x, z, { n: 5 + Math.floor(rnd() * 8), spread: between(rnd, 0.3, 0.8), h: between(rnd, 0.25, 0.45), colors: BLOOM, stalk: STALK });
    }
    climber(b, rnd, gate[0].x, gate[0].z, 0.72, 0.9, 7.5, 1.6, IVY2);
    climber(b, rnd, -20, 19.4, 0.8, 0.9, 8.5, 1.4, IVY2);
    climber(b, rnd, -13.3, 18.8, 0.78, 0.9, 6, 1.1, IVY2);
    for (const i of [9, 11, 14, 17, 20]) climber(b, rnd, colX(i), RUINS.row.z, 0.69, 1.7, between(rnd, 4, 9), between(rnd, 0.8, 1.6), IVY2);

    const FARSTONE = hex('#BFC3C8'), tx = 126, tz = 29, pitch = 4.9, n = 6;
    for (const [w, y] of [[10, 0.35], [8.8, 1.05], [7.6, 1.75]]) b.add(block(w, 0.7, n * pitch + 4 - y, 0.05, y), { ...stone, color: tone(FARSTONE, 0.05), m: mat([tx + 1.5, y, tz]) });
    const tops = Array.from({ length: n }, (_, i) => column(b, { x: tx - 1.2, z: tz + (i - (n - 1) / 2) * pitch, y: 2.1, h: 14.5, r: 0.9, color: FARSTONE, seed: 1500 + i, stump: i === 4 ? 0.45 : 1 }));
    b.add(block(2.6, 1.7, 3 * pitch + 2.2, 0.06, 77), { ...stone, color: tone(FARSTONE), m: mat([tx - 1.2, tops[0] + 0.85, tz - pitch]) });
    b.add(block(2.6, 1.5, 2.6, 0.08, 78), { ...stone, color: tone(FARSTONE), m: mat([tx - 1.2, tops[5] + 0.75, tz + 2.5 * pitch], [0, 0.2, 0.03]) });
    const L = 3 * pitch + 2.6;
    b.add(slabOf([[-L / 2, 0], [L / 2, 0], [L / 2, 2.4], [L * 0.32, 3.1], [L * 0.2, 4.7], [-L / 2, 0.5]], [], 2.3), { ...stone, color: tone(FARSTONE), m: mat([tx - 0.05, tops[0] + 1.7, tz - pitch], [0, -HALF, 0]) });
    b.add(block(1.4, 12, n * pitch - 2, 0.08, 79), { ...stone, color: tone(FARSTONE, 0.04), extra: 1.3, m: mat([tx + 5, 8, tz]) });
    for (const [x, z, st] of [[96, 14, 0.7], [104, 52, 1], [138, 62, 0.5], [112, 6, 0.35], [136, 16, 1], [-84, 50, 1], [-89.2, 51.5, 1], [-94.4, 53, 0.5], [-99.6, 54.5, 1], [-104.8, 56, 0.3], [-76, 16, 0.6]]) {
      column(b, { x, z, h: 12, r: 0.72, color: mixc(FARSTONE, COOL, rnd()), seed: 1600 + x, stump: st, flutes: x < 0 ? 20 : 0 });
    }
    b.add(block(5.4, 0.95, 1.7, 0.05, 80), { ...stone, color: tone(FARSTONE), m: mat([-86.6, 13.4, 50.75], [0, -0.28, 0]) });
    // Where the aqueduct does not stand the ruin's ground comes down to the lake at the water's
    // edge (walked freely, one can go round the aqueduct's ends, and the join of the two places
    // was a ruled line there): stones and reeds along it, thick enough to break the line. (A
    // bank of sand was tried under them: on this ground, which is the paper itself, it was a
    // dark strip with a ruled edge of its own.)
    const az = RUINS.aqueduct.z + RUINS.aqueduct.deep + 0.7, REED = hex('#A3AB9C');
    for (const [x0, x1] of [[-150, -88], [146, 162]]) {
      for (let i = 0; i < (x1 - x0) * 3.2; i++) {
        const x = between(rnd, x0, x1), z = az - 0.3 - 5 * rnd() ** 2.2;
        if (rnd() < 0.4) b.add(rock(between(rnd, 0.2, 0.9), i * 1.3, 1), { ...stone, color: tone(WARM, 0.12), m: mat([x, 0, z], [rnd() * 3, rnd() * 3, 0], [1.4, 0.55, 1]), rest: between(rnd, -0.12, 0.1) });
        else tuft(b, rnd, x, z, { y: -0.02, h: between(rnd, 0.7, 1.8), n: 8, spread: 0.35, lean: 0.25, color: REED });
      }
    }
  }
  return { object: b.mesh(material), hit: b.hit, ground: () => 0 };
}

// ---------------------------------------------------------------------------- 3 青
// A tower like a cut crystal (after L1f_2, L2f_1, L2f_3): a tapering shaft of `sides`
// faces built in courses, each its own wash, under a pointed cap.
function obelisk(b, { x, z, h, w, sides = 6, color, seed = 1, slits = true, ledges = false, yaw = 0, cap = 0.16, y0 = -3, lamp = null }) {
  const rnd = rng(seed), n = Math.max(3, Math.round(h / (w * 1.25)));
  const body = h * (1 - cap), rAt = (y) => (w / 2) * (1 - 0.3 * Math.max(0, y) / body);
  const stone = { kind: K.STONE, face: FACE.FACET };
  let y = y0;
  for (let i = 0; i < n; i++) {
    const y1 = i === n - 1 ? body : body * ((i + 1) / n) + between(rnd, -0.04, 0.04) * body / n;
    const tone = mixc(color, rnd() < 0.5 ? [1, 1, 1] : [0, 0.12, 0.16], between(rnd, 0, 0.22));
    b.add(new THREE.CylinderGeometry(rAt(y1), rAt(y), y1 - y, sides, 1), { ...stone, color: tone, m: mat([x, (y + y1) / 2, z], [0, yaw, 0]) });
    if (ledges && i < n - 1) b.add(new THREE.CylinderGeometry(rAt(y1) * 1.12, rAt(y1) * 1.12, 0.22, sides, 1), { ...stone, color: tone, m: mat([x, y1, z], [0, yaw, 0]) });
    if (slits && i > 0 && rnd() < 0.75) {
      const f = Math.floor(rnd() * sides), a = yaw + ((f + 0.5) / sides) * Math.PI * 2, ym = (y + y1) / 2, ap = rAt(ym) * Math.cos(Math.PI / sides) + 0.02;
      // A tall window: dark, until the colour has climbed to it (`lamp` says when), and then lit.
      const wx = x + Math.sin(a) * ap, wz = z + Math.cos(a) * ap;
      b.add(new THREE.BoxGeometry(w * 0.05, w * 0.42, 0.14), { kind: K.STONE, face: FACE.FACET, color: mixc(color, [0, 0, 0], 0.3), m: mat([wx, ym, wz], [0, a, 0]) });
      b.add(new THREE.BoxGeometry(w * 0.028, w * 0.38, 0.17), { kind: lamp ? K.LAMP : K.DARK, face: FACE.FACET, color: mixc(color, [0, 0, 0], 0.6), extra: lamp ? lamp(wx, ym, wz) : 0, m: mat([wx, ym, wz], [0, a, 0]) });
    }
    y = y1;
  }
  b.add(new THREE.ConeGeometry(rAt(body), h * cap, sides, 1), { ...stone, color: mixc(color, [1, 1, 1], 0.12), m: mat([x, body + (h * cap) / 2, z], [0, yaw, 0]) });
}

// A long line of hills (after L3f_1): a ridge whose crest wanders, falling to nothing at
// its near and far edges.
function ridge(b, { x0, x1, z0, z1, height, color, seed, base = 0, nx = 150, nz = 8, sharp = 1, kind = K.LAND, face = FACE.SMOOTH }) {
  b.add(terrain({
    nx, nz, at: rect(x0, x1, z0, z1), seed,
    height: (x, z) => {
      const v = (z - z0) / (z1 - z0), env = Math.pow(Math.sin(Math.PI * v), 0.8);
      const crest = Math.max(0.12, 1.7 * Math.pow(fbm2(x / ((x1 - x0) * 0.06), seed, seed), sharp) - 0.42) + 0.3 * (fbm2(x / ((x1 - x0) * 0.018), z * 0.01, seed + 5) - 0.5);
      return base + env * height * crest - (1 - env) * 2;
    },
  }), { kind, face, solid: false, color: (x, y) => mixc(color, [1, 1, 1], 0.1 * (fbm2(x * 0.01, y * 0.1, seed) - 0.5) + 0.12 * Math.min(1, Math.max(0, (y - base) / height))) });
}

function lake(material, shot) {
  const b = new Builder(31), rnd = rng(310), free = clearance(shot);
  b.heart = [-20, 0, 100]; b.reach = 240;
  // Far hills, two washes deep.
  // (The lake's far shore, to the right of our way, is the wood: layout.js, JOIN.shore. Nothing of the lake is built past it.)
  const ashore = (x, z, r = 0) => past('shore', 'lake', [x, 0, z]) > -(r + 2.5);
  ridge(b, { x0: -900, x1: -150, z0: 330, z1: 420, height: 46, color: hex('#A9D3D6'), seed: 3, nx: 90 });
  ridge(b, { x0: -900, x1: -100, z0: 245, z1: 320, height: 27, color: hex('#3F8792'), seed: 8, nx: 90 });
  // Towers at three depths.
  const NEAR = hex('#3F8894'), MID = hex('#7C9EA5'), FAR = hex('#B4C8CB');
  LAKE.towers.forEach(([x, z, h, w], i) =>
    obelisk(b, { x, z, h, w, sides: 6, color: NEAR, seed: 320 + i, yaw: 0.2 + i * 0.37, lamp: (wx, wy) => whenUp(shot.rise, wy, 11, 20) + 0.5 }));
  [[-52, 132, 40, 5], [-14, 128, 44, 5.2], [-30, 96, 30, 4.2], [-64, 84, 46, 5.6], [2, 148, 36, 4.6]].filter(([x, z, , w]) => !ashore(x, z, w)).forEach(([x, z, h, w], i) =>
    obelisk(b, { x, z, h, w, sides: 4, color: MID, seed: 330 + i, yaw: 0.5 + i * 0.6, slits: false, cap: 0.12 }));
  [[-38, 158, 30, 2.7], [-8, 166, 34, 3], [-70, 150, 56, 3.3], [-120, 170, 26, 2.6], [-28, 196, 46, 3], [-150, 135, 38, 2.8], [-90, 172, 44, 3]].filter(([x, z, , w]) => !ashore(x, z, w)).forEach(([x, z, h, w], i) =>
    obelisk(b, { x, z, h, w, sides: 4, color: FAR, seed: 340 + i, yaw: 0.3 + i * 0.5, slits: false, ledges: true, cap: 0.08 }));
  // What stands in the water on our way (layout.js, LAKE). A pile: a post driven into the
  // lake bed, with a band near its head.
  const POST = hex('#3F6C7F'), WOOD = hex('#4B6E7C');
  const pile = (x, z, h, r, lean = 0, tone = 0) => {
    b.add(limb([[x, -1.5, z], [x + lean * 0.5, h * 0.5, z], [x + lean, h, z + lean * 0.4]], [r * 1.15, r, r * 0.9], 8), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(POST, [1, 1, 1], tone), extra: -1 });      // extra -1: wood (the painter gives it grain)
    b.add(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.14, 8), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(POST, [0, 0, 0], 0.2), m: mat([x + lean * 0.93, h - 0.3, z + lean * 0.37]) });
  };
  const fixed = [];                                         // where they are, so that nothing else is put on top of them
  {
    // The jetty: planks on two bearers, on pairs of piles; every third pair stands up through the deck.
    const { z, x0, bays, bay, deck } = LAKE.jetty, x1 = x0 + (bays - 1) * bay;
    for (let k = 0; k < bays; k++) for (const dz of [-0.9, 0.9]) { pile(x0 + k * bay, z + dz, deck + (k % 3 === 0 ? 0.95 : 0.05), 0.13, 0, between(rnd, -0.1, 0.1)); fixed.push([x0 + k * bay, z]); }
    for (let x = x0 - 0.6; x < x1 + 0.6; x += 0.42) {
      b.add(block(0.38, 0.09, 2.5 + between(rnd, -0.15, 0.15), 0.01, x), { kind: K.STONE, face: FACE.FACET, extra: -1, color: mixc(WOOD, [1, 1, 1], between(rnd, -0.08, 0.16)), m: mat([x, deck + 0.14, z + between(rnd, -0.05, 0.05)], [0, between(rnd, -0.03, 0.03), 0]) });
    }
    for (const dz of [-0.9, 0.9]) b.add(block(x1 - x0 + 1.2, 0.16, 0.14, 0.01, dz + 3), { kind: K.STONE, face: FACE.FACET, extra: -1, color: WOOD, m: mat([(x0 + x1) / 2, deck + 0.02, z + dz]) });
  }
  pile(LAKE.post.x, LAKE.post.z, LAKE.post.h, 0.15, 0.3);
  LAKE.cluster.forEach(([x, z, h], i) => pile(x, z, h, 0.14, (i - 1) * 0.1));
  b.add(new THREE.TorusGeometry(0.52, 0.045, 6, 18), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(POST, [0, 0, 0], 0.3), m: mat([3.97, 2.3, 35.87], [HALF, 0, 0]) });     // the rope that binds the three
  LAKE.piles.forEach(([x, z], i) => pile(x, z, 4.6 + 0.3 * i, 0.3, 0.06 * (i - 1)));
  fixed.push([LAKE.post.x, LAKE.post.z], ...LAKE.cluster, ...LAKE.piles);
  // Other mooring posts, scattered about the way: near enough to be seen passing, never in it.
  const way = [];
  for (let t = 3.4; t <= 19; t += 0.2) way.push(shot.figure(t).pos);
  let placed = 0;
  for (let i = 0; i < 900 && placed < 46; i++) {
    const p = pick(rnd, way), near = rnd() < 0.5;
    const x = p[0] + between(rnd, -1, 1) * (near ? 9 : 26), z = p[2] + between(rnd, -1, 1) * (near ? 9 : 22), h = between(rnd, 2.2, 4.2);
    if (!free(x, z, 0.2, h, 3.6, 3.6) || fixed.some((f) => Math.hypot(f[0] - x, f[1] - z) < 2.5) || Math.abs(z - LAKE.jetty.z) < 2.2 || ashore(x, z) || past('aqueduct', 'lake', [x, 0, z]) < 3) continue;
    pile(x, z, h, between(rnd, 0.12, 0.17), between(rnd, -0.25, 0.25), between(rnd, -0.1, 0.12));
    placed++;
  }

  // What makes the place somebody's: lanterns on the posts, which light as the fleck comes
  // to them; reeds and the leaves of water lilies about the jetty; the towers standing on
  // stepped feet, their windows lighting as the colour climbs them.
  {
    const lit = passing(shot, 2.6), LAMP = { metal: mixc(POST, [0, 0, 0], 0.35), paper: hex('#D9E6DF') };
    const { post, cluster, piles, jetty } = LAKE;
    const arm = (x, y, z, dx, dz) => {                           // a lantern hung out from a post on a short arm
      b.add(limb([[x, y, z], [x + dx * 0.7, y + 0.16, z + dz * 0.7], [x + dx, y + 0.1, z + dz]], [0.035, 0.028, 0.02], 5), { kind: K.STONE, face: FACE.SMOOTH, color: LAMP.metal });
      b.add(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), { kind: K.DARK, color: LAMP.metal, m: mat([x + dx, y, z + dz]) });
      lantern(b, x + dx, y - 0.1, z + dz, lit(x + dx, y - 0.3, z + dz), LAMP);
    };
    arm(post.x + 0.27, post.h - 0.25, post.z + 0.1, 0.5, 0);
    arm(cluster[2][0], cluster[2][2] - 0.3, cluster[2][1], 0.15, 0.5);
    piles.forEach(([x, z], i) => arm(x + 0.06 * (i - 1), 4.2 + 0.3 * i, z, i === 1 ? 0.55 : -0.55, 0));
    for (let k = 0; k < jetty.bays; k += 3) for (const dz of [-0.9, 0.9]) lantern(b, jetty.x0 + k * jetty.bay, jetty.deck + 1.42, jetty.z + dz, lit(jetty.x0 + k * jetty.bay, jetty.deck + 1.2, jetty.z + dz, 4.2), LAMP);
    const REED = hex('#7FA39A'), PAD = hex('#69A596'), near = (x, z) => fixed.some((f) => Math.hypot(f[0] - x, f[1] - z) < 0.5);
    for (let i = 0, put = 0; i < 400 && put < 26; i++) {
      const x = between(rnd, -10, 13), z = between(rnd, 20.5, 42);
      if (!free(x, z, 0.6, 2.4, 1.3, 1.3) || Math.abs(z - jetty.z) < 1.7 || near(x, z)) continue;
      const n = 5 + Math.floor(rnd() * 7);
      tuft(b, rnd, x, z, { y: -0.12, h: between(rnd, 1.0, 2.1), n, spread: 0.3, lean: 0.22, color: REED });
      put++;
    }
    for (let i = 0; i < 90; i++) {
      const x = between(rnd, -12, 15), z = between(rnd, 20, 46), r = between(rnd, 0.16, 0.42), a = rnd() * 6.283;
      if (near(x, z)) continue;
      b.add(new THREE.CircleGeometry(r, 11, a, 5.7), { kind: K.PALE, face: FACE.SMOOTH, color: mixc(PAD, [1, 1, 1], between(rnd, -0.1, 0.22)), m: mat([x, 0.014, z], [-HALF, 0, 0]) });
      if (rnd() < 0.12) {                                        // a bud, on its stalk
        const id = b.id(), up = (vx, vy) => Math.max(0, vy);
        b.add(limb([[x + r, -0.1, z], [x + r + 0.03, 0.2, z], [x + r + 0.05, 0.36, z]], [0.012, 0.01, 0.008], 4), { kind: K.BLADE, face: FACE.SMOOTH, color: REED, id, extra: up });
        b.add(new THREE.SphereGeometry(0.07, 7, 6), { kind: K.BLADE, face: FACE.SMOOTH, color: hex('#EAD3D6'), id, extra: up, m: mat([x + r + 0.05, 0.42, z], [0, 0, 0], [0.8, 1.35, 0.8]) });
      }
    }
    LAKE.towers.forEach(([x, z, h, w], i) => {
      const yaw = 0.2 + i * 0.37, foot = mixc(NEAR, [0, 0.1, 0.14], 0.25);
      b.add(new THREE.CylinderGeometry((w / 2) * 1.16, (w / 2) * 1.2, 2.2, 6, 1), { kind: K.STONE, face: FACE.FACET, color: foot, m: mat([x, -0.4, z], [0, yaw, 0]) });
      b.add(new THREE.CylinderGeometry((w / 2) * 1.07, (w / 2) * 1.1, 0.7, 6, 1), { kind: K.STONE, face: FACE.FACET, color: mixc(foot, [1, 1, 1], 0.12), m: mat([x, 1.05, z], [0, yaw, 0]) });
    });
  }
  // (v13) More on the water than posts: a boat moored at the jetty and one adrift, herons in the
  // shallows, small islands of rock with reeds and a tree, pads and lotus all along our way,
  // and here and there what is left of an arch.
  {
    const lit = passing(shot, 4.5), LAMP = { metal: mixc(POST, [0, 0, 0], 0.35), paper: hex('#D9E6DF') };
    const HULL = hex('#4E7482'), TEALS = [hex('#5E9C9C'), hex('#7DB3AE'), hex('#4A8A8E')], REED = hex('#7FA39A'), PAD = hex('#69A596');
    const ok = (x, z, r, top = 1.5, gap = 2.2) => free(x, z, r, top, gap, gap) && !fixed.some((f) => Math.hypot(f[0] - x, f[1] - z) < r + 1.2) && !ashore(x, z, r) && past('aqueduct', 'lake', [x, 0, z]) > 3;
    const boat = (x, z, yaw, s = 1) => {
      if (!ok(x, z, 2 * s)) return;
      const id = b.id(), c = Math.cos(yaw), si = Math.sin(yaw), wood = { kind: K.STONE, face: FACE.SMOOTH, extra: -1, id };
      b.add(new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), { ...wood, color: HULL, m: mat([x, 0.36 * s, z], [0, yaw, 0], [1.9 * s, 0.52 * s, 0.62 * s]) });
      b.add(new THREE.CircleGeometry(1, 18), { ...wood, color: mixc(HULL, [0, 0, 0], 0.3), m: mat([x, 0.2 * s, z], [-HALF, yaw, 0], [1.6 * s, 0.5 * s, 1]) });
      for (const d of [-0.7, 0.5]) b.add(block(0.16 * s, 0.05 * s, 1.0 * s, 0.01, d), { ...wood, color: mixc(HULL, [1, 1, 1], 0.18), m: mat([x + c * d * s, 0.33 * s, z - si * d * s], [0, yaw, 0]) });
      const mx = x + c * 1.25 * s, mz = z - si * 1.25 * s;
      b.add(limb([[mx, 0.2 * s, mz], [mx, 1.5 * s, mz], [mx + c * 0.3 * s, 1.72 * s, mz - si * 0.3 * s]], [0.03, 0.025, 0.018], 5), { kind: K.STONE, face: FACE.SMOOTH, color: LAMP.metal });
      lantern(b, mx + c * 0.3 * s, 1.68 * s, mz - si * 0.3 * s, lit(mx, 1.4, mz), LAMP);
    };
    boat(-8.6, 27.25, 0.06); boat(16.5, 83, 0.9, 1.1); boat(-21, 52, -0.5, 0.9);
    b.add(limb([[-6.75, 0.42, 27.3], [-6.5, 0.5, 27.9], [-6.2, 1.2, 28.3]], [0.014, 0.014, 0.014], 4), { kind: K.DARK, face: FACE.SMOOTH, color: LAMP.metal });      // the painter, made fast to a pile
    const heron = (x, z, yaw, s = 1) => {
      if (!ok(x, z, 0.5, 1.6, 1.6)) return;
      const id = b.id(), W = hex('#E6EEEC'), LEG = hex('#6E8088'), f = [Math.sin(yaw), Math.cos(yaw)], at = (d, y, side = 0) => [x + f[0] * d * s + f[1] * side * s, y * s, z + f[1] * d * s - f[0] * side * s];
      for (const sd of [-0.045, 0.05]) b.add(limb([at(-0.02, -0.15, sd), at(0.0, 0.3, sd), at(-0.03, 0.66, sd)], [0.011 * s, 0.012 * s, 0.014 * s], 4), { kind: K.DARK, face: FACE.SMOOTH, color: LEG, id });
      b.add(new THREE.SphereGeometry(0.2 * s, 10, 7), { kind: K.PALE, face: FACE.SMOOTH, color: W, id, m: mat(at(-0.05, 0.8), [-0.3, yaw, 0], [0.75, 0.72, 1.5]) });
      b.add(limb([at(0.17, 0.86), at(0.3, 1.02), at(0.22, 1.2), at(0.27, 1.33)], [0.05 * s, 0.032 * s, 0.027 * s, 0.034 * s], 6), { kind: K.PALE, face: FACE.SMOOTH, color: W, id });
      b.add(limb([at(0.28, 1.34), at(0.52, 1.3)], [0.02 * s, 0.003], 4), { kind: K.DARK, face: FACE.SMOOTH, color: hex('#B99A62'), id });
      b.add(limb([at(-0.3, 0.76), at(-0.52, 0.62)], [0.06 * s, 0.01], 5), { kind: K.PALE, face: FACE.SMOOTH, color: mixc(W, [0.6, 0.7, 0.75], 0.5), id });
    };
    heron(-5.6, 33.6, 1.9); heron(9.6, 30.6, -2.4, 1.1); heron(-9.2, 40.4, 0.6); heron(19.5, 56.5, -1.2, 1.05); heron(8.5, 68, 2.6); heron(-4.2, 24.2, -0.4, 0.9);
    // Islands: a hump of rock just out of the water, reeds round it, a tree or a bush on it.
    for (const [x, z, R] of [[-14, 36, 2.2], [17, 37.5, 1.8], [-7, 56, 2.6], [25, 51, 2.0], [-20, 71, 3.0], [3.5, 77, 2.2], [36, 70, 2.4], [-2, 100, 2.8], [10, 92, 1.8], [-30, 46, 2.4], [38, 86, 2.0]]) {
      if (!ok(x, z, R + 1, 6, 3)) continue;
      const col = mixc(hex('#6F97A0'), [1, 1, 1], between(rnd, 0, 0.25));
      b.add(rock(R, x * 1.7, 2, 0.2), { kind: K.STONE, face: FACE.FACET, color: col, m: mat([x, -0.12 * R, z], [0, rnd() * 3, 0], [1.25, 0.34, 1]) });
      b.add(rock(R * 0.45, x * 3.1, 1, 0.25), { kind: K.STONE, face: FACE.FACET, color: mixc(col, [1, 1, 1], 0.1), m: mat([x + R * 0.9, 0, z + R * 0.5], [0, rnd() * 3, 0], [1.2, 0.5, 1]) });
      for (let i = 0; i < 7; i++) { const a = rnd() * 6.283; tuft(b, rnd, x + Math.cos(a) * R * 1.15, z + Math.sin(a) * R * 0.95, { y: -0.1, h: between(rnd, 0.9, 1.9), n: 6, spread: 0.3, lean: 0.22, color: REED }); }
      if (rnd() < 0.6) smallTree(b, rnd, x - R * 0.2, R * 0.2, z, between(rnd, 3.2, 5.2), TEALS, hex('#8FA9AC'), { fine: true });
      else bush(b, rnd, x, R * 0.16, z, R * 0.4, TEALS);
    }
    // Pads and lotus, in drifts along the way.
    for (const [cx, cz, n, R] of [[7, 44, 26, 5], [10, 53, 22, 5], [15, 64, 30, 6], [22, 80, 26, 7], [30, 96, 22, 6], [-6, 52, 20, 6], [20, 44, 18, 5], [38, 104, 16, 5]]) {
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.283, d = R * Math.sqrt(rnd()), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.7, r = between(rnd, 0.16, 0.44);
        if (fixed.some((f) => Math.hypot(f[0] - x, f[1] - z) < 0.5) || ashore(x, z, 1)) continue;
        b.add(new THREE.CircleGeometry(r, 11, rnd() * 6.283, 5.7), { kind: K.PALE, face: FACE.SMOOTH, color: mixc(PAD, [1, 1, 1], between(rnd, -0.1, 0.22)), m: mat([x, 0.014, z], [-HALF, 0, 0]) });
        if (rnd() < 0.16) {                                      // a lotus, open on the water
          const id = b.id(), PINK = mixc(hex('#F1D3DA'), [1, 1, 1], rnd() * 0.5);
          b.add(new THREE.SphereGeometry(0.15, 9, 6), { kind: K.PALE, face: FACE.SMOOTH, color: PINK, id, m: mat([x + r * 0.6, 0.05, z], [0, rnd() * 3, 0], [1, 0.42, 1]) });
          b.add(new THREE.SphereGeometry(0.09, 8, 6), { kind: K.PALE, face: FACE.SMOOTH, color: mixc(PINK, [1, 1, 1], 0.4), id, m: mat([x + r * 0.6, 0.1, z], [0, 0, 0], [1, 0.85, 1]) });
          b.add(new THREE.SphereGeometry(0.035, 6, 4), { kind: K.PALE, face: FACE.SMOOTH, color: hex('#E8CF86'), id, m: mat([x + r * 0.6, 0.17, z]) });
        }
      }
    }
    // What is left of an arch, standing in the water.
    for (const [x, z, yaw, k] of [[-27, 60, 0.5, 1], [31, 63, -0.9, 0.85], [-12, 84, 1.3, 1.1]]) {
      if (!ok(x, z, 8 * k, 12, 3)) continue;
      b.add(slabOf([[0, -2], [13, -2], [13, 6.2], [11.2, 7.4], [10.6, 10.4], [4.2, 10.6], [3.2, 8.8], [0, 8.3]].map(([u, v]) => [u * k, v * k]), [archHole(6.5 * k, -2.5, 6 * k, 4.6 * k)], 2.3 * k),
        { kind: K.STONE, face: FACE.FACET, color: (vx, vy) => mixc(MID, [1, 1, 1], 0.2 * (fbm2(vx * 0.3, vy * 0.3, 3) - 0.5)), extra: 0.9, m: mat([x, 0, z], [0, yaw, 0]) });
      tuft(b, rnd, x + 1, z + 1, { y: -0.1, h: 1.5, n: 7, spread: 0.4, lean: 0.2, color: REED });
    }
  }
  return { object: b.mesh(material), hit: b.hit, ground: () => -9 };      // water: nothing to stand on
}

// ---------------------------------------------------------------------------- 4 朱
// The four trees of Ff_1 … Ff_4: a slender trunk and one round crown like a bloom on wet
// paper. The crown is a cluster of soft balls, each its own wash, deep at the heart and
// thin at the rim, with a few stray blots below it.
const CROWNS = [
  { core: '#D93A22', mid: '#EC5536', rim: '#F58A5F', trunk: '#D9624A' },      // vermilion
  { core: '#B5202F', mid: '#D43A48', rim: '#E5606A', trunk: '#CC6A70' },      // crimson
  { core: '#C93058', mid: '#E0567A', rim: '#F29AAE', trunk: '#E0A0A6' },      // rose
  { core: '#D8381F', mid: '#EE6B4A', rim: '#F7B5A0', trunk: '#EAA590' },      // orange into pale rose
].map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, hex(v)])));

function tree(b, { x, z, h, cy, r, style = 0, seed, puffs = 18, palette = null, seg = null }) {
  const rnd = rng(seed), C = palette || CROWNS[style % 4], lean = between(rnd, -0.4, 0.4), lz = between(rnd, -0.3, 0.3);
  const cx = x + lean, cz = z + lz, tr = h * 0.011;
  const trunk = { kind: K.PALE, face: FACE.SMOOTH, color: C.trunk, id: b.id(), extra: -2 };      // extra -2: bark
  b.add(limb([[x, -0.3, z], [x, 0.5, z], [x + lean * 0.2, h * 0.25, z + lz * 0.2], [x + lean * 0.6, h * 0.5, z + lz * 0.6], [cx, cy - r * 0.2, cz]],
    [tr * 2.2, tr * 1.25, tr * 1.1, tr * 0.95, tr * 0.7], 8), trunk);
  for (let i = 0; i < 5; i++) {                                  // the boughs that open into the crown
    const a = (i / 5) * Math.PI * 2 + rnd(), out = r * between(rnd, 0.45, 0.7), y0 = cy - r * between(rnd, 0.75, 1.0);
    b.add(limb([[lerpN(x, cx, 0.85), y0, lerpN(z, cz, 0.85)], [cx + Math.cos(a) * out * 0.5, y0 + r * 0.35, cz + Math.sin(a) * out * 0.5], [cx + Math.cos(a) * out, y0 + r * 0.75, cz + Math.sin(a) * out]],
      [tr * 0.6, tr * 0.4, tr * 0.15], 5), trunk);
  }
  const blot = (px, py, pz, pr) => {
    const k = Math.min(1, Math.hypot(px - cx, py - cy, pz - cz) / r), base = k < 0.5 ? mixc(C.core, C.mid, k / 0.5) : mixc(C.mid, C.rim, (k - 0.5) / 0.5);
    const col = mixc(base, [1, 1, 1], between(rnd, -0.05, 0.16));
    b.add(seg ? puff(pr, rnd() * 50, 0.16, seg[0], seg[1]) : puff(pr, rnd() * 50), { kind: K.PUFF, face: FACE.SMOOTH, m: mat([px, py, pz], [rnd() * 3, rnd() * 3, 0]),
      color: (vx, vy, vz) => mixc(col, C.rim, 0.35 * Math.min(1, Math.max(0, (Math.hypot(vx - cx, vy - cy, vz - cz) / r - 0.75) / 0.4))) });
  };
  blot(cx, cy, cz, r * 0.66);
  for (let i = 0; i < puffs; i++) {
    const u = rnd() * 2 - 0.8, a = rnd() * Math.PI * 2, d = r * between(rnd, 0.36, 0.66), s = Math.sqrt(Math.max(0, 1 - Math.min(1, u * u)));
    blot(cx + Math.cos(a) * s * d, cy + Math.min(1, u) * d * 0.92, cz + Math.sin(a) * s * d, r * between(rnd, 0.3, 0.46));
  }
  for (let i = 0; i < 7; i++) {                                  // small sprays under the crown, each on a twig of its own (loose, they hung in the air)
    const a = rnd() * Math.PI * 2, d = r * between(rnd, 0.72, 0.98), px = cx + Math.cos(a) * d, py = cy - r * between(rnd, 0.4, 0.82), pz = cz + Math.sin(a) * d * 0.7;
    const from = [cx + Math.cos(a) * r * 0.2, cy - r * 0.55, cz + Math.sin(a) * r * 0.2];
    b.add(limb([from, [(from[0] + px) / 2, (from[1] + py) / 2 - r * 0.08, (from[2] + pz) / 2], [px, py, pz]], [tr * 0.22, tr * 0.14, tr * 0.07], 4), trunk);
    blot(px, py, pz, r * between(rnd, 0.07, 0.13));
    if (rnd() < 0.6) blot(px + between(rnd, -0.5, 0.5) * r * 0.12, py + r * 0.07, pz + between(rnd, -0.5, 0.5) * r * 0.12, r * between(rnd, 0.05, 0.09));
  }
  return trunk;
}
const lerpN = (a, c, k) => a + (c - a) * k;

function forest(material, shot) {
  const b = new Builder(41), rnd = rng(410), free = clearance(shot);
  b.heart = [30, 0, 45]; b.reach = 230;
  // The row whose crowns bloom as the traveller passes under them.
  const rowWood = FOREST.row.map((t, i) => tree(b, { x: t.cx, z: FOREST.bloomZ + (i % 2 ? 0.9 : -0.7), h: t.h, cy: t.cy, r: t.r, style: [1, 3, 0, 2][i % 4], seed: 500 + i }));
  // The wood behind it, thinning into the distance.
  const stand = (n, x0, x1, z0, z1, h0, h1, seed, count) => {
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * (i + rnd() * 0.7)) / n, z = between(rnd, z0, z1), h = between(rnd, h0, h1);
      tree(b, { x, z, h, cy: h * between(rnd, 0.72, 0.8), r: h * between(rnd, 0.19, 0.235), style: Math.floor(rnd() * 4), seed: seed + i, puffs: count });
    }
  };
  stand(6, -44, 52, 39, 43, 16, 19, 600, 16);
  stand(15, -70, 86, 47, 62, 18, 23, 620, 14);
  stand(18, -110, 130, 72, 104, 25, 32, 650, 12);
  // Saplings right beside the flight: bare, thin, flicking past the lens.
  const PALE = hex('#C9A99C');
  for (const x of [-51.5, -42.5, -33.5, -24.5, -15.5, -6.5, 2.5, 20, 28.5]) {
    const z = (x < 10 ? 26.7 : 22.1) + between(rnd, -0.4, 0.4), h = between(rnd, 7.2, 9.6);
    if (!free(x, z, 0.1, h, 0.4, 0.9)) continue;
    const wood = { kind: K.PALE, face: FACE.SMOOTH, color: PALE, id: b.id(), extra: -2 };
    b.add(limb([[x, -0.2, z], [x + 0.05, h * 0.5, z], [x - 0.04, h, z + 0.05]], [0.1, 0.07, 0.025], 6), wood);
    b.add(limb([[x + 0.03, h * 0.52, z], [x + 0.7, h * 0.72, z + 0.2], [x + 1.15, h * 0.82, z + 0.25]], [0.04, 0.025, 0.008], 5), wood);
    b.add(limb([[x, h * 0.72, z], [x - 0.5, h * 0.9, z - 0.2], [x - 0.8, h * 0.98, z - 0.2]], [0.035, 0.02, 0.008], 5), wood);
  }
  // Dark trunks between the camera and the flight (after F5f_2): tall, a little crooked,
  // the bark streaked along its length, a bare branch or two.
  const BARK = hex('#51463C'), BARK_LIGHT = hex('#7A6C5E');
  // The ones in FOREST.lane stand right in our way, one after another: we go round each.
  const trunks = [...FOREST.lane.map(([x, z]) => [x, z, true]), ...[[-32, 18.3], [-29.4, 17.2], [-13.2, 18.6], [-10.6, 17.5], [6.1, 18.4], [8.7, 17.3], [25, 18.2], [27.6, 17.4], [11.8, 19.6], [-42, 19.4], [44, 19.5], [-20.5, 14.5], [17.5, 14.8], [36, 15.5]].map(([x, z]) => [x, z, false])];
  const axes = [], woods = [];                                   // the middle line of each trunk that stands in the lane, by height / 36; and its wood
  for (const [x, z, lane] of trunks) {
    const r = lane ? 0.55 : between(rnd, 0.42, 0.62), top = 36;
    if (!lane && !free(x, z, r, top, 0.55, 1.3)) continue;
    const sway = lane ? between(rnd, -0.5, 0.5) : between(rnd, -1.2, 1.2), wood = { kind: K.DARK, face: FACE.SMOOTH, id: b.id(), extra: -2, color: (vx, vy, vz) => mixc(BARK, BARK_LIGHT, 0.85 * Math.pow(fbm2((vx + vz) * 2.6, vy * 0.09, x), 2)) };
    const at = (k) => [x + sway * k * k + Math.sin(k * 5 + x) * 0.18, top * k, z + Math.cos(k * 4 + x) * 0.15];
    if (lane) { axes.push(at); woods.push(wood); }
    b.add(limb([[x, -0.4, z], at(0.03), at(0.2), at(0.4), at(0.6), at(0.8), at(1)], [r * 1.5, r * 1.08, r, r * 0.94, r * 0.88, r * 0.8, r * 0.74], 12), wood);
    for (let i = 0; i < 2; i++) {
      const k = between(rnd, 0.28, 0.62), p = at(k), s = rnd() < 0.5 ? -1 : 1, len = between(rnd, 3, 5.5);
      const elbow = [p[0] + s * len * 0.45, p[1] + len * 0.5, p[2] + between(rnd, -0.5, 0.5)], end = [p[0] + s * len, p[1] + len * 1.25, p[2] + between(rnd, -1, 1)];
      b.add(limb([p, elbow, end], [r * 0.24, r * 0.15, 0.02], 6), wood);
      b.add(limb([elbow, [elbow[0] + s * len * 0.2, elbow[1] + len * 0.5, elbow[2] + 0.4]], [r * 0.1, 0.015], 5), wood);
    }
  }

  // The water's edge (the wood's own x = SHORE): the lake comes up to a low bank of sand and
  // stones with reeds along it, and the wood begins at once; the lane opens straight off
  // the water. What is built here hides the line where the two places are joined.
  {
    const SAND = hex('#E7D8C4'), STONE = hex('#BDB3A6'), REED = hex('#A9B08C');
    b.add(terrain({ nx: 12, nz: 160, at: rect(SHORE - 0.6, SHORE + 9, -110, 170), seed: 3,
      height: (x, z) => { const k = (x - SHORE + 0.6) / 9.6; return 0.62 * Math.sin(Math.PI * Math.min(1, k * 1.6)) ** 0.8 * (0.55 + 0.9 * fbm2(z * 0.11, x * 0.3, 5)) * (1 - 0.6 * Math.exp(-(((z - 23.3) / 5) ** 2))) - 0.03; } }),
      { kind: K.LAND, face: FACE.SMOOTH, solid: false, color: (x, y, z) => mixc(SAND, [1, 1, 1], 0.25 * (fbm2(x * 0.4, z * 0.15, 2) - 0.5)) });
    for (let i = 0; i < 150; i++) {
      const z = between(rnd, -100, 160), x = SHORE + between(rnd, -0.2, 6);
      if (rnd() < 0.45) b.add(rock(between(rnd, 0.15, 0.6), i * 1.3, 1), { kind: K.STONE, face: FACE.FACET, color: mixc(STONE, [1, 1, 1], between(rnd, -0.1, 0.2)), m: mat([x, 0, z], [rnd() * 3, rnd() * 3, 0], [1.3, 0.6, 1]), rest: between(rnd, -0.05, 0.25) });
      else if (Math.abs(z - 23.3) > 2.2) tuft(b, rnd, x, z, { y: 0.1, h: between(rnd, 0.7, 1.7), n: 7, spread: 0.3, lean: 0.25, color: REED });
    }
    // The edge of the wood, to either side of where the lane comes down to the water.
    for (let i = 0; i < 26; i++) {
      const z = i % 2 ? between(rnd, 31, 150) : between(rnd, -95, 15), x = SHORE + between(rnd, 5, 15), h = between(rnd, 15, 22);
      tree(b, { x, z, h, cy: h * between(rnd, 0.72, 0.8), r: h * between(rnd, 0.19, 0.235), style: Math.floor(rnd() * 4), seed: 900 + i, puffs: 14 });
    }
  }
  // The floor of the wood, and the foot of things: roots where the great trunks go into the
  // ground, creeper wound up them, ferns and grass, and round the tree we walk about a ring
  // of toadstools that light as the fleck goes over them.
  {
    const FERN = hex('#B5B892'), IVY = hex('#9AA584'), lit = passing(shot, 2.3), hub = shot.hub;
    // Roots. The foot of the trunk swells to meet them; each leaves it a little above the
    // ground, arches down, and wanders off along the ground, thinner and thinner, into it;
    // one in three forks. (They were straight cones once, and the tree stood on a tripod.)
    const root = (x, z, r, n, wood) => {
      b.add(lathe([[r * 1.7, -0.15], [r * 1.4, 0.14], [r * 1.17, 0.5], [r * 1.04, 1.0], [r * 0.97, 1.7]], 16), { ...wood, m: mat([x, 0, z]) });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + between(rnd, -0.32, 0.32), c = Math.cos(a), s2 = Math.sin(a), len = r * between(rnd, 4.4, 8), bend = between(rnd, -0.85, 0.85), wig = between(rnd, 0.7, 1.7);
        const at = (k, y) => { const d = r * 0.45 + (len - r * 0.45) * k, side = (bend * k * k + 0.19 * Math.sin(k * 6.3 * wig + i) * Math.min(1, k * 4)) * len * 0.36; return [x + c * d - s2 * side, y, z + s2 * d + c * side]; };
        const thick = between(rnd, 0.85, 1.15) * r;
        b.add(limb([at(0, r * 2.4), at(0.11, r * 1.4), at(0.24, r * 0.66), at(0.42, r * 0.28), at(0.64, 0.07), at(0.84, 0.0), at(1, -0.15)], [0.44, 0.41, 0.33, 0.24, 0.16, 0.1, 0.03].map((q) => q * thick), 7), wood);
        if (i % 3 === 0) {
          const p0 = at(0.5, r * 0.18), fa = a + (rnd() < 0.5 ? -1 : 1) * between(rnd, 0.5, 0.9), fl = len * between(rnd, 0.25, 0.42);
          b.add(limb([p0, [p0[0] + Math.cos(fa) * fl * 0.5, 0.05, p0[2] + Math.sin(fa) * fl * 0.5], [p0[0] + Math.cos(fa) * fl, -0.1, p0[2] + Math.sin(fa) * fl]], [thick * 0.15, thick * 0.09, thick * 0.025], 5), wood);
        }
      }
    };
    FOREST.lane.forEach(([x0, z0], li) => {
      const [x, , z] = axes[li](0.03);                           // where the trunk really stands: it is not quite on its mark
      root(x, z, 0.55, 7, woods[li]);
      // Creeper: once and a half round the trunk, on its way up.
      const id = b.id(), pts = [], turn0 = rnd() * 6.283;
      for (let k = 0; k <= 14; k++) { const y = 1.5 + k * 0.56, a = turn0 + k * 0.68, c = axes[li](y / 36); pts.push([c[0] + Math.cos(a) * 0.68, y, c[2] + Math.sin(a) * 0.68]); }      // from above the flare of the foot: lower down it would be inside the trunk
      b.add(limb(pts, pts.map((_, k) => 0.045 - 0.002 * k), 5), { kind: K.PALE, face: FACE.SMOOTH, color: IVY, id });
      for (let k = 1; k < 14; k++) { const p = pts[k], a = rnd() * 6.283;
        b.add(new THREE.SphereGeometry(between(rnd, 0.07, 0.11), 5, 4), { kind: K.BLADE, face: FACE.SMOOTH, id, extra: 0.25, color: mixc(IVY, [1, 1, 1], between(rnd, 0.1, 0.45)), m: mat([p[0] + Math.cos(a) * 0.1, p[1] + between(rnd, -0.2, 0.2), p[2] + Math.sin(a) * 0.1], [rnd() * 3, a, 0], [1, 0.35, 1.5]) }); }
    });
    root(hub[0], hub[2], 0.21, 8, rowWood[10]);
    for (const k of [9, 11]) root(FOREST.row[k].cx, FOREST.bloomZ + (k % 2 ? 0.9 : -0.7), 0.2, 6, rowWood[k]);
    for (let i = 0; i < 260; i++) {
      const x = between(rnd, -66, 30), z = between(rnd, 15, 41), big = rnd() < 0.3;
      tuft(b, rnd, x, z, { h: big ? between(rnd, 0.6, 1.1) : between(rnd, 0.25, 0.5), n: big ? 9 : 5, spread: big ? 0.3 : 0.15, lean: big ? 0.9 : 0.45, color: FERN });
    }
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * 6.283 + between(rnd, -0.15, 0.15), d = between(rnd, 1.45, 1.8), x = hub[0] + Math.sin(a) * d, z = hub[2] - Math.cos(a) * d, s = between(rnd, 0.7, 1.25), on = lit(x, 0.3, z);
      b.add(new THREE.CylinderGeometry(0.03 * s, 0.045 * s, 0.24 * s, 6), { kind: K.PALE, face: FACE.SMOOTH, color: hex('#E9DCCB'), m: mat([x, 0.1 * s, z], [between(rnd, -0.15, 0.15), 0, between(rnd, -0.15, 0.15)]) });
      b.add(lathe([[0, 0.12], [0.07, 0.11], [0.13, 0.06], [0.15, 0.0], [0.12, -0.01], [0, 0.0]].map(([r, y]) => [r * s, y * s]), 12), { kind: K.LAMP, face: FACE.SMOOTH, color: hex('#E8C9B4'), extra: on, m: mat([x, 0.22 * s, z]) });
    }
  }
  // (v13) The floor of the wood was bare paper with shadows on it. Now: undergrowth in the reds
  // of the crowns, leaves lying where they fell (thick under the tree we walk round), flowers,
  // fallen trunks and stumps with toadstools on them that light as the fleck goes by, and more
  // wood on every side: a stand on the right of the lane and one far behind the others.
  {
    const REDS = [hex('#E9705A'), hex('#F0977F'), hex('#DE5A6E'), hex('#F2B3A4'), hex('#D9485A')], PALEF = [hex('#F7EEE6'), hex('#F6DADC'), hex('#F3E3C8')], STALK = hex('#B9B48E');
    const hub = shot.hub, lit = passing(shot, 6.5), clear = (x, z, r) => Math.hypot(x - hub[0], z - hub[2]) > 3.4 + r && FOREST.lane.every(([lx, lz]) => Math.hypot(lx - x, lz - z) > 2.2 + r) && x > SHORE + 4;
    for (let i = 0; i < 110; i++) {
      const x = between(rnd, -64, 46), z = pick(rnd, [between(rnd, 4, 19.5), between(rnd, 25.5, 46)]), r = between(rnd, 0.35, 0.85);
      if (clear(x, z, r) && free(x, z, r + 0.4, r * 1.5, 1.3, 1.5)) bush(b, rnd, x, 0, z, r, REDS, { n: 3 + Math.floor(rnd() * 3) });
    }
    const leafId = b.id();
    for (let i = 0; i < 700; i++) {
      const under = i < 260, a = rnd() * 6.283, d = 0.8 + 5.5 * Math.sqrt(rnd());
      const x = under ? hub[0] + Math.cos(a) * d : between(rnd, -66, 40), z = under ? hub[2] + Math.sin(a) * d : between(rnd, 14, 40), r = between(rnd, 0.06, 0.14);
      b.add(new THREE.CircleGeometry(r, 5), { kind: K.PUFF, face: FACE.SMOOTH, id: leafId, color: mixc(pick(rnd, REDS), [1, 1, 1], between(rnd, -0.05, 0.2)), m: mat([x, 0.012 + 0.01 * rnd(), z], [-HALF, 0, rnd() * 3], [1, 0.52, 1]) });
    }
    for (let i = 0; i < 46; i++) {
      const x = between(rnd, -62, 36), z = between(rnd, 12, 42);
      flowers(b, rnd, x, z, { n: 5 + Math.floor(rnd() * 7), spread: between(rnd, 0.3, 0.9), h: between(rnd, 0.22, 0.42), colors: PALEF, stalk: STALK });
    }
    for (let i = 0; i < 170; i++) {
      const x = between(rnd, -66, 60), z = pick(rnd, [between(rnd, -6, 15), between(rnd, 41, 62)]);
      tuft(b, rnd, x, z, { h: between(rnd, 0.3, 0.9), n: 6, spread: 0.22, lean: 0.6, color: hex('#B5B892') });
    }
    // A toadstool that lights when the fleck is near enough.
    const stool = (x, y, z, s) => {
      b.add(new THREE.CylinderGeometry(0.03 * s, 0.045 * s, 0.24 * s, 6), { kind: K.PALE, face: FACE.SMOOTH, color: hex('#E9DCCB'), m: mat([x, y + 0.1 * s, z], [between(rnd, -0.15, 0.15), 0, between(rnd, -0.15, 0.15)]) });
      b.add(lathe([[0, 0.12], [0.07, 0.11], [0.13, 0.06], [0.15, 0.0], [0.12, -0.01], [0, 0.0]].map(([r, h]) => [r * s, h * s]), 12), { kind: K.LAMP, face: FACE.SMOOTH, color: hex('#E8C9B4'), extra: lit(x, 1.5, z), m: mat([x, y + 0.22 * s, z]) });
    };
    for (const [x, z, yaw, len] of [[-38, 29.6, 0.3, 6.5], [3, 16.4, -0.4, 5.5], [24, 28.6, 1.2, 5], [-18, 17.2, 0.15, 7]]) {
      if (!clear(x, z, len / 2) || !free(x, z, len / 2, 1.2, 1.2, 1.4)) continue;
      const c = Math.cos(yaw), si = Math.sin(yaw), wood = { kind: K.DARK, face: FACE.SMOOTH, id: b.id(), extra: -2, color: (vx, vy, vz) => mixc(BARK, BARK_LIGHT, 0.85 * Math.pow(fbm2((vx + vz) * 0.5, vy * 2.6, x), 2)) };
      b.add(limb([[x - c * len / 2, 0.36, z - si * len / 2], [x, 0.34, z + 0.1], [x + c * len / 2, 0.3, z + si * len / 2]], [0.46, 0.42, 0.36], 10), wood);
      b.add(limb([[x + c * 0.6, 0.5, z + si * 0.6], [x + c * 0.9 - si * 0.9, 1.1, z + si * 0.9 + c * 0.9], [x + c * 1.0 - si * 1.5, 1.5, z + si * 1.0 + c * 1.5]], [0.12, 0.07, 0.02], 5), wood);
      for (let k = 0; k < 4; k++) { const u = between(rnd, -0.42, 0.42) * len; stool(x + c * u - si * 0.2, 0.62, z + si * u + c * 0.2, between(rnd, 0.6, 1.0)); }
      for (let k = 0; k < 3; k++) { const u = between(rnd, -0.5, 0.5) * len; stool(x + c * u + si * 0.7, 0, z + si * u - c * 0.7, between(rnd, 0.8, 1.3)); }
    }
    for (const [x, z] of [[-48, 27.8], [-27, 16.2], [-6, 28.4], [14, 17.6], [30, 27.4], [-56, 17.4]]) {
      if (!clear(x, z, 0.8) || !free(x, z, 0.8, 1.2, 1.0, 1.2)) continue;
      const r = between(rnd, 0.38, 0.6), h = between(rnd, 0.5, 1.0), id = b.id();
      b.add(new THREE.CylinderGeometry(r * 0.9, r * 1.25, h, 11), { kind: K.DARK, face: FACE.SMOOTH, id, extra: -2, color: BARK, m: mat([x, h / 2 - 0.05, z]) });
      b.add(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.04, 11), { kind: K.PALE, face: FACE.SMOOTH, id, extra: -1, color: hex('#CDB9A4'), m: mat([x, h - 0.03, z]) });
      for (let k = 0; k < 4; k++) { const a = rnd() * 6.283; stool(x + Math.cos(a) * (r + 0.35), 0, z + Math.sin(a) * (r + 0.35), between(rnd, 0.7, 1.2)); }
    }
    for (const [x, z] of [[-60, 19.6], [-44, 25.6], [-33, 19.4], [-21, 25.9], [-12, 19.2], [-1, 26], [8, 19.5]]) {
      for (let k = 0; k < 4; k++) { const sx = x + between(rnd, -0.6, 0.6), sz = z + between(rnd, -0.4, 0.4); if (clear(sx, sz, 0.2)) stool(sx, 0, sz, between(rnd, 0.6, 1.2)); }
    }
    const SEG = [12, 8];
    for (let i = 0; i < 13; i++) { const x = -66 + (136 * (i + rnd() * 0.7)) / 13, z = between(rnd, -16, 7), h = between(rnd, 16, 21); tree(b, { x, z, h, cy: h * between(rnd, 0.72, 0.8), r: h * between(rnd, 0.19, 0.235), style: Math.floor(rnd() * 4), seed: 760 + i, puffs: 12 }); }
    for (let i = 0; i < 22; i++) { const x = -150 + (320 * (i + rnd() * 0.7)) / 22, z = between(rnd, 110, 152), h = between(rnd, 26, 34); tree(b, { x, z, h, cy: h * between(rnd, 0.72, 0.8), r: h * between(rnd, 0.19, 0.235), style: Math.floor(rnd() * 4), seed: 800 + i, puffs: 9, seg: SEG }); }
    for (let i = 0; i < 16; i++) { const x = -70 + (150 * (i + rnd() * 0.7)) / 16, z = between(rnd, -52, -24), h = between(rnd, 22, 30); tree(b, { x, z, h, cy: h * between(rnd, 0.72, 0.8), r: h * between(rnd, 0.19, 0.235), style: Math.floor(rnd() * 4), seed: 840 + i, puffs: 9, seg: SEG }); }
  }
  return { object: b.mesh(material), hit: b.hit, ground: () => 0 };
}

// ---------------------------------------------------------------------------- 5 金
// The tower: a round wall of ochre blocks (after T1v2_1: large even blocks, each its own
// wash, darker in the joints), a stair winding up the outside, arched windows between its
// turns, and a pointed roof. It rises out of the cloud on the world's origin.
function tower(material, shot) {
  const b = new Builder(51), rnd = rng(510);
  b.reach = 360;
  const { r: R, pitch, top, base } = TOWER;
  const OCHRE = hex('#DDAA55'), PALE = hex('#ECC57E'), DEEP = hex('#C58A3C'), STEP = hex('#E8CB95'), TILE = hex('#B4673A'), UMBER = hex('#7A5226');
  const stone = { kind: K.STONE, face: FACE.FACET };
  b.add(new THREE.CylinderGeometry(R - 0.45, R - 0.45, top - base, 32, 1, true), { kind: K.DARK, face: FACE.SMOOTH, color: DEEP, m: mat([0, (top + base) / 2, 0]) });
  const course = 1.4, per = 14, rows = Math.round((top - base) / course);
  for (let j = 0; j < rows; j++) {
    const y0 = base + j * course, off = (j % 2) * 0.5 + rnd() * 0.12;
    for (let i = 0; i < per; i++) {
      const a0 = ((i + off) / per) * Math.PI * 2, q = rnd();
      b.add(sector({ r0: R - 0.5, r1: R + between(rnd, -0.03, 0.035), a0: a0 + 0.008, a1: a0 + (Math.PI * 2) / per - 0.008, y0: y0 + 0.022, y1: y0 + course - 0.022, seg: 3 }),
        { ...stone, color: q < 0.5 ? mixc(OCHRE, PALE, q * 1.6) : mixc(OCHRE, DEEP, (q - 0.5) * 1.3) });
    }
  }
  // The stair: one pitch to a turn.
  const steps = 26, rise = pitch / steps, dth = (Math.PI * 2) / steps;
  for (let i = 0; base + i * rise < top - 0.8; i++) {
    const y = base + i * rise;
    b.add(sector({ r0: R - 0.1, r1: R + 1.05, a0: i * dth, a1: (i + 1.03) * dth, y0: y - 0.55, y1: y, seg: 2 }), { ...stone, color: mixc(STEP, [1, 1, 1], between(rnd, -0.06, 0.06)) });
  }
  // Windows, each in the wall between two turns of the stair.
  const arch = (w, h) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(-w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true); s.lineTo(w / 2, 0); s.closePath();
    return new THREE.ShapeGeometry(s, 8);
  };
  const glow = passing(shot, 3.4);
  for (let k = 0; k < 7; k++) for (let j = 0; j < 6; j++) {
    const th = ((j + 0.5) * Math.PI) / 3, y = base + pitch * (th / (Math.PI * 2) + k) + 2.7;
    if (y < base + 1 || y > top - 3.5 || rnd() < 0.42) continue;
    const put = (g, rad, color, kind) => b.add(g, { kind, face: FACE.FACET, color, m: mat([Math.sin(th) * rad, y, -Math.cos(th) * rad], [0, Math.PI - th, 0]) });
    put(arch(1.0, 2.05), R + 0.06, mixc(PALE, [1, 1, 1], 0.15), K.STONE);
    b.add(arch(0.62, 1.72), { kind: K.LAMP, face: FACE.FACET, color: UMBER, extra: Math.min(glow(Math.sin(th) * (R + 0.5), y + 0.9, -Math.cos(th) * (R + 0.5), 3.4), whenUp(shot.gold, y + 0.9, 4.5, 21.25) + 0.3), m: mat([Math.sin(th) * (R + 0.09), y, -Math.cos(th) * (R + 0.09)], [0, Math.PI - th, 0]) });
    put(new THREE.BoxGeometry(1.2, 0.16, 0.3), R + 0.12, PALE, K.STONE);
  }
  // Cornice, roof in courses of tile, finial.
  for (let i = 0; i < 18; i++) {
    b.add(sector({ r0: R - 0.3, r1: R + 0.55, a0: (i / 18) * Math.PI * 2 + 0.01, a1: ((i + 1) / 18) * Math.PI * 2 - 0.01, y0: top - 0.85, y1: top, seg: 2 }), { ...stone, color: mixc(PALE, OCHRE, rnd()) });
  }
  const eave = [[R + 0.95, 0], [3.35, 1.2], [2.55, 2.5], [1.8, 3.9], [1.1, 5.3], [0.5, 6.5], [0.14, 7.4]];
  for (let i = 0; i < eave.length - 1; i++) {
    const [r0, y0] = eave[i], [r1, y1] = eave[i + 1];
    b.add(lathe([[r0 * 1.03, y0 - 0.08], [r0 * 1.03, y0], [r1, y1]], 36), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(TILE, [1, 0.85, 0.6], between(rnd, 0, 0.25)), m: mat([0, top, 0]) });
  }
  b.add(new THREE.SphereGeometry(0.34, 14, 10), { kind: K.STONE, face: FACE.SMOOTH, color: hex('#D9A441'), m: mat([0, top + 7.6, 0]) });
  b.add(limb([[0, top + 7.8, 0], [0, top + 9.2, 0]], [0.07, 0.01], 6), { kind: K.STONE, face: FACE.SMOOTH, color: hex('#D9A441') });
  // Other towers, far off, standing out of the same cloud.
  for (const [x, z, h, r] of [[150, 190, 34, 5], [36, 250, 24, 4], [250, 330, 46, 6.5], [-190, 240, 30, 5]]) {
    const col = mixc(OCHRE, [1, 1, 1], 0.2);
    b.add(new THREE.CylinderGeometry(r * 0.9, r, h + 30, 20, 1), { kind: K.STONE, face: FACE.SMOOTH, color: col, m: mat([x, (h - 30) / 2, z]) });
    b.add(new THREE.ConeGeometry(r * 1.25, r * 2.2, 20, 1), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(TILE, [1, 1, 1], 0.2), m: mat([x, h + r * 1.1, z]) });
  }

  // The stair has an edge: a post every third step with a rail from post to post, and a
  // lantern on every other post. Corbels carry the steps. Lanterns and windows light when
  // the fleck reaches them, or, if it never does, when the gold does.
  {
    const lit = passing(shot, 2.8), when = (x, y, z, r) => Math.min(lit(x, y, z, r), whenUp(shot.gold, y, 4.5, 21.25) + 0.3);
    const IRON = hex('#6B4A2A'), LAMP = { metal: IRON, paper: hex('#F1DDB0'), s: 1.15 }, tops = [];
    for (let i = 0; base + i * rise < top - 0.8; i++) {
      const y = base + i * rise, a = (i + 0.5) * dth, sx = Math.sin(a), cz = -Math.cos(a);
      if (i % 2 === 0) b.add(sector({ r0: R - 0.05, r1: R + 0.78, a0: (i + 0.3) * dth, a1: (i + 0.75) * dth, y0: y - 1.0, y1: y - 0.55, seg: 1 }), { ...stone, color: mixc(STEP, DEEP, 0.3 + 0.2 * rnd()) });
      if (i % 3) continue;
      const px = sx * (R + 0.97), pz = cz * (R + 0.97);
      b.add(new THREE.CylinderGeometry(0.035, 0.045, 0.62, 6), { kind: K.DARK, face: FACE.SMOOTH, color: IRON, m: mat([px, y + 0.31, pz]) });
      tops.push([px, y + 0.6, pz]);
      if (i % 6 === 0) lantern(b, px, y + 1.06, pz, when(px, y + 0.8, pz), LAMP);
    }
    for (let i = 0; i < tops.length - 1; i++) b.add(limb([tops[i], V3lerp(tops[i], tops[i + 1], 0.5, -0.06), tops[i + 1]], [0.018, 0.016, 0.018], 4), { kind: K.DARK, face: FACE.SMOOTH, color: IRON });
    for (let i = 0; i < 24; i++) b.add(sector({ r0: R - 0.1, r1: R + 0.42, a0: (i / 24) * Math.PI * 2 + 0.05, a1: ((i + 0.55) / 24) * Math.PI * 2, y0: top - 1.55, y1: top - 0.85, seg: 1 }), { ...stone, color: mixc(OCHRE, DEEP, rnd()) });
    // Cloth: a long pennant from the finial, and three banners hung under the cornice.
    const CLOTH = hex('#B9583A');
    const pen = new THREE.PlaneGeometry(4.4, 0.62, 18, 1), pp = pen.attributes.position;
    for (let i = 0; i < pp.count; i++) { const u = pp.getX(i) / 4.4 + 0.5; pp.setY(i, pp.getY(i) * (1 - 0.86 * u)); }
    b.add(pen, { kind: K.FLAG, face: FACE.SMOOTH, color: CLOTH, extra: (vx, vy, vz, lx) => lx + 2.2, m: mat([-2.2 * 0.92, top + 8.75, 2.2 * 0.38], [0, Math.PI + 0.39, 0]) });
    // The banners hang under the stair, where it passes overhead on its last turns: from a rod
    // below its corbels down to well clear of the rail and lanterns of the turn beneath. (Hung
    // from the cornice they went straight through the stair.)
    for (const [th, turnsDown] of [[0.55, 0], [2.7, 0], [4.75, 1]]) {
      let over = base + pitch * (th / (Math.PI * 2));                                   // the stair's height at this angle, on its highest turn below the top
      while (over + pitch < top - 0.8) over += pitch;
      over -= pitch * turnsDown;
      const y1 = over - 1.3, len = 3.3, x = Math.sin(th) * (R + 0.6), z = -Math.cos(th) * (R + 0.6);
      b.add(new THREE.PlaneGeometry(0.9, len, 2, 12), { kind: K.FLAG, face: FACE.SMOOTH, color: mixc(CLOTH, [1, 0.9, 0.6], 0.15 * rnd()), extra: (vx, vy) => Math.max(0, y1 - vy), m: mat([x, y1 - len / 2, z], [0, Math.PI - th, 0]) });
      b.add(new THREE.CylinderGeometry(0.03, 0.03, 1.05, 5), { kind: K.DARK, face: FACE.SMOOTH, color: IRON, m: mat([x, y1 + 0.02, z], [0, Math.PI - th, HALF]) });
      for (const sgn of [-0.42, 0.42]) b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 4), { kind: K.DARK, face: FACE.SMOOTH, color: IRON, m: mat([x + Math.cos(th) * sgn, y1 + 0.15, z + Math.sin(th) * sgn]) });      // it hangs from the corbels
    }
  }
  // (v13) Somebody lives here: pots of green on the stair against the wall, boxes of flowers
  // under some of the windows with creeper hanging from them, dormers in the roof. And the
  // tower is not alone above the cloud: others stand out of it on every side, near and far,
  // two of them joined by a bridge, their windows lighting as the gold comes up; and here and
  // there a crag with a tree on it.
  {
    const GREENS = [hex('#8E9A5A'), hex('#A3A860'), hex('#7C8C52')], FLOWER = [hex('#C8553A'), hex('#F0E6D0'), hex('#D98A3A')], IVY = hex('#8A9460');
    const lit = passing(shot, 3.2), when = (x, y, z) => Math.min(lit(x, y, z), whenUp(shot.gold, y, 4.5, 21.25) + 0.3), stepsN = 26, rise2 = pitch / stepsN, dth2 = (Math.PI * 2) / stepsN;
    for (let i = 3; base + i * rise2 < top - 2; i += 4 + Math.floor(rnd() * 4)) {
      const y = base + i * rise2, a = (i + 0.5) * dth2, rad = R + 0.3, x = Math.sin(a) * rad, z = -Math.cos(a) * rad, sc = between(rnd, 0.8, 1.25);
      b.add(lathe([[0.1, 0], [0.16, 0.05], [0.19, 0.22], [0.15, 0.3], [0.17, 0.33]].map(([r, h]) => [r * sc, h * sc]), 10), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(TILE, [1, 1, 1], between(rnd, 0, 0.25)), m: mat([x, y, z]) });
      bush(b, rnd, x, y + 0.3 * sc, z, 0.25 * sc, GREENS, { n: 3, squash: 0.9 });
      if (rnd() < 0.5) flowers(b, rnd, x, z, { y: y + 0.42 * sc, n: 4, spread: 0.14, h: 0.16, r: 0.03, colors: FLOWER, stalk: IVY });
    }
    for (let k = 0; k < 7; k++) for (let j = 0; j < 6; j++) {
      const th = ((j + 0.5) * Math.PI) / 3 + 0.0001, y = base + pitch * (th / (Math.PI * 2) + k) + 2.7;
      if (y < base + 1 || y > top - 3.5 || rnd() < 0.5) continue;
      const x = Math.sin(th) * (R + 0.26), z = -Math.cos(th) * (R + 0.26);
      b.add(new THREE.BoxGeometry(0.95, 0.2, 0.3), { kind: K.STONE, face: FACE.FACET, color: mixc(UMBER, PALE, 0.35), m: mat([x, y - 0.2, z], [0, Math.PI - th, 0]) });
      for (let q = -1; q <= 1; q++) bush(b, rnd, x + Math.cos(th) * q * 0.3, y - 0.12, z + Math.sin(th) * q * 0.3, 0.15, rnd() < 0.5 ? FLOWER : GREENS, { n: 2, squash: 0.9 });
      if (rnd() < 0.7) vine(b, rnd, x + Math.cos(th) * between(rnd, -0.35, 0.35), y - 0.28, z + Math.sin(th) * between(rnd, -0.35, 0.35), between(rnd, 0.6, 1.25), IVY);
    }
    for (const th of [0.6, 2.7, 4.8]) {                           // dormers
      const rr = 3.0, x = Math.sin(th) * rr, z = -Math.cos(th) * rr, y = top + 1.9;
      b.add(new THREE.BoxGeometry(0.9, 1.0, 1.0), { kind: K.STONE, face: FACE.FACET, color: mixc(PALE, OCHRE, 0.4), m: mat([x, y, z], [0, Math.PI - th, 0]) });
      b.add(new THREE.ConeGeometry(0.78, 0.7, 4, 1), { kind: K.STONE, face: FACE.FACET, color: TILE, m: mat([x, y + 0.85, z], [0, Math.PI / 4 - th, 0]) });
      b.add(new THREE.BoxGeometry(0.42, 0.56, 0.06), { kind: K.LAMP, face: FACE.FACET, color: UMBER, extra: when(Math.sin(th) * 3.6, y, -Math.cos(th) * 3.6), m: mat([Math.sin(th) * (rr + 0.51), y, -Math.cos(th) * (rr + 0.51)], [0, Math.PI - th, 0]) });
    }
    // Other towers. Only on this side of where the cloud ends (the mountain stands beyond it).
    const others = [[-60, 58, 20, 3.0], [-118, -32, 26, 4.2], [68, -112, 32, 4.5], [-42, -150, 38, 5], [-230, 64, 44, 6], [-150, 128, 30, 4.4], [42, -68, 16, 2.6], [-82, -92, 22, 3.6], [8, -205, 34, 5], [-262, -118, 50, 7], [104, -232, 40, 6], [-36, 104, 14, 2.4]];
    for (const [x, z, h, r] of others) {
      if (past('cloudEdge', 'tower', [x, 0, z]) > -10) continue;
      const col = mixc(OCHRE, [1, 1, 1], 0.18 + 0.1 * rnd()), id = b.id(), far = Math.hypot(x, z);
      b.add(new THREE.CylinderGeometry(r * 0.88, r, h + 34, 18, 1), { kind: K.STONE, face: FACE.SMOOTH, color: col, id, extra: far < 140 ? 1.6 : 0, m: mat([x, (h - 34) / 2, z]) });
      for (const q of [0.55, 0.9]) b.add(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.6, 18, 1), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(col, DEEP, 0.3), id, m: mat([x, h * q, z]) });
      b.add(new THREE.ConeGeometry(r * 1.3, r * 2.4, 18, 1), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(TILE, [1, 1, 1], 0.15 + 0.1 * rnd()), m: mat([x, h + r * 1.2, z]) });
      b.add(limb([[x, h + r * 2.4, z], [x, h + r * 2.4 + 2.2, z]], [0.1, 0.02], 5), { kind: K.STONE, face: FACE.SMOOTH, color: hex('#D9A441') });
      const toUs = Math.atan2(-x, z);                              // the side of it that faces the tower we are on
      for (let w = 0; w < 5; w++) {
        const a = toUs + between(rnd, -1.1, 1.1), y = h * between(rnd, 0.15, 0.82), wx = x + Math.sin(a) * r * 0.97, wz = z - Math.cos(a) * r * 0.97;
        b.add(new THREE.BoxGeometry(r * 0.2, r * 0.42, 0.2), { kind: K.LAMP, face: FACE.FACET, color: UMBER, extra: whenUp(shot.gold, y * 0.6, 4.5, 21.25) + 0.6 + far * 0.012, m: mat([wx, y, wz], [0, Math.PI - a, 0]) });
      }
    }
    {
      const [x0, z0] = [-118, -32], [x1, z1] = [-82, -92], len = Math.hypot(x1 - x0, z1 - z0), yaw = -Math.atan2(z1 - z0, x1 - x0), holes = [];
      for (let u = 7; u + 8 < len - 4; u += 11) holes.push(archHole(u + 4, -40, 8, 6));
      b.add(slabOf([[2, -40], [len - 2, -40], [len - 2, 13], [2, 13]], holes, 2.2), { kind: K.STONE, face: FACE.FACET, color: mixc(OCHRE, [1, 1, 1], 0.22), extra: 1.5, m: mat([x0, 0, z0], [0, yaw, 0]) });
      b.add(block(len - 4, 0.7, 3.0, 0.05, 5), { ...stone, color: mixc(PALE, [1, 1, 1], 0.2), m: mat([(x0 + x1) / 2, 13.3, (z0 + z1) / 2], [0, yaw, 0]) });
    }
    for (const [x, z, r] of [[52, 34, 5], [-70, -18, 7], [34, -128, 9], [-150, 20, 10], [-20, 150, 6], [-108, 90, 8], [150, -90, 11]]) {
      if (past('cloudEdge', 'tower', [x, 0, z]) > -10 || Math.hypot(x, z) < 42) continue;
      const col = mixc(hex('#C9B58E'), [1, 1, 1], between(rnd, 0, 0.2)), hh = r * between(rnd, 1.5, 2.3);
      b.add(rock(r, x * 2.1, 2, 0.3), { kind: K.STONE, face: FACE.FACET, color: col, m: mat([x, -8, z], [0, rnd() * 3, 0], [1, hh / r, 0.9]) });
      smallTree(b, rnd, x + r * 0.15, -8 + hh * 0.86, z, between(rnd, 5, 8), GREENS, UMBER, { fine: true });
      bush(b, rnd, x - r * 0.3, -8 + hh * 0.7, z + r * 0.2, r * 0.22, GREENS);
    }
  }
  return { object: b.mesh(material), hit: b.hit, ground: () => -1e4 };      // cloud
}

// ---------------------------------------------------------------------------- 6 留白
// The summit (after S1f_2: a dark indigo crag, a flat shoulder with a peak rising to its
// right, cut in planes), the country below it (after the land painting of 2026-11-14:
// green fields in long strokes, a pale lake, woods, cone-shaped hills, a burst of red
// blossom) and the range on the horizon (after S2f_3: lilac greys, two washes deep).
function summit(material, shot) {
  const b = new Builder(61), rnd = rng(610);
  b.heart = [-60, 0, 400]; b.reach = 1050;
  const FLOOR = -70;
  // Height of the mountain. The shoulder the traveller lands on is at y = 0: 5.2 wide,
  // from the cliff edge at z = 6.6 back to z = 12.6.
  const rockY = (x, z) => {
    const dx = Math.max(Math.abs(x) - 2.6, 0), dzF = Math.max(6.6 - z, 0), dzB = Math.max(z - 12.6, 0), out = dx + dzF + dzB;
    let y = -Math.min(dzF, 4) * 3.4 - Math.max(dzF - 4, 0) * 1.5;        // the cliff towards the camera, then the slope under it
    y -= dzB * 0.62;
    y -= x < 0 ? dx * 0.85 + Math.max(dx - 9, 0) * 0.6 : dx * 0.22 + Math.max(x - 12, 0) * 1.35;
    y += 5.0 * Math.exp(-(((x - 7.2) ** 2) / 9 + ((z - 10.8) ** 2) / 15)) * Math.min(1, Math.max(0, (x - 2.6) / 1.8));   // the peak
    const rough = Math.min(1, out / 1.6), stand = Math.min(1, Math.max(0, (Math.hypot(x, z - 9.9) - 1.7) / 1.2));     // flat where the traveller stands
    // Crags: sharp-crested ridges that grow down the slopes, and broken steps on the left flank.
    const crest = 1 - Math.abs(2 * fbm2(x * 0.13, z * 0.13, 3) - 1);
    y += rough * ((crest - 0.62) * 5.5 * Math.min(1.6, out / 5) + (fbm2(x * 0.3, z * 0.3, 2) - 0.5) * 2.2 + (noise2(x * 1.1, z * 1.1, 5) - 0.5) * 0.8);
    if (x < -2.6) y += rough * 0.5 * (Math.floor(y / 1.7) * 1.7 + 0.85 - y);
    y += (1 - rough) * stand * (noise2(x * 0.9, z * 0.9, 8) - 0.5) * 0.22;      // the shoulder is worn, not planed
    return Math.max(y, FLOOR - 4);
  };
  const INDIGO = hex('#182149'), INDIGO_LIGHT = hex('#2F3F7A'), FOOT = hex('#6F8A66');
  // Fine near the top, coarse far down the slopes.
  const spread = (u, c, half) => { const k = u * 2 - 1; return c + k * (0.3 + 0.7 * k * k) * half; };
  b.add(terrain({ nx: 84, nz: 84, shake: 0.75, seed: 6, at: (u, v) => [spread(u, 2, 150), spread(v, 10, 130)], height: rockY }), {
    kind: K.STONE, face: FACE.FACET, solid: false,
    color: (x, y, z) => mixc(mixc(INDIGO, INDIGO_LIGHT, Math.min(1, 1.7 * fbm2(x * 0.5, z * 0.5 + y * 0.4, 9) ** 1.5 + 0.5 * noise2(x * 2.3, z * 2.3, 4) - 0.25)), FOOT, Math.min(1, Math.max(0, (-y - 28) / 30))),
  });
  // Loose rock on the shoulder's edges.
  for (let i = 0; i < 7; i++) {
    const x = between(rnd, -3.6, 3.8), z = Math.abs(x) > 2.3 ? between(rnd, 7.5, 12.5) : between(rnd, 12.2, 13.4);
    b.add(rock(between(rnd, 0.06, 0.17), i * 2.3, 1), { kind: K.DARK, face: FACE.FACET, color: mixc(INDIGO, INDIGO_LIGHT, rnd()), m: mat([x, rockY(x, z), z], [rnd() * 3, rnd() * 3, 0], [1.3, 0.7, 1]), rest: rockY(x, z) - 0.03 });
  }

  // The land. Its colours are painted per pixel (landColor in the shader, switched on by
  // `extra`), so that the lake has a clean shore; the mesh gives it its relief.
  const hills = Array.from({ length: 26 }, () => ({ x: between(rnd, -1500, 1500), z: between(rnd, 260, 1600), r: between(rnd, 90, 240), h: between(rnd, 18, 70) }));
  const lakeAt = (x, z) => 1 - Math.hypot((x + 250) / 250, (z - 520) / 130);
  const landY = (x, z) => {
    let y = FLOOR + 16 * (fbm2(x / 170, z / 170, 4) - 0.35);
    for (const h of hills) y += h.h * Math.exp(-(((x - h.x) ** 2 + (z - h.z) ** 2) / (h.r * h.r)));
    const wet = lakeAt(x, z);
    if (wet > -0.35) y = lerpN(y, FLOOR - 1, Math.min(1, (wet + 0.35) / 0.3));
    return y;
  };
  // (The land used to begin at z = 110, and a painted plane lay under the mountain: where the two met there was a seam straight across the plain.)
  b.add(terrain({ nx: 150, nz: 150, at: (u, v) => [spread(u, -100, 2600), -640 + 3450 * v ** 1.75], height: landY }), { kind: K.LAND, face: FACE.SMOOTH, color: [1, 1, 1], extra: 1, solid: false });
  // Hills like cones, pale, as in the painting.
  for (const [x, z, r, h] of [[-640, 900, 210, 150], [-380, 1040, 170, 118], [330, 1150, 240, 170], [760, 820, 160, 104]]) {
    b.add(new THREE.ConeGeometry(r, h, 5, 1), { kind: K.LAND, face: FACE.FACET, solid: false, color: mixc(hex('#C7CBA4'), [1, 1, 1], between(rnd, 0, 0.2)), m: mat([x, FLOOR + h / 2 - 6, z], [0, rnd() * 3, 0]) });
  }
  // Woods: dark green blots along the slopes, and one burst of red.
  const GREENS = ['#3E6B3F', '#4F7F45', '#2F5A3A', '#6A8F4C'].map(hex);
  for (let i = 0; i < 420; i++) {
    const x = between(rnd, -900, 700), z = between(rnd, 180, 1100);
    if (lakeAt(x, z) > -0.08 || fbm2(x / 110, z / 110, 9) < 0.5) continue;
    const r = between(rnd, 5, 12);
    b.add(puff(r, i, 0.2), { kind: K.PUFF, face: FACE.SMOOTH, color: mixc(pick(rnd, GREENS), [1, 1, 1], between(rnd, 0, 0.12)), m: mat([x, landY(x, z) + r * 0.5, z], [0, rnd() * 3, 0], [1, 0.75, 1]) });
  }
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2, d = 46 * Math.sqrt(rnd()), x = -60 + Math.cos(a) * d * 1.5, z = 330 + Math.sin(a) * d, r = between(rnd, 3, 7);
    b.add(puff(r, i * 3, 0.22), { kind: K.PUFF, face: FACE.SMOOTH, color: mixc(hex('#E8563F'), hex('#F5A08C'), rnd()), m: mat([x, landY(x, z) + r * 0.6, z], [0, rnd() * 3, 0], [1, 0.8, 1]) });
  }
  // The range on the horizon.
  ridge(b, { x0: -2600, x1: 2600, z0: 1900, z1: 2300, height: 300, base: FLOOR, color: hex('#DAD1E2'), seed: 14, sharp: 1.5, nx: 220 });
  ridge(b, { x0: -2600, x1: 2600, z0: 1500, z1: 1800, height: 165, base: FLOOR, color: hex('#A29CB4'), seed: 19, sharp: 1.3, nx: 220 });

  // On the shoulder: dry grass in the cracks, laid over by the wind, and at the far edge a
  // cairn. The fleck waits on the cairn.
  {
    const [cx, cy, cz] = SUMMIT.cairn, DRY = hex('#A7A27C');
    let y = rockY(cx, cz) - 0.03;
    for (const [r, sy] of [[0.3, 0.5], [0.25, 0.55], [0.21, 0.5], [0.16, 0.6], [0.11, 0.7]]) {
      const hgt = (cy - rockY(cx, cz)) * (r * sy) / 0.5055;
      b.add(rock(r, r * 31, 1, 0.2), { kind: K.DARK, face: FACE.FACET, color: mixc(INDIGO, INDIGO_LIGHT, 0.35 + 0.6 * rnd()), m: mat([cx + between(rnd, -0.03, 0.03), y + hgt / 2, cz + between(rnd, -0.03, 0.03)], [0, rnd() * 3, 0], [1.25, hgt / (2 * r), 1.1]) });
      y += hgt * 0.92;
    }
    for (let i = 0; i < 70; i++) {
      const x = between(rnd, -2.6, 3.0), z = between(rnd, 6.9, 12.9);
      if (Math.hypot(x - cx, z - cz) < 0.4) continue;
      tuft(b, rnd, x, z, { y: rockY(x, z), h: between(rnd, 0.14, 0.34), n: 5, spread: 0.1, lean: 0.8, color: DRY });
    }
  }
  // (v13) The shoulder: more grass, small flowers in it, loose stones, and off its far edge a
  // pine bent by the wind and a bush or two, to look past. The country below was green slopes
  // with a few blots on them; now it has trees that are trees (trunk and crown) in woods and
  // alone, hedges along the lie of the land, avenues of cypress, a second burst of blossom, and
  // what we came through, small and far: obelisks in the pale lake, a run of the aqueduct, a
  // few columns on a rise, towers on two hills.
  {
    const DRY = hex('#A7A27C'), HEADS = [hex('#F6F3EA'), hex('#E9D27A'), hex('#C9B8E0')], [cx, , cz] = SUMMIT.cairn;
    for (let i = 0; i < 150; i++) {
      const x = between(rnd, -3.4, 3.8), z = between(rnd, 6.8, 13.4);
      if (Math.hypot(x - cx, z - cz) < 0.4) continue;
      tuft(b, rnd, x, z, { y: rockY(x, z), h: between(rnd, 0.12, 0.4), n: 5, spread: 0.1, lean: 0.8, color: mixc(DRY, [0.6, 0.7, 0.4], rnd() * 0.3) });
    }
    for (let i = 0; i < 30; i++) flowers(b, rnd, between(rnd, -2.6, 3.0), between(rnd, 7.0, 13.0), { y: rockY, n: 3 + Math.floor(rnd() * 4), spread: 0.22, h: 0.16, r: 0.022, colors: HEADS, stalk: DRY });
    for (let i = 0; i < 24; i++) {
      const x = between(rnd, -3.6, 3.8), z = between(rnd, 7.0, 13.6);
      if (Math.hypot(x, z - 9.9) < 0.5 || Math.hypot(x - cx, z - cz) < 0.5) continue;
      b.add(rock(between(rnd, 0.03, 0.09), i * 5.1, 0), { kind: K.DARK, face: FACE.FACET, color: mixc(INDIGO, INDIGO_LIGHT, rnd()), m: mat([x, rockY(x, z), z], [rnd() * 3, rnd() * 3, 0], [1.3, 0.6, 1]), rest: rockY(x, z) - 0.015 });
    }
    {
      const px = -3.0, pz = 15.4, py = rockY(px, pz) - 0.25, Q = 0.8, wood = { kind: K.DARK, face: FACE.SMOOTH, id: b.id(), extra: -2, color: hex('#4A4038') }, PINE = [hex('#3F5F4C'), hex('#4E7458'), hex('#365244')];
      b.add(limb([[px, py - 0.3, pz], [px + 0.1, py + 0.6 * Q, pz], [px + 0.45, py + 1.2 * Q, pz + 0.05], [px + 1.0, py + 1.7 * Q, pz + 0.1]], [0.11, 0.085, 0.06, 0.03], 6), wood);      // (out past the edge and low: it frames the country by day, and is under the picture when the eye goes up to the moon)
      b.add(limb([[px + 0.2, py + 0.85 * Q, pz], [px + 0.75, py + 1.0 * Q, pz - 0.15], [px + 1.3, py + 1.05 * Q, pz - 0.2]], [0.04, 0.028, 0.012], 5), wood);
      // Its foliage is in pads, each a cluster of small tufts (as a few large balls it was green boulders in a tree).
      for (const [dx, dy, R] of [[1.05, 1.8, 0.42], [0.55, 1.5, 0.3], [1.55, 1.58, 0.3], [1.35, 1.12, 0.26], [0.9, 2.05, 0.24]]) {
        for (let k = 0; k < 7; k++) {
          const a = rnd() * 6.283, d = R * Math.sqrt(rnd()), r = between(rnd, 0.11, 0.2);
          b.add(puff(r, rnd() * 50, 0.26, 14, 10), { kind: K.PUFF, face: FACE.SMOOTH, color: mixc(pick(rnd, PINE), [1, 1, 1], rnd() * 0.22), m: mat([px + dx + Math.cos(a) * d * 1.2, py + dy * Q + between(rnd, -0.06, 0.1), pz + Math.sin(a) * d], [rnd() * 3, rnd() * 3, 0], [1.2, 0.75, 1]) });
        }
      }
      // (Three bushes stood here, on the slopes beside the shoulder: on a steep face a ball of leaves is half inside the
      // rock, and showed as a green stone set in it. They are still drawn for, so that everything built after them is where it was.)
      const nowhere = new Builder(1); nowhere.hit = null;
      for (const [x, z, r] of [[2.7, 14.3, 0.32], [3.3, 13.9, 0.24], [-3.6, 13.4, 0.3]]) bush(nowhere, rnd, x, rockY(x, z) - 0.05, z, r, PINE);
    }
    const TRUNK = hex('#6B5A48'), G2 = ['#3E6B3F', '#4F7F45', '#2F5A3A', '#6A8F4C', '#7FA052', '#58804A'].map(hex);
    const open = (x, z) => lakeAt(x, z) < -0.1 && rockY(x, z) < landY(x, z) - 2;
    for (let i = 0, put = 0; i < 6000 && put < 640; i++) {
      const x = between(rnd, -760, 640), z = between(rnd, 110, 780);
      if (!open(x, z) || (fbm2(x / 95, z / 95, 21) < 0.54 && rnd() > 0.035)) continue;
      smallTree(b, rnd, x, landY(x, z), z, between(rnd, 9, 19) * (1 + z / 1500), G2, TRUNK, { n: z < 360 ? 4 : 3, fine: z < 360 });
      put++;
    }
    for (let i = 0; i < 9000; i++) {
      const x = between(rnd, -820, 700), z = between(rnd, 150, 920);
      if (Math.abs(fbm2(x / 70, z / 70, 31) - 0.5) > 0.006 || !open(x, z)) continue;
      const r = between(rnd, 2.2, 4.2);
      b.add(blob(r, i), { kind: K.PUFF, face: FACE.SMOOTH, color: mixc(pick(rnd, G2), [1, 1, 1], between(rnd, 0, 0.1)), m: mat([x, landY(x, z) + r * 0.4, z], [0, rnd() * 3, 0], [1, 0.7, 1]) });
    }
    for (const [x0, z0, x1, z1, n] of [[-120, 250, 40, 300, 14], [60, 380, 200, 330, 16], [-420, 380, -330, 300, 12], [200, 520, 330, 600, 14], [-40, 190, 90, 205, 10]]) {
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1), x = lerpN(x0, x1, k) + between(rnd, -2, 2), z = lerpN(z0, z1, k) + between(rnd, -2, 2);
        if (open(x, z)) cypress(b, rnd, x, z, between(rnd, 16, 26), mixc(hex('#35543A'), [1, 1, 1], rnd() * 0.15), landY(x, z));
      }
    }
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, d = 30 * Math.sqrt(rnd()), x = 250 + Math.cos(a) * d * 1.4, z = 300 + Math.sin(a) * d, r = between(rnd, 3, 6);
      if (open(x, z)) b.add(blob(r, i * 3, 0.22), { kind: K.PUFF, face: FACE.SMOOTH, color: mixc(hex('#F0A6B4'), hex('#FBE3E0'), rnd()), m: mat([x, landY(x, z) + r * 0.6, z], [0, rnd() * 3, 0], [1, 0.8, 1]) });
    }
    const TEAL = hex('#4E8E98');
    for (const [x, z, h, w] of [[-300, 500, 58, 9], [-240, 540, 44, 7.5], [-200, 480, 66, 10], [-330, 560, 36, 6.5], [-150, 530, 50, 8], [-260, 470, 30, 6]]) {
      const col = mixc(TEAL, [1, 1, 1], between(rnd, 0, 0.25)), yaw = rnd() * 3;
      b.add(new THREE.CylinderGeometry(w * 0.34, w * 0.5, h * 0.86, 6, 1), { kind: K.STONE, face: FACE.FACET, color: col, m: mat([x, FLOOR - 2 + h * 0.43, z], [0, yaw, 0]) });
      b.add(new THREE.ConeGeometry(w * 0.34, h * 0.14, 6, 1), { kind: K.STONE, face: FACE.FACET, color: mixc(col, [1, 1, 1], 0.12), m: mat([x, FLOOR - 2 + h * 0.93, z], [0, yaw, 0]) });
    }
    {
      const len = 260, holes = [];
      for (let u = 8; u + 14 < len - 60; u += 20) holes.push(archHole(u + 7, -30, 14, 12));
      b.add(slabOf([[0, -30], [len, -30], [len, 8], [len - 6, 9], [len - 8, 20], [len - 30, 21], [len - 33, 26], [0, 26]], holes, 7), { kind: K.STONE, face: FACE.FACET, color: hex('#CBC1B1'), extra: 3.5, m: mat([150, FLOOR, 440], [0, 0.25, 0]) });
      const STONE = hex('#B0BAC6'), gx = 96, gz = 252;
      for (let i = 0; i < 6; i++) {
        const x = gx + i * 6.5, z = gz + i * 1.2, y = landY(x, z), st = [1, 1, 0.5, 1, 1, 0.3][i];
        b.add(new THREE.CylinderGeometry(1.0, 1.15, 16 * st, 10, 1), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(STONE, [1, 1, 1], rnd() * 0.15), m: mat([x, y + 8 * st - 1, z]) });
        if (i === 0 || i === 3) b.add(block(8.2, 1.6, 2.6, 0.1, i), { kind: K.STONE, face: FACE.FACET, color: STONE, m: mat([x + 3.25, landY(x, z) + 15.6, z + 0.6], [0, -0.18, 0]) });
      }
      const OCHRE = hex('#DDAA55'), TILE = hex('#B4673A');
      for (const h of [...hills].filter((q) => q.z < 820 && q.z > 240 && Math.abs(q.x) < 700 && lakeAt(q.x, q.z) < -0.3).sort((p, q) => q.h - p.h).slice(0, 2)) {
        const y = landY(h.x, h.z);
        b.add(new THREE.CylinderGeometry(5.2, 6, 44, 16, 1), { kind: K.STONE, face: FACE.SMOOTH, color: mixc(OCHRE, [1, 1, 1], 0.15), extra: 2.2, m: mat([h.x, y + 20, h.z]) });
        b.add(new THREE.ConeGeometry(7.6, 13, 16, 1), { kind: K.STONE, face: FACE.SMOOTH, color: TILE, m: mat([h.x, y + 48.5, h.z]) });
      }
    }
  }
  return { object: b.mesh(material), hit: b.hit, ground: (x, z) => Math.max(rockY(x, z), landY(x, z)) };
}

const SCENES = { ruins, lake, forest, tower, summit };
export const buildScene = (id, material, shot) => SCENES[id](material, shot);
