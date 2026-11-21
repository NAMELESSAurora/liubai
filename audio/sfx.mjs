// The film's sound, other than its music: made here, from the film's own motion.
//   node audio/sfx.mjs            → out/liubai-sfx.wav (48 kHz, stereo, float)
// Nothing is recorded or downloaded. Every sound is noise or a sine, shaped by what the
// eye is doing at that moment (shots.js: CAM, FLECK): how fast we go, whether we are on
// foot, when each foot falls, what we pass and on which side, where the fleck is.
//   air      the wind of our own going in the ears: louder and brighter with speed
//   cloth    the cloak we wear and never see: it flaps faster the faster we go, snaps when
//            we leap or turn hard, and stirs in the wind when we stand on the summit
//   feet     a fall for every stride: on paper, on stone, at a run, on rock
//   places   paper (the pencil that draws the line, the first drop), the ruin (air, a few
//            birds, columns going by), the lake (rain, water, the fleck skimming, lanterns),
//            the wood (leaves, trunks going by), the cloud (everything muffled), the tower
//            (high wind, cloth on the tower), the summit (wind in dry grass, then the calm
//            of the night)
// The music stops at 1:38; from there the wind carries the film.
import { writeFileSync } from 'node:fs';
import { CAM, FLECK, SHOTS, TOTAL } from '../src/shots.js';
import { RUINS, colX, PLACE } from '../src/layout.js';

const SR = 48000, N = TOTAL * SR, L = new Float32Array(N), R = new Float32Array(N);
const CR = 240, M = TOTAL * CR + 2, K = CR / SR;            // the eye is read 240 times a second
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const win = (a, b, x, e = 0.6) => ss(a - e, a + e, x) * (1 - ss(b - e, b + e, x));        // 1 between a and b, eased in and out
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const START = Object.fromEntries(SHOTS.map((s) => [s.id, s.start]));

// ---- what the eye is doing ------------------------------------------------------------
const c = Object.fromEntries(['v', 'vy', 'foot', 'gait', 'step', 'turn', 'x', 'y', 'z', 'fpan', 'fnear'].map((k) => [k, new Float32Array(M)]));
{
  let py = CAM(0).pos[1], pyaw = 0;
  for (let i = 0; i < M; i++) {
    const T = Math.min(TOTAL - 1e-3, i / CR), e = CAM(T), f = FLECK(T), yaw = Math.atan2(e.dir[0], e.dir[2]);
    const d = [f[0] - e.pos[0], f[1] - e.pos[1], f[2] - e.pos[2]], dist = Math.hypot(...d);
    c.v[i] = e.speed; c.foot[i] = e.foot; c.gait[i] = e.gait; c.step[i] = e.step; [c.x[i], c.y[i], c.z[i]] = e.pos;
    c.vy[i] = (e.pos[1] - py) * CR; py = e.pos[1];
    c.turn[i] = i ? Math.abs(Math.atan2(Math.sin(yaw - pyaw), Math.cos(yaw - pyaw))) * CR : 0; pyaw = yaw;
    c.fpan[i] = clamp((d[0] * Math.cos(yaw) - d[2] * Math.sin(yaw)) / Math.max(dist, 0.3), -1, 1);
    c.fnear[i] = 1 / (1 + (dist * dist) / 16);
  }
}
const ctl = (fn) => { const a = new Float32Array(M); for (let i = 0; i < M; i++) a[i] = fn(i / CR, i); return a; };
const when = (test, t0, t1) => { for (let i = Math.round(t0 * CR); i < t1 * CR; i++) if (test(i)) return i / CR; return null; };
// The places, as how much of each we are in at T (the joins of shots.js, by ear).
const inPaper = (T) => 1 - ss(12.4, 15, T), inRuins = (T) => win(13.5, 36.2, T, 1), inLake = (T) => win(36.3, 53.9, T, 0.8), inWood = (T) => win(53.9, 76.6, T, 0.7);
const inCloud = (T) => win(76.5, 78.25, T, 0.35), inTower = (T) => win(78.3, 98.2, T, 0.5), inGlide = (T) => win(98.2, 104.4, T, 0.8), onSummit = (T) => ss(104.2, 106, T);
const calm = (T) => 1 - ss(111.5, 117.5, T);                 // the night: the wind dies
const muffle = (T) => inCloud(T) + 0.75 * win(40.25, 40.95, T, 0.2);      // inside the cloud; under the jetty

