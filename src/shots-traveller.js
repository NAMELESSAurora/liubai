// The timeline: six shots and the washes between them, laid against the music
// (audio/gris-before-gris.wav, two minutes; see STORYBOARD.md for its phrases).
//
// Each shot is a small world (sky, ground, light, and the scenery built in scenes.js), the
// traveller's path through it, and a camera move. A shot is written on its own clock, its
// "script time", on which every key below is set; `at` then says which moment of the script
// falls on which moment of the music, and the shot is stretched smoothly between those.
// So to move an event onto a note, change `at`; to change what happens, change the keys.
// A shot's time runs a little below 0 and past its length while a transition overlaps it,
// so every path and camera is keyed past both ends and nothing starts or stops on a cut.
import { V, lerp, ss, ease, rig, path } from './camera.js';
import { SHEET, RUINS, FOREST, SUMMIT } from './layout.js';
import { poseOf, tipOf, STAND } from './traveller.js';

export const FPS = 24;
export const W = 1920;
export const H = 1080;
export const ASPECT = W / H;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
export const PAPER = hex('#F4EFE6');
const LIGHT = V.norm([0.3, 0.5, 1]);          // towards the light: behind the scene, up and to the right
const FILL = V.norm([-0.45, 0.5, -0.74]);     // towards the soft light that fills the shade: from the camera's side
const sunDir = (az, el) => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
const pack = (rows) => { const a = new Float32Array(32); rows.slice(0, 8).forEach((r, i) => a.set(r, i * 4)); return a; };

// Every scene uniform has a value here; a shot only states what it changes.
export const BASE = {
  uSeed: 1, uGris: 0,
  uSkyTop: PAPER, uSkyLow: PAPER, uHaze: PAPER, uFog: 0, uSun: [0, 0, 0, 0], uSunCol: [1, 1, 1],
  uGround: 0, uGndNear: PAPER, uGndFar: PAPER, uGndVar: 0, uLight: [...LIGHT, 0], uFill: FILL, uShadeTint: [0.86, 0.9, 1],
  uPts: pack([]), uPtN: 0, uPath: [0, 0, 1, 0], uTrail: [0, 1, 0, 0], uSpread: [1, 1, 1, 0],
  uBlooms: pack([]), uBloomR: pack([]), uBloomN: 0, uTint: [1, 1, 1, 0], uWash: [0, 0, 0, 0], uSweep: [0, 0, 0, 0],
  uLine: -1, uDrop: [0, 0, 0, 0], uGuide: [0, 0, 1, 0], uLeaf: [0, 0, 0, 0], uRibCol: [1, 1, 1],
  uCloud: [0, 1, 0, 0],
  uBirds: [0, 0, 0, 0], uBirdDir: [1, 0, 0],
  uNight: -1, uMoon: [0, 0.4, 0.07, 0], uTip: [0, 0], uTitleBox: [0, 0, 1, 1], uLand: [0, 0, 0, 0], uShaft: [0, 0, 0, 0],
};

// Script time for a time on screen, through the pairs [screen, script]: smooth, and never
// running backwards (a monotone cubic). warp(...).rate is how fast the script is running.
function warp(pairs) {
  const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1]), n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  const at = (x, slope) => {
    if (x <= xs[0]) return slope ? m[0] : ys[0] + (x - xs[0]) * m[0];
    if (x >= xs[n - 1]) return slope ? m[n - 1] : ys[n - 1] + (x - xs[n - 1]) * m[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], u = (x - xs[i]) / h, u2 = u * u, u3 = u2 * u;
    if (slope) return ((6 * u2 - 6 * u) * (ys[i] - ys[i + 1])) / h + (3 * u2 - 4 * u + 1) * m[i] + (3 * u2 - 2 * u) * m[i + 1];
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
  const tau = (x) => at(x, false);
  tau.rate = (x) => at(x, true);
  return tau;
}
// Where the traveller touched the world at each of these times, as the path the colour bleeds out from.
const trail = (figure, times) => pack(times.map((t) => [...tipOf(figure(t)), t]));
// When a path moving in +x reaches x.
const whenAtX = (pathFn, x, t0, t1) => {
  let a = t0, b = t1;
  for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (pathFn(m).pos[0] < x) a = m; else b = m; }
  return (a + b) / 2;
};

