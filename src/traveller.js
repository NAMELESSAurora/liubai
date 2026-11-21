// The traveller is a cloak. There is no torso, no arm, no leg to be seen anywhere: a cloak
// far too big for whoever is under it, gathered at the collar and falling in folds to the
// ground with a train behind, a short cape over its shoulders, and above the collar a head
// of hair with no face drawn under the fringe. What the eye follows is cloth and hair, and
// neither has a single key. The cloak and the cape are sheets of points held together by
// threads, hung from the collar, pulled by their own weight and by the air, lying on a form
// that is never drawn and on the ground. The hair is some three hundred strands, each a
// chain rooted in the scalp that keeps the way it was cut and swings about it.
//
// Everything is stepped at a fixed rate from before each shot begins and the states are
// kept, so any moment of a shot can be asked for and always comes out the same.
import * as THREE from 'three';
import { V, clamp, lerp, ss } from './camera.js';
import { K, FACE, Builder, hex } from './build.js';

const TAU = Math.PI * 2;
const HIP = 0.52;             // height of the body centre above the ground when standing: the figure is one unit tall
export const STAND = HIP;
const NECK = 0.31;            // the collar, above the centre along the spine
const ARM = 0.42;             // how far an arm reaches under the cloth, when the cloak is a wing

// Turns a moment on the path into a pose.
//   pt: from path(); t: time (s, as it passes on screen); rate: how fast the path's own
//   clock runs against it; raise: 0..1 the head lifted to the sky; ground: height of the
//   ground or water the cloak can lie on (leave out where there is none).
export function poseOf(pt, t, { raise = 0, ground = null, wind = 1, rate = 1 } = {}) {
  const vel = V.scale(pt.vel, rate), speed = pt.speed * rate, climb = Math.max(0, vel[1]);
  return {
    pos: pt.pos, vel, speed, yaw: pt.yaw, fly: pt.fly, spread: pt.spread, dip: pt.dip,
    bank: clamp(-pt.yawRate * rate * 0.55, -0.85, 0.85) * pt.fly,
    // The arms' beat: long and shallow in a glide, deeper in a climb.
    flap: (0.2 + 0.3 * clamp(climb / 3)) * pt.fly * Math.sin(t * TAU * 0.5),
    phase: pt.dist / 0.8, stride: (1 - pt.fly) * clamp(speed / 0.5),
    time: t, wind, raise, ground: ground ?? 0, floor: ground !== null,
  };
}

// Where the traveller touches the world, which is where its colour comes from: under the
// cloak on foot, the trailing hem in the air (on the water when it skims), and at the end,
// when it lifts its head, the place in the sky it looks at.
export function tipOf(p) {
  const fwd = [Math.sin(p.yaw), 0, Math.cos(p.yaw)], drop = p.ground - p.pos[1];
  const walk = [fwd[0] * 0.09, drop, fwd[2] * 0.09];
  const fly = [-fwd[0] * 0.55, -0.3, -fwd[2] * 0.55];
  if (p.dip > 0) fly[1] = lerp(fly[1], drop, p.dip);
  const tip = V.add(p.pos, V.lerp(walk, fly, p.fly));
  if (p.raise <= 0) return tip;
  const H = headOf(p, frameOf(p));
  return V.lerp(tip, V.add(H.hc, V.scale(H.Fh, 1.5)), p.raise);
}

// ---- what is under the cloth ----------------------------------------------------------
// The body's axes: S along the spine, F the way the chest faces, R to its right. On foot it
// stands upright, leans a little into its walk and rides up and down twice a stride; in
// the air it lies along its path, head first and held a little high, and rolls into turns.
// Two knees push the front of the cloak out in turn: the only sign of legs.
function frameOf(p) {
  const fwd = [Math.sin(p.yaw), 0, Math.cos(p.yaw)], sp = V.len(p.vel), dir = sp > 0.05 ? V.scale(p.vel, 1 / sp) : fwd;
  const k = ss(0, 1, p.fly), a = p.phase * TAU, foot = (1 - p.fly) * p.stride;
  const side = [fwd[2], 0, -fwd[0]];
  const up = V.add(V.add([0, 1, 0], V.scale(fwd, 0.07 * p.stride)), V.scale(side, 0.025 * foot * Math.sin(a)));
  const S = V.norm(V.lerp(up, V.add(dir, [0, 0.3, 0]), k));
  let F = V.lerp(fwd, V.add([0, -1, 0], V.scale(fwd, 0.25)), k);
  F = V.norm(V.sub(F, V.scale(S, V.dot(F, S))));
  let R = V.cross(S, F);
  const b = p.bank * 0.7, c = Math.cos(b), s = Math.sin(b);
  [F, R] = [V.add(V.scale(F, c), V.scale(R, s)), V.sub(V.scale(R, c), V.scale(F, s))];
  const pos = [p.pos[0], p.pos[1] - 0.016 * foot * (0.5 - 0.5 * Math.cos(2 * a)), p.pos[2]];
  const knees = [0, Math.PI].map((ph, i) => {
    const sw = Math.max(0, Math.sin(a + ph)) * foot;
    return { c: V.add(pos, V.add(V.add(V.scale(R, i ? -0.05 : 0.05), V.scale(F, 0.025 + 0.11 * sw)), V.scale(S, -0.25 + 0.03 * sw))), r: 0.075 * (1 - p.fly) };
  });
  return { S, F, R, pos, knees, neck: V.add(pos, V.scale(S, NECK)) };
}
// The arms are never seen: they are two lines the cloth is held along in the air, where
// they open it into a wing and beat. On foot there are none.
function armsOf(p, B) {
  const a = 0.3 + p.flap, N = V.scale(B.F, -1);          // held in a shallow V, and beating about it
  const out = (side) => V.norm(V.add(V.add(V.scale(B.R, side * Math.cos(a)), V.scale(N, Math.sin(a))), V.scale(B.S, -0.5)));        // swept back a little, like a swallow's
  const wing = p.fly * p.spread;
  return [1, -1].map((side) => ({ side, dir: out(side), w: wing, from: V.add(B.neck, V.add(V.scale(B.R, side * 0.05), V.scale(B.S, -0.03))) }));
}