// ---- two ways of making a sound ---------------------------------------------------------
// A bed: noise through a filter that follows `fc` (Hz) and `gain`, both read from the eye
// (arrays at the control rate). Two channels of different noise, so that it is wide.
// (v10: the user found v9's sound rough and loud. So: the noise is pink, not white; a bed goes
// through its filter twice, so that nothing fizzes above it; every event starts gently and
// is kept below 4 kHz; and the whole of it stands in a room, at the end of this file.)
const pink = () => { let b0 = 0, b1 = 0, b2 = 0; return (w) => { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return (b0 + b1 + b2 + w * 0.1848) * 0.22; }; };
function bed({ seed, gain, fc, q = 0.8, kind = 'band', pan = null, width = 1 }) {
  const rnd = [rng(seed), rng(seed + 977)], pk = [pink(), pink()], st = [[0, 0, 0, 0], [0, 0, 0, 0]], out = [L, R];
  let g = 0, k = 1 / q, a1 = 0, a2 = 0, a3 = 0;
  const pass = (s, o, w) => { const v3 = w - s[o + 1], v1 = a1 * s[o] + a2 * v3, v2 = s[o + 1] + a2 * s[o] + a3 * v3; s[o] = 2 * v1 - s[o]; s[o + 1] = 2 * v2 - s[o + 1]; return kind === 'low' ? v2 : kind === 'high' ? w - k * v1 - v2 : v1; };
  for (let n = 0; n < N; n++) {
    const x = n * K, i = x | 0, fr = x - i;
    if ((n & 31) === 0) { g = Math.tan((Math.PI * clamp(fc[i], 30, 9000)) / SR); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; }
    const amp = gain[i] + (gain[i + 1] - gain[i]) * fr;
    if (amp < 1e-5) continue;
    const p = pan ? pan[i] : 0, m = pk[0](rnd[0]() * 2 - 1);
    for (let ch = 0; ch < 2; ch++) {
      const w = ch ? m * (1 - width) + pk[1](rnd[1]() * 2 - 1) * width : m;
      out[ch][n] += pass(st[ch], 2, pass(st[ch], 0, w)) * amp * 2.2 * (ch ? 1 + p : 1 - p);
    }
  }
}
// An event: a burst of filtered noise that dies away (and may sweep), with, if wanted, a
// sine that slides from one pitch to another under it.
const er = rng(4242);
function hit(T, { dur = 0.08, gain = 0.2, f0 = 1000, f1 = f0, q = 1, kind = 'band', pan = 0, attack = 0.004, shape = 4, tone = null }) {
  if (T == null || T < 0 || T > TOTAL - dur) return;
  // Gentler than asked for: a slower start, a little longer, nothing above 4 kHz, no bare high-pass, and softer tones.
  attack = Math.max(attack, 0.009); dur *= 1.25; f0 = Math.min(f0, 4000) * 0.8; f1 = Math.min(f1, 4000) * 0.8; q = Math.min(q, 1.4); gain *= 1.7;
  if (kind === 'high') { kind = 'band'; gain *= 0.5; }
  if (tone) tone = { ...tone, gain: tone.gain * 0.6 };
  const pk = pink();
  const n0 = Math.round(T * SR), len = Math.round(dur * SR), k = 1 / q, s = [0, 0];
  let g = 0, a1 = 0, a2 = 0, a3 = 0, ph = 0;
  const gl = gain * (1 - pan * 0.7), gr = gain * (1 + pan * 0.7);
  for (let n = 0; n < len; n++) {
    const u = n / len, t = n / SR;
    if ((n & 15) === 0) { g = Math.tan((Math.PI * clamp(f0 * (f1 / f0) ** u, 30, 16000)) / SR); a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; }
    const w = pk(er() * 2 - 1), v3 = w - s[1], v1 = a1 * s[0] + a2 * v3, v2 = s[1] + a2 * s[0] + a3 * v3;
    s[0] = 2 * v1 - s[0]; s[1] = 2 * v2 - s[1];
    const at = Math.min(1, t / attack), env = at * at * (3 - 2 * at) * Math.exp(-shape * u) * (1 - u);
    let y = (kind === 'low' ? v2 : kind === 'high' ? w - k * v1 - v2 : v1) * env;
    if (tone) { ph += (2 * Math.PI * tone.f0 * (tone.f1 / tone.f0) ** Math.min(1, t / (tone.dur || dur))) / SR; y += Math.sin(ph) * tone.gain * Math.min(1, t / 0.008) * Math.exp(-t / ((tone.dur || dur) * 0.35)); }
    L[n0 + n] += y * gl; R[n0 + n] += y * gr;
  }
}
// A swell: a bed that exists only for a while.
const swell = (a, b, peak, T, e = (b - a) * 0.45) => peak * win(a + e, b - e, T, e);

