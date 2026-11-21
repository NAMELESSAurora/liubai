// The timeline: six shots and the washes between them, laid against the music
// (audio/gris-before-gris.wav, two minutes; see STORYBOARD.md for its phrases).
//
// This cut has no figure in it. The lens is the traveller's own eye: each shot is one
// unbroken first-person passage through a small world (sky, ground, light, and the scenery
// built in scenes.js). Three things are designed in every shot, against the music:
//   a reason   nothing turns, climbs or dips for its own sake. Every move is round, between,
//              under, along or over something that stands there (layout.js lays those things
//              out, scenes.js builds them, audit() below checks the path against them);
//   two paces  we stroll, and then we tear through: slow passages where the eye wanders from
//              one thing to the next, and fast ones threaded close past things. They take
//              turns, a phrase of the music each;
//   colour     while we are fast the world ahead is grey pencil; where we slow, the colour
//              we carry catches us up and runs on past.
// Times are seconds on screen since the shot began. A shot's time runs a little below 0
// and past its length while a transition overlaps it, so every path is keyed past both
// ends and nothing starts or stops on a cut.
// (The cut with the traveller in it is kept in shots-traveller.js.)
import { V, ss, ease, pov, track } from './camera.js';
import { SHEET, RUINS, colX, LAKE, FOREST, TOWER, stairY, SUMMIT } from './layout.js';

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
const EYE = 0.92;                             // how high the eye is on foot: the traveller is one unit tall

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

// When something moving in +x (a function of time that gives its place) reaches x.
const whenAtX = (at, x, t0, t1) => {
  let a = t0, b = t1;
  for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (at(m)[0] < x) a = m; else b = m; }
  return (a + b) / 2;
};

// ---------------------------------------------------------------------------- the fleck
// What we follow. A spot of the paper left bare, a point of light with a wash laid round
// it: it goes ahead of us through every world. Where it rests we come up with it and look
// at what it is on; where it darts off we go after it, and that is why we hurry. What it
// passes wakes (lamps, windows, the water, the leaves), and round it the colour of things
// shows even while the world is still pencil. At the end it goes up into the sky and is
// the moon: the one circle that is never painted.
// A fleck is keyed like a path ({ t, pos, hold }); follow() makes keys that keep it a
// little way ahead of us on our own path, so that it takes every gap before we do.
const WISP_N = 18, WISP_DT = 0.034;
function fleck(keys, { swim = 0.07, seed = 1 } = {}) {
  const tr = track([...keys].sort((a, b) => a.t - b.t), ['pos']);
  return (t) => {
    const p = tr(t).pos;
    return [p[0] + swim * Math.sin(t * 2.3 + seed), p[1] + 0.7 * swim * Math.sin(t * 3.1 + seed * 2), p[2] + swim * Math.cos(t * 1.9 + seed * 3)];
  };
}
const follow = (P, t0, t1, step, lead, off = () => [0, 0, 0]) => {
  const out = [];
  for (let t = t0; t <= t1 + 1e-6; t += step) out.push({ t, pos: V.add(P(t + (typeof lead === 'function' ? lead(t) : lead)), off(t)) });
  return out;
};
// What the renderer needs of it for one frame: where it is and has just been, the pigment
// round it, its size, how far its light and its colour reach, how much of it there is.
const wispAt = (W, t, { col, r = 0.07, light = 1.7, colour = 0, on = 1 }) => {
  const pts = new Float32Array(80);
  for (let k = 0; k < WISP_N; k++) pts.set([...W(t - k * WISP_DT), k / (WISP_N - 1)], k * 4);
  return { pts, n: WISP_N, col, p: [r, light, colour, on] };
};
// The eye's keys may `watch` the fleck: the look is put where the fleck is at that moment,
// and the gaze follows it there (pan) unless the key says it is a glance (pan: false). A
// function for `watch` is given the fleck's place and says where to look instead.
const eyes = (keys, mk) => {
  const tr = track(keys.filter((k) => k.pos).sort((a, b) => a.t - b.t), ['pos']), P = (t) => tr(t).pos, W = mk(P);
  return { W, P, keys: keys.map((k) => (k.watch ? { pan: true, ...k, look: typeof k.watch === 'function' ? k.watch(W(k.t)) : W(k.t) } : k)) };
};
const GREY = [0.56, 0.56, 0.58, 0.8];
const keyed = (ks) => { const f = track(ks.map(([t, v]) => ({ t, v, hold: true })), ['v']); return (t) => f(t).v; };     // a value that eases from key to key