// The head rides on the collar; in the air it is lifted to look where it is going, and at
// the end it tips back to look at the sky.
const SKULL = 0.078;
function headOf(p, B) {
  let Sh = V.norm(V.add(B.S, [0, 0.7 * p.fly, 0]));
  const toward = V.lerp(B.F, V.add(B.S, V.scale(B.F, 0.3)), p.fly);
  let Fh = V.norm(V.sub(toward, V.scale(Sh, V.dot(toward, Sh))));
  if (p.raise > 0) { const a = 0.8 * p.raise, c = Math.cos(a), s = Math.sin(a); [Fh, Sh] = [V.add(V.scale(Fh, c), V.scale(Sh, s)), V.sub(V.scale(Sh, c), V.scale(Fh, s))]; }
  const Rh = V.cross(Sh, Fh);
  const hc = V.add(B.neck, V.scale(Sh, 0.064));          // low enough for the chin to sit in the collar
  return { Sh, Fh, Rh, hc, cap: [0, 1, 2].map((q) => hc[q] + Sh[q] * 0.012 - Fh[q] * 0.02) };
}

// ---- cloth ----------------------------------------------------------------------------
// A sheet cut as a ring: ns points round and nr from its inner edge, which is held, to its
// outer. fall(angle) is its length at that angle round (0 = in front); width(d) is the
// radius of the ring it is cut to at distance d from the held edge (cut wider than what it
// hangs on, it folds); `crease` is how hard it resists being folded.
function ringSheet({ ns, nr, fall, width, crease }) {
  const n = ns * nr, rho = new Float32Array(n), a = [], b = [], len = [], stiff = [];
  for (let i = 0; i < nr; i++) for (let j = 0; j < ns; j++) rho[i * ns + j] = (fall((TAU * j) / ns) * i) / (nr - 1);
  // The threads: each holds two points at the distance they have in the cloth laid flat.
  const link = (i, j, i2, dj, k) => {
    const p = i * ns + j, q = i2 * ns + ((j + dj + ns) % ns);
    a.push(p); b.push(q); stiff.push(k);
    len.push(Math.hypot(rho[q] - rho[p], ((width(rho[p]) + width(rho[q])) / 2) * ((dj * TAU) / ns)));
  };
  for (let i = 0; i < nr; i++) for (let j = 0; j < ns; j++) {
    if (i > 0) { link(i, j, i, 1, 1); link(i, j, i, 2, crease); }                                // round the ring, and against creasing
    if (i < nr - 1) { link(i, j, i + 1, 0, 1); link(i, j, i + 1, 1, 0.6); link(i, j, i + 1, -1, 0.6); }      // down the fall, and against shearing
    if (i < nr - 2) link(i, j, i + 2, 0, crease * 1.6);
  }
  return { ns, nr, n, rho, a: Int32Array.from(a), b: Int32Array.from(b), len: Float32Array.from(len), stiff: Float32Array.from(stiff), out: 0 };
}
// The cloak: just clear of the ground in front, on it at the sides, a long train behind.
// It is cut twice as wide as the form it hangs on, so it falls in folds.
const PLEATS = 11;
const CLOAK = ringSheet({ ns: 80, nr: 30, crease: 0.2, width: (d) => 0.085 + 0.3 * d,
  fall: (th) => 0.8 + 0.03 * (0.5 - 0.5 * Math.cos(2 * th)) + 0.3 * Math.pow((1 - Math.cos(th)) / 2, 1.8) });
// The cape over the shoulders: short, standing up a little round the chin, to a point behind.
const CAPE = ringSheet({ ns: 64, nr: 9, crease: 0.4, width: (d) => 0.056 + 0.6 * d,
  fall: (th) => 0.17 + 0.05 * (1 - Math.cos(th)) / 2 + 0.07 * Math.pow((1 - Math.cos(th)) / 2, 8) });
const HZ = 60, STEP = 1 / HZ, KEEP = 2, ITER = 5;       // the cloth's own clock; every KEEP-th state is stored
const per = (k96) => k96 ** (96 / HZ);                  // a loss per step, given as it was tuned at 96 steps a second
// The two columns of the cloak that the arms hold, out to where the hands are.
const SPARS = [0.25, 0.75].map((turn) => {
  const j = Math.round(CLOAK.ns * turn), list = [];
  for (let i = 1; i < CLOAK.nr && CLOAK.rho[i * CLOAK.ns + j] <= ARM; i++) list.push(i * CLOAK.ns + j);
  return list;
});