// ---- air: the wind of our own going ----------------------------------------------------
const gust = (() => { const r = rng(7), a = new Float32Array(M); let x = 0, y = 0; for (let i = 0; i < M; i++) { x += (r() - 0.5) * 0.02 - x * 0.004; y += (x - y) * 0.02; a[i] = y; } const mx = Math.max(...a.map(Math.abs)); return a.map((v) => v / mx); })();
const sp = ctl((T, i) => clamp(c.v[i] / 14, 0, 1.4));
bed({ seed: 11, kind: 'low', q: 0.75, width: 1,                // (a low-pass: wind in the ears is a roar, not a hiss)
  gain: ctl((T, i) => 0.6 * sp[i] ** 1.6 * (1 + 0.35 * gust[i]) * (1 - 0.5 * muffle(T))),
  fc: ctl((T, i) => (260 + 800 * sp[i]) * (1 + 0.25 * gust[i]) * (1 - 0.65 * muffle(T))) });
bed({ seed: 12, kind: 'band', q: 0.6, width: 1,                // the edge of it, when we are really fast
  gain: ctl((T, i) => 0.02 * ss(0.55, 1.1, sp[i]) * (1 - muffle(T))), fc: ctl(() => 2200) });
bed({ seed: 13, kind: 'low', q: 0.9, width: 0.6,               // its weight: a low rush, and the turn of a bank
  gain: ctl((T, i) => 0.3 * sp[i] ** 2 + 0.08 * clamp(c.turn[i] / 2.5) * sp[i]), fc: ctl((T, i) => 110 + 120 * sp[i]) });

// ---- cloth: the cloak ----------------------------------------------------------------------
{
  // How hard the air pulls at it: our own speed, a hard turn, and the wind of the high places when we are slow.
  const pull = ctl((T, i) => clamp(sp[i] ** 1.2 + 0.25 * clamp(c.turn[i] / 3) * sp[i] + (1 - sp[i]) * (0.16 * inTower(T) + 0.34 * onSummit(T) * (0.25 + 0.75 * calm(T))) * (1 + 0.5 * gust[i]), 0, 1.3));
  const r = rng(21);
  let T = 13.2;
  while (T < TOTAL - 1.5) {
    const i = Math.round(T * CR), p = pull[i] * (1 - 0.7 * muffle(T));
    if (p > 0.035) {
      const big = r() < 0.2 ? 1.6 : 1;
      hit(T, { dur: 0.12 + 0.14 * r() * big, gain: 0.24 * p ** 1.1 * big * (0.6 + 0.6 * r()), f0: 380 + 1100 * r() * (0.5 + p), f1: 200 + 220 * r(), q: 0.7, kind: 'band', pan: (r() - 0.5) * 1.2, attack: 0.016, shape: 4,
        tone: big > 1 ? { f0: 120, f1: 60, gain: 0.06 * p, dur: 0.12 } : null });
    }
    T += (0.09 + 0.6 * r() ** 2) / (0.35 + 1.7 * Math.max(p, 0.03));      // faster the harder it is pulled, never even
  }
  bed({ seed: 22, kind: 'band', q: 0.6, width: 1, gain: ctl((T, i) => 0.06 * pull[i] ** 1.3), fc: ctl((T, i) => 1400 + 1800 * pull[i]) });      // the run of it between the flaps
}

