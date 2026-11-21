// The timeline: one take. The film is a single unbroken first-person passage through one
// world, laid against the music (audio/gris-before-gris.wav, two minutes; see STORYBOARD.md
// for its phrases). There is no cut and no transition in it.
//
// The world is six places (a bare sheet, a ruin, a lake, a wood, a tower above the cloud,
// a summit), each built in its own coordinates (scenes.js) and set down in the one world
// by layout.js (PLACE). Each place still keeps its own sky, light and returning colour,
// and is painted by itself; where two meet they are joined in space, not in time (STITCHES
// below, MIX in shaders.js): the eye simply travels from one into the next.
//
// So this file has two layers:
//   an ACT per place   the eye's keys and the fleck's keys while we are in that place, in
//                      the place's own coordinates and in seconds since the act's `start`
//                      (the old shot times, so the notes on the music still hold), and what
//                      the place itself does meanwhile (frame(t): colour, weather, lens);
//   one eye, one fleck all the acts' keys lifted into the world and into film time, and
//                      made into a single pov() camera (CAM) and a single path for the
//                      fleck (FLECK). An act reads them back in its own coordinates.
// What is designed, against the music, is unchanged: every move has a thing for its reason
// (audit() checks the path against what stands in each place); strolling and tearing
// through take turns; while we are fast the world ahead is grey pencil; and there is a
// guide to follow (the fleck), so that every move has a cause.
// (v8, the cut in six shots with transitions, is kept in shots-v8.js; the cut with the
// traveller in it in shots-traveller.js.)
import { V, ss, ease, lerp, pov, track } from './camera.js';
import { SHEET, RUINS, colX, LAKE, FOREST, TOWER, stairY, SUMMIT, PLACE, JOIN, DRIFT, GLIDE, SHORE } from './layout.js';

export const FPS = 60;
export const W = 2560;          // 1440p at 60 frames a second (it was 1080p24 up to v10)
export const H = 1440;
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
  uVol: [0, 1, 0, 0], uVolW: [0, 0, 0, 0], uBore: new Float32Array(24), uBoreN: 0, uPlume: [0, 0, 0, 0],
  uStarC: [0, 1, 0, 0], uStarL: [1, 1, 1, 0], uCon: new Float32Array(32), uConN: 0, uFig: new Float32Array(160), uFigN: 0,
  uNight: -1, uMoon: [0, 0.4, 0.07, 0], uTip: [0, 0], uTitleBox: [0, 0, 1, 1], uLand: [0, 0, 0, 0], uShaft: [0, 0, 0, 0],
  uDusk: -1, uWx: [0, 0, 0, 0],
};

// When something moving in +x (a function of time that gives its place) reaches x.
const whenAtX = (at, x, t0, t1) => {
  let a = t0, b = t1;
  for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (at(m)[0] < x) a = m; else b = m; }
  return (a + b) / 2;
};
const keyed = (ks) => { const f = track(ks.map(([t, v]) => ({ t, v, hold: true })), ['v']); return (t) => f(t).v; };     // a value that eases from key to key
const mixA = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);

// Where each act begins on the film's clock: the places where the music breathes or a new voice comes in.
const START = { paper: 0, ruins: 13.625, lake: 35, forest: 54.625, tower: 76.5, summit: 98.875 };
export const TOTAL = 120;            // the length of the music
// The cloud that lies over the wood and under the tower is one cloud: the height of its top in the world, and how deep it is over the wood.
const CLOUD = { top: PLACE.tower.off[1] - 2, deep: 29 };
const FIRST = START.ruins + 10.875;  // 0:24.5, the strings come in: the first colour falls
const LEAVE = START.summit + 9.67, THERE = START.summit + 12.4;      // the fleck leaves the cairn; it is where the moon will be

// ---------------------------------------------------------------------------- the fleck
// What we follow. A spot of the paper left bare, a point of light with a wash laid round
// it: it goes ahead of us through the whole world. Where it rests we come up with it and
// look at what it is on; where it darts off we go after it, and that is why we hurry. What
// it passes wakes (lamps, windows, the water, the leaves), and round it the colour of
// things shows even while the world is still pencil. At the end it goes up into the sky
// and is the moon: the one circle that is never painted.
// It is keyed like a path ({ t, pos, hold }); follow() makes keys that keep it a little
// way ahead of us on our own path, so that it takes every gap before we do.
const WISP_N = 18, WISP_DT = 0.034;
const follow = (P, t0, t1, step, lead, off = () => [0, 0, 0]) => {
  const out = [];
  for (let t = t0; t <= t1 + 1e-6; t += step) out.push({ t, pos: V.add(P(t + (typeof lead === 'function' ? lead(t) : lead)), off(t)) });
  return out;
};
const GREY = [0.56, 0.56, 0.58, 0.8], BLUE = [0.22, 0.47, 0.8, 0.9], TEAL = [0.13, 0.5, 0.56, 0.9], RED = [0.86, 0.24, 0.14, 0.9], GOLD = [0.86, 0.6, 0.18, 0.9], NIGHT = [0.27, 0.25, 0.55, 0.85];
const MOON_FAR = 78;
// How it looks at film time T, whichever place is painting it: the pigment round it and in
// its thread (the colour of the place it is in), its size, its light, how much of it there is.
function fleckLook(T) {
  let col = mixA([0.5, 0.5, 0.52, 0.75], GREY, ss(11.8, 12.6, T));
  if (T >= FIRST) col = BLUE;                                  // nothing has colour before the first of it falls
  col = mixA(col, TEAL, ss(36.3, 37.6, T));
  col = mixA(col, RED, ss(53.4, 54.6, T));
  col = mixA(col, GOLD, ss(77.2, 78.4, T));
  col = mixA(col, NIGHT, ss(101.5, 103.5, T));
  const settle = ss(START.tower + 12.2, START.tower + 13.5, T) * (1 - ss(98.0, 98.8, T));      // on the tower's top
  const flare = ss(START.tower + 20.6, START.tower + 21.3, T) * (1 - ss(98.0, 98.8, T));       // the gold reaches it
  const grow = ease(THERE - 0.9, THERE + 1.3, T), night = ease(THERE - 0.5, START.summit + 16.6, T);
  const r = lerp(0.04, 0.07, ss(11.8, 12.6, T)) * (1 + 0.6 * settle + 1.6 * flare);
  return {
    col: [col[0], col[1], col[2], col[3] * (1 - ss(0.15, 0.6, night))],
    r: r + (MOON_FAR * Math.tan(SUMMIT.moon[2]) - r) * grow * grow,          // it swells into the moon
    light: (1.7 * ss(11.8, 12.6, T) + 2 * flare) * (1 - grow),
    on: (1 - ss(FIRST - 0.05, FIRST + 0.12, T) + ss(FIRST + 0.45, FIRST + 0.7, T)) * (1 - ss(0.55, 0.95, night)),        // it is in the stone for a moment
    night,
  };
}

// For whoever wanders the world with the fleck beside them (play.js): how it looks at T, the
// pigment it wears in each place, how its thread is sampled, and where and when it is the moon.
export const FLECK_LOOK = fleckLook;
export const PIGMENT = { paper: GREY, ruins: BLUE, lake: TEAL, forest: RED, tower: GOLD, summit: NIGHT };
export const WISP = { n: WISP_N, dt: WISP_DT };