// Normals at every point of a grid of ns × nr points closed round, facing away from what it hangs on.
function normalsOf(ns, nr, sign, x, out) {
  out.fill(0);
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < ns; j++) {
    const a = (i * ns + j) * 3, b = (i * ns + ((j + 1) % ns)) * 3, c = ((i + 1) * ns + j) * 3, d = ((i + 1) * ns + ((j + 1) % ns)) * 3;
    const ux = x[d] - x[a], uy = x[d + 1] - x[a + 1], uz = x[d + 2] - x[a + 2], vx = x[c] - x[b], vy = x[c + 1] - x[b + 1], vz = x[c + 2] - x[b + 2];
    const nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz; out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz; out[d] += nx; out[d + 1] += ny; out[d + 2] += nz;
  }
  for (let o = 0; o < ns * nr * 3; o += 3) {
    const l = (Math.hypot(out[o], out[o + 1], out[o + 2]) || 1) * (sign || 1);
    out[o] /= l; out[o + 1] /= l; out[o + 2] /= l;
  }
}
// A sheet's points as they move: where they are, were, how fast, and which way they face.
// To begin with it hangs as a cone from its inner edge, already gathered into `pleats` folds.
function cloth(sh, at, F, R, S, open, drop, pleats = 0) {
  const st = { sh, x: new Float32Array(sh.n * 3), xp: new Float32Array(sh.n * 3), v: new Float32Array(sh.n * 3), nrm: new Float32Array(sh.n * 3) };
  for (let k = 0; k < sh.n; k++) {
    const th = (TAU * (k % sh.ns)) / sh.ns, c = Math.cos(th), s = Math.sin(th), r = sh.rho[k];
    const rad = (0.045 + r * open) * (1 + 0.12 * Math.cos(pleats * th) * Math.min(1, r * 6));
    for (let q = 0; q < 3; q++) st.x[k * 3 + q] = at[q] + (F[q] * c + R[q] * s) * rad - S[q] * r * drop;
  }
  if (!sh.out) {
    // Which way "away" is for the order the points are joined in: a point on the right should face right.
    normalsOf(sh.ns, sh.nr, 1, st.x, st.nrm);
    const o = ((sh.nr >> 1) * sh.ns + Math.round(sh.ns / 4)) * 3;
    sh.out = st.nrm[o] * R[0] + st.nrm[o + 1] * R[1] + st.nrm[o + 2] * R[2] < 0 ? -1 : 1;
  }
  return st;
}
// Weight and air move every free point. wind: the air's velocity; press: how hard it leans on the cloth's face.
function blow(st, t, g, wind, eddies, press, drag) {
  const { sh, x, xp, v, nrm } = st;
  normalsOf(sh.ns, sh.nr, sh.out, x, nrm);
  for (let k = sh.ns; k < sh.n; k++) {
    const o = k * 3, eddy = eddies * Math.sin(2.3 * t + x[o] * 2.1 + x[o + 2] * 1.7 + x[o + 1] * 3.0);
    const rx = wind[0] - v[o], ry = wind[1] + 0.3 * eddy - v[o + 1], rz = wind[2] + eddy - v[o + 2];
    const push = (rx * nrm[o] + ry * nrm[o + 1] + rz * nrm[o + 2]) * press;
    v[o] += (push * nrm[o] + rx * drag) * STEP; v[o + 1] += (g + push * nrm[o + 1] + ry * drag) * STEP; v[o + 2] += (push * nrm[o + 2] + rz * drag) * STEP;
    xp[o] = x[o]; xp[o + 1] = x[o + 1]; xp[o + 2] = x[o + 2];
    x[o] += v[o] * STEP; x[o + 1] += v[o + 1] * STEP; x[o + 2] += v[o + 2] * STEP;
  }
}
// One pass over the threads, pulling each pair of points back towards its length.
function relax(st) {
  const { sh, x } = st, { a, b, len, stiff, ns } = sh;
  for (let c = 0; c < a.length; c++) {
    const na = a[c], nb = b[c], oa = na * 3, ob = nb * 3;
    const dx = x[ob] - x[oa], dy = x[ob + 1] - x[oa + 1], dz = x[ob + 2] - x[oa + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const fa = na < ns ? 0 : 1, fb = nb < ns ? 0 : 1, k = (stiff[c] * (d - len[c])) / (d * (fa + fb));
    x[oa] += dx * k * fa; x[oa + 1] += dy * k * fa; x[oa + 2] += dz * k * fa;
    x[ob] -= dx * k * fb; x[ob + 1] -= dy * k * fb; x[ob + 2] -= dz * k * fb;
  }
}
// Cloth does not stretch: no point may be further from where its column is held than the
// cloth between them is long. (A few passes over the threads alone leave a fine sheet slack.)
function tether(st) {
  const { sh, x } = st, { ns, n, rho } = sh;
  for (let k = ns; k < n; k++) {
    const a = (k % ns) * 3, o = k * 3, reach = rho[k] * 1.02 + 0.004;
    const dx = x[o] - x[a], dy = x[o + 1] - x[a + 1], dz = x[o + 2] - x[a + 2], d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > reach * reach) { const m = reach / Math.sqrt(d2); x[o] = x[a] + dx * m; x[o + 1] = x[a + 1] + dy * m; x[o + 2] = x[a + 2] + dz * m; }
  }
}
// Keeps point o of x outside a ball.
function outside(x, o, c, r) {
  const dx = x[o] - c[0], dy = x[o + 1] - c[1], dz = x[o + 2] - c[2], d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < r * r) { const m = r / Math.max(Math.sqrt(d2), 1e-4) - 1; x[o] += dx * m; x[o + 1] += dy * m; x[o + 2] += dz * m; }
}
const settle = (st, keep) => { for (let o = st.sh.ns * 3; o < st.sh.n * 3; o++) st.v[o] = ((st.x[o] - st.xp[o]) / STEP) * keep; };