// ---- feet --------------------------------------------------------------------------------
{
  const r = rng(31);
  let last = Math.floor(c.step[0] / Math.PI), side = 1;
  for (let i = 1; i < M; i++) {
    const n = Math.floor(c.step[i] / Math.PI), T = i / CR;
    if (n === last) continue;
    last = n; side = -side;
    const g = clamp(c.gait[i] / 1.3), run = clamp(c.gait[i] - 1);
    if (g < 0.2) continue;
    const pan = 0.25 * side;
    if (T < 12.8) {                                             // on the sheet: a soft tap, and the paper giving
      hit(T, { dur: 0.06, gain: 0.2 * g, f0: 1900 + 700 * r(), f1: 900, q: 0.8, pan, shape: 6 });
      hit(T, { dur: 0.09, gain: 0.14 * g, f0: 160, f1: 90, q: 0.9, kind: 'low', pan, shape: 5 });
    } else if (T < 60) {                                        // on stone: the heel, then the grit under it; harder at a run
      hit(T, { dur: 0.07, gain: (0.24 + 0.3 * run) * g, f0: 950 + 400 * r(), f1: 380, q: 0.9, pan, shape: 6, tone: { f0: 150, f1: 70, gain: 0.07 + 0.12 * run, dur: 0.07 } });
      hit(T + 0.018, { dur: 0.1 + 0.04 * run, gain: (0.07 + 0.1 * run) * g, f0: 4200, f1: 2400, q: 0.6, kind: 'high', pan, shape: 5 });
    } else {                                                    // on the mountain: rock and loose stone
      hit(T, { dur: 0.09, gain: 0.26 * g, f0: 700 + 300 * r(), f1: 300, q: 0.8, pan, shape: 5, tone: { f0: 120, f1: 60, gain: 0.08, dur: 0.08 } });
      hit(T + 0.02, { dur: 0.16, gain: 0.09 * g, f0: 3000, f1: 1500, q: 0.5, pan, shape: 4 });
    }
    hit(T + 0.06, { dur: 0.12, gain: 0.035 * g, f0: 2600, f1: 1500, q: 0.6, pan: -pan, shape: 3 });       // and the cloth, at every stride
  }
  // Leaving the ground: the last stride pushes off, the cloak snaps out. Coming down on the mountain: both feet, and the cloak settling.
  const off = when((i) => c.foot[i] < 0.5 && c.foot[i - 1] >= 0.5, 20, 40), down = when((i) => c.foot[i] > 0.5 && c.foot[i - 1] <= 0.5, 100, 110);
  hit(off - 0.05, { dur: 0.16, gain: 0.5, f0: 500, f1: 150, q: 0.8, kind: 'low', shape: 5, tone: { f0: 110, f1: 50, gain: 0.25, dur: 0.14 } });
  hit(off, { dur: 0.7, gain: 0.5, f0: 300, f1: 2600, q: 0.8, attack: 0.25, shape: 2.2 });
  for (const d of [0.1, 0.19, 0.3, 0.46]) hit(off + d, { dur: 0.12, gain: 0.38, f0: 1900, f1: 400, q: 0.7, pan: (r() - 0.5), shape: 5 });
  hit(down, { dur: 0.22, gain: 0.6, f0: 420, f1: 110, q: 0.8, kind: 'low', shape: 5, tone: { f0: 95, f1: 45, gain: 0.3, dur: 0.18 } });
  hit(down + 0.02, { dur: 0.3, gain: 0.2, f0: 3200, f1: 1200, q: 0.5, shape: 4 });
  for (const d of [0.1, 0.24, 0.45, 0.8]) hit(down + d, { dur: 0.16, gain: 0.3 / (1 + 3 * d), f0: 1500, f1: 350, q: 0.7, pan: (r() - 0.5), shape: 4 });
  console.log('leaves the ground', off?.toFixed(2), 'comes down', down?.toFixed(2));
}

// ---- 1 paper: the pencil, and the first drop ------------------------------------------------
{
  const grain = (() => { const r = rng(41), a = new Float32Array(M); let x = 0; for (let i = 0; i < M; i++) { if (i % 3 === 0) x = 0.45 + 0.55 * r(); a[i] = x; } return a; })();      // graphite catches on the tooth of the paper
  const drawn = (T) => { const k = clamp((T - 3.0) / 5.8), e = 0.02; const f = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2); return (f(Math.min(1, k + e)) - f(Math.max(0, k - e))) / (2 * e); };      // how fast the line is being drawn
  bed({ seed: 42, kind: 'band', q: 1.4, width: 0.4, pan: c.fpan,
    gain: ctl((T, i) => 0.16 * Math.min(1, drawn(T) / 1.6) * grain[i] * (0.35 + 0.65 * c.fnear[i]) * win(3.0, 8.8, T, 0.1)), fc: ctl((T, i) => 3100 + 1400 * grain[i]) });
  hit(8.82, { dur: 0.25, gain: 0.07, f0: 2500, f1: 5000, q: 1, shape: 3 });                             // it lifts off the paper
  hit(10.6, { dur: 0.05, gain: 0.25, f0: 2800, f1: 900, q: 1.2, shape: 6, tone: { f0: 1050, f1: 420, gain: 0.3, dur: 0.07 } });       // the drop
  hit(10.66, { dur: 0.12, gain: 0, tone: { f0: 620, f1: 880, gain: 0.12, dur: 0.1 } });
  bed({ seed: 43, kind: 'band', q: 0.6, width: 1, gain: ctl((T) => swell(11.9, 16.5, 0.11, T)), fc: ctl((T) => 250 + 900 * ss(12, 16, T)) });       // the world being drawn, outwards
  bed({ seed: 44, kind: 'low', q: 0.7, width: 1, gain: ctl((T) => 0.035 * inPaper(T) * ss(0, 1.5, T)), fc: ctl(() => 300) });                      // the room the sheet lies in
}