// ---------------------------------------------------------------------------- 1 纸
// Still, then slow. We are looking down at a bare sheet and at one point on it, just ahead
// of our feet: the fleck. With the piano's first phrase (0:03) it sets off across the paper
// and a pencil line is what it leaves; the eye goes after it, then the feet, faster, the
// draughtsman's marks passing under us. Where the line ends it lifts off the sheet, comes
// back over our heads as the phrase crests (0:10), and we stop under it; it falls at our
// feet, and where it falls a drop of grey water spreads. And goes on spreading: the world
// is drawn outwards from the drop, and we are standing in a ruin (the first join).
function paper() {
  const { z, x1 } = SHEET, stop = 5.2, drop = [stop + 1.15, 0, z - 0.05], from = -12.25;
  const me = { id: 'paper', name: '纸', world: { uSeed: 1.3, uGround: 1, uGuide: [-4, z + 5, 6, 0.3] }, line: [from, z, x1, z], drop };
  me.eye = [
    { t: -1, pos: [-13, EYE, z], look: [from, 0, z], hold: true, fd: 1.2, blur: 4 },
    { t: 3.2, pos: [-13, EYE, z], look: [from, 0, z], hold: true, fd: 1.2, blur: 4 },
    { t: 4.6, watch: true, fd: 6, blur: 3 },                                           // the eye goes after it; then the feet
    { t: 5.0, pos: [-12.4, EYE, z] },
    { t: 6.2, watch: true, fd: 12 }, { t: 7.5, watch: true, fd: 16 },
    { t: 7.5, pos: [-4.6, EYE, z] },
    { t: 8.8, watch: true, fd: 12 }, { t: 9.5, watch: true, fd: 8 },                   // it leaves the paper, and comes back over us
    { t: 10.1, pos: [stop, EYE, z], hold: true },
    { t: 10.1, watch: true, fd: 4 }, { t: 10.6, watch: true, fd: 1.6, blur: 4 },       // and falls at our feet
    { t: 12.3, watch: true, fd: 1.6, blur: 4 },
    { t: 13.2, pos: [stop + 0.02, EYE, z], hold: true },
  ];
  me.fleck = () => [
    { t: -1, pos: [from, 0.035, z], hold: true }, { t: 3.0, pos: [from, 0.035, z], hold: true },
    ...Array.from({ length: 16 }, (_, i) => { const t = 3.0 + (5.8 * (i + 1)) / 16; return { t, pos: [from + (x1 - from) * ease(3.0, 8.8, t), 0.035, z] }; }),
    { t: 9.45, pos: [12.2, 2.5, z - 0.5] }, { t: 10.05, pos: [8.2, 2.3, z - 0.3] },
    { t: 10.6, pos: [drop[0], 0.035, drop[2]], hold: true }, { t: 12.3, pos: [drop[0], 0.035, drop[2]], hold: true },
  ];
  me.frame = (t) => ({
    cam: me.cam(t), wisp: me.wispAt(t, {}),
    u: { uPath: me.line, uLine: ease(3.0, 8.8, t), uDrop: [drop[0], drop[2], 1.9 * (1 - Math.exp(-Math.max(t - 10.6, 0) / 1.7)), 1] },
  });
  return me;
}

// ---------------------------------------------------------------------------- 2 灰
// A stroll, a run, and the first flight of the film. The piano's second phrase, alone: the
// ruin has drawn itself round us in pencil, and the fleck shows us round it. It hangs over
// a length of fallen column until we come; goes up to the head of a standing one while we
// go round the fallen one, and we look up after it; comes down between that column and a
// broken one, and we go between them too; and waits over a round stone set in the paving.
// We stop at the stone's edge. When the strings come in under the piano (0:24.5) it sinks
// into the stone and the first colour runs out from it over the floor and up the columns.
// Then it is up out of the stone and away, blue behind it, and the birds go up off the
// roof. We run after it: a few strides down the paving, faster and faster, and on the last
// of them we leave the ground. In between two columns of the colonnade, round to the right
// and down the aisle, columns flicking past on both sides, beams and hanging creeper
// overhead, to where the roof lies fallen across it; out to the left between two columns,
// at the great arch, and through it into the sun as the phrase crests (0:33). Beyond the
// arch stands the aqueduct, and beyond the aqueduct there is water: we go through one of
// its arches, the rain begins, and we let ourselves down towards the lake (the second join).
function ruins() {
  const z = RUINS.pathZ, first = 10.875, stone = RUINS.dais, pool = [stone.x, 0.14, stone.z];
  const A = RUINS.row.z, B = RUINS.aisle.z, mid = (A + B) / 2, [g1] = RUINS.gate, drum = RUINS.drum, aq = RUINS.aqueduct;
  const chase = { watch: true, aim: 0.4 };
  const me = { id: 'ruins', name: '灰', scene: 'ruins', shadow: { c: [20, 0, 44], r: 80, d: 140 } };
  me.eye = [
    { t: -0.1, look: [-4, 9.5, 34], fd: 14, blur: 3, glance: 0.9 },                    // the world has drawn itself: a colonnade
    { t: 0.5, watch: true, pan: false, fd: 5 },                                        // and there the fleck is, over a fallen drum
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
    { t: 11.75, pos: [0.9, EYE, z], hold: true },
    { t: 11.9, watch: true, fd: 4 }, { t: 12.3, watch: true, fd: 10 },                 // up out of the stone, and away
    { t: 12.25, pos: [2.3, EYE, 24.1] },                                               // after it: a run,
    { t: 12.75, pos: [4.6, EYE, 24.9], ...chase, fd: 14 },
    { t: 13.2, pos: [7.0, EYE - 0.07, 26.2], ...chase },                               // the last stride, down into it,
    { t: 13.6, pos: [9.4, 2.0, 28.6], ...chase },                                      // and off the ground
    { t: 14.0, pos: [12.1, 4.5, 31.4], ...chase },
    { t: 14.4, pos: [14.7, 6.6, A], ...chase },                                        // in between two columns
    { t: 14.85, pos: [18.8, 7.2, mid - 0.5], ...chase },                               // the far row is a wall ahead: round to the right
    { t: 15.5, pos: [27.0, 7.4, mid + 0.1], ...chase },                                // and down the aisle
    { t: 16.15, pos: [36.0, 7.4, mid], ...chase },
    { t: 16.77, pos: [44.5, 7.5, mid + 0.1], ...chase },
    { t: 17.15, pos: [49.4, 7.9, mid + 1.5], ...chase },                               // the roof is down across it ahead: out to the left
    { t: 17.41, pos: [51.6, 8.6, B + 0.2], ...chase },                                 // between two columns of the far row
    { t: 18.0, pos: [55.5, 10.2, 48], ...chase },
    { t: 18.75, pos: [59.2, 12, 57.5], ...chase },
    { t: 19.45, pos: [62, 13, RUINS.arch.z + 0.5], ...chase },                         // through the great arch, on the crest
    { t: 20.35, pos: [62.4, 12.2, 78], ...chase },
    { t: 21.25, pos: [aq.arch, 10.6, 89], ...chase },                                  // the aqueduct: at one of its arches
    { t: 22.2, pos: [aq.arch, 9.2, aq.z + 0.2], ...chase },                            // and through it
    { t: 22.7, pos: [aq.arch + 0.1, 8.6, aq.z + aq.deep + 0.1], ...chase },
    { t: 23.5, pos: [64.2, 5.6, 112.5], ...chase },                                    // water under us: down towards it, and slower
    { t: 24.3, pos: [67.4, 2.4, 116.8], ...chase },
  ];
  me.fleck = (P) => [
    { t: -0.1, pos: [drum.x, 1.6, drum.z - 0.2], hold: true }, { t: 1.6, pos: [drum.x, 1.6, drum.z - 0.2], hold: true },
    { t: 2.6, pos: [g1.x - 0.4, 10.3, g1.z - 1.3], hold: true }, { t: 4.8, pos: [g1.x - 0.4, 10.3, g1.z - 1.3], hold: true },      // by the head of the column
    { t: 5.4, pos: [-5.4, 4.2, 24.2] }, { t: 5.9, pos: [-4.5, 1.4, 23.8] },                                                         // down, and through between the two
    { t: 6.5, pos: [-2.0, 1.25, 24.1], hold: true }, { t: 7.2, pos: [-2.0, 1.25, 24.1], hold: true },
    { t: 8.0, pos: [pool[0], 1.2, z], hold: true }, { t: 10.0, pos: [pool[0], 1.2, z], hold: true },                                // over the stone
    { t: first, pos: pool, hold: true }, { t: 11.35, pos: pool, hold: true },                                                       // into it
    { t: 11.9, pos: [3.3, 3.0, 25.2] },
    ...follow(P, 12.4, 24.0, 0.31, keyed([[12.4, 0.9], [15.5, 1.2], [17.2, 0.7], [19.5, 1.1], [24, 0.9]]), (t) => [0, 0.35 * Math.sin(t * 1.9), 0.45 * Math.sin(t * 1.3 + 1)]),
  ];
  // The sun is low, ahead of the walk and to its left: the ruin is lit from behind, its
  // shadows run long across our path, and it stands in the opening of the great arch.
  const sun = [0.42, 0.33], sheet = PLACE.paper.off;
  // Under the roof of the aisle the lens opens; coming out at the sun it is caught open, and shuts down.
  const exp = keyed([[14.0, 0], [15.6, 0.3], [17.2, 0.38], [18.0, 0.1], [19.4, -0.22], [21.5, -0.08], [23.5, 0]]);
  const up = 13.2;                                                // the birds go up as it reaches the colonnade
  me.world = {
    uSeed: 2.1, uGris: 1,
    uSkyTop: hex('#EDEBE7'), uSkyLow: hex('#DCDBDC'), uHaze: hex('#E2E1E1'), uFog: 0.004,
    uSun: [...sun, 0.14, 0.9], uSunCol: hex('#F6F4F0'),
    uGround: 1, uGndNear: hex('#D3D3D6'), uGndFar: hex('#E6E4E1'), uGndVar: 1, uLight: [...sunDir(...sun), 0.9], uShadeTint: [0.9, 0.93, 1],
    uShaft: [0.55, 0.28, 0, 0],
    // The pencil line we came in by is still on the ground behind us.
    uPath: [-12.25 + sheet[0], SHEET.z + sheet[2], SHEET.x1 + sheet[0], SHEET.z + sheet[2]], uLine: 1,
    // The first colour: a drop that lands small, then runs. Fast enough to be on the
    // columns before we reach them; slow enough that half way down the aisle we pass it.
    uBlooms: pack([[...pool, first]]), uBloomR: pack([[0.7, 5.4, 2.2, 0]]), uBloomN: 1, uTint: [0.7, 0.85, 0.94, 0.85],
  };
  me.frame = (t) => {
    const c = me.cam(t), k = Math.max(t - up, 0), away = V.norm([0.55, 0.3, -0.78]);
    return {
      cam: c, slabs: [16, 9, 4].map((d, i) => [0, c.pos[2] + d, 3 - i]),
      wisp: me.wispAt(t, { colour: 3.4 * ss(11.5, 12.6, t) }),
      lens: { exp: exp(t) },
      u: { uBirds: [15.5 + away[0] * 6.5 * k, 14.2 + away[1] * 6.5 * k + 1.2 * Math.sqrt(k), 33 + away[2] * 6.5 * k, t > up ? 1 : 0], uBirdDir: away },
    };
  };
  return me;
}