// ---- hair -----------------------------------------------------------------------------
// A bob, cut longer towards the face than at the nape, with a fringe down over the eyes.
// Every strand is a chain of HAIRN points rooted in the scalp. `rest` is how it lies when
// nothing moves it, in the head's own axes (right, up, forward) about the skull's centre:
// it flows away from a whorl at the back of the crown, round the skull, and hangs from
// where the skull turns under, turning in a little at the tip.
const HAIRN = 9;
const HAIR = (() => {
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const W = V.norm([0, 1, -0.3]), TOTAL = 920, rest = [], seg = [], rnd = [], wide = [], deep = [];
  for (let i = 0; i < TOTAL; i++) {
    const s = 1 - (2 * (i + 0.5)) / TOTAL, rad = Math.sqrt(1 - s * s), a = i * 2.399963;
    const d = [rad * Math.sin(a), s, rad * Math.cos(a)], az = Math.abs(Math.atan2(d[0], d[2]));
    if (d[1] < lerp(0.5, -0.3, ss(0.6, 1.5, az))) continue;                 // the hairline: high over the brow, low behind the ears
    const lay = hash(i + 0.37), fringe = ss(0.95, 0.6, az);
    const rho = SKULL + 0.002 + 0.011 * lay;                                // how far off the skull this strand lies: the hair has body
    const end = lerp(lerp(-0.094, -0.074, ss(1.2, 2.7, az)), -0.014, fringe) + (hash(i + 0.71) - 0.5) * 0.012;
    const cw = V.dot(d, W), phi0 = Math.acos(clamp(cw, -1, 1));
    if (phi0 < 0.12) continue;                                              // the whorl itself is bare: the strands part from it
    const e = V.norm(V.sub(d, V.scale(W, cw)));
    const pts = [V.scale(d, SKULL)], dl = 0.003;
    let p = pts[0], phi = phi0, hang = p[1] < 0.012;
    for (let guard = 0; guard < 500 && p[1] > end; guard++) {
      if (!hang) {
        phi += dl / SKULL;
        const r = lerp(SKULL, rho, ss(0, 0.9, phi - phi0));
        p = V.scale(V.add(V.scale(W, Math.cos(phi)), V.scale(e, Math.sin(phi))), r);
        hang = p[1] < 0.012 || phi > 2.2;
      } else {
        const h = Math.hypot(p[0], p[2]) || 1, turn = 0.04 + 0.3 * ss(end + 0.05, end, p[1]);
        p = V.add(p, V.scale(V.norm([(-p[0] / h) * turn, -1, (-p[2] / h) * turn]), dl));
      }
      pts.push(p);
    }
    let L = 0;
    const at = [0];
    for (let k = 1; k < pts.length; k++) { L += V.len(V.sub(pts[k], pts[k - 1])); at.push(L); }
    if (L < 0.035) continue;
    for (let k = 0, m = 0; k < HAIRN; k++) {
      const want = (L * k) / (HAIRN - 1);
      while (m < pts.length - 2 && at[m + 1] < want) m++;
      rest.push(...V.lerp(pts[m], pts[m + 1], clamp((want - at[m]) / Math.max(at[m + 1] - at[m], 1e-6))));
    }
    seg.push(L / (HAIRN - 1)); rnd.push(hash(i)); deep.push(1 - lay); wide.push(lerp(0.0065, 0.0098, hash(i + 0.19)) * lerp(1, 0.85, fringe));
  }
  return { count: seg.length, n: seg.length * HAIRN, rest: Float32Array.from(rest), seg, rnd, wide, deep };
})();
// The strands as they move. Each point is pulled back towards the way the hair was cut,
// hard near the root and hardly at all at the tip, so the head of hair keeps its shape and
// the ends are left to the air: they stream back in flight and swing on after a stop.
function strands(Hd) {
  const st = { x: new Float32Array(HAIR.n * 3), xp: new Float32Array(HAIR.n * 3), v: new Float32Array(HAIR.n * 3) };
  for (let k = 0; k < HAIR.n; k++) {
    const o = k * 3, r = HAIR.rest[o], s = HAIR.rest[o + 1], f = HAIR.rest[o + 2];
    for (let q = 0; q < 3; q++) st.x[o + q] = Hd.cap[q] + Hd.Rh[q] * r + Hd.Sh[q] * s + Hd.Fh[q] * f;
  }
  st.xp.set(st.x);
  return st;
}
const HOLD = per(0.985);
function comb(st, Hd, t, wind, eddies, shoulders) {
  const { x, xp, v } = st, { cap, Rh, Sh, Fh, hc } = Hd, rest = HAIR.rest;
  for (let s = 0; s < HAIR.count; s++) {
    const base = s * HAIRN, seg = HAIR.seg[s], ph = HAIR.rnd[s] * TAU;
    for (let i = 0; i < HAIRN; i++) {
      const o = (base + i) * 3, r = rest[o], up = rest[o + 1], f = rest[o + 2];
      const tx = cap[0] + Rh[0] * r + Sh[0] * up + Fh[0] * f, ty = cap[1] + Rh[1] * r + Sh[1] * up + Fh[1] * f, tz = cap[2] + Rh[2] * r + Sh[2] * up + Fh[2] * f;
      xp[o] = x[o]; xp[o + 1] = x[o + 1]; xp[o + 2] = x[o + 2];
      if (i === 0) { x[o] = tx; x[o + 1] = ty; x[o + 2] = tz; continue; }
      const u = i / (HAIRN - 1), drag = 2 + 4.5 * u;
      const g1 = eddies * Math.sin(2.3 * t + ph + 2 * u), g2 = eddies * Math.sin(3.7 * t + 1.7 * ph + 3 * u);
      v[o] += drag * (wind[0] + 0.6 * g1 - v[o]) * STEP;
      v[o + 1] += (-2.2 + drag * (wind[1] + 0.3 * g2 - v[o + 1])) * STEP;
      v[o + 2] += drag * (wind[2] + 0.6 * g2 - v[o + 2]) * STEP;
      x[o] += v[o] * STEP; x[o + 1] += v[o + 1] * STEP; x[o + 2] += v[o + 2] * STEP;
      const k = Math.min(0.6, ((10 + 54 * (1 - u) ** 3) * STEP) ** 2);      // a spring: slow at the tip, stiff at the root
      x[o] += (tx - x[o]) * k; x[o + 1] += (ty - x[o + 1]) * k; x[o + 2] += (tz - x[o + 2]) * k;
      for (let pass = 0; pass < 2; pass++) {
        const dx = x[o] - x[o - 3], dy = x[o + 1] - x[o - 2], dz = x[o + 2] - x[o - 1], m = seg / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6);
        x[o] = x[o - 3] + dx * m; x[o + 1] = x[o - 2] + dy * m; x[o + 2] = x[o - 1] + dz * m;
        if (pass) break;
        outside(x, o, cap, SKULL + 0.002);
        outside(x, o, hc, 0.066);
        outside(x, o, shoulders, 0.088);
      }
      v[o] = ((x[o] - xp[o]) / STEP) * HOLD; v[o + 1] = ((x[o + 1] - xp[o + 1]) / STEP) * HOLD; v[o + 2] = ((x[o + 2] - xp[o + 2]) / STEP) * HOLD;
    }
  }
}