// ---- 2 the ruin ----------------------------------------------------------------------------
{
  const r = rng(51);
  bed({ seed: 52, kind: 'band', q: 0.5, width: 1, gain: ctl((T, i) => 0.045 * inRuins(T) * (1 + 0.6 * gust[i])), fc: ctl((T, i) => 420 + 260 * gust[i]) });      // open air among stone
  bed({ seed: 53, kind: 'high', q: 0.7, width: 1, gain: ctl((T, i) => 0.012 * inRuins(T) * (1 + gust[i])), fc: ctl(() => 5200) });                              // grass
  const chirp = (T, pan, f = 3200 + 1500 * r()) => { for (let k = 0, n = 2 + Math.floor(r() * 3); k < n; k++) hit(T + k * (0.07 + 0.03 * r()), { dur: 0.06, gain: 0, pan, tone: { f0: f * (1 + 0.25 * r()), f1: f * (0.8 + 0.5 * r()), gain: 0.035, dur: 0.05 } }); };
  for (const T of [15.4, 17.9, 18.3, 21.2, 23.0]) chirp(T, r() * 1.6 - 0.8);
  // The first colour: the fleck goes into the stone like a drop into water, and the colour runs out.
  hit(START.ruins + 10.875, { dur: 0.06, gain: 0.2, f0: 2400, f1: 800, q: 1.2, shape: 6, tone: { f0: 880, f1: 330, gain: 0.3, dur: 0.09 } });
  bed({ seed: 54, kind: 'band', q: 0.7, width: 1, gain: ctl((T) => swell(24.45, 27.6, 0.16, T, 1.2)), fc: ctl((T) => 180 + 700 * ss(24.5, 27.5, T)) });
  hit(25.0, { dur: 0.5, gain: 0.16, f0: 700, f1: 4200, q: 1, attack: 0.2, shape: 2.5 });                 // it comes up out of the stone
  // The birds go up off the roof.
  const up = START.ruins + 13.2;
  for (let k = 0; k < 26; k++) hit(up + k * 0.062 + 0.02 * r(), { dur: 0.05, gain: 0.16 * Math.exp(-k / 12), f0: 1500 + 900 * r(), f1: 700, q: 0.8, pan: 0.1 + 0.03 * k, shape: 5 });
  for (const d of [0.1, 0.4, 0.75, 1.3]) chirp(up + d, 0.2 + 0.3 * d, 3600);
  // Columns: each one we go between or past says so, on its own side.
  for (let k = 14; k <= 23; k++) {
    const T = when((i) => c.x[i] >= colX(k), 27, 32);
    if (T) for (const pan of k < 16 || k > 21 ? [k % 2 ? 0.7 : -0.7] : [-0.8, 0.8]) hit(T - 0.05, { dur: 0.16, gain: 0.26, f0: 500, f1: 1700, q: 1.1, pan, attack: 0.05, shape: 3 });
  }
  // The great arch, and the arch of the aqueduct: a hollow pass, the air shut in for a moment.
  for (const [z, g] of [[RUINS.arch.z, 0.5], [RUINS.aqueduct.z + 1.5, 0.42]]) {
    const T = when((i) => c.z[i] >= z && c.x[i] > 55, 31, 38);
    hit(T - 0.25, { dur: 0.75, gain: g, f0: 240, f1: 520, q: 2.2, attack: 0.22, shape: 2.6 });
    hit(T - 0.1, { dur: 0.5, gain: g * 0.5, f0: 900, f1: 2600, q: 0.9, attack: 0.12, shape: 3 });
  }
}