// ---------------------------------------------------------------------------- 3 青
// A drift, a rush, a drift, a rush. We come down out of the aqueduct's arch on to a lake in
// the rain, the glass wet, losing speed, until we are low over the water and hardly moving
// (the trough, 0:35 – 0:39). The fleck is at a lantern on a leaning post, and the lantern
// lights; it goes down and under a jetty, touching the water, and we go under after it,
// between two piles, with a look up at the planks; it winds once round three posts lashed
// together and their lantern lights too. Then the swell lifts it away (0:42.5 – 0:45.6)
// and we are after it down a channel marked by three piles, right of the first, left of
// the second, right of the third, the rain running on the glass, rings spreading where it
// skims. In the trough (0:45.6) it touches the water once more, and there the colour
// falls; we come up off the water and let the speed go. It climbs between the two nearest
// towers, and we go slowly up after it and between them, close enough to touch, while the
// colour rises past us up their sides and their windows light. Round the back of the
// second tower the far shore is there, and a wood on it; the fleck is off towards it, low
// and fast, and so are we (the third join: the water's edge).
function lake() {
  const { post } = LAKE, hub = [3.95, 2.25, 35.9], touch = [15.5, 0.06, 64.5], fell = 10.6;
  const chase = { watch: true, aim: 0.4 };
  const orbit = (t, a, r = 0.9, y = hub[1]) => ({ t, pos: [hub[0] + r * Math.sin(a), y, hub[2] - r * Math.cos(a)] });
  const lamp = [post.x + 0.75, 2.55, post.z + 0.1];
  const me = { id: 'lake', name: '青', scene: 'lake', rise: (t) => 0.3 + 34 * ss(11.5, 19.5, t) };
  me.eye = [
    { t: 3.6, pos: [-1.0, 0.9, 23.2], watch: true, fd: 3 },                            // on the water: a lantern on a leaning post
    { t: 4.2, watch: true }, { t: 4.6, watch: true }, { t: 5.0, watch: true, fd: 3.5 },                   // it goes down, and under the jetty
    { t: 4.75, pos: [0.2, 0.9, 26.9] },
    { t: 5.35, look: [1.1, 2.3, 29.6], fd: 2.5, glance: 0.4 },                         // the planks, overhead
    { t: 5.6, pos: [1.0, 0.9, 29.4] },                                                 // under it, between two piles
    { t: 5.95, watch: true, pan: false, fd: 4, glance: 0.4 },                          // and there it is again, waiting
    { t: 6.45, watch: true }, { t: 6.9, watch: true }, { t: 7.37, watch: true },       // round the three posts
    { t: 6.6, pos: [1.9, 0.92, 32.2] },
    { t: 7.5, pos: [2.3, 0.95, 35.4], ...chase, tilt: -0.04, fd: 14 },                 // round them on the left; and after it, faster
    { t: 8.3, pos: [4.6, 1.0, 39.0], ...chase },
    { t: 8.75, pos: [7.5, 1.0, 41.6], ...chase },                                      // right of the first pile
    { t: 9.55, pos: [7.6, 1.05, 50.6], ...chase },                                     // left of the second
    { t: 10.35, pos: [14.2, 1.1, 58.9], ...chase },                                    // right of the third
    { t: 10.8, pos: [15.9, 1.25, 64.5], ...chase, tilt: 0 },
    { t: 11.6, pos: [18.2, 2.3, 71.5], watch: true, aim: 0.6 },                        // up off the water, and slower
    { t: 12.7, pos: [20.8, 4.2, 79.5], watch: true, aim: 0.7 },
    { t: 13.9, pos: [23.4, 5.8, 87.0], watch: true, aim: 0.7, fd: 12 },                // the towers: it is in the gap between the first and the second
    { t: 15.0, pos: [27.0, 7.0, 92.0], watch: true, aim: 0.75, fd: 8 },
    { t: 16.2, pos: [27.3, 8.3, 98.3], watch: true, aim: 0.7 },                        // between the two of them, after it
    { t: 17.2, pos: [28.8, 8.2, 104.5], watch: true, aim: 0.6 },                       // round the back of the second: the shore, and a wood
    { t: 18.0, pos: [33.5, 6.6, 110.2], ...chase, fd: 20 },                            // down, and faster
    { t: 18.9, pos: [41.5, 5.0, 114.2], ...chase },                                    // the water's edge
  ];
  me.fleck = (P) => [
    { t: 2.9, pos: lamp, hold: true }, { t: 4.0, pos: lamp, hold: true },
    { t: 4.5, pos: [0.5, 0.6, 27.7] }, { t: 4.95, pos: [1.0, 0.28, 29.3] },                       // under the jetty, on the water
    { t: 5.6, pos: [1.9, 1.05, 31.7], hold: true }, { t: 6.2, pos: [1.9, 1.05, 31.7], hold: true },
    orbit(6.45, -2.2), orbit(6.68, -1.0), orbit(6.91, 0.3), orbit(7.14, 1.6), orbit(7.37, 2.9, 1.0, 1.7), orbit(7.6, 4.1, 1.5, 0.9),      // once round the three posts
    ...follow(P, 7.9, 10.1, 0.28, keyed([[7.9, 0.7], [9, 1.0], [10.1, 0.6]]), (t) => [0.3 * Math.sin(t * 2.1), -0.74 + 0.1 * Math.sin(t * 3.3), 0]),
    { t: fell, pos: touch },                                                                       // the colour falls where it touches
    { t: 11.6, pos: [18.6, 3.4, 73] }, { t: 12.9, pos: [22.2, 6.8, 83.5] }, { t: 14.3, pos: [26.2, 9.8, 93] },
    { t: 15.5, pos: [27.2, 11.8, 98.8] }, { t: 16.5, pos: [28.6, 11.2, 105.5] },                  // through the gap, and round
    ...follow(P, 17.0, 18.6, 0.3, 1.0),
  ];
  const wet = keyed([[1.0, 0], [2.6, 0.3], [7.4, 0.34], [9.6, 0.6], [12.5, 0.34], [18, 0.08], [20, 0]]), exp = keyed([[1.0, 0.25], [3.2, 0]]);
  me.world = {
    uSeed: 3.4, uGris: 1,
    uSkyTop: hex('#EEF5F3'), uSkyLow: hex('#D6E8E9'), uHaze: hex('#D9E9EA'), uFog: 0.004,
    uSun: [-0.3, 0.33, 0.075, 1], uSunCol: hex('#F8FBFA'),
    uGround: 2, uGndNear: hex('#7DB2BD'), uGndFar: hex('#C6DEE0'), uLight: [...sunDir(-0.3, 0.33), 1], uShadeTint: [0.84, 0.94, 0.97],
    uFill: V.norm([0.5, 0.45, -0.74]),
    uBlooms: pack([[touch[0], 0, touch[2], fell]]), uBloomR: pack([[2, 8, 1.5, 0]]), uBloomN: 1,
  };
  me.frame = (t) => {
    const c = me.cam(t), wake = [];
    // Rings where the fleck is on the water: one every third of a second while it skims.
    for (let k = Math.floor(Math.min(t, fell + 0.01) / 0.3); wake.length < 8 && k * 0.3 > t - 4.5 && k * 0.3 >= 4.4; k--) {
      const p = me.W(k * 0.3);
      if (p[1] < 0.5) wake.push([p[0], p[2], k * 0.3, k * 0.3 > fell - 0.2 ? 1 : 0.6]);
    }
    return {
      cam: c, wake,
      wisp: me.wispAt(t, { colour: 2.3 }),
      lens: { wet: wet(t), exp: exp(t) },
      u: { uWash: [me.rise(t), 0.02, 5, 1] },                                          // it passes our own height as we come between the towers
      slabs: [26, 13, 6].map((d, i) => [1, c.pos[2] + d, i + 1]),
    };
  };
  return me;
}