// ---------------------------------------------------------------------------- 1 纸
// Still, then slow. We are looking down at a bare sheet and at one point on it, just ahead
// of our feet: the fleck. With the piano's first phrase (0:03) it sets off across the paper
// and a pencil line is what it leaves; the eye goes after it, then the feet, faster, the
// draughtsman's marks passing under us. Where the line ends it lifts off the sheet, comes
// back over our heads as the phrase crests (0:10), and we stop under it; it falls at our
// feet, and where it falls a drop of grey water spreads.
function paper() {
  const { z, x1 } = SHEET, stop = 5.2, drop = [stop + 1.15, 0, z - 0.05], from = -12.25;
  const { W, keys } = eyes([
    { t: -1, pos: [-13, EYE, z], look: [from, 0, z], hold: true, fd: 1.2, blur: 4 },
    { t: 3.2, pos: [-13, EYE, z], look: [from, 0, z], hold: true, fd: 1.2, blur: 4 },
    { t: 4.6, watch: true, fd: 6, blur: 3 },                                           // the eye goes after it; then the feet
    { t: 5.0, pos: [-12.4, EYE, z] },
    { t: 6.2, watch: true, fd: 12 }, { t: 7.5, watch: true, fd: 16 },
    { t: 7.5, pos: [-4.6, EYE, z] },
    { t: 8.8, watch: true, fd: 12 }, { t: 9.5, watch: true, fd: 8 },                   // it leaves the paper, and comes back over us
    { t: 10.1, pos: [stop, EYE, z], hold: true },
    { t: 10.1, watch: true, fd: 4 }, { t: 10.6, watch: true, fd: 1.6, blur: 4 },       // and falls at our feet
    { t: 15, pos: [stop + 0.04, EYE, z], look: drop, hold: true, fd: 1.5, blur: 4 },
  ], () => fleck([
    { t: -1, pos: [from, 0.035, z], hold: true }, { t: 3.0, pos: [from, 0.035, z], hold: true },
    ...Array.from({ length: 16 }, (_, i) => { const t = 3.0 + (5.8 * (i + 1)) / 16; return { t, pos: [from + (x1 - from) * ease(3.0, 8.8, t), 0.035, z] }; }),
    { t: 9.45, pos: [12.2, 2.5, z - 0.5] }, { t: 10.05, pos: [8.2, 2.3, z - 0.3] },
    { t: 10.6, pos: [drop[0], 0.035, drop[2]], hold: true }, { t: 16, pos: [drop[0], 0.035, drop[2]], hold: true },
  ], { swim: 0.012 }));
  const cam = pov(keys, { fov: [38, 52], speeds: [0.4, 4.5], eye: EYE, seed: 1 });
  return {
    id: 'paper', name: '纸', dur: 13.625, cam, W,
    world: { uSeed: 1.3, uGround: 1, uGuide: [-4, z + 5, 6, 0.3] },
    frame(t) {
      return {
        cam: cam(t), anchor: drop,
        wisp: wispAt(W, t, { col: [0.5, 0.5, 0.52, 0.75], r: 0.04, light: 0, on: 1 }),
        u: {
          uPath: [from, z, x1, z], uLine: ease(3.0, 8.8, t),
          uDrop: [drop[0], drop[2], 1.9 * (1 - Math.exp(-Math.max(t - 10.6, 0) / 1.7)), 1],
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------- 2 灰
// A stroll, then the first rush of the film. The piano's second phrase, alone: the fleck is
// here before us, a point of light in a world of pencil, and it shows us round. It hangs
// over a length of fallen column until we come; goes up to the head of a standing one while
// we go round the fallen one, and we look up after it; comes down between that column and a
// broken one, and we go between them too; and waits over a round stone set in the paving.
// We stop at the stone's edge. When the strings come in under the piano (0:24.5) it sinks
// into the stone and the first colour runs out from it over the floor and up the columns.
// Then it is up out of the stone and away, blue behind it, in between two columns of the
// colonnade, and the birds go up off the roof. We leave the ground after it: round to the
// right and down the aisle, columns flicking past on both sides, beams and hanging creeper
// overhead, to where the roof lies fallen across it; out to the left between two columns,
// at the great arch, and through it into the sun.
function ruins() {
  const z = RUINS.pathZ, first = 10.875, stone = RUINS.dais, pool = [stone.x, 0.14, stone.z];
  const A = RUINS.row.z, B = RUINS.aisle.z, mid = (A + B) / 2, [g1] = RUINS.gate, drum = RUINS.drum;
  const chase = { watch: true, aim: 0.4 };
  const { W, keys } = eyes([
    { t: -1.5, pos: [-16.6, EYE, 23.5], look: [4, 10.5, 34], fd: 14 },                 // the colonnade
    { t: 0.4, watch: true, pan: false, fd: 5 },                                        // and there it is, over the fallen drum
    { t: 1.0, pos: [-13.2, EYE, 22.7] },
    { t: 2.1, look: [drum.x + 0.3, 0.5, drum.z - 1.25], fd: 2.4, glance: 0.5 },        // the end of the drum, as we go round it
    { t: 2.8, pos: [-10.7, EYE, 21.95] },
    { t: 3.5, watch: true, pan: false, fd: 9 },                                        // up the column, to where it has gone
    { t: 4.6, pos: [-8.0, EYE, 22.6] },
    { t: 4.8, watch: true, fd: 8 }, { t: 5.8, watch: true, fd: 4 }, { t: 6.4, watch: true, fd: 3.5 },      // and down after it, between the two
    { t: 6.6, pos: [-4.75, EYE, 23.7] },
    { t: 7.2, watch: true }, { t: 8.0, watch: true, fd: 5 },
    { t: 8.3, pos: [-1.8, EYE, 24.0] },
    { t: 9.8, pos: [0.9, EYE, z], hold: true },                                        // we stop at the edge of the stone
    { t: 10.0, watch: true, fd: 2.4 }, { t: first, watch: true, fd: 2 },               // it sinks, and the eye goes down with it
    { t: 11.6, pos: [0.9, EYE, z], hold: true },
    { t: 12.25, watch: true, fd: 4 },                                                  // up out of the stone
    { t: 12.4, pos: [1.0, EYE + 0.04, z], hold: true },
    { t: 13.1, watch: true, fd: 12 },                                                  // and away to the columns
    { t: 13.6, pos: [4.6, 2.2, 26.2], ...chase, fd: 14 },                              // we leave the ground after it
    { t: 14.5, pos: [10.8, 4.6, 29.2], ...chase },
    { t: 15.2, pos: [14.7, 6.6, A], ...chase },                                        // in between two columns
    { t: 15.75, pos: [18.8, 7.2, mid - 0.5], ...chase },                               // the far row is a wall ahead: round to the right
    { t: 16.55, pos: [27.0, 7.4, mid + 0.1], ...chase },                               // and down the aisle
    { t: 17.35, pos: [36.0, 7.4, mid], ...chase },
    { t: 18.1, pos: [44.5, 7.5, mid + 0.1], ...chase },
    { t: 18.55, pos: [49.4, 7.9, mid + 1.5], ...chase },                               // the roof is down across it ahead: out to the left
    { t: 18.85, pos: [51.6, 8.6, B + 0.2], ...chase },                                 // between two columns of the far row
    { t: 19.55, pos: [55.5, 10.2, 48], ...chase },
    { t: 20.4, pos: [59.2, 12, 57.5], ...chase },
    { t: 21.15, pos: [62, 13, RUINS.arch.z + 0.5], ...chase },                         // through the great arch
    { t: 22.15, pos: [65.5, 13.8, 79], ...chase },
  ], (P) => fleck([
    { t: -1.5, pos: [drum.x, 1.6, drum.z - 0.2], hold: true }, { t: 1.6, pos: [drum.x, 1.6, drum.z - 0.2], hold: true },
    { t: 2.6, pos: [g1.x - 0.4, 10.3, g1.z - 1.3], hold: true }, { t: 4.8, pos: [g1.x - 0.4, 10.3, g1.z - 1.3], hold: true },      // by the head of the column
    { t: 5.4, pos: [-5.4, 4.2, 24.2] }, { t: 5.9, pos: [-4.5, 1.4, 23.8] },                                                         // down, and through between the two
    { t: 6.5, pos: [-2.0, 1.25, 24.1], hold: true }, { t: 7.2, pos: [-2.0, 1.25, 24.1], hold: true },
    { t: 8.0, pos: [pool[0], 1.2, z], hold: true }, { t: 10.0, pos: [pool[0], 1.2, z], hold: true },                                // over the stone
    { t: first, pos: pool, hold: true }, { t: 11.5, pos: pool, hold: true },                                                        // into it
    { t: 12.2, pos: [3.3, 3.0, 25.2] },
    ...follow(P, 12.9, 22.2, 0.31, keyed([[12.9, 1.0], [16.0, 1.25], [18.4, 0.7], [20.5, 1.1]]), (t) => [0, 0.35 * Math.sin(t * 1.9), 0.45 * Math.sin(t * 1.3 + 1)]),
  ], { seed: 2 }));
  const cam = pov(keys, { fov: [44, 66], speeds: [1.5, 12], bank: 10, maxBank: 16, eye: EYE, seed: 2 });
  // The sun is low, ahead of the walk and to its left: the ruin is lit from behind, its
  // shadows run long across our path, and it stands in the opening of the great arch.
  const sun = [0.42, 0.33], BLUE = [0.22, 0.47, 0.8, 0.9];
  // Under the roof of the aisle the lens opens; coming out at the sun it is caught open, and shuts down.
  const exp = keyed([[14.8, 0], [16.4, 0.3], [18.6, 0.38], [19.5, 0.1], [21.0, -0.22]]);
  const up = 13.75;                                               // the birds go up as it reaches the colonnade
  return {
    id: 'ruins', name: '灰', dur: 21.375, scene: 'ruins', cam, W,
    shadow: { c: [20, 0, 44], r: 80, d: 140 },
    world: {
      uSeed: 2.1, uGris: 1,
      uSkyTop: hex('#EDEBE7'), uSkyLow: hex('#DCDBDC'), uHaze: hex('#E2E1E1'), uFog: 0.004,
      uSun: [...sun, 0.14, 0.9], uSunCol: hex('#F6F4F0'),
      uGround: 1, uGndNear: hex('#D3D3D6'), uGndFar: hex('#E6E4E1'), uGndVar: 1, uLight: [...sunDir(...sun), 0.9], uShadeTint: [0.9, 0.93, 1],
      uShaft: [0.55, 0.28, 0, 0],
      // The first colour: a drop that lands small, then runs. Fast enough to be on the
      // columns before we reach them; slow enough that half way down the aisle we pass it.
      uBlooms: pack([[...pool, first]]), uBloomR: pack([[0.7, 5.4, 2.2, 0]]), uBloomN: 1, uTint: [0.7, 0.85, 0.94, 0.85],
    },
    frame(t) {
      const c = cam(t), k = Math.max(t - up, 0), away = V.norm([0.55, 0.3, -0.78]);
      return {
        cam: c, anchor: pool, slabs: [16, 9, 4].map((d, i) => [0, c.pos[2] + d, 3 - i]),
        // Nothing has colour before the first of it falls: until then the fleck is only light.
        wisp: wispAt(W, t, { col: t < first ? GREY : BLUE, light: 1.3, colour: 3.4 * ss(11.5, 12.6, t), on: 1 - ss(first - 0.05, first + 0.12, t) + ss(11.45, 11.7, t) }),
        lens: { exp: exp(t) },
        u: { uBirds: [15.5 + away[0] * 6.5 * k, 14.2 + away[1] * 6.5 * k + 1.2 * Math.sqrt(k), 33 + away[2] * 6.5 * k, t > up ? 1 : 0], uBirdDir: away },
      };
    },
  };
}

// ---------------------------------------------------------------------------- 3 青
// A drift, a rush, a drift. Out of the white we are low over a lake in the rain, the glass
// wet, and hardly moving. The fleck is at a lantern on a leaning post, and the lantern
// lights; it goes down and under a jetty, touching the water, and we go under after it,
// between two piles, with a look up at the planks; it winds once round three posts lashed
// together and their lantern lights too. Then the swell lifts it away (0:41 – 0:45) and we
// are after it down a channel marked by three piles, right of the first, left of the
// second, right of the third, the rain running on the glass, rings spreading where it
// skims. In the trough (0:45.6) it touches the water once more, and there the colour
// falls; we come up off the water and let the speed go. It climbs between the two nearest
// towers, and we go slowly up after it and between them, close enough to touch, while the
// colour rises past us up their sides and their windows light.
function lake() {
  const [t1] = LAKE.towers, { post, cluster } = LAKE, hub = [3.95, 2.25, 35.9], touch = [19, 0.06, 74], fell = 10.6;
  const chase = { watch: true, aim: 0.4 };
  const orbit = (t, a, r = 0.9, y = hub[1]) => ({ t, pos: [hub[0] + r * Math.sin(a), y, hub[2] - r * Math.cos(a)] });
  const { W, keys } = eyes([
    { t: -1.4, pos: [-1.0, 0.9, 23.2], watch: true, fd: 3 },                           // a lantern on a leaning post
    { t: 0.3, watch: true }, { t: 0.9, watch: true }, { t: 1.4, watch: true, fd: 3.5 },                   // it goes down, and under the jetty
    { t: 1.0, pos: [0.2, 0.9, 26.9] },
    { t: 2.0, look: [1.1, 2.3, 29.6], fd: 2.5, glance: 0.45 },                         // the planks, overhead
    { t: 2.6, pos: [1.0, 0.9, 29.4] },                                                 // under it, between two piles
    { t: 3.0, watch: true, pan: false, fd: 4, glance: 0.45 },                          // and there it is again, waiting
    { t: 3.6, watch: true }, { t: 4.3, watch: true }, { t: 5.0, watch: true },         // round the three posts
    { t: 4.3, pos: [1.9, 0.92, 32.2] },
    { t: 5.7, pos: [2.3, 0.95, 35.4], ...chase, tilt: -0.04, fd: 14 },                 // round them on the left; and after it, faster
    { t: 6.7, pos: [4.6, 1.0, 39.0], ...chase },
    { t: 7.3, pos: [7.5, 1.0, 41.6], ...chase },                                       // right of the first pile
    { t: 8.3, pos: [7.6, 1.05, 50.6], ...chase },                                      // left of the second
    { t: 9.3, pos: [14.2, 1.1, 58.9], ...chase },                                      // right of the third
    { t: 10.0, pos: [16.6, 1.3, 66.0], ...chase, tilt: 0 },
    { t: 10.85, pos: [19.0, 2.2, 74.0], watch: true, aim: 0.6 },                       // up off the water, and slower
    { t: 11.75, pos: [21.2, 4.2, 81.0], watch: true, aim: 0.7 },
    { t: 12.75, pos: [23.4, 5.8, 87.0], look: [t1[0], 26, t1[1]], aim: 0.5, pan: false, fd: 12 },      // the towers: up the face of the first
    { t: 14.2, pos: [27.0, 7.0, 92.0], watch: true, aim: 0.75, pan: false, fd: 8 },    // it is in the gap between that one and the second
    { t: 16.0, pos: [27.3, 8.3, 98.3], watch: true, aim: 0.7 },                        // between the two of them, after it
    { t: 18.0, pos: [26.9, 9.6, 104.5], watch: true, aim: 0.7, fd: 16 },
    { t: 20.8, pos: [29.5, 11.5, 112.5], watch: true, aim: 0.75, fd: 20 },
  ], (P) => fleck([
    { t: -1.4, pos: [post.x + 0.75, 2.55, post.z + 0.1], hold: true }, { t: 0.3, pos: [post.x + 0.75, 2.55, post.z + 0.1], hold: true },
    { t: 0.9, pos: [0.5, 0.6, 27.7] }, { t: 1.4, pos: [1.0, 0.28, 29.3] },                        // under the jetty, on the water
    { t: 2.2, pos: [1.9, 1.05, 31.7], hold: true }, { t: 3.0, pos: [1.9, 1.05, 31.7], hold: true },
    orbit(3.55, -2.2), orbit(3.9, -1.0), orbit(4.25, 0.3), orbit(4.6, 1.6), orbit(4.95, 2.9, 1.0, 1.7), orbit(5.3, 4.1, 1.5, 0.9),      // once round the three posts
    ...follow(P, 5.7, 9.5, 0.3, keyed([[5.7, 0.75], [7.5, 1.1], [9.5, 0.95]]), (t) => [0.3 * Math.sin(t * 2.1), -0.74 + 0.1 * Math.sin(t * 3.3), 0]),
    { t: fell - 0.5, pos: [17.8, 1.0, 70.0] }, { t: fell, pos: touch },                            // the colour falls where it touches
    { t: 11.5, pos: [21.4, 3.4, 81.5] }, { t: 12.75, pos: [24.6, 7.4, 90.5] },
    { t: 14.2, pos: [26.8, 10.4, 96.8] }, { t: 16.0, pos: [27.4, 12.6, 102.0] }, { t: 18.0, pos: [32.5, 14.6, 110] }, { t: 20.8, pos: [40, 18.5, 119.5] },      // through the gap, and on towards the towers beyond
  ], { seed: 3 }));
  const cam = pov(keys, { fov: [46, 66], speeds: [1.5, 10], bank: 14, maxBank: 14, seed: 3 });
  const TEAL = [0.13, 0.5, 0.56, 0.9];
  const wet = keyed([[-1.4, 0.3], [5.5, 0.34], [8.5, 0.6], [12, 0.34], [19, 0.06]]), exp = keyed([[-1.4, 0.45], [1.6, 0]]);
  return {
    id: 'lake', name: '青', dur: 19.625, scene: 'lake', cam, W, rise: (t) => 0.3 + 34 * ss(11.5, 19.5, t),
    world: {
      uSeed: 3.4, uGris: 1,
      uSkyTop: hex('#EEF5F3'), uSkyLow: hex('#D6E8E9'), uHaze: hex('#D9E9EA'), uFog: 0.004,
      uSun: [-0.3, 0.36, 0.075, 1], uSunCol: hex('#F8FBFA'),
      uGround: 2, uGndNear: hex('#7DB2BD'), uGndFar: hex('#C6DEE0'), uLight: [...sunDir(-0.3, 0.36), 1], uShadeTint: [0.84, 0.94, 0.97],
      uFill: V.norm([0.5, 0.45, -0.74]),
      uBlooms: pack([[touch[0], 0, touch[2], fell]]), uBloomR: pack([[2, 8, 1.5, 0]]), uBloomN: 1,
    },
    frame(t) {
      const c = cam(t), wake = [];
      // Rings where the fleck is on the water: one every third of a second while it skims.
      for (let k = Math.floor(Math.min(t, fell + 0.01) / 0.3); wake.length < 8 && k * 0.3 > t - 4.5 && k * 0.3 >= 0.9; k--) {
        const p = W(k * 0.3);
        if (p[1] < 0.5) wake.push([p[0], p[2], k * 0.3, k * 0.3 > fell - 0.2 ? 1 : 0.6]);
      }
      return {
        cam: c, wake,
        wisp: wispAt(W, t, { col: TEAL, colour: 2.3, light: 1.9 }),
        lens: { wet: wet(t), exp: exp(t) },
        u: { uWash: [0.3 + 34 * ss(11.5, 19.5, t), 0.02, 5, 1] },                      // it passes our own height as we come between the towers
        slabs: [26, 13, 6].map((d, i) => [1, c.pos[2] + d, i + 1]),
      };
    },
  };
}

// ---------------------------------------------------------------------------- 4 朱
// A rush, then a stroll, then straight up. The upper strings join (0:54.5) and the fleck is
// already going hard down a lane of the wood with great trunks standing in it one after
// another; we are after it: left of this one, right of the next, the grey wood streaming
// past, each crown going red as the fleck comes level with it. On the crest (1:05) it swings
// in under the trees to the foot of one of them and begins to wind up round its trunk. We
// let the speed go and come in after it, and the red runs on through the whole wood; the
// toadstools at the tree's foot light as it passes them. We walk slowly once round the foot
// of the tree, looking up at it going round and round above us, behind the trunk and out
// again. On the next crest (1:15.5) it goes into the crown, the leaves come down on us, and
// we go up after it, and the leaves with us.
function forest() {
  const tree = FOREST.row[10], hub = [tree.cx, 0, FOREST.bloomZ - 0.7], top = tree.cy - 0.55 * tree.r;       // the tree we walk round
  // Walking round the tree we look at its trunk, at the height the fleck has reached: the eye
  // climbs the trunk steadily and the fleck goes round and round in the picture.
  const round = (t, th) => ({ t, pos: [hub[0] + 2.3 * Math.sin(th), 1.7, hub[2] - 2.3 * Math.cos(th)], watch: (w) => [hub[0], w[1] + 0.6, hub[2]], fd: 6 });
  const chase = { watch: true, aim: 0.35 };
  const wind = (t) => { const k = (t - 9.9) / 7.3, a = -2.0 + 2.6 * 6.2832 * k; return { t, pos: [hub[0] + 1.3 * Math.sin(a), 0.9 + (top - 0.9) * k ** 1.25, hub[2] - 1.3 * Math.cos(a)] }; };
  const { W, keys } = eyes([
    { t: -1.6, pos: [-65.5, 5.0, 23.6], ...chase },
    ...FOREST.lane.map(([x, zt], k) => ({ t: -0.5 + 1.11 * k, pos: [x, [4.4, 4.1, 4.0, 4.2][k % 4], zt + (k % 2 ? 1.95 : -1.95)], ...chase })),      // round each trunk in the lane, on the side it leaves open
    { t: 9.0, pos: [12.5, 2.9, 25.6], watch: true, aim: 0.7 },                         // the crest: the speed goes, we swing in to the left after it
    { t: 10.2, pos: [15.4, 2.0, 28.2], watch: (w) => [hub[0], w[1] + 0.6, hub[2]], aim: 1, fd: 7 },
    round(12.0, Math.PI / 2), round(13.6, Math.PI), round(15.2, 1.5 * Math.PI), round(16.8, 2 * Math.PI - 0.2),      // once round the foot of the tree, the eye on it
    { t: 17.6, pos: [12.8, 2.2, 30.0], watch: true, fd: 12 },
    { t: 18.8, pos: [12.3, 6, 29.4], watch: true, fd: 20 },                            // and up past the crown, after it
    { t: 20.0, pos: [12.2, 14, 29.2], watch: true },
    { t: 21.2, pos: [12.2, 25, 29.3], watch: true },
    { t: 22.8, pos: [12.2, 38, 29.6], watch: true },
  ], (P) => fleck([
    ...follow(P, -1.8, 7.6, 0.37, 1.25, (t) => [0, 0.4 * Math.sin(t * 1.7), 0.35 * Math.sin(t * 1.3)]),
    { t: 8.6, pos: [12.0, 3.0, 28.0] }, { t: 9.3, pos: [13.4, 1.3, 31.4] },
    ...Array.from({ length: 22 }, (_, i) => wind(9.9 + (7.3 * i) / 21)),               // round and round the trunk, and up
    { t: 17.9, pos: [hub[0] + 0.3, tree.cy + 1, hub[2] + 0.5] },                       // into the crown
    { t: 18.9, pos: [13.2, 22, 36] }, { t: 20.0, pos: [13.1, 36, 41] }, { t: 21.2, pos: [13, 54, 49] }, { t: 22.8, pos: [13, 78, 60] },
  ], { seed: 4 }));
  const cam = pov(keys, { fov: [46, 64], speeds: [1.5, 8.6], bank: 12, maxBank: 16, seed: 4 });
  const crowns = [0, 2, 4, 6, 8, 9, 10, 11].map((k) => FOREST.row[k]);
  const pass = [-1.6, 0.61, 2.83, 5.05, 7.27, 9.0, 10.2, 12.0];
  const RED = [0.86, 0.24, 0.14, 0.9], exp = keyed([[18.6, 0], [21.5, 0.3]]);
  return {
    id: 'forest', name: '朱', dur: 21.875, scene: 'forest', cam, W, hub,
    shadow: { c: [-14, 0, 36], r: 82, d: 120 },
    world: {
      uSeed: 4.7, uGris: 1,
      uSkyTop: hex('#FBF4EE'), uSkyLow: hex('#F6E7DE'), uHaze: hex('#F8EBE3'), uFog: 0.007,
      uGround: 1, uGndNear: hex('#EED6C8'), uGndFar: hex('#F6E8DF'), uGndVar: 1, uLight: [...LIGHT, 0.8], uShadeTint: [0.97, 0.86, 0.88],
      uSun: [0.291, 0.446, 0.09, 0.8], uSunCol: hex('#FFF6EC'), uShaft: [0.6, 0.3, 0, 0],      // the sun stands where the light comes from
      // What we have passed is coloured behind us; each crown goes red as the fleck comes level with it.
      uPts: pack(pass.map((t) => [...cam.path(t), t])), uPtN: 8, uTrail: [0, 1, 4.2, 0], uSpread: [1.3, 1.5, 2.2, 0],
      uBlooms: pack(crowns.map((c) => [c.cx, c.cy, FOREST.bloomZ, whenAtX(W, c.cx, -1.8, 10.4)])),
      uBloomR: pack(crowns.map((c) => [c.r * 1.3, 0, 0, 0])), uBloomN: crowns.length,
    },
    frame(t) {
      const c = cam(t), up = Math.max(t - 17.4, 0) * 0.45;
      // Leaves: upright sheets of them ahead of us, and, once we are under the tree looking
      // up, level sheets that come down past us one after another.
      const slabs = [30, 20, 13, 8].map((d, i) => [2, c.pos[2] + d, i + 1]);
      if (t > 9) for (let k = 0; k < 4; k++) slabs.push([3, c.pos[1] + 0.5 + ((((k * 2.6 - 0.8 * t) % 10.4) + 10.4) % 10.4), 7 + k]);
      return {
        cam: c,
        wisp: wispAt(W, t, { col: RED, colour: 3.2 * ss(8.4, 9.6, t), light: 1.8 }),      // in the lane it is only light and a red thread: the bark it would show is dark
        lens: { exp: exp(t) },
        u: {
          uLeaf: [0.22 * t, 0.42 * t - 6 * up * up, 0.45 * t, 0.05 + 0.2 * ss(8.5, 11.5, t) + 0.25 * ss(17.4, 20.5, t)],
          // The colour keeps just behind our shoulders while we tear along; when we slow
          // it runs on ahead through the whole depth of the wood.
          uSweep: [c.pos[0] + 2 + 95 * ss(8.0, 12.0, t), 0.12, 3, 1],
        },
        slabs,
      };
    },
  };
}

// ---------------------------------------------------------------------------- 5 金
// The fastest, then the slowest. The brightest stretch of the music (1:16.5 – 1:38): we
// come up through cloud after the fleck, all white, the glass misted, and break out of the
// top of it straight at a tower. A stair winds up round it and the fleck is going up the
// stair; we go up after it, a wingspan off the treads, lanterns on the stair's edge and
// the windows of the wall lighting one after another as it reaches them, once round and
// round again. On the crest (1:27) it leaves the stair, goes up round the roof and settles
// on the very top; we come off the stair too, up past the roof and out. Then we only drift,
// in a wide slow arc, coming down, looking back at the tower as the gold climbs it from the
// cloud, window by window, and reaches the fleck at its top on the last crest (1:37.8)
// with the sun behind it.
function tower() {
  const TURN = 3 * TOWER.pitch;                                   // the turn of the stair we fly: the third above its foot
  const psiAt = (t) => 1.2 + 1.6 * (t - 4.7);                     // where we are on the stair
  const stair = (t) => ({ t, pos: [4.95 * Math.sin(psiAt(t)), stairY(psiAt(t)) + TURN + 1.5, -4.95 * Math.cos(psiAt(t))], watch: true, aim: 0.62, fd: 5 });
  const ring = (t, psi, rho, y, more) => ({ t, pos: [rho * Math.sin(psi), y, -rho * Math.cos(psi)], ...more });
  const tread = (t, ahead = 0.72) => { const p = psiAt(t) + ahead; return { t, pos: [3.85 * Math.sin(p), stairY(p) + TURN + 0.6, -3.85 * Math.cos(p)] }; };
  const tip = [0.2, TOWER.top + 9.5, 0];
  const { W, keys } = eyes([
    { t: -1.4, pos: [-8, -8, -44], watch: true, aim: 0.4 },
    { t: 0.4, pos: [-6, -4.4, -38], watch: true, aim: 0.4 },
    { t: 1.8, pos: [-3.5, -0.6, -30], watch: true, aim: 0.4 },                         // out of the top of the cloud
    { t: 3.0, pos: [0.5, 3.2, -18], watch: true, aim: 0.5 },                           // at the tower, to pass it on its right
    { t: 4.0, pos: [3.6, 6.2, -8.5], watch: true, aim: 0.6 },
    ...Array.from({ length: 11 }, (_, j) => stair(4.7 + 0.5 * j)),                     // on to the stair, and up it after the fleck: a turn and a quarter
    ring(10.2, 9.75, 7.2, 20, { watch: true, aim: 0.5 }),                              // the crest: off the stair, up and out
    ring(10.8, 10.2, 10, 26.5, { watch: true, aim: 0.6 }),
    ring(11.5, 10.6, 14.5, 32.5, { watch: true, aim: 0.85 }),                          // past the roof
    ring(12.4, 10.9, 20, 36, { watch: true, aim: 1, fd: 22 }),                         // it has settled on the top
    ring(13.8, 11.2, 25, 36.4, { look: [0, 31, 0], aim: 1, pan: true, fd: 26 }),       // and now only drifting, round and down
    ring(16.0, 11.5, 27.5, 33.5, { look: [0, 28, 0], aim: 1, pan: true, fd: 28 }),
    ring(18.5, 11.75, 28.5, 29.5, { look: [0, 29, 0], aim: 1, pan: true, fd: 28 }),
    ring(21.2, 12.0, 29, 26.3, { look: [0, 31, 0], pan: true, hold: true, fd: 29 }),               // still: the tower before the sun, the fleck at its top
    ring(23.5, 12.04, 29.3, 26, { look: [0, 31, 0], pan: true, hold: true, fd: 29 }),
  ], (P) => fleck([
    ...follow(P, -1.6, 3.2, 0.4, 0.9, (t) => [0.3 * Math.sin(t * 1.9), 0.3 * Math.sin(t * 2.3), 0]),
    ...Array.from({ length: 25 }, (_, i) => tread(4.0 + 0.25 * i)),                    // up the stair, a little way ahead of us
    ring(10.6, psiAt(10.0) + 1.5, 4.3, 31.5), ring(11.2, psiAt(10.0) + 2.5, 3.6, 34), ring(11.8, psiAt(10.0) + 3.6, 2.2, 37),
    { t: 12.4, pos: tip, hold: true }, { t: 24, pos: tip, hold: true },
  ], { seed: 5, swim: 0.05 }));
  const cam = pov(keys, { fov: [42, 66], speeds: [1.5, 10], bank: 9, maxBank: 16, seed: 5 });
  const sun = [0.56, 0.14];
  // The gold: up through the cloud as we break out of it, where it waits while we climb
  // the grey stone; then up the whole tower while we drift.
  const gold = track([{ t: 1.2, y: -14, hold: true }, { t: 4.5, y: -1.6, hold: true }, { t: 11.5, y: -1.2, hold: true }, { t: 21.25, y: 40, hold: true }], ['y']);
  const GOLD = [0.86, 0.6, 0.18, 0.9];
  const mist = keyed([[-1.4, 0.95], [0.8, 0.8], [2.9, 0]]), exp = keyed([[-1.4, 0.6], [1.6, 0.5], [3.6, 0], [19, 0], [21.25, -0.12]]);
  return {
    id: 'tower', name: '金', dur: 22.375, scene: 'tower', cam, W, gold: (t) => gold(t).y,
    shadow: { c: [0, 10, 0], r: 30, d: 80 },
    world: {
      uSeed: 5.9, uGris: 1, uWind: 1.6,
      uSkyTop: hex('#FCF8EC'), uSkyLow: hex('#F8E7BC'), uHaze: hex('#F9ECCF'), uFog: 0.004,
      uSun: [...sun, 0.2, 1], uSunCol: hex('#FEF7E0'), uLight: [...sunDir(...sun), 1], uShadeTint: [0.97, 0.86, 0.74], uShaft: [0.5, 0.22, 0, 0],
    },
    frame(t) {
      const a = 0.4 * t + 3.2, arrive = ss(20.6, 21.3, t);        // the gold reaches it: it flares
      return {
        cam: cam(t),
        wisp: wispAt(W, t, { col: GOLD, colour: 2.6, light: 1.8 + 2 * arrive, r: 0.07 * (1 + 0.6 * ss(12.2, 13.5, t) + 1.6 * arrive) }),
        lens: { mist: mist(t), exp: exp(t) },
        u: {
          uWash: [gold(t).y, -200, 3, 1],
          uCloud: [-2, 3.2, 4, t * 0.05],
          uBirds: [15 * Math.sin(a), 31 + 3 * Math.sin(0.31 * t), -15 * Math.cos(a), t > 10 ? 1 : 0], uBirdDir: [Math.cos(a), 0, Math.sin(a)],
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------- 6 留白
// Slow, then nothing moves at all. The music stops short (1:38.5) and what is left is a
// few single notes. We come up the face of a mountain and over its lip and set down on its
// shoulder, in the wind. The fleck is there already, on a cairn at the far edge; we walk
// the few steps to it, and stand, and look out at the whole country below. On the next note
// (1:48.5) it leaves the cairn; our eyes go up with it. It climbs away into the sky until
// it is a speck, and on the note at 1:51 it stops and swells: and the night floods out
// from round it across the whole sky, and it is the moon, the one circle that was never
// painted. Silence from 1:57.
function summit() {
  const [sx, sy, sz] = SUMMIT.stand, here = [sx + 0.25, sy + EYE, sz + 1.5], out = [0.4, -5, 80];
  const [maz, mel, mr] = SUMMIT.moon, far = 78, md = [Math.sin(maz) * Math.cos(mel), Math.sin(mel), Math.cos(maz) * Math.cos(mel)];
  const moon = V.add(here, V.scale(md, far)), cairn = [...SUMMIT.cairn.slice(0, 2), SUMMIT.cairn[2]], rest = [SUMMIT.cairn[0], SUMMIT.cairn[1] + 0.16, SUMMIT.cairn[2]];
  const leave = 9.67, there = 12.4;
  const { W, keys } = eyes([
    { t: -1.3, pos: [-7, -6, -6] },
    { t: 0.6, pos: [-4.5, -2.2, 0.5] },
    { t: 2.2, pos: [-2.2, 1.6, 5.2] },                                                 // over the lip
    { t: 3.5, pos: [-0.9, 1.45, 7.9], look: [0.4, -3, 60], fd: 40 },
    { t: 4.8, pos: [sx - 0.35, sy + EYE, sz - 0.7], look: out, fd: 60 },               // down
    { t: 6.1, watch: true, pan: false, glance: 0.9, fd: 2.4 },                         // it is here: on a cairn, at the far edge
    { t: 8.2, pos: here, hold: true },                                                 // a few steps, to it; and still
    { t: 8.5, look: out, fd: 60 },                                                     // and out, over the country
    { t: leave + 0.45, watch: true, pan: false, glance: 0.9, fd: 2.4 },               // it stirs
    { t: 10.7, watch: true, fd: 5 }, { t: 11.5, watch: true, fd: 30 }, { t: there, watch: true, fd: 200, blur: 0 },      // the eyes go up with it
    { t: 14.6, look: [0.25, 21.2, 91.4], pan: true, zoom: 4, fd: 200, blur: 0 },       // and settle: the moon above, the night round it
    { t: 22, pos: here, hold: true },
  ], () => fleck([
    { t: -1.3, pos: rest, hold: true }, { t: leave, pos: rest, hold: true },
    { t: 10.6, pos: [rest[0] - 0.3, 2.3, rest[2] + 1.6] }, { t: 11.4, pos: [0.6, 8.5, 28] },
    { t: there, pos: moon, hold: true }, { t: 22, pos: moon, hold: true },
  ], { seed: 6, swim: 0.03 }));
  const cam = pov(keys, { fov: [40, 52], speeds: [0.5, 4.5], eye: sy + EYE, seed: 6 });
  const night = (t) => ease(there - 0.5, 16.6, t);
  return {
    id: 'summit', name: '留白', dur: 21.125, scene: 'summit', cam, W, cairn,
    shadow: { c: [1, 0, 10], r: 18, d: 50, soft: 7 },
    world: {
      uSeed: 6.6, uWind: 2.2, uSkyLow: hex('#F4E3D2'), uHaze: hex('#F2DFCF'), uFog: 0.0009,
      uLight: [...V.norm([-0.35, 0.4, 0.85]), 0.75], uShadeTint: [0.86, 0.86, 1],     // the last light, low behind the summit
      uShaft: [0.3, 0, 0, 0],
      uMoon: [...SUMMIT.moon, 0], uTitleBox: SUMMIT.title.box, uLand: [-70, 1, 0, 0],
    },
    frame(t) {
      // It swells into the moon, and the night's wash is the wash that was round it all along.
      const grow = ease(there - 0.9, there + 1.3, t), n = night(t);
      return {
        cam: cam(t),
        wisp: wispAt(W, t, { col: [0.27, 0.25, 0.55, 0.85 * (1 - ss(0.15, 0.6, n))], r: 0.07 + (far * Math.tan(mr) - 0.07) * grow * grow, light: 1.7 * (1 - grow), on: 1 - ss(0.55, 0.95, n) }),
        u: { uNight: n, uTip: [maz, mel] },
      };
    },
  };
}

// Each shot on the film's clock. figure() is only where we are: the scenery is built clear
// of it (scenes.js). tau is the time the colour comes back by; here it is simply the shot's own.
let clock = 0;
export const SHOTS = [paper(), ruins(), lake(), forest(), tower(), summit()].map((s) => {
  const shot = { ...s, start: clock, tau: (t) => t, pre: -1.5, wisp: s.W, figure: (t) => ({ pos: s.cam.path(t) }) };
  clock += s.dur;
  return shot;
});
export const TOTAL = clock;          // 120 s: the length of the music

// What stands in or beside each path, as upright cylinders [x, z, radius, from y, to y, name]
// (a seventh entry makes it a slab: half-lengths in x and z), and balls [x, y, z, radius,
// name] for the crowns we rise past. audit() walks every path and says how near it comes
// to each: what it would hit (clear < 0.4), and what it passes close by, which is what
// gives its turns their reason. Run it from the console after moving a path or a thing:
//   (await import('/src/shots.js')).audit()
const HAZARDS = {
  ruins: [
    ...Array.from({ length: RUINS.row.n }, (_, i) => [colX(i), RUINS.row.z, 0.66, 0, 12.6, `column A${i}`]),
    ...Array.from({ length: RUINS.aisle.to - RUINS.aisle.from + 1 }, (_, k) => [colX(RUINS.aisle.from + k), RUINS.aisle.z, 0.66, 0.7, 12.6, `column B${RUINS.aisle.from + k}`]),
    ...[-0.9, 0, 0.9].map((d) => [RUINS.drum.x, RUINS.drum.z + d, 0.66, 0, 1.3, 'fallen drum']),
    ...RUINS.gate.map((g, i) => [g.x, g.z, 0.72, 0, 12 * g.stump, `gate column ${i + 1}`]),
    [-20, 19.4, 0.8, 0, 12.6, 'near column 1'], [-13.3, 18.8, 0.8, 0, 12.6, 'near column 2'],
    [RUINS.aisle.fall + 0.6, (RUINS.row.z + RUINS.aisle.z) / 2, 3.4, 0, 12, 'fallen roof'],
    [RUINS.arch.lx, RUINS.arch.z, 2.45, 0, 22, 'arch pillar L'], [RUINS.arch.lx + 25.4, RUINS.arch.z, 2.45, 0, 14.5, 'arch pillar R'],
  ],
  lake: [
    ...Array.from({ length: LAKE.jetty.bays }, (_, k) => [-0.9, 0.9].map((d) => [LAKE.jetty.x0 + k * LAKE.jetty.bay, LAKE.jetty.z + d, 0.15, -1, LAKE.jetty.deck, `jetty pile ${k}${d < 0 ? 'a' : 'b'}`])).flat(),
    [LAKE.jetty.x0 + 16, LAKE.jetty.z, 0, LAKE.jetty.deck - 0.1, LAKE.jetty.deck + 0.3, 'jetty deck', [17.5, 1.3]],
    [LAKE.post.x + 0.08, LAKE.post.z, 0.2, -1, LAKE.post.h, 'leaning post'],
    ...LAKE.cluster.map(([x, z, h], i) => [x, z, 0.17, -1, h, `bound post ${i + 1}`]),
    ...LAKE.piles.map(([x, z], i) => [x, z, 0.35, -1, 4.6, `channel pile ${i + 1}`]),
    ...LAKE.towers.map(([x, z, h, w], i) => [x, z, w / 2, -3, h * 0.84, `tower ${i + 1}`]),
  ],
  forest: [
    ...FOREST.lane.map(([x, z], k) => [x, z, 0.75, 0, 36, `lane trunk ${k + 1}`]),
    ...[9, 10, 11].map((k) => [FOREST.row[k].cx, FOREST.bloomZ + (k % 2 ? 0.9 : -0.7), 0.45, 0, FOREST.row[k].cy, `row tree ${k}`]),
  ],
  tower: [[0, 0, TOWER.r + 0.15, TOWER.base, TOWER.top, 'tower wall'], [0, 0, 3.6, TOWER.top, TOWER.top + 3, 'roof, lower'], [0, 0, 1.9, TOWER.top + 3, TOWER.top + 6, 'roof, upper']],
};
const BALLS = { forest: [9, 10, 11].map((k) => [FOREST.row[k].cx, FOREST.row[k].cy, FOREST.bloomZ + (k % 2 ? 0.9 : -0.7), FOREST.row[k].r * 1.1, `crown ${k}`]) };
export function audit(step = 1 / 48) {
  return SHOTS.map((s) => {
    const best = new Map();
    const note = (name, clear, t) => { if (!best.has(name) || clear < best.get(name)[0]) best.set(name, [clear, t]); };
    for (let t = -0.5; t <= s.dur + 0.5; t += step) {
      const [x, y, z] = s.cam.path(t);
      for (const [hx, hz, r, y0, y1, name, half] of HAZARDS[s.id] || []) {
        const dy = Math.max(y0 - y, y - y1, 0);
        const flat = half ? Math.hypot(Math.max(Math.abs(x - hx) - half[0], 0), Math.max(Math.abs(z - hz) - half[1], 0)) : Math.hypot(x - hx, z - hz) - r;
        note(name, flat < 0 && dy === 0 ? flat : Math.hypot(Math.max(flat, 0), dy), t);
      }
      for (const [bx, by, bz, r, name] of BALLS[s.id] || []) note(name, Math.hypot(x - bx, y - by, z - bz) - r, t);
    }
    const near = [...best].filter(([, [c]]) => c < 3).map(([name, [c, t]]) => ({ name, clear: +c.toFixed(2), at: +(s.start + t).toFixed(1) })).sort((a, b) => a.at - b.at);
    return { shot: s.id, hits: near.filter((n) => n.clear < 0.4), near };
  });
}

// TRANSITIONS[i] carries shot i into shot i + 1, centred on the cut. The cuts fall where
// the music breathes between two swells (0:13.6, 0:35) or where a new voice comes in
// (0:54.6, 1:16.5), and the last where it stops (1:38.9).
// type 1: a bloom from the outgoing shot's anchor; 2: a wash across; 3: through bare paper.
export const TRANSITIONS = [
  { dur: 2.4, type: 1, edge: [0.8, 0.8, 0.82] },                      // out of the grey drop at our feet
  { dur: 2.2, type: 3 },                                              // through the arch, into the light
  { dur: 3.0, type: 2, dir: [-1, 0], edge: [0.93, 0.62, 0.52] },
  { dur: 3.0, type: 2, dir: [0, -1], edge: [0.95, 0.8, 0.52] },       // we rise into it
  { dur: 2.6, type: 3 },
];

// The film ends by fading back to bare paper in the silence after the last note.
export const fadeOut = (t) => ss(TOTAL - 2.0, TOTAL - 0.4, t);