// ---- 3 the lake ------------------------------------------------------------------------------
{
  const r = rng(61), rain = ctl((T) => inLake(T) * (0.55 + 0.45 * win(41.5, 46, T, 1.5)) * (1 - 0.7 * ss(47, 53.5, T)));
  bed({ seed: 62, kind: 'high', q: 0.6, width: 1, gain: ctl((T, i) => 0.05 * rain[i] * (1 - 0.6 * muffle(T))), fc: ctl((T) => 4200 * (1 - 0.6 * muffle(T))) });      // the rain itself
  bed({ seed: 63, kind: 'band', q: 0.6, width: 1, gain: ctl((T, i) => 0.03 * rain[i]), fc: ctl(() => 1500) });                                            // rain on the water
  bed({ seed: 64, kind: 'low', q: 0.8, width: 0.8, gain: ctl((T, i) => 0.06 * inLake(T) * (0.6 + 0.4 * Math.sin(T * 1.9) * Math.sin(T * 0.53))), fc: ctl(() => 240) });     // the lake against the posts
  for (let T = 36.2; T < 54; T += 0.1 + 0.4 * r() ** 2) if (r() < rain[Math.round(T * CR)]) hit(T, { dur: 0.05, gain: 0.012 + 0.02 * r(), f0: 2500 + 4000 * r(), q: 3, pan: r() * 2 - 1, shape: 6 });      // single drops
  // The fleck on the water: a small sound each time it touches, and a larger one where the colour falls.
  const lake = SHOTS.find((s) => s.id === 'lake');
  for (let t = 4.5; t <= 10.5; t += 0.3) if (lake.W(t)[1] < 0.5) { const i = Math.round((lake.start + t) * CR); hit(lake.start + t, { dur: 0.05, gain: 0.05 * c.fnear[i] + 0.02, f0: 3000, f1: 1200, q: 1.5, pan: c.fpan[i], shape: 6, tone: { f0: 1250 + 300 * r(), f1: 640, gain: 0.07 * (0.3 + c.fnear[i]), dur: 0.05 } }); }
  hit(lake.start + 10.6, { dur: 0.1, gain: 0.2, f0: 2200, f1: 600, q: 1.2, shape: 5, tone: { f0: 760, f1: 300, gain: 0.3, dur: 0.11 } });
  bed({ seed: 65, kind: 'band', q: 0.7, width: 1, gain: ctl((T) => swell(45.6, 49.5, 0.12, T, 1.5)), fc: ctl((T) => 300 + 1200 * ss(45.6, 49.5, T)) });       // the colour, going out over the water and up
  // Lanterns as they light: glass, very small.
  for (const T of [37.8, 41.7, 42.95, 43.75, 44.6]) hit(T, { dur: 0.05, gain: 0.02, f0: 3000, q: 1.2, pan: r() - 0.5, shape: 6, tone: { f0: 1560, f1: 1540, gain: 0.03, dur: 0.4 } });
  // The three piles of the channel, each on its side; the spray as we go by.
  [[8.75, -0.8], [9.55, 0.8], [10.35, -0.8]].forEach(([t, pan]) => { hit(lake.start + t - 0.08, { dur: 0.22, gain: 0.34, f0: 420, f1: 1500, q: 1.1, pan, attack: 0.07, shape: 3 }); hit(lake.start + t, { dur: 0.3, gain: 0.12, f0: 5000, f1: 2500, q: 0.6, kind: 'high', pan, shape: 3 }); });
  // The two towers we go between: stone close on both sides.
  hit(lake.start + 15.7, { dur: 1.2, gain: 0.2, f0: 300, f1: 420, q: 2, attack: 0.5, shape: 2 });
}

// ---- 4 the wood --------------------------------------------------------------------------------
{
  const r = rng(71), wood = SHOTS.find((s) => s.id === 'forest');
  bed({ seed: 72, kind: 'band', q: 0.5, width: 1, gain: ctl((T, i) => inWood(T) * (0.035 + 0.1 * sp[i] + 0.03 * gust[i])), fc: ctl((T, i) => 3200 + 1600 * sp[i]) });      // leaves: a hush that rises as we tear through them
  bed({ seed: 73, kind: 'low', q: 0.7, width: 1, gain: ctl((T) => 0.03 * inWood(T)), fc: ctl(() => 280) });
  // The trunks that stand in the lane: each goes by close, on the side we leave it.
  for (let k = 0; k < 8; k++) { const T = wood.start + 0.75 + 0.96 * k, pan = k % 2 ? -0.85 : 0.85; hit(T - 0.11, { dur: 0.3, gain: 0.42, f0: 300, f1: 1300, q: 1.2, pan, attack: 0.1, shape: 3 }); hit(T - 0.02, { dur: 0.18, gain: 0.12, f0: 2600, f1: 4500, q: 0.7, pan, shape: 4 }); }
  // Each crown as it goes red: a breath of leaves.
  const blooms = Array.from({ length: 8 }, (_, k) => wood.world.uBlooms[k * 4 + 3]);
  for (const t of blooms) if (t > -1 && t < 12) hit(wood.start + t, { dur: 0.9, gain: 0.1, f0: 2200, f1: 5200, q: 0.6, pan: -0.5 + r() * 0.3, attack: 0.3, shape: 2.5 });
  // Under the tree: toadstools lighting as the fleck goes over them; a bird; leaves coming down.
  for (let k = 0; k < 11; k++) hit(64.5 + 0.21 * k + 0.05 * r(), { dur: 0.05, gain: 0, pan: Math.sin(k * 1.3) * 0.6, tone: { f0: 520 + 40 * r(), f1: 380, gain: 0.05, dur: 0.06 } });
  for (const T of [67.2, 69.8, 70.4]) for (let k = 0; k < 3; k++) hit(T + k * 0.09, { dur: 0.06, gain: 0, pan: r() - 0.5, tone: { f0: 3900 + 500 * r(), f1: 3100, gain: 0.03, dur: 0.05 } });
  for (let T = 66; T < 76; T += 0.4 + 0.9 * r()) hit(T, { dur: 0.07, gain: 0.012 + 0.015 * ss(72, 75, T), f0: 4500 + 2500 * r(), q: 1.5, kind: 'high', pan: r() * 2 - 1, shape: 5 });
  hit(wood.start + 17.7, { dur: 1.6, gain: 0.22, f0: 1800, f1: 5200, q: 0.5, attack: 0.5, shape: 2 });      // it goes into the crown, and the leaves come down
}