// ---------------------------------------------------------------------------- 4 朱
// A rush, then a stroll, then straight up. The upper strings join (0:54.5) as we come in
// off the water over the bank, and the fleck is already going hard down a lane of the wood
// with great trunks standing in it one after another; we are after it: left of this one,
// right of the next, the grey wood streaming past, each crown going red as the fleck comes
// level with it. On the crest (1:05) it swings in under the trees to the foot of one of
// them and begins to wind up round its trunk. We let the speed go and come in after it,
// and the red runs on through the whole wood; the toadstools at the tree's foot light as
// it passes them. We walk slowly once round the foot of the tree, looking up at it going
// round and round above us, behind the trunk and out again. On the next crest (1:15.5) it
// goes into the crown, the leaves come down on us, and we go up after it, faster and
// faster, past the crowns and into the cloud that lies over the wood: the glass mists,
// everything goes white (the fourth join: inside the cloud).
function forest() {
  const tree = FOREST.row[10], hub = [tree.cx, 0, FOREST.bloomZ - 0.7], top = tree.cy - 0.55 * tree.r;       // the tree we walk round
  // Walking round the tree we look at its trunk, at the height the fleck has reached: the eye
  // climbs the trunk steadily and the fleck goes round and round in the picture.
  const trunk = (w) => [hub[0], w[1] + 0.6, hub[2]];
  const round = (t, th) => ({ t, pos: [hub[0] + 2.3 * Math.sin(th), 1.7, hub[2] - 2.3 * Math.cos(th)], watch: trunk, fd: 6 });
  const chase = { watch: true, aim: 0.35 };
  const wind = (t) => { const k = (t - 9.9) / 7.3, a = -2.0 + 2.6 * 6.2832 * k; return { t, pos: [hub[0] + 1.3 * Math.sin(a), 0.9 + (top - 0.9) * k ** 1.25, hub[2] - 1.3 * Math.cos(a)] }; };
  const laneAt = (k) => 0.75 + 0.96 * k;                           // when we pass the k-th trunk of the lane
  // Going up we do not look straight overhead: the tower is that way, above the cloud, and the fleck keeps a little that way of us.
  const beyond = PLACE.forest.from(PLACE.tower.to([0, 16, 0])), tw = V.norm([beyond[0] - 12.2, 0, beyond[2] - 29.6]);
  const me = { id: 'forest', name: '朱', scene: 'forest', hub, shadow: { c: [-14, 0, 36], r: 82, d: 120 } };
  me.eye = [
    { t: -0.25, pos: [-65.5, 5.0, 23.6], ...chase },                                   // over the bank, into the lane
    ...FOREST.lane.map(([x, zt], k) => ({ t: laneAt(k), pos: [x, [4.4, 4.1, 4.0, 4.2][k % 4], zt + (k % 2 ? 1.95 : -1.95)], ...chase })),      // round each trunk in the lane, on the side it leaves open
    { t: 9.0, pos: [12.5, 2.9, 25.6], watch: true, aim: 0.7 },                         // the crest: the speed goes, we swing in to the left after it
    { t: 10.2, pos: [15.4, 2.0, 28.2], watch: trunk, aim: 1, fd: 7 },
    round(12.0, Math.PI / 2), round(13.6, Math.PI), round(15.2, 1.5 * Math.PI), round(16.8, 2 * Math.PI - 0.2),      // once round the foot of the tree, the eye on it
    { t: 17.6, pos: [12.8, 2.2, 30.0], watch: true, fd: 12 },
    { t: 18.8, pos: [12.3, 6, 29.4], watch: true, fd: 20 },                            // and up past the crown, after it
    { t: 19.9, pos: [12.2, 14, 29.2], watch: true },
    { t: 20.8, pos: [12.2, 25, 29.3], watch: true },
    { t: 21.6, pos: [12.2, 38, 29.5], watch: true, aim: 0.7 },                         // faster: the cloud is just above
    { t: 22.25, pos: [12.2, 49, 29.6], look: beyond, aim: 0.3, pan: true },            // up the way the fleck has made through it
    { t: 22.7, pos: [12.2, 56, 29.6] },                                                // in it
  ];
  me.fleck = (P) => [
    ...follow(P, -0.7, 7.4, 0.37, 1.2, (t) => [0, 0.4 * Math.sin(t * 1.7), 0.35 * Math.sin(t * 1.3)]),
    { t: 8.5, pos: [12.0, 3.0, 28.0] }, { t: 9.3, pos: [13.4, 1.3, 31.4] },
    ...Array.from({ length: 22 }, (_, i) => wind(9.9 + (7.3 * i) / 21)),               // round and round the trunk, and up
    { t: 17.75, pos: [hub[0] + 0.3, tree.cy - 0.2 * tree.r, hub[2] + 0.5] },           // into the crown
    ...follow(P, 18.5, 22.4, 0.3, keyed([[18.5, 1.3], [22.4, 0.8]]), (t) => V.scale(tw, (3 + 4 * ss(18.5, 20.5, t)) * (1 - 0.85 * ss(20.8, 21.8, t)))),      // in the cloud it is straight ahead of us: it makes the way
  ];
  const crowns = [0, 2, 4, 6, 8, 9, 10, 11].map((k) => FOREST.row[k]);
  const pass = [-0.25, laneAt(0), laneAt(2), laneAt(4), laneAt(6), 9.0, 10.2, 12.0];
  // The cloud over the wood: as the eye comes up to it the air thickens to white, the glass mists, the lens is caught open.
  const cloud = (y) => ss(32, 46, y);
  me.world = {
    uSeed: 4.7, uGris: 1,
    uSkyTop: hex('#FBF4EE'), uSkyLow: hex('#F6E7DE'), uHaze: hex('#F8EBE3'), uFog: 0.007,
    uGround: 1, uGndNear: hex('#EED6C8'), uGndFar: hex('#F6E8DF'), uGndVar: 1, uLight: [...LIGHT, 0.8], uShadeTint: [0.97, 0.86, 0.88],
    uSun: [0.291, 0.446, 0.09, 0.8], uSunCol: hex('#FFF6EC'), uShaft: [0.6, 0.3, 0, 0],      // the sun stands where the light comes from
    uBloomR: pack(crowns.map((c) => [c.r * 1.3, 0, 0, 0])), uBloomN: crowns.length, uPtN: 8, uTrail: [0, 1, 4.2, 0], uSpread: [1.3, 1.5, 2.2, 0],
  };
  // What we have passed is coloured behind us; each crown goes red as the fleck comes level with it.
  // (These need the one eye and the one fleck, which exist only when every act has been read.)
  me.init = () => {
    me.world.uPts = pack(pass.map((t) => [...me.cam.path(t), t]));
    me.world.uBlooms = pack(crowns.map((c) => [c.cx, c.cy, FOREST.bloomZ, whenAtX(me.W, c.cx, -0.7, 10.4)]));
  };
  me.frame = (t) => {
    // (tt: walked live, the world's air keeps its own time while its story waits or stands still: me.live.wait, from play.js.)
    const c = me.cam(t), up = Math.max(t - 17.4, 0) * 0.45, cl = cloud(c.pos[1]), tt = t + (me.live?.wait ?? 0);
    // Leaves: upright sheets of them ahead of us, and, once we are under the tree looking
    // up, level sheets that come down past us one after another.
    const slabs = [30, 20, 13, 8].map((d, i) => [2, c.pos[2] + d, i + 1]);
    if (t > 9) for (let k = 0; k < 4; k++) slabs.push([3, c.pos[1] + 0.5 + ((((k * 2.6 - 0.8 * tt) % 10.4) + 10.4) % 10.4), 7 + k]);
    return {
      cam: c,
      wisp: me.wispAt(t, { colour: 3.2 * ss(8.4, 9.6, t) }),      // in the lane it is only light and a red thread: the bark it would show is dark
      lens: { exp: 0.2 * ss(18.6, 21, t) + 0.1 * cl, mist: 0.4 * ss(40, 52, c.pos[1]), wet: 0.4 * ss(38, 50, c.pos[1]) },      // in the cloud: mist and fine drops on the glass
      u: {
        uFog: 0.007 + 0.03 * cl,
        // (Walked freely, me.live: the cloud gathers as WE rise to it, whenever that is; the leaves
        // stop coming down so thick once the story has left; and the colour goes by where the film's
        // eye went, not ours: by ours it came with us into a wood the fleck had not reached, and left
        // the trees again when we turned back.)
        uVol: [CLOUD.top - PLACE.forest.off[1], CLOUD.deep, me.live ? Math.max(me.live.plain ? 0 : ss(19.2, 21.0, t), ss(14, 28, c.pos[1])) : ss(19.2, 21.0, t), (me.start + tt) * 0.017],      // the cloud that lies over the wood gathers as we rise to it
        uLeaf: [0.22 * tt, 0.42 * tt - 6 * up * up, 0.45 * tt, 0.05 + 0.2 * ss(8.5, 11.5, t) + 0.25 * ss(17.4, 20.5, t) * (me.live ? 1 - 0.8 * ss(24, 32, t) : 1)],
        // The colour keeps just behind our shoulders while we tear along; when we slow
        // it runs on ahead through the whole depth of the wood.
        uSweep: [(me.live ? me.cam.path(t)[0] + 300 * ss(21, 28, t) : c.pos[0]) + 2 + 95 * ss(8.0, 12.0, t), 0.12, 3, 1],
      },
      slabs,
    };
  };
  return me;
}