// ---------------------------------------------------------------------------- 1 纸
// Bare paper and the first low notes. With the piano's first phrase (0:03) a pencil line
// starts; the camera goes after it, over it and down to the ground, where the drawing has
// become a place and the traveller is standing in it, as the phrase crests (0:10). Then it
// is still, and under the hem of the cloak the first wash begins to spread.
function paper() {
  const { z, x0, x1, stand } = SHEET;
  const still = path([{ t: -1, pos: [stand, STAND, z], yaw: Math.PI / 2 }, { t: 8, pos: [stand, STAND, z], yaw: Math.PI / 2 }]);
  const figure = (t, clock = t, rate = 1) => poseOf(still(t), clock, { wind: 0.6, ground: 0, rate });
  const cam = rig([
    { t: -0.5, pos: [-13, 4.5, 18.6], look: [-12.6, 0, 20], fov: 34, blur: 0, hold: true },   // close enough to see the graphite
    { t: 0.9, pos: [-13, 4.5, 18.6], look: [-12.6, 0, 20], hold: true },
    { t: 1.9, pos: [-2, 11, 13], look: [2, 0, 20], fov: 40 },                                 // after the pencil, and up
    { t: 2.7, pos: [3.5, 6.5, 9], look: [0, 0.6, 20] },                                       // over the top and down
    { t: 3.7, pos: [-3.4, 1.15, 13.2], look: [-5.3, 0.75, 20], fov: 38, hold: true },         // to the ground, beside the traveller
    { t: 6.8, pos: [-4.2, 0.95, 14.6], look: [-5.6, 0.7, 20], hold: true },                   // and rest, creeping in
  ]);
  return {
    id: 'paper', name: '纸', dur: 13.625, figure,
    at: [[-1.6, -0.6], [3.0, 0.4], [6.2, 1.9], [8.4, 2.7], [10.4, 3.7], [15.4, 7.0]],
    shadow: { c: [stand, 0, z], r: 7, d: 30 },
    world: { uSeed: 1.3, uGround: 1, uGuide: [stand + 1.5, z + 5, 6, 0.3], uLining: hex('#6C7FB8') },
    frame(t) {
      const tip = tipOf(figure(t)), show = ss(2.5, 3.6, t);
      return {
        cam: cam(t), anchor: tip, figOpacity: show,
        u: {
          uLight: [...LIGHT, 0.8 * show],
          uPath: [x0, z, x1, z], uLine: ease(0.4, 2.6, t),
          uDrop: [tip[0], z - 0.05, 1.8 * (1 - Math.exp(-Math.max(t - 3.8, 0) / 1.3)), 1],
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------- 2 灰
// The piano's second phrase, alone: on foot between two rows of columns, the cloak's train
// dragging and leaving a wet line. When the strings come in under the piano (0:24.5)
// the first colour appears, the cloak fills and the traveller leaves the ground, and flies
// away into the ruin towards the great arch while the colour spreads behind.
function ruins() {
  const z = RUINS.pathZ, xAt = (t) => -5 + (7 * (t + 0.8)) / 6.4;
  const walk = path([
    { t: -0.8, pos: [xAt(-0.8), STAND, z], fly: 0 },
    { t: 2.4, pos: [xAt(2.4), STAND, z] },
    { t: 4.8, pos: [xAt(4.8), STAND, z] },
    { t: 5.6, pos: [xAt(5.6), STAND, z], fly: 0 },
    { t: 6.4, pos: [3.3, 0.62, z + 0.1], fly: 0.25 },
    { t: 7.2, pos: [5.4, 1.6, z + 1], fly: 0.9 },
    { t: 8.0, pos: [8.6, 3.7, z + 3.5], fly: 1 },
    { t: 8.8, pos: [13, 6.6, z + 8], fly: 1 },
    { t: 9.8, pos: [17.5, 8.8, 43], fly: 1 },
    { t: 10.9, pos: [22.5, 11, 55.5], fly: 1 },
    { t: 12.0, pos: [27, 13, 68], fly: 1 },
    { t: 13.2, pos: [31, 15, 82], fly: 1 },                  // on towards the great arch
  ]);
  const figure = (t, clock = t, rate = 1) => poseOf(walk(t), clock, { ground: 0, rate });
  const pool = [...tipOf(figure(5.7)).map((v, i) => (i === 1 ? 0.02 : v))];
  // Close and low, a broken column out of focus at the edge of frame: the traveller walks
  // out from behind it. Then one long crane up and back, until the whole ruin is in frame
  // and the traveller is a speck in it. It stays there while they run and leave the ground.
  const cam = rig([
    { t: -0.8, pos: [-3.3, 0.6, 15.4], look: [-2.2, 1.3, 24], fov: 36, fz: 24, blur: 9, hold: true },
    { t: 2.0, pos: [-3.0, 0.65, 15.4], look: [-1.2, 1.3, 24], hold: true },
    { t: 3.4, pos: [-4.5, 5.5, 7], look: [0, 2.6, 26], fov: 42 },
    { t: 5.2, pos: [-1, 12.5, -6], look: [4.5, 7.6, 40], fov: 48, fz: 30, blur: 6, hold: true },
    { t: 13.2, pos: [1.2, 11.6, -1.5], look: [8, 7.6, 42], hold: true },
  ]);
  const pts = trail(figure, [-0.8, 5.6, 6.4, 7.2, 8.8, 10.9, 12.0, 13.2]);
  // The sun is low, ahead and to the right: the ruin is lit from behind and its shadows
  // run long towards the camera, across the traveller's path.
  const sun = [0.42, 0.33];
  return {
    id: 'ruins', name: '灰', dur: 21.375, scene: 'ruins', figure,
    at: [[-1.6, -0.8], [4.0, 2.0], [10.4, 5.2], [10.9, 5.6], [13.6, 7.2], [16.5, 8.8], [23.2, 13.2]],
    shadow: { c: [4, 0, 44], r: 80, d: 140 },
    world: {
      uSeed: 2.1, uGris: 1,
      uSkyTop: hex('#EDEBE7'), uSkyLow: hex('#DCDBDC'), uHaze: hex('#E2E1E1'), uFog: 0.004,
      uSun: [...sun, 0.14, 0.9], uSunCol: hex('#F6F4F0'),
      uGround: 1, uGndNear: hex('#D3D3D6'), uGndFar: hex('#E6E4E1'), uGndVar: 1, uLight: [...sunDir(...sun), 0.9], uShadeTint: [0.9, 0.93, 1],
      uShaft: [0.55, 0.28, 0, 0],
      uPts: pts, uPtN: 8, uPath: [xAt(-0.8) + 0.1, z, xAt(5.6) + 0.1, z], uTrail: [-0.8, 5.6, 3.4, 1], uSpread: [1.4, 1.2, 2.0, 2.2],
      uBlooms: pack([[...pool, 5.7]]), uBloomR: pack([[1.9, 7.5, 0, 0]]), uBloomN: 1, uTint: [0.7, 0.85, 0.94, 0.85],          // the first colour goes on spreading until it has the whole ruin
      uRibCol: hex('#9CC9DE'),
    },
    frame(t) {
      return { cam: cam(t), anchor: pool, figOpacity: 1, slabs: [[0, 29, 3], [0, 21, 2], [0, 12, 1]] };
    },
  };
}

// ---------------------------------------------------------------------------- 3 青
// The strings' second and third swells. Gliding low over the lake, the cloak's hem cutting
// the water and the colour spreading in the wake; on the crest (0:43.6) the camera lets go
// and climbs, and the colour climbs the towers as the traveller pulls up towards them.
function lake() {
  const glide = path([
    { t: -0.8, pos: [-24, 2.2, 10], fly: 1, dip: 0 },
    { t: 0.8, pos: [-13, 0.7, 17], dip: 0.6 },
    { t: 3.0, pos: [2, 0.46, 28], dip: 1 },                 // low enough for the cloak to drag in the water
    { t: 5.2, pos: [17, 0.5, 40], dip: 1 },
    { t: 6.4, pos: [25, 2.6, 49], dip: 0 },
    { t: 7.6, pos: [32, 9.5, 60] },
    { t: 8.8, pos: [38, 19, 71] },
  ]);
  const figure = (t, clock = t, rate = 1) => poseOf(glide(t), clock, { ground: 0, rate });
  // Right behind them, a wingspan above the water, the posts flicking past. Then the
  // camera lets go: it climbs away until the lake is a sheet of paper below and the wake
  // is one teal stroke across it. It waits up there while they climb to the towers.
  const cam = rig([
    { t: -0.8, pos: [-27.5, 3.4, 5.5], look: [-22, 2.0, 12], fov: 44, blur: 12 },
    { t: 0.8, pos: [-16.4, 1.45, 12.4], look: [-11, 0.9, 19], fov: 46 },
    { t: 2.4, pos: [-5.2, 1.3, 20.6], look: [-0.5, 0.85, 27] },
    { t: 4.0, pos: [-8, 16, 4], look: [8, 0, 36], fov: 42 },
    { t: 5.6, pos: [-8, 34, -22], look: [14, 0, 62], fov: 40, blur: 0, hold: true },
    { t: 8.8, pos: [-6, 34, -18], look: [24, 14, 80], hold: true },
  ]);
  return {
    id: 'lake', name: '青', dur: 19.625, scene: 'lake', figure,
    at: [[-1.6, -0.8], [2.5, 0.8], [8.0, 2.4], [15.0, 5.6], [21.2, 8.8]],
    world: {
      uSeed: 3.4, uGris: 1,
      uSkyTop: hex('#EEF5F3'), uSkyLow: hex('#D6E8E9'), uHaze: hex('#D9E9EA'), uFog: 0.004,
      uSun: [-0.3, 0.36, 0.075, 1], uSunCol: hex('#F8FBFA'),
      uGround: 2, uGndNear: hex('#7DB2BD'), uGndFar: hex('#C6DEE0'), uLight: [...sunDir(-0.3, 0.36), 1], uShadeTint: [0.84, 0.94, 0.97],
      uFill: V.norm([0.5, 0.45, -0.74]),
      uPts: trail(figure, [0.9, 2.0, 3.0, 4.1, 5.2, 6.0, 7.6, 8.8]), uPtN: 8, uTrail: [0, 1, 7.5, 0], uSpread: [2.2, 0.6, 2.2, 1.5],
      uRibCol: hex('#5FA3B4'),
    },
    frame(t) {
      const c = cam(t);
      c.roll = -figure(t - 0.3).bank * 6 * (1 - ss(2.4, 4, t));
      return {
        cam: c, figOpacity: 1,
        u: { uWash: [0.3 + 140 * ss(4.6, 8.8, t) ** 2, 0.02, 5, 1] },
        slabs: [26, 13, 6].map((d, i) => [1, c.pos[2] + d, i + 1]),
      };
    },
  };
}

// ---------------------------------------------------------------------------- 4 朱
// The upper strings join (0:54.5). Weaving between the trunks, each crown blooming as the
// traveller passes beneath it; on the second crest (1:15.5) the leaves turn and fly upward
// with them through the canopy.
function forest() {
  const weave = path([
    { t: -0.8, pos: [-26, 9, 23], fly: 1 },
    { t: 0.6, pos: [-17, 5, 25] },
    { t: 2.2, pos: [-8, 4.2, 22.5] },
    { t: 3.8, pos: [0, 5.5, 26.5] },
    { t: 5.4, pos: [8, 4.5, 23] },
    { t: 6.8, pos: [15, 6, 27] },
    { t: 7.8, pos: [19.5, 12, 28.5] },
    { t: 8.8, pos: [22, 22, 29] },
  ]);
  const figure = (t, clock = t, rate = 1) => poseOf(weave(t), clock, { rate });
  // On the forest floor, looking up the rows, the traveller far off between the trunks.
  // As they come past, the camera goes in through the trees to meet them and is pulled
  // along at their shoulder. Then it drops back and looks up as they leave through the canopy.
  const cam = rig([
    { t: -0.8, pos: [-9, 0.8, 11], look: [-13, 5.5, 26], fov: 46, fz: 24, blur: 10, hold: true },
    { t: 1.6, pos: [-6.5, 1.0, 13], look: [-8.5, 5.0, 25], fz: 24 },
    { t: 2.6, pos: [-3.2, 2.6, 18.6], look: [-5.5, 4.6, 23.6], fz: 24 },
    { t: 3.2, pos: [-1.8, 3.9, 21.2], look: [-3.2, 4.9, 24.9], fz: 25 },
    { t: 4.4, pos: [2.2, 4.6, 21.6], look: [4.6, 5.0, 25], fz: 25 },
    { t: 5.6, pos: [5.8, 4.0, 20.9], look: [9.2, 4.7, 24.4], fz: 24 },
    { t: 6.8, pos: [10.5, 3.2, 21.4], look: [15.5, 7.5, 27], fov: 44, fz: 27 },
    { t: 8.8, pos: [13.5, 2.8, 21.6], look: [21, 22, 29], fz: 29, hold: true },
  ]);
  const crowns = FOREST.row.filter((c) => Math.abs(c.cx) < 16.5).slice(0, 8);
  return {
    id: 'forest', name: '朱', dur: 21.875, scene: 'forest', figure,
    at: [[-1.6, -0.8], [5.5, 1.6], [8.0, 2.6], [17.0, 6.8], [23.5, 8.8]],
    shadow: { c: [2, 0, 36], r: 66, d: 110 },
    world: {
      uSeed: 4.7, uGris: 1,
      uSkyTop: hex('#FBF4EE'), uSkyLow: hex('#F6E7DE'), uHaze: hex('#F8EBE3'), uFog: 0.007,
      uGround: 1, uGndNear: hex('#EED6C8'), uGndFar: hex('#F6E8DF'), uGndVar: 1, uLight: [...LIGHT, 0.8], uShadeTint: [0.97, 0.86, 0.88],
      uSun: [0.291, 0.446, 0.09, 0.8], uSunCol: hex('#FFF6EC'), uShaft: [0.6, 0.3, 0, 0],      // the sun stands where the light comes from
      uPts: trail(figure, [-0.8, 0.6, 2.2, 3.8, 5.4, 6.8, 7.8, 8.8]), uPtN: 8, uTrail: [0, 1, 4.2, 0], uSpread: [1.3, 1.5, 2.2, 0],
      uBlooms: pack(crowns.map((c) => [c.cx, c.cy, FOREST.bloomZ, whenAtX(weave, c.cx - 3, -0.8, 8.8)])),
      uBloomR: pack(crowns.map((c) => [c.r * 1.3, 0, 0, 0])), uBloomN: crowns.length,
      uRibCol: hex('#D9654F'),
    },
    frame(t) {
      const c = cam(t), up = Math.max(t - 7, 0);
      c.roll = -figure(t - 0.2).bank * 6 * ss(2.4, 3.4, t) * (1 - ss(6.2, 7.4, t));
      return {
        cam: c, figOpacity: 1,
        u: {
          uLeaf: [0.5 * t, 1.0 * t - 7 * up * up, t, 0.045 + 0.4 * ss(7, 8.4, t)],
          // Colour comes back through the whole depth of the wood as the traveller draws
          // level with it: the nearest trees first, the far ones a moment later.
          uSweep: [weave(t).pos[0] + 5, 0.12, 3, 1],
        },
        slabs: [30, 20, 13, 8, 4].map((d, i) => [2, c.pos[2] + d, i + 1]),
      };
    },
  };
}

// ---------------------------------------------------------------------------- 5 金
// The brightest stretch of the music (1:16.5 – 1:38). Low over the cloud, waiting: the
// traveller comes up through it and sweeps past the lens. The camera falls away, far back,
// until the whole tower stands against the sun with the traveller a mark winding round it,
// and stays to watch the gold climb to the top on the last crest (1:37.8).
function tower() {
  const span = 9.6, psiAt = (k) => -2.4 + 4.0 * k;
  const soar = path(Array.from({ length: 17 }, (_, i) => {
    const k = i / 16, psi = psiAt(k), rho = lerp(11, 8, k);
    return { t: -0.8 + k * span, pos: [rho * Math.sin(psi), lerp(-7, 16, k ** 0.9), -rho * Math.cos(psi)], fly: 1 };
  }));
  const figure = (t, clock = t, rate = 1) => poseOf(soar(t), clock, { rate });
  const sun = [0.56, 0.14];
  const wide = rig([
    { t: -0.8, pos: [-12.6, -0.9, -5.0], look: [-10.6, -1.8, 1.0], fov: 42, blur: 10, hold: true },
    { t: 0.9, pos: [-12.6, -0.8, -5.0], look: [-10.4, -1.6, 0.8], hold: true },
    { t: 2.6, pos: [-14, 0.6, -7.5], look: [-8.3, 2.0, -5.5] },
    { t: 4.0, pos: [-30, 4, -36], look: [-2, 9, 0], fov: 40 },
    { t: 5.4, pos: [-40, 6.5, -60], look: [0, 12.5, 0], fov: 38, blur: 0, hold: true },
    { t: 8.8, pos: [-33, 9, -64], look: [0, 14, 0], hold: true },
  ]);
  // While they are close the camera's eye stays on them; as it falls back it settles on the tower.
  const cam = (t) => {
    const c = wide(t), k = ss(0.9, 1.6, t) * (1 - ss(2.6, 3.8, t));
    return { ...c, look: V.lerp(c.look, soar(t + 0.05).pos, k) };
  };
  return {
    id: 'tower', name: '金', dur: 22.375, scene: 'tower', figure,
    at: [[-1.6, -0.8], [3.5, 0.9], [8.5, 2.6], [15.0, 5.4], [24.0, 8.8]],
    shadow: { c: [0, 10, 0], r: 30, d: 80 },
    world: {
      uSeed: 5.9, uGris: 1,
      uSkyTop: hex('#FCF8EC'), uSkyLow: hex('#F8E7BC'), uHaze: hex('#F9ECCF'), uFog: 0.004,
      uSun: [...sun, 0.2, 1], uSunCol: hex('#FEF7E0'), uLight: [...sunDir(...sun), 1], uShadeTint: [0.97, 0.86, 0.74], uShaft: [0.5, 0.22, 0, 0],
      uRibCol: hex('#E2A84B'),
    },
    frame(t) {
      const flock = soar(t - 0.55);
      return {
        cam: cam(t), figOpacity: 1,
        u: {
          uWash: [-8 + 75 * ss(2.5, 8.8, t) ** 2, -200, 3, 1],             // timed for the wide: the gold climbs the tower in view
          uCloud: [-2, 3.2, 4, t * 0.05],
          uBirds: [...V.add(flock.pos, [0, 1.3, 0]), t > 0.9 ? 1 : 0], uBirdDir: V.norm(flock.vel),
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------- 6 留白
// The music stops short (1:38.5) and what is left is a few single notes. Over the lip of
// the summit, a flare, and down; the cloak settles. On two of the notes an arm goes up under the cloak
// (1:45.9 – 1:48.5); the night floods out of it across the whole sky, round one circle that
// is never painted, and the camera is back and still by the note at 1:54. Silence from 1:57.
function summit() {
  const [sx, sy, sz] = SUMMIT.stand, here = [sx, sy + STAND, sz];
  const land = path([
    { t: -0.8, pos: [-9, -4.5, 5.5], fly: 1, spread: 1 },
    { t: 0.2, pos: [-4.6, 0.9, 8.2], fly: 1, spread: 1 },
    { t: 1.0, pos: [-1.6, 1.7, 9.6], fly: 0.85, spread: 1, yaw: 1.1 },                // flare: upright, cape wide
    { t: 1.7, pos: [-0.25, 0.85, 9.85], fly: 0.35, spread: 0.8, yaw: 0.35 },
    { t: 2.3, pos: here, fly: 0, spread: 0, yaw: 0 },
    { t: 11, pos: here, fly: 0, spread: 0, yaw: 0 },
  ]);
  const figure = (t, clock = t, rate = 1) => poseOf(land(t), clock, { raise: ease(2.8, 4.8, t), ground: sy, rate });
  const cam = rig([
    { t: -0.8, pos: [2.2, 1.6, 3.4], look: [-3, 0.2, 8.5], fov: 42, blur: 10 },       // watch them come up over the edge
    { t: 1.2, pos: [1.6, 1.4, 4.4], look: [-0.6, 1.2, 9.9] },
    { t: 2.8, pos: [1.0, 1.1, 5.4], look: [0.1, 1.1, 9.9], fov: 38, hold: true },       // close behind them, still
    { t: 4.8, pos: [0.7, 0.85, 5.0], look: [0.2, 1.55, 9.9], fov: 40, blur: 5, hold: true },     // up with the arm, the head still in frame
    { t: 8.4, pos: [0, 2.0, -7.5], look: [0, 5.8, 9.9], fov: 44, blur: 0, hold: true },         // then back and up, until the moon is in frame; all of it sharp
    { t: 10, pos: [0, 2.4, -10.5], look: [0, 6.2, 9.9], hold: true },
  ]);
  return {
    id: 'summit', name: '留白', dur: 21.125, scene: 'summit', figure,
    at: [[-1.5, -0.8], [4.6, 2.3], [7.0, 2.8], [9.67, 4.8], [15.1, 8.4], [16.6, 9.0], [22.5, 11]],
    shadow: { c: [1, 0, 10], r: 18, d: 50, soft: 7 },
    world: {
      uSeed: 6.6, uSkyLow: hex('#F4E3D2'), uHaze: hex('#F2DFCF'), uFog: 0.0009,
      uLight: [...V.norm([-0.35, 0.4, 0.85]), 0.75], uShadeTint: [0.86, 0.86, 1],     // the last light, low behind the summit
      uShaft: [0.3, 0, 0, 0],
      uMoon: [...SUMMIT.moon, 0], uTitleBox: SUMMIT.title.box, uLand: [-70, 1, 0, 0],
      uRibCol: hex('#9A8FC0'), uLining: hex('#6A58B0'),
    },
    frame(t) {
      // The wash pours out of the lifted hand, wherever the camera sees it in the sky.
      const c = cam(t), d = V.sub(tipOf(figure(t)), c.pos);
      return {
        cam: c, figOpacity: 1,
        u: { uNight: ease(4.6, 8.6, t), uTip: [Math.atan2(d[0], d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))] },
      };
    },
  };
}

// Each shot laid against the music: from here on its figure() and frame() take the time on
// screen since the shot began; tau gives the script time for it.
let clock = 0;
export const SHOTS = [paper(), ruins(), lake(), forest(), tower(), summit()].map((s) => {
  const tau = warp(s.at);
  const shot = { ...s, start: clock, tau, pre: s.at[0][0], figure: (t) => s.figure(tau(t), t, tau.rate(t)), frame: (t) => s.frame(tau(t)) };
  clock += s.dur;
  return shot;
});
export const TOTAL = clock;          // 120 s: the length of the music

// TRANSITIONS[i] carries shot i into shot i + 1, centred on the cut. The cuts fall where
// the music breathes between two swells (0:13.6, 0:35) or where a new voice comes in
// (0:54.6, 1:16.5), and the last where it stops (1:38.9).
// type 1: a bloom from the outgoing shot's anchor; 2: a wash across; 3: through bare paper.
export const TRANSITIONS = [
  { dur: 2.4, type: 1, edge: [0.8, 0.8, 0.82] },
  { dur: 2.6, type: 1, edge: [0.62, 0.8, 0.86] },
  { dur: 3.0, type: 2, dir: [-1, 0], edge: [0.93, 0.62, 0.52] },      // from the right: it takes the old traveller before it shows the new
  { dur: 3.0, type: 2, dir: [0, -1], edge: [0.95, 0.8, 0.52] },
  { dur: 2.6, type: 3 },
];

// The film ends by fading back to bare paper in the silence after the last note.
export const fadeOut = (t) => ss(TOTAL - 2.0, TOTAL - 0.4, t);