// ---- the cloud, the tower, the glide ------------------------------------------------------------
{
  const r = rng(81);
  bed({ seed: 82, kind: 'low', q: 0.6, width: 1, gain: ctl((T) => 0.2 * inCloud(T)), fc: ctl(() => 220) });                      // inside the cloud: only the low of the air
  hit(78.3, { dur: 1.4, gain: 0.34, f0: 250, f1: 3000, q: 0.6, attack: 0.3, shape: 2.2 });                       // out of the top of it: everything opens
  // High air round the tower: a wind with a thin voice in it.
  bed({ seed: 83, kind: 'band', q: 0.5, width: 1, gain: ctl((T, i) => (0.07 * inTower(T) + 0.05 * inGlide(T)) * (1 + 0.7 * gust[i])), fc: ctl((T, i) => 520 + 380 * gust[i]) });
  bed({ seed: 84, kind: 'band', q: 3, width: 0.9, gain: ctl((T, i) => (0.004 * inTower(T) + 0.005 * inGlide(T)) * clamp(0.5 + gust[i])), fc: ctl((T, i) => 1100 + 350 * gust[i]) });      // (it was a whistle; now only a colour in the wind)
  // Up the stair: its lanterns and windows as they light, one after another.
  for (let T = 81.0; T < 86.6; T += 0.84 + 0.15 * r()) hit(T, { dur: 0.05, gain: 0.015, f0: 3000, q: 1.2, pan: -0.5 + 0.3 * r(), shape: 6, tone: { f0: 1400 + 500 * r(), f1: 1380, gain: 0.022, dur: 0.35 } });
  // The cloth on the tower: the banners as we go up past them, the long pennant at the top, and again as we glide by.
  for (const [a, b, g] of [[84.5, 86.5, 0.1], [86.8, 90.5, 0.2], [99.6, 101.2, 0.22]]) for (let T = a; T < b; T += 0.07 + 0.2 * r()) hit(T, { dur: 0.1 + 0.08 * r(), gain: g * win(a, b, T, 0.5) * (0.5 + r()), f0: 700 + 1500 * r(), f1: 300, q: 0.7, pan: -0.6 + 0.5 * r(), shape: 4 });
  hit(100.2, { dur: 1.4, gain: 0.2, f0: 260, f1: 520, q: 1.6, pan: -0.6, attack: 0.6, shape: 2 });              // the tower itself, going by on our left
  // The gold reaches the top; then the music stops, and the cloud opens.
  bed({ seed: 85, kind: 'band', q: 0.7, width: 1, gain: ctl((T) => swell(96.6, 99.4, 0.1, T, 1.1) + swell(98.0, 101.5, 0.12, T, 1.4)), fc: ctl((T) => 600 + 2200 * ss(96.6, 98, T) - 1900 * ss(98.1, 101, T)) });
}

// ---- 6 the summit ---------------------------------------------------------------------------
{
  const r = rng(91);
  bed({ seed: 92, kind: 'band', q: 0.5, width: 1, gain: ctl((T, i) => 0.16 * onSummit(T) * (0.2 + 0.8 * calm(T)) * (1 + 0.6 * gust[i])), fc: ctl((T, i) => 380 + 260 * gust[i]) });      // the wind over the shoulder of the mountain
  bed({ seed: 93, kind: 'high', q: 0.6, width: 1, gain: ctl((T, i) => 0.03 * onSummit(T) * calm(T) * clamp(0.6 + gust[i])), fc: ctl(() => 5600) });                             // in the dry grass
  hit(108.5, { dur: 0.9, gain: 0.12, f0: 900, f1: 4800, q: 0.9, attack: 0.3, shape: 2.5 });                      // the fleck leaves the cairn
  bed({ seed: 94, kind: 'band', q: 0.8, width: 1, gain: ctl((T) => swell(110.9, 116.5, 0.11, T, 2)), fc: ctl((T) => 500 + 1500 * ss(111, 113, T) - 1300 * ss(113, 117, T)) });      // it swells: the night goes out from it like a breath
  bed({ seed: 95, kind: 'low', q: 0.7, width: 1, gain: ctl((T) => 0.03 * ss(113, 116, T) * (1 - ss(117.3, 118.8, T))), fc: ctl(() => 200) });      // the night itself: very little
  for (let k = 0; k < 7; k++) hit(111.1 + 0.55 * k, { dur: 0.04, gain: 0.03, f0: 8000, q: 2, kind: 'high', pan: -0.7 + 0.2 * k, shape: 6, tone: { f0: 2100 + 160 * k, f1: 2080 + 160 * k, gain: 0.014, dur: 0.5 } });      // our stars, lighting one by one
}