// ---------------------------------------------------------------------------- 5 金
// The fastest, then the slowest, then a long glide. The brightest stretch of the music
// (1:16.5 – 1:38): we go on up through the cloud after the fleck, all white, the glass
// misted, and break out of the top of it (1:18.3) with a tower straight ahead. A stair
// winds up round it and the fleck is going up the stair; we go up after it, a wingspan off
// the treads, lanterns on the stair's edge and the windows of the wall lighting one after
// another as it reaches them, once round and round again. On the crest (1:27) it leaves the
// stair, goes up round the roof and settles on the very top; we come off the stair too, up
// past the roof and out. Then we only drift, in a wide slow arc, coming down, looking back
// at the tower as the gold climbs it from the cloud, window by window, and reaches the
// fleck at its top on the last crest (1:37.8) with the sun behind it. The music stops
// short. In the quiet the fleck leaves the tower's top and goes off over the cloud, past
// the tower, towards a mountain that stands at the cloud's edge; and we glide after it,
// with only the wind (the fifth join: the edge of the cloud sea).
function tower() {
  const TURN = 3 * TOWER.pitch;                                   // the turn of the stair we fly: the third above its foot
  const psiAt = (t) => 1.2 + 1.6 * (t - 4.7);                     // where we are on the stair
  const stair = (t) => ({ t, pos: [4.95 * Math.sin(psiAt(t)), stairY(psiAt(t)) + TURN + 1.5, -4.95 * Math.cos(psiAt(t))], watch: true, aim: 0.62, fd: 5 });
  const ring = (t, psi, rho, y, more) => ({ t, pos: [rho * Math.sin(psi), y, -rho * Math.cos(psi)], ...more });
  const tread = (t, ahead = 0.72) => { const p = psiAt(t) + ahead; return { t, pos: [3.85 * Math.sin(p), stairY(p) + TURN + 0.6, -3.85 * Math.cos(p)] }; };
  const glide = (t, s, y, more) => ({ t, pos: [DRIFT[0] + s * GLIDE[0], y, DRIFT[2] + s * GLIDE[2]], ...more });      // from the end of the drift, s on the way to the mountain
  const tip = [0.2, TOWER.top + 9.5, 0];
  const gold = track([{ t: 1.2, y: -14, hold: true }, { t: 4.5, y: -1.6, hold: true }, { t: 11.5, y: -1.2, hold: true }, { t: 21.25, y: 40, hold: true }], ['y']);
  const me = { id: 'tower', name: '金', scene: 'tower', gold: (t) => gold(t).y, shadow: { c: [0, 10, 0], r: 30, d: 80 } };
  me.eye = [
    { t: 1.35, pos: [-4.7, -5.2, -34.6], look: [0, 16, 0], aim: 0.3, pan: true },      // up through the cloud, by the way the fleck has made
    { t: 1.85, pos: [-4.0, -1.0, -32.0], look: [0, 14, 0], aim: 0.6, pan: true },      // out of the top of it: the tower
    { t: 2.4, pos: [-2.4, 1.8, -26.5], watch: true, aim: 0.5 },
    { t: 3.2, pos: [0.5, 3.2, -18], watch: true, aim: 0.5 },                           // at the tower, to pass it on its right
    { t: 4.1, pos: [3.6, 6.2, -8.5], watch: true, aim: 0.6 },
    ...Array.from({ length: 11 }, (_, j) => stair(4.7 + 0.5 * j)),                     // on to the stair, and up it after the fleck: a turn and a quarter
    ring(10.2, 9.75, 7.2, 20, { watch: true, aim: 0.5 }),                              // the crest: off the stair, up and out
    ring(10.8, 10.2, 10, 26.5, { watch: true, aim: 0.6 }),
    ring(11.5, 10.6, 14.5, 32.5, { watch: true, aim: 0.85 }),                          // past the roof
    ring(12.4, 10.9, 20, 36, { watch: true, aim: 1, fd: 22 }),                         // it has settled on the top
    ring(13.8, 11.2, 25, 36.4, { look: [0, 31, 0], aim: 1, pan: true, fd: 26 }),       // and now only drifting, round and down
    ring(16.0, 11.5, 27.5, 33.5, { look: [0, 28, 0], aim: 1, pan: true, fd: 28 }),
    ring(18.5, 11.75, 28.5, 29.5, { look: [0, 29, 0], aim: 1, pan: true, fd: 28 }),
    ring(21.2, 12.0, 29, 26.3, { look: [0, 31, 0], pan: true, hold: true, fd: 29 }),   // still: the tower before the sun, the fleck at its top
    { t: 21.55, pos: [...DRIFT], hold: true },
    { t: 22.0, watch: true, aim: 0.8, pan: false, glance: 0.6, fd: 30 },               // it is off the tower: after it
    glide(22.4, 5, 25.9, { watch: true, aim: 0.5 }),
    glide(23.3, 16, 23.5, { watch: true, aim: 0.5 }),                                  // the tower goes by on our left
    glide(24.2, 29, 19.5, { watch: true, aim: 0.5 }),
    glide(25.1, 43, 13.5, { watch: true, aim: 0.5 }),                                  // out over the edge of the cloud: the mountain
  ];
  me.fleck = (P) => [
    ...follow(P, 0.9, 3.2, 0.4, 0.9, (t) => [0.3 * Math.sin(t * 1.9), 0.3 * Math.sin(t * 2.3), 0.8]),
    ...Array.from({ length: 25 }, (_, i) => tread(4.0 + 0.25 * i)),                    // up the stair, a little way ahead of us
    ring(10.6, psiAt(10.0) + 1.5, 4.3, 31.5), ring(11.2, psiAt(10.0) + 2.5, 3.6, 34), ring(11.8, psiAt(10.0) + 3.6, 2.2, 37),
    { t: 12.4, pos: tip, hold: true }, { t: 21.6, pos: tip, hold: true },
    ...follow(P, 22.2, 25.4, 0.4, keyed([[22.2, 2.0], [25.4, 1.3]])),                  // and away, ahead of us, to the mountain
  ];
  const sun = [0.56, 0.14];
  const mist = keyed([[0.6, 0.5], [1.5, 0.45], [2.7, 0]]), exp = keyed([[0.6, 0.15], [1.8, 0.3], [3.4, 0], [19, 0], [21.25, -0.12], [23.5, 0]]);
  me.world = {
    uSeed: 5.9, uGris: 1, uWind: 1.6,
    uSkyTop: hex('#FCF8EC'), uSkyLow: hex('#F8E7BC'), uHaze: hex('#F9ECCF'), uFog: 0.004,
    uSun: [...sun, 0.2, 1], uSunCol: hex('#FEF7E0'), uLight: [...sunDir(...sun), 1], uShadeTint: [0.97, 0.86, 0.74], uShaft: [0.5, 0.22, 0, 0],
  };
  me.frame = (t) => {
    const tt = t + (me.live?.wait ?? 0), a = 0.4 * tt + 3.2;
    return {
      cam: me.cam(t),
      wisp: me.wispAt(t, { colour: 2.6 }),
      lens: { mist: mist(t), exp: exp(t), wet: 0.4 * (1 - ss(2.0, 4.2, t)) },
      u: {
        // The gold: up through the cloud as we break out of it, where it waits while we
        // climb the grey stone; then up the whole tower while we drift.
        uWash: [gold(t).y, -200, 3, 1],
        uVol: [CLOUD.top - PLACE.tower.off[1], 60, 1, (me.start + tt) * 0.017],            // the sea of cloud
        uBirds: [15 * Math.sin(a), 31 + 3 * Math.sin(0.31 * tt), -15 * Math.cos(a), t > 10 ? 1 : 0], uBirdDir: [Math.cos(a), 0, Math.sin(a)],
      },
    };
  };
  return me;
}