// The cloak, the cape and the hair through one shot. at(t) gives the two stored states
// either side of t (cloak points, then cape, then hair) and how far t lies between them.
const SIZE = (CLOAK.n + CAPE.n + HAIR.n) * 3;
function clothFor(shot) {
  const lead = shot.pre ?? -1.5, t0 = lead - 3;
  // Before the shot's own keys begin, the traveller is taken to have been moving as it is
  // then; if it is standing then, to have just walked up, so that the train lies out behind it.
  const bodyAt = (t) => {
    if (t >= lead) return shot.figure(t);
    const p = shot.figure(lead), still = p.fly < 0.5 && V.len(p.vel) < 0.2;
    const vel = still ? V.scale([Math.sin(p.yaw), 0, Math.cos(p.yaw)], 0.5 * ss(0, 1.2, lead - t)) : p.vel;
    return { ...p, pos: V.add(p.pos, V.scale(vel, t - lead)), time: t };
  };
  const p0 = bodyAt(t0), B0 = frameOf(p0);
  const cloak = cloth(CLOAK, B0.neck, B0.F, B0.R, B0.S, 0.2, 0.95, PLEATS);
  const cape = cloth(CAPE, B0.neck, B0.F, B0.R, B0.S, 0.55, 0.75);
  const hair = strands(headOf(p0, B0));
  const keep = () => { const s = new Float32Array(SIZE); s.set(cloak.x); s.set(cape.x, CLOAK.n * 3); s.set(hair.x, (CLOAK.n + CAPE.n) * 3); return s; };
  const states = [keep()];
  let steps = 0;

  function step() {
    const t = t0 + steps * STEP, p = bodyAt(t), B = frameOf(p), { S, F, R, neck } = B, Hd = headOf(p, B);
    const gust = 0.55 + 0.45 * Math.sin(0.83 * t + 1.3 * Math.sin(0.31 * t));
    // As the head comes up at the end a wind gets up with it, across the traveller and a
    // little into its face, and does not quite die away.
    const stir = 1.8 * Math.sin(Math.PI * clamp(p.raise)) + 0.5 * p.raise, air = p.wind * (1 + stir);
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), gx = 1.3 * stir * (0.8 * cy - 0.6 * sy), gz = 1.3 * stir * (-0.8 * sy - 0.6 * cy);
    const wind = [0.95 * p.wind * gust + gx, 0.12 * air * Math.sin(1.9 * t) + 0.45 * stir, 0.3 * p.wind * Math.sin(0.67 * t + 1) + gz];
    // In flight the air carries most of the cloak's weight; the hair keeps its own.
    blow(cloak, t, -3.4 * (1 - 0.72 * p.fly), wind, 0.4 * p.wind + 0.3 * p.speed * p.fly, 7, 0.6);      // the faster it flies, the more the cloth flutters
    blow(cape, t, -3.4 * (1 - 0.5 * p.fly), wind, 0.3 * p.wind + 0.2 * p.speed * p.fly, 5, 0.8);
    // The collars go where the neck is: the cloak's gathered, the cape's a little higher, round the chin.
    for (let j = 0; j < CLOAK.ns; j++) {
      const th = (TAU * j) / CLOAK.ns, rad = 0.046 + 0.008 * Math.cos(PLEATS * th), c = Math.cos(th) * rad * 0.9, s = Math.sin(th) * rad;
      for (let q = 0; q < 3; q++) cloak.x[j * 3 + q] = neck[q] + F[q] * c + R[q] * s;
    }
    for (let j = 0; j < CAPE.ns; j++) {
      const th = (TAU * j) / CAPE.ns, c = Math.cos(th) * 0.05, s = Math.sin(th) * 0.055;
      for (let q = 0; q < 3; q++) cape.x[j * 3 + q] = neck[q] + S[q] * 0.016 + F[q] * c + R[q] * s;
    }
    const arms = armsOf(p, B), bell = ss(0, 0.6, p.fly);
    const top = V.add(neck, V.scale(S, -0.02)), span = NECK - 0.02 + HIP, shoulders = V.add(neck, V.scale(S, -0.085));
    // The ground, where there is one; it is let down out of the way while the traveller is below it.
    const near = p.floor ? ss(-0.9, -0.1, p.pos[1] - HIP - p.ground) : 0, floor = near > 0 ? p.ground - 3 * (1 - near) + 0.012 : -1e9;
    // What the cloth lies on. It is not a body: shoulders, and below them a bell that widens
    // to the ground, which the cloak (cut wider still) hangs round in folds. In the air the
    // bell closes to something thin and the cloth streams from the shoulders.
    const lie = (x, n0, n1, pad) => {
      for (let k = n0; k < n1; k++) {
        const o = k * 3, dx = x[o] - top[0], dy = x[o + 1] - top[1], dz = x[o + 2] - top[2];
        const along = -(dx * S[0] + dy * S[1] + dz * S[2]);
        if (along <= -0.01 || along >= span) continue;
        const u = along / span;
        let ar, af;
        if (u < 0.1) { const w = Math.sin((u / 0.1) * 1.5708); ar = lerp(0.052, 0.108, w); af = lerp(0.046, 0.074, w); }
        else { const w = ((u - 0.1) / 0.9) ** 0.85; ar = lerp(0.108, lerp(0.17, 0.05, bell), w); af = lerp(0.074, lerp(0.15, 0.045, bell), w); }
        const qr = dx * R[0] + dy * R[1] + dz * R[2], qf = dx * F[0] + dy * F[1] + dz * F[2], e = Math.hypot(qr / (ar + pad), qf / (af + pad));
        if (e < 1) {
          const m = 1 / Math.max(e, 0.08) - 1;
          x[o] += (R[0] * qr + F[0] * qf) * m; x[o + 1] += (R[1] * qr + F[1] * qf) * m; x[o + 2] += (R[2] * qr + F[2] * qf) * m;
        }
      }
    };
    for (let it = 0; it < ITER; it++) {
      relax(cloak);
      relax(cape);
      arms.forEach((arm, s) => {
        if (arm.w < 0.01) return;
        for (const k of SPARS[s]) for (let q = 0; q < 3; q++) cloak.x[k * 3 + q] += (arm.from[q] + arm.dir[q] * CLOAK.rho[k] - cloak.x[k * 3 + q]) * arm.w * 0.7;
      });
      tether(cloak);
      tether(cape);
      if (it < ITER - 3) continue;
      lie(cloak.x, CLOAK.ns, CLOAK.n, 0);
      lie(cape.x, CAPE.ns, CAPE.n, 0.014);
      const x = cloak.x, xp = cloak.xp;
      for (let k = CLOAK.ns; k < CLOAK.n; k++) {
        const o = k * 3;
        outside(x, o, Hd.cap, 0.084);
        if (B.knees[0].r > 0.01) { outside(x, o, B.knees[0].c, B.knees[0].r); outside(x, o, B.knees[1].c, B.knees[1].r); }
        if (x[o + 1] < floor) {
          x[o + 1] = floor;
          if (it === ITER - 1) { x[o] = lerp(xp[o], x[o], 0.5); x[o + 2] = lerp(xp[o + 2], x[o + 2], 0.5); }      // it drags
        }
      }
    }
    settle(cloak, per(0.992));
    settle(cape, per(0.985));
    comb(hair, Hd, t, wind, 0.5 * p.wind + 0.15 * p.speed * p.fly, shoulders);
    steps++;
    if (steps % KEEP === 0) states.push(keep());
  }
  return {
    at(t) {
      const u = Math.max(0, (t - t0) / (STEP * KEEP)), i = Math.floor(u);
      while (states.length < i + 2) step();
      return [states[i], states[i + 1], u - i];
    },
  };
}