// ---- out -------------------------------------------------------------------------------------
// The whole of it stands in a room: a soft reverberation, darker than what feeds it, so that
// nothing is dry and near. Then: nothing below 30 Hz, a gentle roll-off above 5 kHz, nothing
// sudden at either end, and (since there is no music under it from 1:38) the wind a little
// forward from there.
{
  const combs = [1557, 1617, 1491, 1422, 1277, 1356], alls = [225, 556, 441], wet = 0.2, fb = 0.84, damp = 0.35;
  for (const [buf, spread] of [[L, 0], [R, 23]]) {
    const dry = Float32Array.from(buf), acc = new Float32Array(N);
    for (const len0 of combs) {
      const len = Math.round((len0 + spread) * SR / 44100), d = new Float32Array(len); let i = 0, lp = 0;
      for (let n = 0; n < N; n++) { const y = d[i]; lp = y * (1 - damp) + lp * damp; d[i] = dry[n] + lp * fb; acc[n] += y; if (++i === len) i = 0; }
    }
    for (const len0 of alls) {
      const len = Math.round((len0 + spread) * SR / 44100), d = new Float32Array(len); let i = 0;
      for (let n = 0; n < N; n++) { const x = acc[n], y = d[i]; d[i] = x + y * 0.5; acc[n] = y - x * 0.5; if (++i === len) i = 0; }
    }
    for (let n = 0; n < N; n++) buf[n] = dry[n] * (1 - wet * 0.5) + acc[n] * wet * 0.16;
  }
}
let pl = 0, pr = 0, xl = 0, xr = 0, peak = 0, ll = 0, lr = 0, ll2 = 0, lr2 = 0;
const top = 1 - Math.exp((-2 * Math.PI * 5200) / SR);
for (let n = 0; n < N; n++) {
  const T = n / SR, e = ss(0, 0.5, T) * (1 - ss(TOTAL - 1.6, TOTAL - 0.5, T)) * (1 + 0.5 * ss(97.6, 100, T));
  const l = L[n], r = R[n];
  pl = 0.996 * (pl + l - xl); xl = l; pr = 0.996 * (pr + r - xr); xr = r;
  ll += (pl - ll) * top; ll2 += (ll - ll2) * top; lr += (pr - lr) * top; lr2 += (lr - lr2) * top;
  L[n] = 1.1 * Math.tanh((ll2 * e) / 1.1); R[n] = 1.1 * Math.tanh((lr2 * e) / 1.1);          // a ceiling that bends: one loud footfall must not set the level of everything
  peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
}
const hdr = Buffer.alloc(44), body = Buffer.alloc(N * 8), g = 0.9 / peak;
for (let n = 0; n < N; n++) { body.writeFloatLE(L[n] * g, n * 8); body.writeFloatLE(R[n] * g, n * 8 + 4); }
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + body.length, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(3, 20); hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 8, 28); hdr.writeUInt16LE(8, 32); hdr.writeUInt16LE(32, 34); hdr.write('data', 36); hdr.writeUInt32LE(body.length, 40);
const out = new URL('../out/liubai-sfx.wav', import.meta.url).pathname;
writeFileSync(out, Buffer.concat([hdr, body]));
// How loud each ten seconds is, so that it can be set against the music.
const rms = []; for (let k = 0; k < 12; k++) { let s = 0; for (let n = k * 10 * SR; n < (k + 1) * 10 * SR; n++) s += (L[n] * g) ** 2 + (R[n] * g) ** 2; rms.push((10 * Math.log10(s / (20 * SR) + 1e-12)).toFixed(1)); }
console.log('wrote', out, 'peak before', peak.toFixed(2), 'dB per 10 s:', rms.join(' '));