// ---------------------------------------------------------------------------- 6 留白
// Slow, then nothing moves at all. What is left of the music is a few single notes. We
// come in under the mountain's lip, up its face and over it, and set down on its shoulder
// on one of the notes (1:45.9), in the wind. The fleck is there already, on a cairn at the
// far edge; we walk the few steps to it, and stand, and look out at the whole country
// below. On the next note (1:48.5) it leaves the cairn; our eyes go up with it. It climbs
// away into the sky until it is a speck, and on the note at 1:51 it stops and swells: and
// the night floods out from round it across the whole sky, and it is the moon, the one
// circle that was never painted. Silence from 1:57.
function summit() {
  const [sx, sy, sz] = SUMMIT.stand, here = [sx + 0.25, sy + EYE, sz + 1.5], out = [0.4, -5, 80];
  const [maz, mel] = SUMMIT.moon, md = [Math.sin(maz) * Math.cos(mel), Math.sin(mel), Math.cos(maz) * Math.cos(mel)];
  const moon = V.add(here, V.scale(md, MOON_FAR)), rest = [SUMMIT.cairn[0], SUMMIT.cairn[1] + 0.16, SUMMIT.cairn[2]];
  const leave = 9.67, there = 12.4;
  const me = { id: 'summit', name: '留白', scene: 'summit', shadow: { c: [1, 0, 10], r: 18, d: 50, soft: 7 } };
  me.eye = [
    { t: 3.5, pos: [-7, -6, -6], watch: true, aim: 0.4 },                              // in under the lip
    { t: 4.4, pos: [-4.5, -2.2, 0.5], aim: 0 },
    { t: 5.45, pos: [-2.2, 1.6, 5.2] },                                                // over it
    { t: 6.25, pos: [-0.9, 1.45, 7.9], look: [0.4, -3, 60], fd: 40 },
    { t: 7.0, pos: [sx - 0.35, sy + EYE, sz - 0.7], look: out, fd: 60 },               // down, on the note
    { t: 7.6, watch: true, pan: false, glance: 0.7, fd: 2.4 },                         // it is here: on a cairn, at the far edge
    { t: 8.75, pos: here, hold: true },                                                // a few steps, to it; and still
    { t: 9.05, look: out, fd: 60, glance: 0.6 },                                       // and out, over the country
    { t: leave + 0.45, watch: true, pan: false, glance: 0.9, fd: 2.4 },                // it stirs
    { t: 10.7, watch: true, fd: 5 }, { t: 11.5, watch: true, fd: 30 }, { t: there, watch: true, fd: 200, blur: 0 },      // the eyes go up with it
    { t: 14.6, look: [0.25, 21.2, 91.4], pan: true, zoom: 4, fd: 200, blur: 0 },       // and settle: the moon above, the night round it
    { t: 22, pos: here, hold: true },
  ];
  me.fleck = () => [
    { t: 3.9, pos: rest, hold: true }, { t: leave, pos: rest, hold: true },
    { t: 10.6, pos: [rest[0] - 0.3, 2.3, rest[2] + 1.6] }, { t: 11.4, pos: [0.6, 8.5, 28] },
    { t: there, pos: moon, hold: true }, { t: 22, pos: moon, hold: true },
  ];
  me.world = {
    uSeed: 6.6, uWind: 2.2, uSkyLow: hex('#F4E3D2'), uHaze: hex('#F2DFCF'), uFog: 0.0009,
    uLight: [...V.norm([-0.35, 0.4, 0.85]), 0.75], uShadeTint: [0.86, 0.86, 1],       // the last light, low behind the summit
    uShaft: [0.3, 0, 0, 0],
    uMoon: [...SUMMIT.moon, 0], uTitleBox: SUMMIT.title.box, uLand: [-86, 1, 0, 0],
  };
  // The night's wash is the wash that was round the fleck all along: it pours out from where the fleck has stopped.
  // A flight of birds crosses below the shoulder while we stand and look out.
  // (Walked live it comes by again every forty seconds, for as long as it is day.)
  me.frame = (t) => {
    const b = me.live ? ((t + (me.live.wait ?? 0)) % 40) + 4 : t, on = me.live ? fleckLook(me.start + t).night < 0.3 : t > 6.5 && t < 16;
    return { cam: me.cam(t), wisp: me.wispAt(t, {}), u: { uNight: fleckLook(me.start + t).night, uTip: [maz, mel],
      uBirds: [-34 + 7.5 * (b - 6.5), -2.2 + 0.8 * Math.sin(0.6 * b), 36 + 1.5 * (b - 6.5), on ? 1 : 0], uBirdDir: V.norm([1, 0, 0.2]) } };
  };
  return me;
}