// ---- drawing it -----------------------------------------------------------------------
const NAVY = hex('#22355E'), DUSK = hex('#2B2E6A'), LOCKS = hex('#6F7FC6'), TURQ = [0.39, 0.74, 0.78], PALE = [0.83, 0.93, 0.9], SKIN = hex('#F3E3D8');

export function createTraveller(materials) {
  const group = new THREE.Group();
  const geometry = (count, idx) => {
    const g = new THREE.BufferGeometry(), arr = { pos: new Float32Array(count * 3), nor: new Float32Array(count * 3), uv: new Float32Array(count * 2), dat: new Float32Array(count * 4), col: new Float32Array(count * 3) };
    g.setAttribute('position', new THREE.BufferAttribute(arr.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(arr.nor, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(arr.col, 3));
    g.setAttribute('aData', new THREE.BufferAttribute(arr.dat, 4));
    g.setAttribute('uv', new THREE.BufferAttribute(arr.uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, materials[0]);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    return { g, ...arr };
  };
  const midway = (a, b, c, d) => (9 * (b + c) - a - d) / 16;      // half-way along a smooth curve through four points

  // A sheet's mesh: twice as fine as the cloth each way, a smooth surface through its
  // points, with the first column repeated to close the ring.
  // uv: x round the ring, y from the held edge to the free one.
  const sheetMesh = (sh, id, extra, color) => {
    const fs = sh.ns * 2, fr = sh.nr * 2 - 1, cols = fs + 1, idx = [];
    for (let i = 0; i < fr - 1; i++) for (let j = 0; j < fs; j++) { const o = i * cols + j; idx.push(o, o + cols, o + 1, o + 1, o + cols, o + cols + 1); }
    const m = geometry(cols * fr, idx);
    for (let i = 0; i < fr; i++) for (let j = 0; j < cols; j++) {
      const o = i * cols + j;
      m.uv[o * 2] = j / fs; m.uv[o * 2 + 1] = i / (fr - 1);
      m.dat.set([K.CAPE + K.FIG, id, FACE.SHEET, extra], o * 4);
      m.col.set(color, o * 3);
    }
    const now = new Float32Array(sh.n * 3), tall = new Float32Array(sh.ns * fr * 3), fine = new Float32Array(fs * fr * 3), nrm = new Float32Array(fs * fr * 3);
    // Lays the mesh on the cloth as it is between two stored states.
    return (s0, s1, k, from) => {
      for (let o = 0; o < sh.n * 3; o++) now[o] = s0[from + o] + (s1[from + o] - s0[from + o]) * k;
      const { ns, nr } = sh;
      for (let i = 0; i < fr; i++) for (let j = 0; j < ns; j++) for (let q = 0; q < 3; q++) {
        const at = (r) => now[(r * ns + j) * 3 + q], h = i >> 1;
        let val = at(h);
        if (i & 1) val = midway(h > 0 ? at(h - 1) : 2 * at(0) - at(1), at(h), at(h + 1), h + 2 < nr ? at(h + 2) : 2 * at(nr - 1) - at(nr - 2));
        tall[(i * ns + j) * 3 + q] = val;
      }
      for (let i = 0; i < fr; i++) for (let j = 0; j < fs; j++) for (let q = 0; q < 3; q++) {
        const at = (c) => tall[(i * ns + ((c + ns) % ns)) * 3 + q], h = j >> 1;
        fine[(i * fs + j) * 3 + q] = j & 1 ? midway(at(h - 1), at(h), at(h + 1), at(h + 2)) : at(h);
      }
      normalsOf(fs, fr, sh.out, fine, nrm);
      for (let i = 0; i < fr; i++) for (let j = 0; j < cols; j++) {
        const a = (i * fs + (j % fs)) * 3, b = (i * cols + j) * 3;
        for (let q = 0; q < 3; q++) { m.pos[b + q] = fine[a + q]; m.nor[b + q] = nrm[a + q]; }
      }
      m.g.attributes.position.needsUpdate = true;
      m.g.attributes.normal.needsUpdate = true;
    };
  };
  const layCloak = sheetMesh(CLOAK, 0.5, 0, NAVY), layCape = sheetMesh(CAPE, 0.6, 1, DUSK);

  // The hair's mesh. Every strand is drawn as a lock that lies on the head like a long
  // leaf, widest a third of the way down and drawn to a point, and beside each lock run
  // FINE single hairs, a little off it, some lighter and some darker: they are what the
  // light picks out, and what leaves the head first when it moves.
  // uv: x across the lock, y from root to tip.
  const FN = HAIRN * 2 - 1, FINE = 2, PER = 1 + FINE;
  const layHair = (() => {
    const idx = [], hash = (n) => { const s = Math.sin(n * 91.7 + 17.3) * 43758.5453; return s - Math.floor(s); };
    for (let r = 0; r < HAIR.count * PER; r++) for (let i = 0; i < FN - 1; i++) { const o = (r * FN + i) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    const m = geometry(HAIR.count * PER * FN * 2, idx), kids = [];
    for (let s = 0; s < HAIR.count; s++) for (let c = 0; c < PER; c++) {
      const h = (q) => hash(s * 7 + c * 3 + q), light = h(0.4) > 0.6;
      // a fine hair: how far to the side of its lock and off it, where it ends, how wide
      kids.push(c ? { side: (h(0.1) - 0.5) * 3.2 * HAIR.wide[s], off: 0.0012 + 0.003 * h(0.2), cut: 0.8 + 0.2 * h(0.3), wide: 0.0011 + 0.0012 * h(0.5) } : null);
      for (let i = 0; i < FN; i++) for (let e = 0; e < 2; e++) {
        const o = ((s * PER + c) * FN + i) * 2 + e;
        m.uv[o * 2] = e; m.uv[o * 2 + 1] = i / (FN - 1);
        m.dat.set([K.SKIN + K.FIG, 0.7, FACE.SHEET, (c ? 1 : 0) + h(0.6) * 0.98], o * 4);
        // The colour is laid in from the crown and runs down the head as a wash would: violet-blue
        // at the top into turquoise and out to almost nothing at the cut, whatever lock it crosses.
        const at = (i / 2) | 0, up = lerp(HAIR.rest[(s * HAIRN + at) * 3 + 1], HAIR.rest[(s * HAIRN + Math.min(at + 1, HAIRN - 1)) * 3 + 1], (i & 1) / 2);
        const run = clamp((SKULL - up) / (SKULL + 0.094)) + 0.04 * (HAIR.rnd[s] - 0.5);
        m.col.set(V.scale(V.lerp(V.lerp(LOCKS, TURQ, ss(0.1, 0.6, run)), PALE, ss(0.62, 1.05, run)), c ? (light ? 1.22 : 0.8) : 1), o * 3);
      }
    }
    const P = new Float32Array(FN * 3), T = new Float32Array(FN * 3), O = new Float32Array(FN * 3), D = new Float32Array(FN * 3);
    return (s0, s1, k, from, cap) => {
      const pos = m.pos, nor = m.nor;
      for (let s = 0; s < HAIR.count; s++) {
        const base = from + s * HAIRN * 3, wide = HAIR.wide[s];
        const at = (i, q) => s0[base + i * 3 + q] + (s1[base + i * 3 + q] - s0[base + i * 3 + q]) * k;
        for (let i = 0; i < FN; i++) for (let q = 0; q < 3; q++) {
          const h = i >> 1;
          P[i * 3 + q] = i & 1 ? midway(h > 0 ? at(h - 1, q) : 2 * at(0, q) - at(1, q), at(h, q), at(h + 1, q), h + 2 < HAIRN ? at(h + 2, q) : 2 * at(HAIRN - 1, q) - at(HAIRN - 2, q)) : at(h, q);
        }
        // At every point of the strand: T across the lock, O away from the head, D the lock's own face.
        let sx = 1, sy = 0, sz = 0;
        for (let i = 0; i < FN; i++) {
          const a = Math.max(i - 1, 0) * 3, b = Math.min(i + 1, FN - 1) * 3, o = i * 3;
          let tx = P[b] - P[a], ty = P[b + 1] - P[a + 1], tz = P[b + 2] - P[a + 2], l = Math.hypot(tx, ty, tz) || 1;
          tx /= l; ty /= l; tz /= l;
          let ox = P[o] - cap[0], oy = P[o + 1] - cap[1], oz = P[o + 2] - cap[2];
          l = Math.hypot(ox, oy, oz) || 1; ox /= l; oy /= l; oz /= l;
          const cx = ty * oz - tz * oy, cy = tz * ox - tx * oz, cz = tx * oy - ty * ox, cl = Math.hypot(cx, cy, cz);
          if (cl > 0.2) { sx = cx / cl; sy = cy / cl; sz = cz / cl; }
          let fx = sy * tz - sz * ty, fy = sz * tx - sx * tz, fz = sx * ty - sy * tx;
          if (fx * ox + fy * oy + fz * oz < 0) { fx = -fx; fy = -fy; fz = -fz; }
          T[o] = sx; T[o + 1] = sy; T[o + 2] = sz; O[o] = ox; O[o + 1] = oy; O[o + 2] = oz;
          D[o] = fx * 0.6 + ox * 0.4; D[o + 1] = fy * 0.6 + oy * 0.4; D[o + 2] = fz * 0.6 + oz * 0.4;
        }
        for (let c = 0; c < PER; c++) {
          const kid = kids[s * PER + c], row = (s * PER + c) * FN;
          for (let i = 0; i < FN; i++) {
            const o = i * 3, v = i / (FN - 1);
            const w = kid ? kid.wide * (1 - ss(kid.cut - 0.35, kid.cut, v)) : wide * (0.55 + 0.45 * ss(0, 0.3, v)) * (1 - 0.93 * ss(0.5, 1, v) ** 1.4);
            const aside = kid ? kid.side * ss(0, 0.3, v) : 0, off = kid ? kid.off * ss(0, 0.2, v) : 0, lean = kid ? 0.2 : 0.45;
            for (let e = 0; e < 2; e++) {
              const sgn = e ? 1 : -1, vo = ((row + i) * 2 + e) * 3;
              for (let q = 0; q < 3; q++) {
                pos[vo + q] = P[o + q] + T[o + q] * (aside + sgn * w) + O[o + q] * off;
                nor[vo + q] = D[o + q] + T[o + q] * sgn * lean;
              }
            }
          }
        }
      }
      m.g.attributes.position.needsUpdate = true;
      m.g.attributes.normal.needsUpdate = true;
    };
  })();

  // The head under the hair: two plain balls, placed by their axes every frame.
  let made = 0;
  const part = (geom, color, kind, extra = 0) => {
    const mesh = new Builder(40 + made++).add(geom, { color, kind: kind + K.FIG, face: FACE.SMOOTH, extra }).mesh(materials[0]);
    group.add(mesh);
    return mesh;
  };
  const ball = () => new THREE.SphereGeometry(1, 28, 20);
  const face = part(ball(), SKIN, K.PALE, 8), crown = part(ball(), LOCKS, K.SKIN, 3);
  const place = (mesh, X, Y, Z, P) => {
    mesh.matrix.set(X[0], Y[0], Z[0], P[0], X[1], Y[1], Z[1], P[1], X[2], Y[2], Z[2], P[2], 0, 0, 0, 1);
    mesh.matrixWorldNeedsUpdate = true;
  };

  const cloths = new Map();
  // Poses the traveller as it is at shot-local time t.
  function update(shot, t) {
    let sim = cloths.get(shot.id);
    if (!sim) sim = clothFor(shot);
    cloths.delete(shot.id);
    cloths.set(shot.id, sim);
    if (cloths.size > 3) cloths.delete(cloths.keys().next().value);     // a shot's states are large; keep the last few
    const [s0, s1, k] = sim.at(t);
    const p = shot.figure(t), B = frameOf(p), { Sh, Fh, Rh, hc, cap } = headOf(p, B);
    layCloak(s0, s1, k, 0);
    layCape(s0, s1, k, CLOAK.n * 3);
    layHair(s0, s1, k, (CLOAK.n + CAPE.n) * 3, cap);
    // The sphere's own z is the way the face looks (see MESH_FRAG): nothing is drawn on it.
    place(face, V.scale(Rh, 0.06), V.scale(Sh, 0.066), V.scale(Fh, 0.058), hc);
    place(crown, V.scale(Rh, 0.074), V.scale(Sh, 0.073), V.scale(Fh, 0.074), cap);
  }

  return { group, update, tip: tipOf };
}

// The title as a mask: white where the night wash must leave the paper bare.
export function makeTitle(text) {
  const c = Object.assign(document.createElement('canvas'), { width: 2048, height: 256 });
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#fff';
  x.strokeStyle = '#fff';
  x.lineWidth = 3;                     // a brush reserve is a little fuller than type
  x.lineJoin = 'round';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '600 150px "Baskerville", "Cochin", "Hoefler Text", "Times New Roman", serif';
  x.letterSpacing = '46px';
  x.fillText(text, c.width / 2 + 23, c.height / 2 + 8);
  x.strokeText(text, c.width / 2 + 23, c.height / 2 + 8);
  return c;
}