// ---------------------------------------------------------------------------- one eye, one fleck
// The acts, on the film's clock; then every act's keys lifted into the world and into film
// time, and made into the one camera and the one fleck.
const ACTS = [paper(), ruins(), lake(), forest(), tower(), summit()];
ACTS.forEach((a, i) => { a.start = START[a.id]; a.dur = (ACTS[i + 1] ? START[ACTS[i + 1].id] : TOTAL) - a.start; a.place = PLACE[a.id]; });
const lifted = ACTS.flatMap((a) => a.eye.map((k) => ({ ...k, t: a.start + k.t, act: a, ...(k.pos ? { pos: a.place.to(k.pos) } : {}), ...(k.look ? { look: a.place.to(k.look) } : {}) })));
const way = track(lifted.filter((k) => k.pos).sort((a, b) => a.t - b.t), ['pos']);
const fkeys = ACTS.flatMap((a) => a.fleck((t) => a.place.from(way(a.start + t).pos)).map((k) => ({ t: a.start + k.t, pos: a.place.to(k.pos), hold: k.hold }))).sort((a, b) => a.t - b.t);
const ftrack = track(fkeys, ['pos']);
// The fleck, in the world, at film time T. It is never quite still: it swims a little about where it is.
export const FLECK = (T) => {
  const p = ftrack(T).pos, sw = lerp(0.012, 0.07, ss(11.8, 12.6, T)) * (1 - 0.55 * ss(102.5, 103.5, T));
  return [p[0] + sw * Math.sin(T * 2.3 + 1), p[1] + 0.7 * sw * Math.sin(T * 3.1 + 2), p[2] + sw * Math.cos(T * 1.9 + 3)];
};
// An eye key may `watch` the fleck: the gaze goes to it (all the way from the key before,
// unless the key says it is a glance: pan: false) and stays on it wherever it goes. A
// function for `watch` is given the fleck's place (in the act's own coordinates) and says
// where to look instead.
const seen = new Map();          // one function per way of watching, so that the gaze knows two keys watch the same thing
const watcher = (k) => {
  if (typeof k.watch !== 'function') return FLECK;
  if (!seen.has(k.watch)) seen.set(k.watch, (T) => k.act.place.to(k.watch(k.act.place.from(FLECK(T)))));
  return seen.get(k.watch);
};
const eyeKeys = lifted.map((k) => (k.watch ? { pan: true, ...k, at: watcher(k) } : k));
// The lens and the bank suit the place we are in; on foot the eye is at EYE above the ground of that place.
const LENS = [
  [0, { fov: [38, 52], speeds: [0.4, 4.5], bank: 9, maxBank: 16 }],
  [12.5, { fov: [44, 66], speeds: [1.5, 12], bank: 10, maxBank: 16 }],
  [36.5, { fov: [46, 66], speeds: [1.5, 10], bank: 14, maxBank: 14 }],
  [53.5, { fov: [46, 64], speeds: [1.5, 9.5], bank: 12, maxBank: 16 }],
  [77.3, { fov: [42, 66], speeds: [1.5, 10], bank: 9, maxBank: 16 }],
  [102.4, { fov: [40, 56], speeds: [0.5, 8], bank: 9, maxBank: 16 }],
];
export const CAM = pov(eyeKeys, { seed: 2, at: (T) => ({ ...(LENS.filter(([t0]) => T >= t0).pop() || LENS[0])[1], hand: 1 + 1.1 * ss(75.6, 76.4, T) * (1 - ss(78.0, 78.8, T)),      // in the cloud the air is rough
  eye: T < 28 ? EYE : T > 105.2 ? PLACE.summit.off[1] + EYE : null }) });      // on foot in the ruin, until we leave the ground; and again on the mountain

// Each act as the renderer wants it: a "shot" with its own clock, whose camera and fleck
// are the one eye and the one fleck read back in the act's own coordinates.
// The diagram on the sky (shaders.js, diagram()): its centre is where the moon will be, in
// every place; each place draws it in its own pigment. And our own constellation, in the
// last sky: the way we came, seen from above, as seven stars that light one after another
// as the night comes, the last of them the moon.
const MIST = { paper: 0.012, ruins: 0.018, lake: 0.016, forest: 0.014, tower: 0.008, summit: 0.0022 };      // how thick a mist each place takes (the mountain looks out over a whole country)
const SKY = { paper: [[0.6, 0.6, 0.62], 0.3], ruins: [[0.5, 0.57, 0.7], 0.8], lake: [[0.36, 0.6, 0.66], 0.8], forest: [[0.84, 0.5, 0.45], 0.7], tower: [[0.8, 0.58, 0.26], 0.8], summit: [[0.48, 0.42, 0.7], 0.75] };
const moonWay = PLACE.summit.dir([Math.sin(SUMMIT.moon[0]) * Math.cos(SUMMIT.moon[1]), Math.sin(SUMMIT.moon[1]), Math.cos(SUMMIT.moon[0]) * Math.cos(SUMMIT.moon[1])]);
export const MOON = { way: moonWay, far: MOON_FAR, leave: LEAVE, there: THERE };
const OURS = (() => {
  const end = PLACE.summit.to(SUMMIT.stand), k = 0.00183;          // radians of sky to a unit of ground
  const stops = [JOIN.drop, [RUINS.dais.x, 0, RUINS.dais.z], [62, 0, RUINS.arch.z], PLACE.lake.to([15.5, 0, 64.5]), PLACE.forest.to([FOREST.row[10].cx, 0, FOREST.bloomZ]), PLACE.tower.to([0, 0, 0]), end];
  return stops.map((p) => { const az = SUMMIT.moon[0] + (p[0] - end[0]) * k, el = SUMMIT.moon[1] + (p[2] - end[2]) * k; return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]; });
})();
// The constellations: seven figures of a few stars each, set about the sky (az, el in the
// world), each a line of points in radians from its first star; `null` lifts the pen (the
// next point starts a new stroke of the same figure).
const FIGURES = [
  [[0.18, 0.56], [[0, 0], [0.07, 0.03], [0.15, 0.04], [0.22, 0.02], [0.27, -0.04], [0.24, -0.09]]],                        // a long arc with a hook
  [[1.38, 0.50], [[0, 0], [0.08, 0.05], [0.13, -0.02], [0, 0], [-0.07, -0.05]]],                                           // a triangle with a tail
  [[-0.55, 0.36], [[0, 0], [0.05, 0.07], [0.1, 0.01], [0.15, 0.08], [0.2, 0.02]]],                                         // a zigzag
  [[2.45, 0.72], [[0, 0.1], [0, 0], [0, -0.12], null, [-0.06, 0.02], [0, 0], [0.07, 0.03]]],                               // a cross
  [[0.78, 0.98], [[0, 0], [0.06, -0.01], [0.11, 0.02], [0.16, 0], [0.18, -0.06], [0.24, -0.07], [0.25, 0], [0.16, 0]]],    // a ladle
  [[-1.4, 0.62], [[0, 0], [0.05, 0.03], [0.04, 0.1]]],                                                                     // three
  [[3.4, 0.42], [[0, 0], [0.04, 0.05], [0.1, 0.07], [0.16, 0.05], [0.2, 0]]],                                              // a crown
];
const BORE = [[75.85, 2.6], [76.45, 2.4], [77.05, 2.5], [77.65, 2.7], [78.15, 3.3], [78.6, 5.0]];      // film times along our way up; how wide the way is there
const FIG_WORLD = FIGURES.flatMap(([[az, el], pts]) => { let pen = 0; return pts.flatMap((q) => { if (!q) { pen = 0; return []; } const a = az + q[0] / Math.cos(el), e = el + q[1], w = pen; pen = 1; return [[Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e), w]]; }); });
export const SHOTS = ACTS.map((a) => {
  const fig = new Float32Array(160);
  FIG_WORLD.forEach(([x, y, z, w], i) => { const o = a.place.from([0, 0, 0]), d = a.place.from([x, y, z]); fig.set([d[0] - o[0], d[1] - o[1], d[2] - o[2], w ? 0.9 - 0.001 * i : 0.4 - 0.001 * i], i * 4); });
  const origin = a.place.from([0, 0, 0]), starC = a.place.from(moonWay).map((x, i) => x - origin[i]), [tint, pencil] = SKY[a.id], paint = a.frame;
  const moonAt = [Math.atan2(starC[0], starC[2]), Math.atan2(starC[1], Math.hypot(starC[0], starC[2]))];      // where the moon is, seen from this place: bearing, height
  a.frame = (t) => {
    const f = paint(t), T = a.start + t, L = fleckLook(T);
    if (a.id === 'forest' || a.id === 'tower') {
      // The way up through the cloud: the fleck opens it a little ahead of us, and it closes slowly behind.
      const bore = new Float32Array(24);
      BORE.forEach(([Tk, R], i) => bore.set([...a.place.from(CAM.path(Tk)), R * ss(Tk - 1.5, Tk - 0.8, T) * (1 - 0.5 * ss(Tk + 3, Tk + 10, T))], i * 4));
      const out = a.place.from(CAM.path(78.3));
      f.u = { ...f.u, uBore: bore, uBoreN: BORE.length, uVolW: [a.place.yaw, ...a.place.off], uPlume: [out[0], out[2], T - 78.25, 6 * ss(77.9, 78.5, T) * (1 - ss(78.8, 83, T))] };
    }
    f.u = { ...f.u, uFig: fig, uFigN: FIG_WORLD.length, uStarC: [...starC, pencil * (1 - 0.6 * L.night)], uStarL: [...tint, a.id === 'summit' ? L.night : a.id === 'tower' ? 0.3 * ss(START.tower + 20.6, START.tower + 21.6, T) : 0] };
    if (a.live && !a.live.film) {
      // Walked live (not: the film played back as it was shot). Night is the world's, not the mountain's alone: when the story's clock comes to
      // its end it falls on every place, out of the moon, all the way round the sky, and what
      // stands under it goes dark with it (uDusk) while the lamps stay lit. And the weather is
      // whatever was asked for (a.live.wx, from play.js): mist, rain, snow, each 0 … 1.
      const w = { ...BASE, ...a.world, ...f.u }, D = ss(0.1, 0.7, L.night), wx = a.live.wx || {}, mist = wx.mist || 0, rain = wx.rain || 0, snow = wx.snow || 0, dull = Math.max(0.75 * mist, 0.9 * rain, 0.85 * snow);
      const breath = wx.pulse || 0;                                 // the music, breathing (0 … 1): the drawing on the sky and the light in the air answer it
      Object.assign(f.u, {
        uNight: L.night > 0 ? 2.4 * L.night : -1, uDusk: D, uTip: moonAt, uMoon: [...moonAt, SUMMIT.moon[2], 0],
        uStarL: [...tint, Math.max(L.night, f.u.uStarL[3])], uStarC: [...starC, f.u.uStarC[3] * (1 + 0.5 * breath)],
        uSun: [w.uSun[0], w.uSun[1], w.uSun[2], w.uSun[3] * (1 - D) * (1 - dull)],
        uShaft: [w.uShaft[0] * (1 - 0.4 * D) * (1 - 0.6 * Math.max(rain, snow)) * (1 + 0.5 * mist), w.uShaft[1] * (1 - D) * (1 - Math.max(rain, snow)) * (1 + 1.6 * mist) * (1 + 0.5 * breath), 0, 0],      // in mist the light stands in the air as beams
        uLight: [w.uLight[0], w.uLight[1], w.uLight[2], w.uLight[3] * (1 - 0.3 * D) * (1 - 0.45 * Math.max(rain, snow, 0.6 * mist))],
        uFog: w.uFog * (1 + 2 * mist + 0.8 * rain + 1.2 * snow) + MIST[a.id] * (mist + 0.25 * rain + 0.35 * snow),
        uWx: [mist, rain, snow, wx.pulse || 0],
      });
      if (a.live.plain || a.id !== 'summit') f.u.uTitleBox = [9, 9, 0.001, 0.001];      // the title belongs to the film's last sky
    }
    if (a.id === 'summit') { const con = new Float32Array(32); OURS.forEach((d, i) => con.set([...d, ss(THERE - 0.2 + 0.55 * i, THERE + 0.5 + 0.55 * i, T)], i * 4)); f.u.uCon = con; f.u.uConN = OURS.length; }
    return f;
  };
  const local = (c) => { const pos = a.place.from(c.pos), dir = a.place.dir ? a.place.from(V.add(c.pos, c.dir)).map((x, i) => x - pos[i]) : c.dir; return { ...c, pos, dir, look: V.add(pos, V.scale(dir, 10)) }; };
  // (a.live: the eye of whoever is walking the world themselves, in this place's coordinates; play.js. Then the place goes by that eye.)
  a.local = local;
  a.cam = (t) => a.live || local(CAM(a.start + t));
  a.cam.path = (t) => a.place.from(CAM.path(a.start + t));
  a.W = (t) => a.place.from(FLECK(a.start + t));
  a.wisp = a.W;
  // What the renderer needs of the fleck for one frame: where it is and has just been, and how it looks.
  a.wispAt = (t, { colour = 0 }) => {
    const pts = new Float32Array(80), L = fleckLook(a.start + t);
    for (let k = 0; k < WISP_N; k++) pts.set([...a.W(t - k * WISP_DT), k / (WISP_N - 1)], k * 4);
    return { pts, n: WISP_N, col: L.col, p: [L.r, L.light, colour, L.on], tail: ss(8.75, 9.3, a.start + t) };      // on the sheet the pencil line is its thread
  };
  a.tau = (t) => t;
  a.pre = -1.5;
  a.figure = (t) => ({ pos: a.cam.path(t) });
  return a;
});
SHOTS.forEach((a) => a.init?.());

// ---------------------------------------------------------------------------- the joins
// STITCHES[i] joins act i to act i + 1. Between `from` and `to` both places are painted
// (the far one may come up out of the haze over a few seconds: `fade`); before, only the
// first; after, only the second.
//   type 6  the second place is drawn outwards from a point (centre), as far as R(T)
//   type 4  across a plane in the world (plane): `sky` is the distance over which one sky
//           goes over into the other as the eye passes; `rag` makes the join ragged
//   type 5  one into the other, inside cloud
export const STITCHES = [
  { a: 0, b: 1, from: 11.7, to: 20.5, type: 6, centre: JOIN.drop, sky: 130, edge: [0.8, 0.8, 0.82], R: (T) => 1.9 * ss(11.8, 12.8, T) + 8.5 * Math.max(T - 12.6, 0) ** 1.7 },
  { a: 1, b: 2, from: 29.5, to: 38.3, type: 4, plane: JOIN.aqueduct, sky: 12, fade: (T) => ss(29.5, 31.5, T) },
  { a: 2, b: 3, from: 38.4, to: 55.6, type: 4, plane: JOIN.shore, sky: 12, fade: (T) => ss(38.4, 41.6, T) },
  { a: 3, b: 4, from: 77.15, to: 77.6, type: 5 },
  { a: 4, b: 5, from: 97.8, to: 106.4, type: 4, plane: JOIN.cloudEdge, sky: 16, rag: 7, fade: (T) => ss(97.9, 100.4, T) },      // the cloud opens when the music stops
];

// What stands in or beside each path, as upright cylinders [x, z, radius, from y, to y, name]
// (a seventh entry makes it a slab: half-lengths in x and z), and balls [x, y, z, radius,
// name] for the crowns we rise past. audit() walks every path and says how near it comes
// to each: what it would hit (clear < 0.4), and what it passes close by, which is what
// gives its turns their reason. Run it from the console after moving a path or a thing:
//   (await import('/src/shots.js')).audit()
export const HAZARDS = {
  ruins: [
    ...Array.from({ length: RUINS.row.n }, (_, i) => [colX(i), RUINS.row.z, 0.66, 0, 12.6, `column A${i}`]),
    ...Array.from({ length: RUINS.aisle.to - RUINS.aisle.from + 1 }, (_, k) => [colX(RUINS.aisle.from + k), RUINS.aisle.z, 0.66, 0.7, 12.6, `column B${RUINS.aisle.from + k}`]),
    ...[-0.9, 0, 0.9].map((d) => [RUINS.drum.x, RUINS.drum.z + d, 0.66, 0, 1.3, 'fallen drum']),
    ...RUINS.gate.map((g, i) => [g.x, g.z, 0.72, 0, 12 * g.stump, `gate column ${i + 1}`]),
    [-20, 19.4, 0.8, 0, 12.6, 'near column 1'], [-13.3, 18.8, 0.8, 0, 12.6, 'near column 2'],
    [RUINS.aisle.fall + 0.6, (RUINS.row.z + RUINS.aisle.z) / 2, 3.4, 0, 12, 'fallen roof'],
    [RUINS.arch.lx, RUINS.arch.z, 2.45, 0, 22, 'arch pillar L'], [RUINS.arch.lx + 25.4, RUINS.arch.z, 2.45, 0, 14.5, 'arch pillar R'],
    ...[-5, 5].map((d) => [RUINS.aqueduct.arch + d, RUINS.aqueduct.z + RUINS.aqueduct.deep / 2, 0, 0, 33.6, `aqueduct pier ${d < 0 ? 'L' : 'R'}`, [1.7, RUINS.aqueduct.deep / 2 + 0.4]]),
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
    for (let t = -6; t <= s.dur + 8; t += step) {
      if (s.start + t < 0 || s.start + t > TOTAL) continue;
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

// The film ends by fading back to bare paper in the silence after the last note.
export const fadeOut = (t) => ss(TOTAL - 2.0, TOTAL - 0.4, t);
