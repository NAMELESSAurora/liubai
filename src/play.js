// The world of the film, walked by whoever is at the keyboard (play.html).
//
// Nothing here is a second world: it is the film's own renderer (film.js, renderLive) drawing
// the film's own places, one sample a frame at a size the machine can keep up with. What is
// handed over is the eye. It is first of all a place to walk and fly in and look at, with
// music playing (the user, 2026-11-22: not a game: "风景观赏的禅意散步和飞行模拟器+音乐播放器").
//   wander   (the default) the world as the story leaves it, every place in its colour, by
//            day. Walk and fly anywhere a place reaches: which place is painted, and which
//            neighbour beside it, goes by where the eye is (the regions below); things can be
//            walked into (build.js makes the colliders as the scenery is built) and stood on;
//            past the edge of what was made the picture goes back to bare paper. Night can be
//            called down on the mountain (N): it is the story's own ending, played.
//   tour     (T, within wander) carried along the film's own route at the film's own pace,
//            free to look about, round and round: something to watch with the music on.
//   journey  (J) the story itself, walked freely: the world begins as pencil, the fleck leads,
//            and the world's clock runs while we are with it and waits while we are not.
//   rail     (L) the journey kept to the film's path, with a little room.
//   auto     (G) the film itself, in real time, its own music in step.
// The music is a player of its own (PLAYER below): whatever lies in music/, whatever is
// dropped on the page, and the film's own track.
import { createFilm } from './film.js';
import { Builder, blocked, floorUnder, clearAt } from './build.js';
import { SHOTS, STITCHES, CAM, FLECK, HAZARDS, FLECK_LOOK, PIGMENT, WISP, MOON } from './shots.js';
import { V, ss, lerp, clamp } from './camera.js';
import { PLACE, JOIN } from './layout.js';

Builder.collect = true;                    // the scenery says what can be walked into, as it is built

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const H = clamp(Math.round(Number(query.get('h')) || 900), 360, 1440), W = Math.round((H * 16) / 18) * 2;
const canvas = $('view'), hud = $('hud'), veil = $('veil'), note = $('note');
const EYE = 0.92, END = 116.4, DAY = 108;      // (DAY: the moment of the story the world is kept at for wandering: every colour has come back, and it is not yet night)

// ---- the way (for rail, and for going back to the fleck) -----------------------------------
// The film's eye path, sampled; how fast the film goes along it; whether we are on foot there;
// and how far from it the player may stray (by what stands near it: HAZARDS in shots.js).
const HZ = 30, N = Math.round(END * HZ);
const WAY = Array.from({ length: N + 1 }, (_, i) => CAM.path(i / HZ));
const PACE = WAY.map((_, i) => V.len(V.sub(WAY[Math.min(N, i + 1)], WAY[Math.max(0, i - 1)])) * (HZ / 2));
const onFoot = (T) => T < 27.1 || T > 105.9;
const shotAt = (T) => SHOTS.find((s) => T < s.start + s.dur) || SHOTS[SHOTS.length - 1];
const ROOM = (() => {
  const most = (T) => (T < 12 ? 1.4 : T > 102 ? 1.5 : T > 75.3 && T < 79 ? 1.4 : 2.6);       // the sheet; the shoulder of the mountain; the way bored through the cloud
  const raw = WAY.map((_, i) => {
    const T = i / HZ, s = shotAt(T), [x, y, z] = s.cam.path(T - s.start);
    let clear = 9;
    for (const [hx, hz, r, y0, y1, , half] of HAZARDS[s.id] || []) {
      const dy = Math.max(y0 - y, y - y1, 0), flat = half ? Math.hypot(Math.max(Math.abs(x - hx) - half[0], 0), Math.max(Math.abs(z - hz) - half[1], 0)) : Math.hypot(x - hx, z - hz) - r;
      clear = Math.min(clear, Math.hypot(Math.max(flat, 0), dy));
    }
    return clamp(clear - 0.6, 0.45, most(T));
  });
  const near = raw.map((_, i) => Math.min(...raw.slice(Math.max(0, i - 12), i + 13)));       // it narrows before the thing, not at it
  return near.map((_, i) => { const a = near.slice(Math.max(0, i - 8), i + 9); return a.reduce((p, c) => p + c, 0) / a.length; });
})();

// ---- the regions (walking freely) ----------------------------------------------------------
// The one world, by where a point of it is. Low down, two planes part three places: the ruin
// (this side of the aqueduct, and of the line the wood's shore runs on), the lake (beyond the
// aqueduct), the wood (beyond the shore). Over the wood lies the cloud, and above the cloud
// is the tower's place; past the edge of the cloud sea is the mountain's, with its country
// below. One goes from one to the next only as the world allows: through the cloud over the
// wood, and over the cloud's edge once the story has opened it (the mountain is not there
// before: STITCHES[4]).
const past = (j, p) => j[0] * p[0] + j[1] * p[1] + j[2] * p[2] + j[3];
const CLOUD_TOP = PLACE.tower.off[1] - 2, BAND = [CLOUD_TOP - 13, CLOUD_TOP - 5], MID = (BAND[0] + BAND[1]) / 2;      // the cloud's top in the world; where, going up through it, one place gives way to the other
const OPEN = STITCHES[4].from;                                 // when the cloud's edge is there to cross
// How far each place reaches, in its own coordinates (its other sides are joins), how high one may go in it (in the world), and how wide the margin is in which the picture goes back to paper.
const BOUNDS = {
  ruins: { x: [-125, 9e3], z: [-48, 9e3], top: 42, margin: 14 },
  lake: { x: [-168, 9e3], z: [-9e3, 218], top: 42, margin: 14 },
  forest: { x: [-9e3, 152], z: [-80, 172], top: 9e3, margin: 14 },
  tower: { x: [-330, 330], z: [-330, 330], top: 80 + PLACE.tower.off[1], margin: 30 },        // (not very high: from far above, the edge of the cloud sea is seen for the ruled plane it is)
  summit: { x: [-820, 720], z: [-260, 1020], top: 60 + PLACE.summit.off[1], margin: 60 },
};
// Which places to paint for an eye at p in region `reg`: the one it is in, and the neighbour whose join is nearest, coming and going with distance.
// How far off a join may be met and what lies beyond it still be shown (film.js, uFar): nearer in mist.
const farOf = (join) => (join === 'cloudEdge' ? [900, 1700] : [200, 480]).map((d) => d * (1 - 0.6 * S.wx.mist));
function mixFor(reg, p, T) {
  if (T < STITCHES[0].from) return { a: 0, b: null };
  if (T < STITCHES[0].to) { const s = STITCHES[0]; return { a: 0, b: 1, type: 6, centre: s.centre, sky: s.sky, edge: s.edge, R: s.R(T) }; }
  const aq = past(JOIN.aqueduct, p), sh = past(JOIN.shore, p), ed = past(JOIN.cloudEdge, p), y = p[1];
  // Across a plane: a is the place on its near side (as the film crosses it). d: how far the eye is from it; other: how far from the next nearest join.
  const across = (a, b, join, d, other, more = 1, rag = 0, sky = 12) => {
    const there = ss(230, 130, Math.abs(d)) * ss(0, 14, Math.abs(other - Math.abs(d))) * more, eyeOnA = d < 0;
    if (there < 0.01) return { a: eyeOnA ? a : b, b: null };
    return { a, b, type: 4, plane: JOIN[join], sky, rag, fade: eyeOnA ? there : 1, hold: eyeOnA ? 0 : 1 - there, far: farOf(join) };
  };
  if (reg === 'ruins') return -aq < -sh ? across(1, 2, 'aqueduct', aq, -sh) : across(1, 3, 'shore', sh, -aq);
  if (reg === 'lake') return aq < -sh ? across(1, 2, 'aqueduct', aq, -sh) : across(2, 3, 'shore', sh, aq);
  if (reg === 'forest') {
    if (y > BAND[0] - 2) return { a: 3, b: 4, type: 5, w: ss(BAND[0], BAND[1], y) };
    return across(aq < 0 ? 1 : 2, 3, 'shore', sh, Math.abs(aq));
  }
  if (reg === 'tower') {
    if (y < BAND[1] + 2 && sh >= 0) return { a: 3, b: 4, type: 5, w: ss(BAND[0], BAND[1], y) };
    return T >= OPEN ? across(4, 5, 'cloudEdge', ed, 1e9, STITCHES[4].fade(T) * ss(620, 420, Math.abs(ed)), 7, 16) : { a: 4, b: null };
  }
  // The mountain's place: the cloud sea and the tower are there to look back at only from near the cloud's own height.
  const back = ss(45, 60, y) * ss(620, 420, Math.abs(ed));
  return back > 0.01 ? { a: 4, b: 5, type: 4, plane: JOIN.cloudEdge, sky: 16, rag: 7, fade: ed < 0 ? back : 1, hold: ed < 0 ? 0 : 1 - back, far: farOf('cloudEdge') } : { a: 5, b: null };
}
// Where the eye passes from one region into another.
function regionAfter(reg, p, T) {
  if (T < STITCHES[0].to) return 'ruins';                      // the world is still being drawn: there is only the ruin's ground
  const aq = past(JOIN.aqueduct, p), sh = past(JOIN.shore, p), ed = past(JOIN.cloudEdge, p), y = p[1];
  if (reg === 'summit') return ed < 0 && y > CLOUD_TOP - 3 ? 'tower' : 'summit';
  if (reg === 'tower') return y < MID && sh >= 0 ? 'forest' : ed > 0 && T >= OPEN ? 'summit' : 'tower';
  const low = sh >= 0 ? 'forest' : aq < 0 ? 'ruins' : 'lake';
  return low === 'forest' && y > MID ? 'tower' : low;
}
// Kept inside what the region reaches (and, while the world is being drawn, inside what has been drawn).
// Returns how far into the margin the eye is (0: well inside, 1: at the very edge).
function confine(reg, p, T) {
  if (T < STITCHES[0].to) {
    const [cx, , cz] = JOIN.drop;
    if (T < 12) { p[0] = clamp(p[0], -40, -4); p[2] = clamp(p[2], 16, 31); p[1] = Math.min(p[1], 3); return 0; }
    const R = Math.max(14, STITCHES[0].R(T) - 4), d = Math.hypot(p[0] - cx, p[2] - cz);
    if (d > R) { p[0] = cx + ((p[0] - cx) * R) / d; p[2] = cz + ((p[2] - cz) * R) / d; }
    p[1] = Math.min(p[1], 30);
    return 0;
  }
  const B = BOUNDS[reg], place = PLACE[reg], l = place.from(p);
  l[0] = clamp(l[0], B.x[0], B.x[1]); l[2] = clamp(l[2], B.z[0], B.z[1]);
  const q = place.to(l);
  p[0] = q[0]; p[2] = q[2];
  p[1] = Math.min(p[1], B.top);
  const d = Math.min(l[0] - B.x[0], B.x[1] - l[0], l[2] - B.z[0], B.z[1] - l[2]);
  return ss(B.margin, 0, d);
}

// ---- state --------------------------------------------------------------------------------
const S = {
  T: 0, Te: 0, clock: 0, i: 0, wait: 0,    // the world's time; where on the way the eye is (rail); seconds played; index into WAY; how long the world has waited for us in all
  pos: [...WAY[0]], vel: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, fov: 46, walked: 0,
  mode: ['rail', 'free'].includes(query.get('mode')) ? query.get('mode') : 'wander', auto: false, started: false, assist: true, idle: 9, rate: 1,      // 'free' is the journey
  tour: false, tourT: 13.8, cruise: false, night: false, wayI: 0, yawRate: 0, prevYaw: 0, blink: 0, jump: null, view: 0,      // wander: carried along the way; flying on without W held; night on the mountain; where on the way we last were; the fade over a jump
  region: 'ruins', grounded: true, state: 'ground', fs: 0, fd: null, bank: 0, dip: 0, dipV: 0, edge: 0, far: 0,      // free: the region the eye is in; on foot or in the air; how near the edge of the world; how far the fleck is
  blooms: {}, wake: {}, fps: 0, ms: 0,
  cycle: false, cycleT: 0, weather: 0, wx: { mist: 0, rain: 0, snow: 0 },      // wander: day and night going round by themselves; the weather asked for, and how much of each there is yet
  breathe: true, ride: null,               // the world answering the music; a way we are being carried along that is not the film's (RIDES)
};
const aim = (dir) => { S.yaw = Math.atan2(dir[0], dir[2]); S.pitch = Math.asin(clamp(dir[1], -1, 1)); };
aim(CAM(0).dir);
const keys = new Set();
let lastCam = null;

// To where the film's eye is at the world's time (the start; B: back beside the fleck).
function rejoin(T = S.T) {
  const c = CAM(T), s = shotAt(T);
  Object.assign(S, { T, Te: T, i: Math.round(T * HZ), pos: [...CAM.path(T)], vel: [0, 0, 0], roll: 0, rate: 1, idle: 9, region: s.id === 'paper' ? 'ruins' : s.id, grounded: onFoot(T) });
  aim(c.dir);
}
function reset() {
  Object.assign(S, { wait: 0, walked: 0, blooms: {}, wake: {}, edge: 0, night: false, tour: false, cruise: false, cycle: false, weather: 0 });
  if (S.mode === 'wander' && !S.auto) goView(0, false); else rejoin(0);
}
// Places to stand and look from (Z / X go round them): moments of the film's own way, and two in the country below the mountain.
const VIEWS = [15.2, 24.0, 29.6, 33.4, 36.8, 40.4, 47.6, 51.6, 57.6, 66.6, 74.2, 79.2, 83.2, 88.6, 96.2, 101.6, 107.7,
  { reg: 'summit', at: [40, -52, 200], yaw: 0.2, pitch: -0.02 }, { reg: 'summit', at: [-150, -58, 380], yaw: -0.5, pitch: 0 }];
// To a view, through a blink of bare paper (or at once).
function goView(i, soft = true) {
  const n = VIEWS.length, k = ((i % n) + n) % n, v = VIEWS[k];
  const go = () => {
    S.view = k;
    if (typeof v === 'number') { const T0 = S.T; rejoin(v); S.T = S.mode === 'wander' ? T0 : v; S.Te = S.T; S.wayI = Math.round(v * HZ); }
    else { const pl = PLACE[v.reg]; Object.assign(S, { pos: pl.to(v.at), yaw: v.yaw + pl.yaw, pitch: v.pitch, vel: [0, 0, 0], region: v.reg, grounded: false, idle: 0 }); }
    S.tour = false; S.cruise = false;
  };
  if (soft) { S.blink = 1; S.jump = go; } else go();
}

// ---- the hour and the weather (wandering) --------------------------------------------------
// Wandering, the world is kept at the end of its story, and the last stretch of the story's
// clock is the hour: at DAY every colour is back and it is day; from there to END the fleck
// goes up, is the moon, and night comes out of it over every place (shots.js). N asks for
// night or day; Y lets them go round by themselves. The weather is asked for with K, and
// comes and goes slowly.
const WEATHER = ['晴', '薄雾', '雨', '雪'], DAYLONG = 150, NIGHTLONG = 110;
function hour(dt) {
  if (S.cycle) {
    S.cycleT += dt;
    if (!S.night && S.T <= DAY && S.cycleT > DAYLONG) { S.night = true; S.cycleT = 0; }
    else if (S.night && S.T >= END && S.cycleT > NIGHTLONG) { S.night = false; S.cycleT = 0; }
  }
  const want = S.night ? END : DAY;
  S.T = want > S.T ? Math.min(want, S.T + 0.5 * dt) : Math.max(want, S.T - 0.8 * dt);
  const k = 1 - Math.exp(-dt / 2.8);
  S.wx.mist = lerp(S.wx.mist, S.weather === 1 ? 1 : 0, k); S.wx.rain = lerp(S.wx.rain, S.weather === 2 ? 1 : 0, k); S.wx.snow = lerp(S.wx.snow, S.weather === 3 ? 1 : 0, k);
}
// What the weather does to the lens.
const glass = (lens) => ({ exp: lens.exp, wet: Math.max(lens.wet, 0.34 * S.wx.rain), mist: Math.max(lens.mist, 0.3 * S.wx.mist + 0.1 * S.wx.snow + 0.08 * S.wx.rain) });

// ---- the eye, in every mode ---------------------------------------------------------------
const turnTo = (dir, k) => {
  const yaw = Math.atan2(dir[0], dir[2]), pitch = Math.asin(clamp(dir[1], -1, 1));
  let d = yaw - S.yaw; d -= Math.round(d / 6.2832) * 6.2832;
  S.yaw += d * k; S.pitch += (pitch - S.pitch) * k;
};
const held = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0);
// The arrow keys turn the eye (for a keyboard alone, and where the pointer cannot be caught).
function steer(dt) {
  const turn = held('ArrowRight') - held('ArrowLeft'), tilt = held('ArrowUp') - held('ArrowDown');
  if (turn || tilt) { S.yaw += turn * 1.5 * dt; S.pitch = clamp(S.pitch + tilt * 0.9 * dt, -1.35, 1.35); S.idle = 0; }
}
// Left alone while we travel, the eye comes round to the fleck (F: at once). To the fleck only
// when it is some way off: when it rests at our feet, turning to it as we walk past turns us
// round and round it; `toWay` (rail) is where the eye goes instead.
function look(dt, toWay = null, byWay = false) {
  S.idle += dt;
  const toFleck = V.sub(FLECK(S.T), S.pos), fl = V.norm(toFleck), far = V.len(toFleck);
  S.far = far;
  if (S.mode === 'wander') { S.pitch = clamp(S.pitch, -1.35, 1.35); return; }      // wandering, the eye is our own
  if (keys.has('KeyF')) turnTo(fl, 1 - Math.exp(-dt * 7));
  else if (S.assist && S.idle > 1.6 && V.len(S.vel) > 0.5) {
    // (byWay: walking freely near the film's way, the eye is led along the way itself, which
    // goes round things; led straight at the fleck we flew into whatever stood between.)
    const wF = byWay && toWay ? 0.15 : ss(2.5, 6, far), wW = toWay ? (1 - wF) * ss(0.4, 1.2, V.len(toWay)) : 0;
    if (wF + wW > 0.2) turnTo(V.norm(V.add(V.scale(fl, wF), toWay ? V.scale(V.norm(toWay), wW) : [0, 0, 0])), 1 - Math.exp(-dt * 0.9 * ss(1.6, 3, S.idle)));
  } else if (S.assist && S.idle > 3 && S.rate > 0.6 && far > 5) {
    turnTo(fl, 1 - Math.exp(-dt * 0.5 * ss(3, 5, S.idle)));       // standing where the story is, hands off: the eye goes to what it is showing (at the end, up to the moon)
  }
  S.pitch = clamp(S.pitch, -1.35, 1.35);
}
// A body under the eye: steps on foot, and a hand that is never quite still; the lens opens with speed.
function eyeOf(dt, foot, right) {
  const speed = V.len(S.vel), slip = V.dot(S.vel, right);
  // In the air we lean into a turn, as anything that flies does, and out of it again (S.bank, when
  // we fly ourselves; carried on the tour or the rail, by how fast the eye is turning).
  const free = !S.auto && S.mode !== 'rail' && !(S.mode === 'wander' && S.tour);
  const lean = foot ? clamp(-slip * 1.1, -9, 9) * 0.25 : free ? S.bank || 0 : clamp(-slip * 1.1 - S.yawRate * Math.min(speed, 16) * 1.5, -24, 24);
  S.roll = lerp(S.roll, lean, 1 - Math.exp(-dt * (foot ? 3 : 5)));
  S.fov = lerp(S.fov, 46 + 20 * ss(3, 24, speed), 1 - Math.exp(-dt * 2.2));
  // A landing is felt: the eye dips and comes back (a spring).
  S.dipV = (S.dipV || 0) + (-150 * (S.dip || 0) - 17 * (S.dipV || 0)) * dt; S.dip = clamp((S.dip || 0) + S.dipV * dt, -0.32, 0.08);
  const t = S.clock, stride = speed > 3.4 ? 0.95 : 0.74, bob = foot ? (0.024 + 0.014 * ss(3, 5.4, speed)) * Math.sin((S.walked / stride) * Math.PI) * ss(0.3, 1.4, speed) : 0, sway = 0.6 + 0.5 * ss(2, 10, speed);
  const eye = [S.pos[0] + 0.012 * sway * Math.sin(t * 1.3 + 1), S.pos[1] + bob + S.dip + 0.01 * sway * Math.sin(t * 0.9 + 2), S.pos[2] + 0.012 * sway * Math.sin(t * 1.1 + 4)];
  const pt = S.pitch + 0.004 * sway * Math.sin(t * 0.7), yw = S.yaw + 0.004 * sway * Math.sin(t * 0.83 + 3), c = Math.cos(pt);
  const d = [Math.sin(yw) * c, Math.sin(pt), Math.cos(yw) * c];
  return { pos: eye, dir: d, look: V.add(eye, V.scale(d, 10)), fov: S.fov, roll: S.roll + 0.25 * sway * Math.sin(t * 0.6 + 5), speed: Math.min(speed, 14), fd: 14, blur: 0, steady: true };
}

// ---- the fleck, wandering -------------------------------------------------------------------
// Wandering there is no story to be led through, but the fleck is still with us. While we are
// going somewhere it goes ahead, the way we are going; when we stop it comes to rest a few
// steps off, on the ground (the grass leans from it) or just over the water (rings); on the
// tour it is the film's own fleck on the film's own way. It wears the pigment of the place it
// is in. And when night is asked for it does what it does at the story's end: it goes up, and
// is the moon; at daybreak it comes back down to us. (O: by day it may be sent away.)
const PAL = { on: true, pos: null, vel: [0, 0, 0], hist: [], col: [...PIGMENT.ruins], still: 0, rest: null, away: 0, ring: 0 };
function palStep(dt, pulse) {
  const P = PAL, eye = S.pos, sp = V.len(S.vel), reg = S.region, place = PLACE[reg], sc = film.scene(reg);
  const cp = Math.cos(S.pitch), gaze = [Math.sin(S.yaw) * cp, Math.sin(S.pitch), Math.cos(S.yaw) * cp], flat = [Math.sin(S.yaw), 0, Math.cos(S.yaw)], right = [Math.cos(S.yaw), 0, -Math.sin(S.yaw)];
  // What there is under a world point for it to rest on (the place's ground, a step, a deck; over the lake, the water), or null.
  const floorAt = (w) => {
    const l = place.from(w), g = Math.max(sc ? sc.ground(l[0], l[2]) : 0, sc ? floorUnder(sc.hit, l[0], l[1], l[2], 0.6, 6) : -1e9, reg === 'lake' ? 0.08 : -1e9);
    return g > -1e3 ? g + place.off[1] : null;
  };
  const inside = (w) => { const l = place.from(w); return !!sc && blocked(sc.hit, l[0], l[1], l[2], 0.15); };
  if (!P.pos || V.len(V.sub(P.pos, eye)) > 70) { P.pos = V.add(eye, V.add(V.scale(flat, 2.2), [0, -0.2, 0])); P.vel = [0, 0, 0]; P.hist = []; P.rest = null; }      // (after a jump it is beside us)
  if (S.tour && !S.ride) {
    const q = FLECK(Math.min(S.tourT, MOON.leave - 0.3));
    P.vel = V.scale(V.sub(q, P.pos), 1 / Math.max(dt, 1e-3)); P.pos = q; P.rest = null; P.still = 0;
    if (V.len(P.vel) > 60) P.vel = [0, 0, 0];
  } else {
    P.still = sp < 0.4 ? P.still + dt : 0;
    let tgt;
    if (P.still > 1.4) {
      // At rest. (Where it rests is chosen once, not held in front of the eye: looked away from, it stays; left out of sight for long, it comes round.)
      const seen = P.rest ? V.dot(V.norm(V.sub(P.rest, eye)), gaze) : -1;
      P.away = seen < 0.3 ? P.away + dt : 0;
      if (!P.rest || P.away > 7 || V.len(V.sub(P.rest, eye)) > 9) {
        // (Along the way we are looking, so that it is in the picture; and down on to whatever lies just under that point, if anything does.)
        const side = Math.sin(S.clock * 1.7) > 0 ? 1 : -1, a = V.add(eye, V.add(V.scale(gaze, 2.7), V.add(V.scale(right, 0.9 * side), [0, -0.25, 0]))), g = floorAt(a);
        P.rest = [a[0], g !== null && a[1] - g < 1.7 ? g + 0.16 : a[1], a[2]]; P.away = 0; P.ring = 0.8;
      }
      tgt = [P.rest[0], P.rest[1] + 0.03 * Math.sin(S.clock * 1.3), P.rest[2]];
    } else {
      P.rest = null;
      const going = sp > 0.4 ? V.norm(V.add(V.scale(S.vel, 0.65 / sp), V.scale(gaze, 0.35))) : gaze, lead = 3.0 + 0.5 * Math.min(sp, 34);
      tgt = V.add(V.add(eye, V.scale(going, lead)), V.scale(right, 0.7 * Math.sin(S.clock * 0.55)));
      tgt[1] += (S.state === 'ground' ? -0.12 : 0.25) + 0.2 * Math.sin(S.clock * 0.8);
    }
    // Not into things: drawn in towards us until it is clear; and never under what there is to rest on.
    const home = V.add(eye, V.scale(flat, 1.2));
    for (let k = 0; k < 4 && inside(tgt); k++) tgt = V.lerp(tgt, home, 0.5);
    const g = floorAt(tgt);
    if (g !== null) tgt[1] = Math.max(tgt[1], g + 0.14);
    const w = 3.0 + 0.22 * sp;                                   // a spring, quicker the faster we go
    P.vel = V.add(P.vel, V.scale(V.add(V.scale(V.sub(tgt, P.pos), w * w), V.scale(P.vel, -2 * w)), dt));
    P.pos = V.add(P.pos, V.scale(P.vel, dt));
    // Resting just over the water, it touches it now and then.
    if (reg === 'lake' && P.rest && P.pos[1] - place.off[1] < 0.45) {
      P.ring -= dt;
      if (P.ring <= 0) { P.ring = 3.2; const l = place.from(P.pos); (S.wake.lake ||= []).push([l[0], l[2], S.T - SHOTS[2].start + S.wait, 0.55]); if (S.wake.lake.length > 4) S.wake.lake.shift(); }
    }
  }
  // Night: up to where the moon is, and it is the moon (which is always the same way off, wherever we go).
  const L = FLECK_LOOK(S.T), up = ss(MOON.leave, MOON.there, S.T), k = up * up * (3 - 2 * up);
  const sw = 0.05 * (1 - k), swim = [sw * Math.sin(S.clock * 2.3 + 1), 0.7 * sw * Math.sin(S.clock * 3.1 + 2), sw * Math.cos(S.clock * 1.9 + 3)];
  const at = V.add(V.lerp(P.pos, V.add(eye, V.scale(MOON.way, MOON.far)), k * k), swim);
  P.hist.unshift([S.clock, at]);
  while (P.hist.length > 2 && S.clock - P.hist[P.hist.length - 2][0] > WISP.n * WISP.dt) P.hist.pop();
  const pts = [];
  for (let i = 0, j = 0; i < WISP.n; i++) {
    const t = S.clock - i * WISP.dt;
    while (j < P.hist.length - 2 && P.hist[j + 1][0] > t) j++;
    const a = P.hist[j], b = P.hist[Math.min(P.hist.length - 1, j + 1)];
    pts.push(a[0] > b[0] ? V.lerp(a[1], b[1], clamp((a[0] - t) / (a[0] - b[0]), 0, 1)) : a[1]);
  }
  const want = PIGMENT[reg] || PIGMENT.ruins, kc = 1 - Math.exp(-dt * 1.2);
  P.col = P.col.map((x, i) => x + (want[i] - x) * kc);
  const here = P.on ? 1 : up;                                    // sent away, it is still what rises to be the moon
  return { at, pts, col: [P.col[0], P.col[1], P.col[2], P.col[3] * (1 - ss(0.15, 0.6, L.night))], p: [L.r * (1 + 0.2 * pulse.hit), L.light * (0.85 + 0.5 * pulse.breath + 0.7 * pulse.hit), 0, L.on * here], tail: 1 };
}

// ---- auto: the film itself, as it was shot ------------------------------------------------
function stepAuto(dt) {
  S.T = Math.min(END, S.T + dt); S.Te = S.T; S.i = Math.round(S.T * HZ); S.rate = 1;
  const c = CAM(S.T), s = shotAt(S.T);
  S.pos = [...c.pos]; S.vel = [0, 0, 0]; aim(c.dir); S.fov = c.fov; S.roll = c.roll;
  S.region = s.id === 'paper' ? 'ruins' : s.id; S.grounded = onFoot(S.T); S.edge = 0; S.far = V.len(V.sub(FLECK(S.T), S.pos));
  return { cam: { ...c, steady: true } };
}

// ---- rail: kept to the film's way ---------------------------------------------------------
function stepRail(dt) {
  const T = S.T, foot = onFoot(S.Te), cp = Math.cos(S.pitch);
  const dir = [Math.sin(S.yaw) * cp, Math.sin(S.pitch), Math.cos(S.yaw) * cp], right = [Math.cos(S.yaw), 0, -Math.sin(S.yaw)];
  const fwd = foot ? [Math.sin(S.yaw), 0, Math.cos(S.yaw)] : dir;
  steer(dt);
  const go = held('KeyW') - held('KeyS'), side = held('KeyD') - held('KeyA'), rise = foot ? 0 : held('Space', 'KeyE') - held('KeyQ', 'ControlLeft');
  // W is "on, along the way" (and S back along it), whatever we are looking at: the way winds
  // (round a tree, up a stair) and going only where the eye points we would be left behind at
  // the first turn. Looking roughly where we go, the eye steers a little too. A and D are ours.
  const along = (sgn) => {
    let d = [0, 0, 0];
    for (let j = S.i + sgn; j >= 0 && j <= N && Math.abs(j - S.i) < 3 * HZ; j += sgn) {
      d = V.sub(WAY[j], WAY[S.i]);
      if (foot) d[1] = 0;
      if (V.len(d) > 1.0) return V.norm(d);
    }
    const l = V.len(d);                                            // the way comes to rest within a step of here: go that step, and rest with it
    return l > 0.02 ? V.scale(d, Math.min(1, l / 0.5) / l) : [0, 0, 0];
  };
  let ahead = go ? along(go) : [0, 0, 0];
  if (go > 0 && V.dot(ahead, fwd) > 0.3) ahead = V.norm(V.add(ahead, V.scale(fwd, 0.5)));
  let wish = V.add(V.add(ahead, V.scale(right, side)), [0, rise, 0]);
  const wl = V.len(wish);
  if (wl > 1) wish = V.scale(wish, 1 / wl);
  // As fast as the film goes here, and a little over: holding W behind the fleck keeps up with it.
  const pace = Math.max(foot ? 1.7 : 2.6, 1.22 * PACE[clamp(Math.round(T * HZ), 0, N)]) * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.7 : 1);
  S.vel = V.lerp(S.vel, V.scale(wish, pace), 1 - Math.exp(-dt * 4.5));
  let p = V.add(S.pos, V.scale(S.vel, dt));

  // Where on the way that is: the nearest point of it, looked for near where we were (and, of
  // points equally near, as where the film stands still, the one at the world's own time).
  const iT = Math.round(T * HZ), lo = Math.max(0, Math.min(S.i - 45, iT - 240)), hi = Math.min(N, Math.max(S.i + 45, iT + 20), iT + 75);
  let best = S.i, bd = 1e9;
  for (let i = lo; i <= hi; i++) {
    const w = WAY[i], d = (w[0] - p[0]) ** 2 + (w[1] - p[1]) ** 2 + (w[2] - p[2]) ** 2 + 2e-5 * (i - iT) ** 2 + (Math.abs(i - S.i) > 60 ? 4 : 0);
    if (d < bd) { bd = d; best = i; }
  }
  S.i = best; S.Te = best / HZ;
  // No further from it than there is room.
  const w = WAY[best], off = V.sub(p, w), room = ROOM[best];
  if (foot) off[1] = 0;
  const far = V.len(off);
  if (far > room) {
    // Held at the edge of the room: what is lost is only the part of our speed that was taking us out of it.
    const out = V.scale(off, 1 / far), pull = V.scale(out, room);
    p = [w[0] + pull[0], p[1], w[2] + pull[2]];
    if (!foot) p[1] = w[1] + pull[1];
    S.vel = V.sub(S.vel, V.scale(out, Math.max(0, V.dot(S.vel, out))));
  }
  if (foot) p[1] = lerp(p[1], w[1], 1 - Math.exp(-dt * 10));
  else {
    if (!rise) p[1] = lerp(p[1], w[1], 1 - Math.exp(-dt * 0.9));      // the air carries us at the height of the way, unless we say otherwise
    if (S.Te < 75) p[1] = Math.max(p[1], 0.4);                         // not under the ground, nor under the water
  }
  S.walked += Math.hypot(p[0] - S.pos[0], p[2] - S.pos[2]);
  S.pos = p;
  const s = shotAt(S.Te);
  S.region = s.id === 'paper' ? 'ruins' : s.id; S.grounded = foot; S.edge = 0;

  // The world's clock: it keeps time with us. Level with the film's eye it runs as the film
  // does; ahead of it, faster (but never much: at three times the speed the film's slow
  // opening was gone in a blink); two thirds of a second behind, it has stopped and waits.
  S.rate = lerp(S.rate, clamp(1 + 1.5 * (S.Te - T), 0, 1.6), 1 - Math.exp(-dt * 6));
  S.T = Math.min(END, T + S.rate * dt);
  S.wait += dt - (S.T - T);
  look(dt, V.sub(WAY[Math.min(N, S.i + Math.round(1.3 * HZ))], S.pos));
  return { cam: eyeOf(dt, foot, right) };
}

// ---- the tour: carried along the film's way ------------------------------------------------
// The film's own route at the film's own pace, its rests and all (S.tourT is the film's time
// along it), through the world as it is wandered: the eye goes where the film looks unless we
// look elsewhere, and comes back to it when left alone. At the end, a while under the sky, and
// round again. Any going of our own and we are let go, where we are.
function stepTour(dt) {
  hour(dt);
  if (held('KeyW') || held('KeyS') || held('KeyA') || held('KeyD') || held('Space', 'KeyE') || held('KeyQ', 'ControlLeft')) { S.tour = false; S.ride = null; S.vel = [0, 0, 0]; return stepFree(dt); }
  steer(dt);
  if (S.ride) return stepRide(dt);
  S.tourT += dt;
  if (S.tourT > END + 8 && !S.jump) { S.blink = 1; S.jump = startTour; }
  const t = Math.min(S.tourT, END), x = t * HZ, i = Math.min(N - 1, Math.floor(x)), k = x - i, p = V.lerp(WAY[i], WAY[i + 1], k);
  S.vel = V.scale(V.sub(p, S.pos), 1 / dt);
  if (V.len(S.vel) > 40) S.vel = [0, 0, 0];                     // (the first step after a jump is not a speed)
  S.walked += Math.hypot(p[0] - S.pos[0], p[2] - S.pos[2]);
  S.pos = p; S.wayI = i; S.Te = S.T; S.i = Math.round(S.T * HZ); S.rate = 1; S.edge = 0;
  const s = shotAt(t);
  S.region = s.id === 'paper' ? 'ruins' : s.id; S.grounded = onFoot(t);
  S.idle += dt;
  if (S.idle > 2.5) turnTo(CAM(t).dir, 1 - Math.exp(-dt * 1.4 * ss(2.5, 4.5, S.idle)));
  S.pitch = clamp(S.pitch, -1.35, 1.35);
  S.far = V.len(V.sub(FLECK(S.T), S.pos));
  const right = [Math.cos(S.yaw), 0, -Math.sin(S.yaw)], y = p[1], cloud = S.region === 'forest' || S.region === 'tower' ? ss(BAND[0] - 12, BAND[0] + 2, y) * (1 - ss(BAND[1], BAND[1] + 6, y)) : 0;
  return { cam: eyeOf(dt, S.grounded, right), mix: mixFor(S.region, p, S.T), lens: glass({ exp: 0.12 * cloud, wet: Math.max(S.region === 'lake' ? 0.3 : 0, 0.4 * cloud), mist: 0.5 * cloud }), fade: 0 };
}
const startTour = (from = 13.8) => { const t = Math.max(13.8, from); Object.assign(S, { mode: 'wander', T: clamp(S.T, DAY, END), Te: clamp(S.T, DAY, END), tourT: t, tour: true, ride: null, cruise: false, pos: [...CAM.path(t)], vel: [0, 0, 0], idle: 9 }); aim(CAM(t).dir); };

// ---- rides: carried round one place --------------------------------------------------------
// Besides the film's way there is, in each place, a way of its own to be carried along (U),
// round and round, free to look about: on foot under the colonnade and through the wood, in a
// boat on the lake, on the wing over the sea of cloud and over the country below the mountain.
// The ways on foot and by boat are not drawn by hand: they are found (route(), below) through
// what actually stands there, between a few points that say where the way should go, keeping
// clear of every column, trunk and post; the ways in the air are drawn, and checked.
const RIDES = {
  ruins: { name: '廊下漫步', kind: 'walk', speed: 1.9, clear: 1.3, via: [[-30, 24.5], [-9, 24], [12, 26], [44, 27], [74, 38], [62, 54], [62, 76], [30, 82], [-10, 80], [-50, 68], [-70, 46], [-62, 27]] },      // along the front of the colonnade (it stands on a step too high to walk up), round its far end, through the great arch, back under the aqueduct and round the near end
  lake: { name: '湖上泛舟', kind: 'boat', speed: 1.5, clear: 2.0, eye: 0.85, via: [[-30, 20], [-40, 50], [-58, 68], [-76, 84], [-60, 101], [-20, 110], [9, 100], [3, 68], [11, 43]] },
  forest: { name: '林间小径', kind: 'walk', speed: 1.8, clear: 1.2, via: [[-62, 28], [-20, 27.5], [22, 27], [50, 40], [36, 62], [-8, 66], [-44, 58], [-64, 44]] },
  tower: { name: '云海盘旋', kind: 'fly', speed: 7.5, pts: [[-22, 14, -8], [-30, 18, 40], [-60, 22, 95], [-100, 22, 128], [-185, 18, 150], [-205, 14, 60], [-190, 12, -30], [-140, 12, -95], [-80, 14, -130], [-30, 16, -95], [-28, 14, -45]] },
  summit: { name: '山野滑翔', kind: 'glide', speed: 13, clear: 13, via: [[0, 150], [-120, 300], [-300, 410], [-385, 520], [-260, 655], [-60, 700], [40, 620], [200, 640], [330, 520], [360, 360], [240, 220], [100, 130]] },
};
// A closed curve through points (Catmull-Rom), as points `step` apart.
function loopThrough(pts, step) {
  const n = pts.length, fine = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n], d = pts[(i + 2) % n];
    for (let k = 0; k < 24; k++) { const t = k / 24, t2 = t * t, t3 = t2 * t; fine.push(b.map((_, j) => 0.5 * (2 * b[j] + (c[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t3))); }
  }
  let len = 0;
  const at = [0], gap = (a, b) => Math.hypot(...a.map((x, j) => x - b[j])), mid = (a, b, k) => a.map((x, j) => x + (b[j] - x) * k);      // (points of two numbers or of three)
  for (let i = 0; i < fine.length; i++) { len += gap(fine[(i + 1) % fine.length], fine[i]); at.push(len); }
  const m = Math.max(8, Math.round(len / step)), out = [];
  for (let i = 0, j = 0; i < m; i++) { const d = (i / m) * len; while (at[j + 1] < d) j++; out.push(mid(fine[j], fine[(j + 1) % fine.length], (d - at[j]) / Math.max(at[j + 1] - at[j], 1e-9))); }
  return out;
}
// A way on the level through what stands in a place: from each point of `via` to the next (and
// round to the first), never nearer than `clear` to anything, and preferring to keep further.
// The place is laid out as a grid of cells half a unit wide (the colliders' own); what is in
// the way is asked of the same colliders we walk by; then the cheapest way is looked for (A*:
// near things is dear), and it is eased, point by point, for as long as easing keeps it clear.
// Local coordinates, points half a unit apart; null if there is no way.
function route(reg, via, clear, heights) {
  const sc = film.scene(reg), hit = sc?.hit, pl = PLACE[reg], cs = 0.5;
  const x0 = Math.floor(Math.min(...via.map((v) => v[0])) - 24), z0 = Math.floor(Math.min(...via.map((v) => v[1])) - 24);
  const nx = Math.ceil((Math.max(...via.map((v) => v[0])) + 24 - x0) / cs), nz = Math.ceil((Math.max(...via.map((v) => v[1])) + 24 - z0) / cs), at = (i, k) => k * nx + i;
  const near = new Float32Array(nx * nz).fill(1e3);             // how far each cell is from anything in the way (units)
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * cs, z = z0 + (k + 0.5) * cs, w = pl.to([x, 0, z]), aq = past(JOIN.aqueduct, w), sh = past(JOIN.shore, w);
    let stop = (sh >= 0 ? 'forest' : aq < 0 ? 'ruins' : 'lake') !== reg;                                   // another place's side of a join
    const g = reg === 'lake' ? 0 : sc.ground(x, z);
    for (const h of heights) if (!stop && blocked(hit, x, g + h, z, 0.3)) stop = true;
    if (stop) near[at(i, k)] = 0;
  }
  for (let pass = 0; pass < 2; pass++) {                        // distances, swept there and back
    const d0 = pass ? -1 : 1;
    for (let k = pass ? nz - 1 : 0; k >= 0 && k < nz; k += d0) for (let i = pass ? nx - 1 : 0; i >= 0 && i < nx; i += d0) {
      let d = near[at(i, k)];
      for (const [di, dk, c] of [[-d0, 0, cs], [0, -d0, cs], [-d0, -d0, 1.414 * cs], [d0, -d0, 1.414 * cs]]) { const a = i + di, b = k + dk; if (a >= 0 && a < nx && b >= 0 && b < nz) d = Math.min(d, near[at(a, b)] + c); }
      near[at(i, k)] = d;
    }
  }
  const nearAt = (x, z) => { const fi = clamp((x - x0) / cs - 0.5, 0, nx - 1.001), fk = clamp((z - z0) / cs - 0.5, 0, nz - 1.001), i = Math.floor(fi), k = Math.floor(fk), u = fi - i, v = fk - k; return lerp(lerp(near[at(i, k)], near[at(i + 1, k)], u), lerp(near[at(i, k + 1)], near[at(i + 1, k + 1)], u), v); };
  // A point of `via` that is not clear is moved to the nearest cell that is.
  const snap = ([x, z]) => {
    let best = null, bd = 1e9;
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (near[at(i, k)] >= clear + 0.1) { const d = (x0 + (i + 0.5) * cs - x) ** 2 + (z0 + (k + 0.5) * cs - z) ** 2; if (d < bd) { bd = d; best = [i, k]; } }
    return best;
  };
  const stops = via.map(snap);
  if (stops.some((q) => !q)) return null;
  const cost = new Float32Array(nx * nz), from = new Int32Array(nx * nz);
  // The cheapest way from one cell to another: the cells after the first, as far as the last; null if there is none.
  const astar = (c0, c1) => {
    const ti = c1 % nx, tk = (c1 - ti) / nx, heap = [[0, c0]];
    cost.fill(1e9); from.fill(-1); cost[c0] = 0;
    let found = false;
    while (heap.length) {
      // (a heap: the cheapest first)
      const top = heap[0], end = heap.pop();
      if (heap.length) { heap[0] = end; for (let j = 0; ;) { const l = 2 * j + 1, r = l + 1; let m = j; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === j) break; [heap[j], heap[m]] = [heap[m], heap[j]]; j = m; } }
      const c = top[1], i = c % nx, k = (c - i) / nx;
      if (c === c1) { found = true; break; }
      if (top[0] > cost[c] + Math.hypot(ti - i, tk - k) * cs + 1e-3) continue;      // (an older, dearer entry for this cell)
      for (const [di, dk, len] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
        const p = i + di, q = k + dk;
        if (p < 0 || p >= nx || q < 0 || q >= nz) continue;
        const d = near[at(p, q)];
        if (d < clear) continue;
        const g = cost[c] + len * cs * (1 + 9 / (d * d));
        if (g < cost[at(p, q)]) {
          cost[at(p, q)] = g; from[at(p, q)] = c;
          heap.push([g + Math.hypot(ti - p, tk - q) * cs, at(p, q)]);
          for (let j = heap.length - 1; j > 0;) { const u = (j - 1) >> 1; if (heap[u][0] <= heap[j][0]) break; [heap[u], heap[j]] = [heap[j], heap[u]]; j = u; }
        }
      }
    }
    if (!found) return null;
    const leg = [];
    for (let c = c1; c !== c0; c = from[c]) leg.push(c);
    return leg.reverse();
  };
  let ids = [];
  const turns = [];                                             // where in `ids` each point of `via` is
  for (let q = 0; q < stops.length; q++) {
    const leg = astar(at(...stops[q]), at(...stops[(q + 1) % stops.length]));
    if (!leg) return null;
    ids.push(...leg); turns.push(ids.length - 1);
  }
  // The points of `via` say roughly where the way should go, not that it must touch them: at each
  // the corner is cut (the way is looked for again from a little before it to a little after),
  // which also takes out any going in to a point and back out the way we came.
  for (let q = 0; q < turns.length; q++) {
    if (turns[q] < 0) continue;
    const n = ids.length, m = Math.min(36, Math.floor(n / 4)), start = (((turns[q] - m) % n) + n) % n, rot = ids.slice(start).concat(ids.slice(0, start)), cut = astar(rot[0], rot[2 * m]);
    if (!cut) continue;
    ids = [rot[0], ...cut, ...rot.slice(2 * m + 1)];
    for (let r = 0; r < turns.length; r++) {
      if (turns[r] < 0) continue;
      const pos = (((turns[r] - start) % n) + n) % n;
      turns[r] = r === q || pos <= 2 * m ? -1 : pos + cut.length - 2 * m;
    }
  }
  const cells = ids.map((c) => [x0 + ((c % nx) + 0.5) * cs, z0 + (Math.floor(c / nx) + 0.5) * cs]);
  // Eased: each point drawn towards the middle of its neighbours, wherever that leaves it clear.
  let pts = cells;
  for (let it = 0; it < 240; it++) pts = pts.map((p, i) => { const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length], q = [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]; return nearAt(q[0], q[1]) >= Math.min(clear + 0.5, nearAt(p[0], p[1])) ? q : p; });
  // Points half a unit apart along it (straight from one to the next: they are close together already).
  const out = [];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let d = carry; d < l; d += 0.5) out.push([a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l]); carry = (carry - l) % 0.5; if (carry < 0) carry += 0.5; }
  return { pts: out, nearAt };
}
const RIDE = {};
function buildRide(reg) {
  const def = RIDES[reg], pl = PLACE[reg], sc = film.scene(reg);
  if (!def || !sc) return null;
  let local, step = 0.5, least = null;
  if (def.kind === 'fly') { step = 1; local = loopThrough(def.pts, step); }
  else if (def.kind === 'glide') {
    // Over the country: the ground's own height along the way, and what stands on it, cleared by `clear`; then smoothed, so that we rise before a hill and not at it.
    step = 2;
    const flat = loopThrough(def.via, step), n = flat.length, need = flat.map(([x, z]) => {
      let top = -1e9;
      for (const [dx, dz] of [[0, 0], [9, 0], [-9, 0], [0, 9], [0, -9]]) { const g = sc.ground(x + dx, z + dz); let h = g; for (let y = g + 75; y > g + 1; y -= 3) if (blocked(sc.hit, x + dx, y, z + dz, 3)) { h = y; break; } top = Math.max(top, h); }
      return top + def.clear;
    });
    let y = need.map((_, i) => { let m = -1e9; for (let j = -14; j <= 14; j++) m = Math.max(m, need[(i + j + n) % n]); return m; });
    for (let it = 0; it < 3; it++) y = y.map((_, i) => { let s = 0; for (let j = -16; j <= 16; j++) s += y[(i + j + n * 4) % n]; return s / 33; });
    local = flat.map(([x, z], i) => [x, y[i], z]);
  } else {
    const r = route(reg, def.via, def.clear, def.kind === 'boat' ? [0.3, 0.8, 1.3] : [0.45, 0.9, 1.4]);
    if (!r) return null;
    local = r.pts.map(([x, z]) => [x, def.kind === 'boat' ? def.eye : sc.ground(x, z) + EYE, z]);
    least = Math.min(...local.map(([x, , z]) => r.nearAt(x, z)));
  }
  const pts = local.map((p) => pl.to(p));
  return { reg, name: def.name, kind: def.kind, speed: def.speed, pts, n: pts.length, step, len: pts.length * step, least };
}
function startRide(reg = S.region) {
  const R = (RIDE[reg] ||= buildRide(reg));
  if (!R) return false;
  let best = 0, bd = 1e18;
  R.pts.forEach((p, i) => { const q = (p[0] - S.pos[0]) ** 2 + (p[1] - S.pos[1]) ** 2 + (p[2] - S.pos[2]) ** 2; if (q < bd) { bd = q; best = i; } });      // from the point of it nearest us
  Object.assign(S, { mode: 'wander', tour: true, ride: { ...R, d: best * R.step, ring: 0 }, cruise: false, region: reg, pos: [...R.pts[best]], vel: [0, 0, 0], idle: 9, T: clamp(S.T, DAY, END) });
  aim(V.norm(V.sub(R.pts[(best + 6) % R.n], R.pts[best])));
  return true;
}
function stepRide(dt) {
  const R = S.ride, at = (d) => { const x = (((d % R.len) + R.len) % R.len) / R.step, i = Math.floor(x) % R.n; return V.lerp(R.pts[i], R.pts[(i + 1) % R.n], x - Math.floor(x)); };
  R.d = (R.d + R.speed * dt) % R.len;
  const p = at(R.d), ahead = at(R.d + Math.max(4, R.speed * 2.2));
  if (R.kind === 'boat') {
    p[1] += 0.035 * Math.sin(S.clock * 1.15) + 0.02 * Math.sin(S.clock * 0.63 + 1);      // the boat rides the water, and leaves rings on it
    R.ring -= dt;
    if (R.ring <= 0) { R.ring = 1.5; const l = PLACE.lake.from(p); (S.wake.lake ||= []).push([l[0], l[2], S.T - SHOTS[2].start + S.wait, 0.4]); if (S.wake.lake.length > 4) S.wake.lake.shift(); }
  }
  S.vel = V.scale(V.sub(p, S.pos), 1 / dt);
  if (V.len(S.vel) > 60) S.vel = [0, 0, 0];
  S.walked += Math.hypot(p[0] - S.pos[0], p[2] - S.pos[2]);
  S.pos = p; S.Te = S.T; S.i = Math.round(S.T * HZ); S.rate = 1; S.edge = 0; S.grounded = R.kind === 'walk';
  S.region = regionAfter(S.region, p, S.T);
  // Left to itself the eye goes the way we are going: on the wing, a little down, over the country; round the tower, half towards the tower.
  let to = V.norm(V.sub(ahead, p));
  if (R.kind === 'glide') to = V.norm([to[0], to[1] - 0.16, to[2]]);
  if (R.kind === 'fly') to = V.norm(V.add(to, V.scale(V.norm(V.sub(PLACE.tower.to([0, 12, 0]), p)), 0.55)));
  S.idle += dt;
  if (S.idle > 2.5) turnTo(to, 1 - Math.exp(-dt * 1.2 * ss(2.5, 4.5, S.idle)));
  S.pitch = clamp(S.pitch, -1.35, 1.35);
  const right = [Math.cos(S.yaw), 0, -Math.sin(S.yaw)];
  return { cam: eyeOf(dt, S.grounded, right), mix: mixFor(S.region, p, S.T), lens: glass({ exp: 0, wet: S.region === 'lake' ? 0.3 : 0, mist: 0 }), fade: 0 };
}

// ---- free: anywhere ------------------------------------------------------------------------
// How it feels to move (all of it can be changed from the console: __play.FEEL).
// On foot: a walk and a run that are picked up and let go of quickly but not at once; a jump
// with weight in it (a tap is a hop, holding goes higher), forgiving at an edge (coyote) and
// before a landing (buffer); a landing that is felt. Space held on into the air, or pressed
// again there, and we fly; a long fall and we fly anyway: nobody falls here.
// In the air: we are carried where we look, but not at once. The speed is ours to build and
// to spend: W gathers it, a dive adds to it, a climb costs it, and let go of we glide on,
// slower and slower, to a stop in the air. We lean into turns, and turn wider the faster we go.
const FEEL = {
  walk: 2.5, run: 5.4, accel: 16, brake: 12, airAccel: 6,
  jump: 5.0, gravity: 11, cut: 2.6, fallMax: 14, coyote: 0.12, buffer: 0.14, takeoff: 0.3, autoGlide: 0.95,
  cruise: 9, boost: 2.3, thrust: 1.15, hold: 0.42, brakeK: 2.4, drag: 0.3, dive: 10, steep: 1.25, turn: [3.0, 1.3], turnAt: 18,
  lift: 5.5, strafe: 3.2, bank: 2.0, bankMax: 36, altitude: [30, 2.6],
};
// The three ways of being somewhere: on the ground, in the air under our own weight (a jump, a fall), flying.
function stepFree(dt) {
  const wander = S.mode === 'wander', T0 = S.T;
  // Wandering, the world is kept at the end of its story: by day, or by night (hour(), above).
  if (wander) hour(dt);
  steer(dt);
  if ((S.state === 'ground') !== S.grounded) { S.state = S.grounded ? 'ground' : 'fly'; S.fs = Math.min(V.len(S.vel), 14); S.fd = S.fs > 0.3 ? V.norm(S.vel) : null; S.liftV = 0; S.airT = 1; }      // (set from outside: a view, the tour, the film)
  const T = S.T, reg = S.region, place = PLACE[reg], sc = T < 13.4 ? null : film.scene(reg), hit = sc?.hit, oy = place.off[1];
  const cp = Math.cos(S.pitch), dir = [Math.sin(S.yaw) * cp, Math.sin(S.pitch), Math.cos(S.yaw) * cp], right = [Math.cos(S.yaw), 0, -Math.sin(S.yaw)], flat = [Math.sin(S.yaw), 0, Math.cos(S.yaw)];
  // What there is to stand on at a world point: the place's ground, or the top of a thing under
  // us (a step, a deck, a stair). The height the eye is at, standing there.
  const standAt = (w) => {
    const l = place.from(w), g = sc ? sc.ground(l[0], l[2]) : 0;
    return Math.max(g, floorUnder(hit, l[0], l[1] - EYE, l[2])) + oy + EYE;
  };
  const inside = (w) => { const l = place.from(w); return blocked(hit, l[0], l[1], l[2]); };
  // The place's own ground alone (not the things on it): for telling a slope from a face of rock.
  const earthAt = (w) => { const l = place.from(w); return (sc ? sc.ground(l[0], l[2]) : 0) + oy + EYE; };
  const stand = standAt(S.pos), solid = stand > -1e3;
  // The least height the eye may be at: just over water; not through the cloud except over the wood; a crouch above the ground.
  const least = (w) => (reg === 'lake' ? Math.max(0.55, standAt(w) - 0.45) : reg === 'tower' ? Math.max(past(JOIN.shore, w) >= 0 ? -1e4 : BAND[1] + 1.5, standAt(w) - 0.45) : standAt(w) - 0.45);

  // ---- what is asked of us
  const side = held('KeyD') - held('KeyA'), space = !!held('Space', 'KeyE'), rise = (space ? 1 : 0) - held('KeyQ', 'ControlLeft');
  if (held('KeyS')) S.cruise = false;
  const go = Math.max(held('KeyW'), S.cruise ? 1 : 0) - held('KeyS');                 // (cruise, C: on, as if W were held: for flying with the hands off)
  const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const pressed = space && !S.spaceWas;                           // Space, this very step
  S.spaceWas = space;
  S.jumpBuf = pressed ? FEEL.buffer : Math.max(0, (S.jumpBuf || 0) - dt);

  // ---- the film's way, if we are near it (the journey: W alone, the eye left to itself, is led along it)
  // (Wandering there is no story time to look about: the way is kept track of by where on it we last were, S.wayI.)
  const iT = wander ? S.wayI : Math.round(T * HZ);
  let near = -1, nd = 81;
  for (let i = Math.max(0, iT - (wander ? 90 : 240)); i <= Math.min(N, iT + (wander ? 90 : 20)); i++) { const w = WAY[i], q = (w[0] - S.pos[0]) ** 2 + (w[1] - S.pos[1]) ** 2 + (w[2] - S.pos[2]) ** 2 + 1e-5 * (i - iT) ** 2; if (q < nd) { nd = q; near = i; } }
  let toWay = null;
  if (near >= 0) for (let j = near + 1; j <= Math.min(N, near + 3 * HZ); j++) { const v = V.sub(WAY[j], S.pos); if (V.len(v) > Math.max(2.5, 0.45 * V.len(S.vel))) { toWay = v; break; } }
  if (wander && near >= 0) S.wayI = near;
  const led = !!toWay && !wander && S.assist && S.idle > 1.6 && go > 0;
  // Led: we make for a point of the way a stride or two on from the point nearest us, wherever
  // the eye happens to be turned. (Going as the way goes but a step to one side of it, we were
  // held against the column it threads past.)
  let lead = null;
  if (led) {
    let tgt = WAY[near];
    for (let j = near + 1; j <= Math.min(N, near + 3 * HZ); j++) { tgt = WAY[j]; if (V.len(V.sub(tgt, WAY[near])) > 1.6) break; }
    if (S.stuck > 0.3) tgt = WAY[near];                           // held up all the same: straight back on to the way
    const v = V.sub(tgt, S.pos), l = V.len(v);
    lead = l > 0.03 ? V.scale(v, Math.min(1, l / 0.5) / l) : [0, 0, 0];
  }
  const wayPace = led ? 1.2 * PACE[clamp(near, 0, N)] : 0;
  // Stopped by something while going on: step aside from it, to whichever side is open (and keep to that side while it lasts).
  if (S.stuck > 0.35 && go > 0 && !side && !led) {
    if (!S.dodge) { const probe = (sg) => !inside([S.pos[0] + right[0] * sg * 1.3, S.pos[1], S.pos[2] + right[2] * sg * 1.3]); S.dodge = probe(1) ? 1 : probe(-1) ? -1 : 1; }
  } else if (S.stuck <= 0 || led) S.dodge = 0;
  const sidle = side + (go > 0 ? (S.dodge || 0) * 1.2 : 0);

  // ---- leaving the ground
  const fly = (kick = 0) => { S.state = 'fly'; S.grounded = false; S.airT = Math.min(S.airT || 0, 0.5); S.fs = V.len(S.vel); S.fd = S.fs > 0.3 ? V.scale(S.vel, 1 / S.fs) : [...dir]; S.liftV = kick; };
  S.airT = S.state === 'ground' ? 0 : (S.airT || 0) + dt;
  if (S.state === 'ground') {
    S.coyote = FEEL.coyote; S.jumped = false;
    if (!solid) fly();
    else if (led && (toWay[1] > 1.0 || WAY[near][1] - S.pos[1] > 0.7)) fly(1.5);                     // the way rises: so do we
    else if (!wander && go > 0 && S.assist && S.idle > 1.6 && !toWay && T < 108 && FLECK(T)[1] - S.pos[1] > 2.4 && S.far > 7) fly(1.5);      // (not after the fleck has gone up to be the moon: there is no following it there)
    else if (S.cruise && go > 0 && S.pitch > 0.12) fly(1.5);                                         // cruising, and the eye lifted
  }
  if ((S.state === 'ground' || (S.state === 'air' && S.coyote > 0 && !S.jumped)) && S.jumpBuf > 0) {
    S.state = 'air'; S.grounded = false; S.jumped = true; S.jumpBuf = 0; S.airT = 0; S.fallT = 0; S.vel[1] = FEEL.jump;
  } else if (S.state === 'air' && ((pressed && S.airT > 0.1) || (space && S.jumped && S.airT > FEEL.takeoff) || S.fallT > FEEL.autoGlide)) fly(space ? 2.5 : 0);

  // ---- the speed we would have
  const high = solid ? Math.max(0, S.pos[1] - stand) : 12;
  if (S.state === 'fly') {
    // Flying. The speed (S.fs) and the way we are going (S.fd) are two things: the way comes round to where we look, the speed is built and spent.
    const h = led ? V.norm(lead) : dir, alt = 1 + Math.min(FEEL.altitude[1], high / FEEL.altitude[0]);
    // (Led along the way we go at the way's own pace, and ease up to the point we are making for.)
    const ll = led ? V.len(lead) : 1, top = led ? Math.max(2.5, wayPace) * ll : FEEL.cruise * alt * (fast ? FEEL.boost : 1), thrust = led ? (ll > 0.15 ? 1 : -1) : go;
    let fs = S.fs, fd = S.fd || [...dir];
    const turnRate = lerp(FEEL.turn[0], FEEL.turn[1], ss(2, FEEL.turnAt, fs)) * (led ? 2 : 1);
    fd = V.norm(V.lerp(fd, h, 1 - Math.exp(-turnRate * dt)));
    const want = thrust > 0 ? top : 0, k = led ? 3 : thrust < 0 ? FEEL.brakeK : thrust > 0 ? (fs > want ? FEEL.hold : FEEL.thrust * (fast ? 1.5 : 1)) : FEEL.drag;
    fs += (want - fs) * (1 - Math.exp(-k * dt));
    if (!led) fs += -fd[1] * FEEL.dive * dt * ss(0.04, 0.2, Math.abs(fd[1]));       // a dive gathers speed, a climb spends it
    fs = clamp(fs, 0, led ? top + 2 : FEEL.cruise * alt * FEEL.boost * 1.5 + 6);
    S.liftV = lerp(S.liftV || 0, rise * FEEL.lift * alt, 1 - Math.exp(-dt * 4));
    const sl = sidle * FEEL.strafe * (1 - 0.55 * ss(4, 14, fs));
    S.fs = fs; S.fd = fd;
    S.vel = [fd[0] * fs + right[0] * sl, fd[1] * fs + S.liftV, fd[2] * fs + right[2] * sl];
    // Leaning into the turn: by how fast the way we are going is coming round, and how fast we are going.
    const vy = Math.atan2(fd[0], fd[2]);
    let w = vy - (S.vyaw ?? vy); w -= Math.round(w / 6.2832) * 6.2832; S.vyaw = vy;
    S.bank = lerp(S.bank || 0, clamp(-(w / dt) * Math.min(fs, 22) * FEEL.bank - sidle * 5, -FEEL.bankMax, FEEL.bankMax), 1 - Math.exp(-dt * 3.2));
  } else {
    // On the ground, or in the air under our own weight: what the feet can do.
    let wish = led ? [lead[0], 0, lead[2]] : V.add(V.scale(flat, go), V.scale(right, sidle));
    const wl = V.len(wish);
    if (wl > 1) wish = V.scale(wish, 1 / wl);
    const speed = Math.max(fast ? FEEL.run : FEEL.walk, wayPace), tx = wish[0] * speed, tz = wish[2] * speed;
    const dx = tx - S.vel[0], dz = tz - S.vel[2], dl = Math.hypot(dx, dz);
    const a = (S.state === 'air' ? FEEL.airAccel : wl > 0.01 ? FEEL.accel : FEEL.brake) * dt, f = dl > a ? a / dl : 1;
    S.vel[0] += dx * f; S.vel[2] += dz * f;
    if (S.state === 'air') {
      S.coyote = Math.max(0, (S.coyote || 0) - dt);
      S.vel[1] = Math.max(-FEEL.fallMax, S.vel[1] - FEEL.gravity * (S.vel[1] > 0 && !space ? FEEL.cut : 1) * dt);      // let go of early, the jump is cut short
      S.fallT = S.vel[1] < 0 ? (S.fallT || 0) + dt : 0;
    } else S.vel[1] = 0;
    S.bank = lerp(S.bank || 0, 0, 1 - Math.exp(-dt * 4));
  }

  // ---- move, a little at a time, and not into things: what is in the way stops only the part of the move that goes into it
  let p = [...S.pos], bumped = false;
  const d = V.scale(S.vel, dt), n = Math.max(1, Math.ceil(V.len(d) / 0.22));
  for (let k = 0; k < n; k++) {
    const q = [p[0] + d[0] / n, p[1] + d[1] / n, p[2] + d[2] / n];
    if (S.state === 'ground') {
      const sq = standAt(q), run = Math.hypot(q[0] - p[0], q[2] - p[2]), eq = earthAt(q), onEarth = eq >= sq - 1e-6;
      // Off an edge, or down a face too steep to walk (for a moment the ground is still ours to jump from). Up a face too steep to walk, we do not go.
      if (!(sq > -1e3) || sq < p[1] - 0.7 || (onEarth && run > 1e-4 && p[1] - sq > FEEL.steep * run + 0.04)) { S.state = 'air'; S.grounded = false; S.fallT = 0; S.airT = 0; }
      else if (onEarth && run > 1e-4 && sq - p[1] > FEEL.steep * run + 0.04) { q[0] = p[0]; q[2] = p[2]; S.vel[0] *= 0.6; S.vel[2] *= 0.6; }
      else q[1] = sq;
    }
    if (!inside(q) || inside(p)) { p = q; continue; }                      // (already inside something, we are let out of it)
    for (const ax of [0, 2, 1]) {
      const t = [...p]; t[ax] = q[ax];
      if (S.state === 'ground' && ax !== 1) { const st = standAt(t); if (st > -1e3 && st >= p[1] - 0.7) t[1] = st; }
      if (!inside(t)) p = t; else { bumped = true; if (S.state !== 'fly') S.vel[ax] *= ax === 1 ? 0 : 0.2; }
    }
  }
  if (bumped && S.state === 'fly') S.fs *= 1 - Math.min(0.6, 3 * dt);     // against a wall the speed goes
  const st = standAt(p), under = st > -1e3;
  if (S.state === 'air') {
    if (under && p[1] <= st && S.vel[1] <= 0) {                           // down
      S.dipV = (S.dipV || 0) + Math.max(-3.2, S.vel[1] * 0.3);
      p[1] = st; S.state = 'ground'; S.grounded = true; S.vel[1] = 0;
    } else if (p[1] < least(p)) { p[1] = least(p); fly(); }               // nothing to land on here (water, cloud): we are borne up
  } else if (S.state === 'fly') {
    // (Where the film's way itself goes lower than we would let ourselves, close along a rock face, the way is right.)
    const onWay = near >= 0 && nd < 9 ? WAY[near][1] - 0.05 : 1e9, low = Math.min(least(p), onWay);
    if (p[1] < low) { p[1] = low; S.fd = V.norm([S.fd[0], Math.max(S.fd[1], 0.02), S.fd[2]]); S.liftV = Math.max(S.liftV, 0); }      // skimming: we go along it, not into it
    // Low over ground (or a deck, a stair), wanting down or hardly moving: we are on it.
    if (under && p[1] - st < 0.45 && S.airT > 0.9 && (rise < 0 || (!led && go <= 0 && S.fs < 2.6) || (led && WAY[near][1] - st < 0.5)) && rise <= 0) {
      S.dipV = (S.dipV || 0) + Math.max(-2.4, Math.min(0, S.vel[1]) * 0.3) - 0.5;
      S.state = 'ground'; S.grounded = true; S.vel = [S.vel[0], 0, S.vel[2]];
      const hs = Math.hypot(S.vel[0], S.vel[2]), cap = FEEL.run * 1.5; if (hs > cap) { S.vel[0] *= cap / hs; S.vel[2] *= cap / hs; }      // we come down running
    }
  }
  if (S.state === 'ground' && under) p[1] = lerp(S.pos[1], st, 1 - Math.exp(-dt * 14));
  // Skimming the lake, we leave rings on it.
  if (S.state === 'fly' && reg === 'lake' && p[1] < 1.3 && V.len(S.vel) > 3) {
    S.skim = (S.skim || 0) + dt;
    if (S.skim > 0.24) { S.skim = 0; const l = place.from(p); (S.wake.lake ||= []).push([l[0], l[2], S.T - SHOTS[2].start + S.wait, 0.5 + 0.5 * ss(4, 14, V.len(S.vel))]); if (S.wake.lake.length > 4) S.wake.lake.shift(); }
  }
  // Held up by a thing (measured before the edge of the world has its say: that is not a thing to step round).
  const moved = Math.hypot(p[0] - S.pos[0], p[1] - S.pos[1], p[2] - S.pos[2]), meant = V.len(d);
  S.stuck = meant > 1e-4 && moved < 0.35 * meant ? (S.stuck || 0) + dt : Math.max(0, (S.stuck || 0) - dt * 0.6);      // (it has to stay clear a moment before we stop stepping aside)
  S.edge = confine(reg, p, T);
  S.walked += S.state === 'ground' ? Math.hypot(p[0] - S.pos[0], p[2] - S.pos[2]) : 0;
  S.pos = p;
  const next = regionAfter(reg, p, T);
  if (next !== reg) { S.region = next; if (S.state === 'ground') { S.state = 'air'; S.grounded = false; S.fallT = 0; S.airT = 0; } }

  // The world's clock runs while we are with the story, and waits while we are away: with the
  // fleck, or where the film's own eye is at this moment of it (there are moments when the film
  // stands well back from the fleck: drifting round the tower with the fleck on its top, and at
  // the end, when it has gone up to be the moon).
  look(dt, toWay, true);
  if (wander) S.rate = 1;
  else {
    const film0 = WAY[clamp(iT, 0, N)], withFilm = Math.hypot(film0[0] - p[0], film0[1] - p[1], film0[2] - p[2]);
    S.rate = lerp(S.rate, Math.max(ss(26, 11, S.far), ss(18, 8, withFilm)), 1 - Math.exp(-dt * 4));
    S.T = Math.min(END, T + S.rate * dt);
  }
  S.wait += dt - (S.T - T0);
  S.Te = S.T; S.i = Math.round(S.T * HZ);

  // The lens: rain on it over the lake; mist and drops, and the light let in, inside the cloud.
  const y = S.pos[1], cloud = S.region === 'forest' || S.region === 'tower' ? ss(BAND[0] - 12, BAND[0] + 2, y) * (1 - ss(BAND[1], BAND[1] + 6, y)) : 0;
  const lens = { exp: 0.12 * cloud, wet: Math.max(S.region === 'lake' ? 0.3 : 0, 0.4 * cloud), mist: 0.5 * cloud };
  return { cam: eyeOf(dt, S.state === 'ground', right), mix: mixFor(S.region, S.pos, S.T), lens: wander ? glass(lens) : lens, fade: 0.92 * S.edge };
}

function step(dt) {
  S.clock += dt;
  // A jump (to a view; round again at the end of the tour) is made behind a blink of bare paper.
  let veiled = 0;
  if (S.blink > 0) { const b0 = S.blink; S.blink = Math.max(0, S.blink - dt / 0.9); if (b0 > 0.5 && S.blink <= 0.5 && S.jump) { S.jump(); S.jump = null; S.prevYaw = S.yaw; } veiled = 1 - Math.abs(S.blink - 0.5) * 2; }
  if (!S.tour || S.mode !== 'wander' || S.auto) S.ride = null;
  const r = S.auto ? stepAuto(dt) : S.mode === 'rail' ? stepRail(dt) : S.mode === 'wander' && S.tour ? stepTour(dt) : stepFree(dt);
  let dy = S.yaw - S.prevYaw; dy -= Math.round(dy / 6.2832) * 6.2832;
  S.yawRate = lerp(S.yawRate, clamp(dy / dt, -2.5, 2.5), 1 - Math.exp(-dt * 5)); S.prevYaw = S.yaw;
  if (veiled > 0) r.fade = Math.max(r.fade || 0, ss(0, 1, veiled));
  lastCam = r.cam;
  // What the player has dropped, as the renderer wants it: a wash by how long ago it fell; a ring by the place's own clock.
  const blooms = Object.fromEntries(Object.entries(S.blooms).map(([id, list]) => [id, list.map(([x, y, z, c0]) => [x, y, z, S.clock - c0])]));
  // Wandering: the weather asked for, the music's breath, the fleck beside us.
  const wander = S.mode === 'wander' && !S.auto, pulse = wander && S.breathe ? player.pulse(dt) : { breath: 0, hit: 0 };
  lastLive = { T: S.T, Te: S.Te, clock: S.clock, wait: S.wait, cam: r.cam, mix: r.mix, lens: r.lens, fade: r.fade, blooms, wake: S.wake, plain: wander, film: S.auto, wx: wander ? { ...S.wx, pulse: pulse.breath } : null, wisp: wander ? palStep(dt, pulse) : null };
  return film.renderLive(lastLive);
}
let lastLive = null;

// ---- a photograph ---------------------------------------------------------------------------
// P stops the world where it is and hands over a camera of its own: it goes where we send it
// (no further than a stone's throw from where we stand), turns, rolls, zooms, and can be given
// a shallow focus on whatever is pointed at. Enter prints what it sees at the film's own size
// (2560 × 1440, each pixel drawn several times over), and saves it.
let PH = null, big = null;
const photoCam = () => {
  const cp = Math.cos(PH.pitch), d = [Math.sin(PH.yaw) * cp, Math.sin(PH.pitch), Math.cos(PH.yaw) * cp];
  return { pos: [...PH.pos], dir: d, look: V.add(PH.pos, V.scale(d, 10)), fov: PH.fov, roll: PH.roll, speed: 0, fd: PH.fd, blur: PH.blur, steady: true };
};
const photoLive = () => ({ ...lastLive, cam: photoCam(), mix: mixFor(PH.region, PH.pos, S.T), fade: 0 });
function photoOn() {
  if (!lastLive || S.auto || PH) return;
  PH = { pos: [...lastLive.cam.pos], yaw: S.yaw, pitch: S.pitch, roll: 0, fov: S.fov, fd: 14, blur: 0, region: S.region, busy: false };
  keys.clear(); document.body.classList.add('photo'); $('photo').classList.remove('off');
}
function photoOff() { PH = null; keys.clear(); document.body.classList.remove('photo'); }
function stepPhoto(dt) {
  const cp = Math.cos(PH.pitch), d = [Math.sin(PH.yaw) * cp, Math.sin(PH.pitch), Math.cos(PH.yaw) * cp], right = [Math.cos(PH.yaw), 0, -Math.sin(PH.yaw)];
  const go = held('KeyW') - held('KeyS'), side = held('KeyD') - held('KeyA'), rise = held('Space', 'KeyE') - held('KeyQ', 'ControlLeft');
  const v = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 10 : 2.5) * dt;
  const p = V.add(PH.pos, V.add(V.add(V.scale(d, go * v), V.scale(right, side * v)), [0, rise * v, 0]));
  PH.yaw += (held('ArrowRight') - held('ArrowLeft')) * 0.8 * dt; PH.pitch = clamp(PH.pitch + (held('ArrowUp') - held('ArrowDown')) * 0.6 * dt, -1.4, 1.4);
  PH.roll = clamp(PH.roll + (held('BracketRight') - held('BracketLeft')) * 22 * dt, -60, 60);
  // No further than a stone's throw from where we stand; not out of the world; not under the ground or the water.
  const off = V.sub(p, S.pos), far = V.len(off);
  if (far > 40) { p[0] = S.pos[0] + (off[0] * 40) / far; p[1] = S.pos[1] + (off[1] * 40) / far; p[2] = S.pos[2] + (off[2] * 40) / far; }
  confine(PH.region, p, S.T);
  const place = PLACE[PH.region], sc = S.T < 13.4 ? null : film.scene(PH.region), l = place.from(p), g = (sc ? sc.ground(l[0], l[2]) : 0) + place.off[1];
  if (g > -1e3) p[1] = Math.max(p[1], g + 0.12);
  if (PH.region === 'lake') p[1] = Math.max(p[1], 0.12);
  PH.pos = p; PH.region = regionAfter(PH.region, p, S.T);
  film.renderLive(photoLive());
}
// Focus on what is pointed at (px, py: on the canvas, in its own pixels).
function photoFocus(px, py) {
  const cam = photoCam(), hit = film.pick(px, py, cam);
  if (!hit) return;
  PH.fd = Math.max(0.4, V.len(V.sub(hit.p, hit.shot.local(cam).pos)));
  if (!PH.blur) PH.blur = 5;
  say(`对焦 · ${PH.fd.toFixed(1)} 步`, 1.4);
}
const stampNow = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };
const download = (canvasEl, name) => new Promise((done) => canvasEl.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); done(); }, 'image/png'));
// (save: a name, to have the server keep it in out/snaps instead of the browser downloading it: for looking at it without a display.)
async function shoot(save = null, samples = 12) {
  if (!PH || PH.busy) return null;
  PH.busy = true;
  say('正在洗印…', 90);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40)));       // (let the words be seen: the first print takes a few seconds, a second film has to be made for it)
  const was = Builder.collect;
  try {
    Builder.collect = false;                                     // the print's own scenery is only to be looked at
    if (!big) { const c = document.createElement('canvas'); big = { canvas: c, film: await createFilm(c, { w: 2560, h: 1440 }) }; }
    const t0 = performance.now();
    big.film.renderLive(photoLive(), samples);
    big.film.sync();
    const out = { w: big.film.W, h: big.film.H, ms: Math.round(performance.now() - t0), errors: big.film.shaderErrors.length };
    if (save) out.file = (await (await fetch(`/api/snap?name=${encodeURIComponent(save)}&w=${big.film.W}&h=${big.film.H}&scale=0`, { method: 'POST', body: big.film.read() })).json()).file;
    else await download(big.canvas, `liubai-${stampNow()}.png`);
    say(`已存下这一眼 · ${big.film.W}×${big.film.H}`, 2.4);
    return out;
  } catch (e) { say('没能存下', 2.4); return { error: String(e) }; } finally { Builder.collect = was; if (PH) PH.busy = false; }
}

// A wash of the player's own, where they point (px, py: on the canvas, in its own pixels).
function drop(px, py) {
  if (!lastCam) return null;
  const hit = film.pick(px, py, lastCam);
  if (!hit) return null;
  const id = hit.shot.id;
  (S.blooms[id] ||= []).push([hit.p[0], hit.p[1], hit.p[2], S.clock]);
  if (S.blooms[id].length > 6) S.blooms[id].shift();
  if (id === 'lake' && hit.p[1] < 0.3) { (S.wake.lake ||= []).push([hit.p[0], hit.p[2], S.T - hit.shot.start + S.wait, 1]); if (S.wake.lake.length > 4) S.wake.lake.shift(); }
  return { id, p: hit.p.map((x) => +x.toFixed(2)), on: hit.on };
}

// ---- sound --------------------------------------------------------------------------------
// A music player of its own: what lies in music/ and the film's own track (the server lists
// them), and whatever files are dropped on the page or picked. It plays on by itself, track
// after track, whatever we are doing; only when the film plays itself (auto) is the film's own
// track laid against the film as in the film. And the air: a hush that rises with our speed.
// And the air of each place, made here out of noise (nothing is loaded): the wind, which rises
// with our speed; thin air high up; the lake lapping, and its rain; leaves; rain and its patter
// when rain is asked for; under snow everything is duller. Footfalls, a landing, a drop on the
// water. All of it quiet, well under the music, and its level is its own ([ and ]).
function makeAir(ac) {
  const out = ac.createGain();
  out.gain.value = 0.7;
  const len = ac.sampleRate * 4, pink = ac.createBuffer(1, len, ac.sampleRate), white = ac.createBuffer(1, len, ac.sampleRate), pd = pink.getChannelData(0), wd = white.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + 0.03 * w; b1 = 0.985 * b1 + 0.07 * w; b2 = 0.95 * b2 + 0.1 * w; pd[i] = (b0 + b1 + b2) * 0.5; wd[i] = w * 0.5; }
  const bed = (buffer, type, freq, q, rate = 1) => {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = buffer; s.loop = true; s.playbackRate.value = rate; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(out); s.start(0, Math.random() * 3);
    return { f, g };
  };
  const wind = bed(pink, 'lowpass', 400, 0.4), high = bed(pink, 'bandpass', 760, 2.2, 1.3), water = bed(pink, 'bandpass', 520, 0.9, 0.8), leaves = bed(white, 'bandpass', 3400, 0.8), rain = bed(white, 'highpass', 2600, 0.5), patter = bed(pink, 'bandpass', 1500, 0.7, 1.7);
  const to = (param, v, tau) => param.setTargetAtTime(v, ac.currentTime, tau);
  // Something struck: a short burst of the noise through a filter.
  const knock = (freq, q, dur, level, type = 'lowpass') => {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t0 = ac.currentTime;
    s.buffer = pink; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(level, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t0, Math.random() * 3, dur + 0.05);
  };
  let t = 0;
  return {
    out,
    // s: { reg, speed, height (above what is under us), rain, snow, night }: every frame.
    set(s, dt) {
      t += dt;
      const gust = 0.5 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1), lap = 0.5 + 0.5 * Math.sin(t * 0.9 + 0.6 * Math.sin(t * 0.31)), dull = 1 - 0.45 * s.snow, wet = Math.max(s.rain, s.reg === 'lake' ? 0.35 : 0);
      to(wind.g.gain, (0.022 + 0.06 * ss(1.5, 12, s.speed) + 0.012 * s.night + 0.02 * s.rain) * (0.75 + 0.5 * gust) * dull, 0.3);
      to(wind.f.frequency, (320 + 1000 * ss(2, 13, s.speed) - 70 * s.night) * (1 - 0.4 * s.snow), 0.3);
      to(high.g.gain, (s.reg === 'tower' || s.reg === 'summit' ? 0.03 : 0) * (0.4 + 0.9 * gust) * dull, 1.2);
      to(high.f.frequency, 640 + 260 * gust, 2);
      to(water.g.gain, (s.reg === 'lake' ? 0.075 : 0) * (0.55 + 0.45 * lap) * ss(14, 3, s.height), 0.8);
      to(leaves.g.gain, (s.reg === 'forest' ? 0.02 : s.reg === 'ruins' || s.reg === 'summit' ? 0.005 : 0) * (0.3 + 1.2 * gust) * (1 - s.snow), 0.9);
      to(rain.g.gain, 0.04 * wet, 0.8);
      to(patter.g.gain, 0.03 * wet, 0.8);
    },
    // A footfall: how hard (0 … 1), and on what.
    step(hard, on) {
      const v = 0.9 + 0.2 * Math.random();
      if (on === 'snow') knock(1700 * v, 0.9, 0.16, 0.16 * hard, 'bandpass');
      else if (on === 'wood') knock(420 * v, 1.2, 0.09, 0.15 * hard);
      else if (on === 'earth') knock(300 * v, 0.7, 0.1, 0.1 * hard);
      else knock(520 * v, 0.9, 0.07, 0.07 * hard);
    },
    land(hard) { knock(180, 0.7, 0.22, 0.3 * hard); },
    // A drop on the water.
    plip(level = 1) {
      const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime;
      o.frequency.setValueAtTime(880, t0); o.frequency.exponentialRampToValueAtTime(500, t0 + 0.09);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.03 * level, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.2);
    },
  };
}
const player = (() => {
  const el = new Audio();
  el.preload = 'auto';
  const ui = { bar: $('player'), pp: $('pp'), name: $('tname'), seek: $('seek'), time: $('ttime'), order: $('order'), vol: $('vol'), list: $('tracks') };
  const ORDER = { all: '顺序', one: '单曲', shuffle: '随机' };
  let list = [], at = -1, order = 'all', ac = null, gain = null, amb = null, ambVol = 0.7, muted = false, vol = 0.85, seeking = false, want = null, tap = null;
  const bins = new Uint8Array(512), env = { fast: 0, slow: 0.08, breath: 0, hit: 0 };
  const nice = (f) => (f === 'gris-before-gris.wav' ? 'Berlinist - Gris before Gris' : f.replace(/\.[^.]+$/, '').replace(/_+/g, ' '));
  const clock = (t) => (isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');
  const draw = () => {
    ui.name.textContent = at >= 0 ? list[at].name : list.length ? list[0].name : '没有音乐';
    ui.pp.textContent = el.paused ? '▶' : '❙❙';
    ui.order.textContent = ORDER[order];
    ui.list.innerHTML = '';
    list.forEach((t, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t.name; if (i === at) b.className = 'on'; b.addEventListener('click', () => play(i)); ui.list.appendChild(b); });
  };
  function play(i, t = 0) {
    if (!list.length) return;
    at = ((i % list.length) + list.length) % list.length;
    el.src = list[at].url; want = t > 0 ? t : null;
    el.play().catch(() => {});
    draw();
  }
  const next = (d = 1) => play(order === 'shuffle' && list.length > 1 ? (at + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length : at + d);
  el.addEventListener('loadedmetadata', () => { if (want !== null) { el.currentTime = Math.min(want, Math.max(0, el.duration - 0.2)); want = null; } });
  el.addEventListener('ended', () => (order === 'one' ? play(at) : next()));
  el.addEventListener('play', draw); el.addEventListener('pause', draw);
  el.addEventListener('timeupdate', () => { if (!seeking) ui.seek.value = el.duration ? Math.round((el.currentTime / el.duration) * 1000) : 0; ui.time.textContent = `${clock(el.currentTime)} / ${clock(el.duration)}`; });
  ui.seek.addEventListener('input', () => { seeking = true; });
  ui.seek.addEventListener('change', () => { if (el.duration) el.currentTime = (ui.seek.value / 1000) * el.duration; seeking = false; });
  ui.vol.addEventListener('input', () => { vol = ui.vol.value / 100; if (gain && !muted) gain.gain.setTargetAtTime(vol, ac.currentTime, 0.05); });
  ui.pp.addEventListener('click', () => api.toggle());
  $('prev').addEventListener('click', () => next(-1));
  $('next').addEventListener('click', () => next(1));
  ui.order.addEventListener('click', () => { order = order === 'all' ? 'one' : order === 'one' ? 'shuffle' : 'all'; draw(); });
  $('listbtn').addEventListener('click', () => ui.bar.classList.toggle('open'));
  $('add').addEventListener('click', () => $('files').click());
  $('files').addEventListener('change', (e) => api.add(e.target.files));
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => { e.preventDefault(); api.add(e.dataTransfer.files); });
  const api = {
    async load() {
      try { list = (await (await fetch('/api/tracks')).json()).tracks.map((t) => ({ url: t.url, name: nice(t.file), film: t.film })); }
      catch { list = [{ url: 'audio/gris-before-gris.wav', name: 'Berlinist - Gris before Gris', film: true }]; }
      draw();
    },
    // The sound has to be begun from a click or a key.
    start() {
      if (ac) return;
      ac = new AudioContext();
      const src = ac.createMediaElementSource(el);
      gain = ac.createGain(); gain.gain.value = vol; src.connect(gain); gain.connect(ac.destination);
      tap = ac.createAnalyser(); tap.fftSize = 1024; tap.smoothingTimeConstant = 0.5; src.connect(tap);
      amb = makeAir(ac); amb.out.gain.value = ambVol; amb.out.connect(ac.destination);
      if (at < 0) play(0);
    },
    add(files) {
      const first = list.length;
      for (const f of files || []) if (/^audio\//.test(f.type) || /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i.test(f.name)) list.push({ url: URL.createObjectURL(f), name: nice(f.name) });
      if (list.length > first) { ui.bar.classList.add('open'); play(first); }
    },
    toggle() { if (at < 0) play(0); else if (el.paused) el.play().catch(() => {}); else el.pause(); },
    next, play,
    // The film's own track, at the film's own time (auto).
    film(T) {
      const i = list.findIndex((t) => t.film);
      if (i < 0) return;
      if (at !== i) play(i, T); else if (el.readyState > 0 && Math.abs(el.currentTime - T) > 0.2 && T < el.duration - 0.3) el.currentTime = T;
      if (el.paused && want === null && T < END - 0.2) el.play().catch(() => {});
    },
    // The air (makeAir): what it is doing this frame; and the things that happen in it.
    air(state, dt) { if (amb) amb.set(state, dt); },
    sound(what, ...a) { if (amb && !muted) amb[what](...a); },
    airLouder(d) { ambVol = clamp(ambVol + d, 0, 2); if (amb && !muted) amb.out.gain.setTargetAtTime(ambVol, ac.currentTime, 0.1); return ambVol; },
    // How the music is breathing, for the world to answer (taken before the volume: turned down, it breathes the same).
    // breath: its loudness against its own recent average, slowly (0 quiet … about 0.45 as usual … 1 a swell); hit: a note struck, gone in a moment.
    pulse(dt) {
      if (!tap || el.paused) { env.fast *= Math.exp(-dt * 1.5); env.breath = lerp(env.breath, 0, 1 - Math.exp(-dt * 1.2)); env.hit *= Math.exp(-dt * 6); return { breath: env.breath, hit: env.hit }; }
      tap.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 1; i < 180; i++) sum += bins[i] * bins[i];
      const now = Math.sqrt(sum / 179) / 255;
      env.hit = Math.max(env.hit * Math.exp(-dt * 6), clamp((now - env.fast) * 7, 0, 1));
      env.fast = lerp(env.fast, now, 1 - Math.exp(-dt * 5)); env.slow = lerp(env.slow, now, 1 - Math.exp(-dt * 0.12));
      env.breath = lerp(env.breath, clamp((env.fast / Math.max(env.slow, 0.03) - 0.55) / 1.0, 0, 1), 1 - Math.exp(-dt * 2.2));
      return { breath: env.breath, hit: env.hit };
    },
    mute() { muted = !muted; if (gain) { gain.gain.setTargetAtTime(muted ? 0 : vol, ac.currentTime, 0.1); amb.out.gain.setTargetAtTime(muted ? 0 : ambVol, ac.currentTime, 0.1); } return muted; },
    louder(d) { ui.vol.value = clamp(Number(ui.vol.value) + d, 0, 100); ui.vol.dispatchEvent(new Event('input')); },
    state: () => ({ at, n: list.length, name: list[at]?.name, paused: el.paused, t: +el.currentTime.toFixed(2), order, ready: el.readyState }),
  };
  return api;
})();

// ---- the picture, and the loop ------------------------------------------------------------
note.textContent = '正在铺开世界…';
const film = await createFilm(canvas, { w: W, h: H, light: query.get('light') !== '0' });
// Every place is built and drawn once before we begin, so that walking into it does not stall.
for (const T of [1, 20, 45, 65, 85, 108]) { film.render(T, 1); await new Promise((r) => setTimeout(r, 0)); }
film.render(0, 1);
// The film's own way is kept open through every place: the grid of what can be walked into is
// coarse, and the way passes within a stride of posts and columns. Foliage that reaches into
// it is drawn in.
for (const s of SHOTS) {
  const hit = film.scene(s.id)?.hit;
  if (!hit) continue;
  const way = WAY.map((w) => s.place.from(w));
  for (const l of way) clearAt(hit, l[0], l[1], l[2], 0.6);
  for (const b of hit.balls) {
    let near = 1e9;
    for (const l of way) { const q = (l[0] - b[0]) ** 2 + (l[1] - b[1]) ** 2 + (l[2] - b[2]) ** 2; if (q < near) near = q; }
    b[3] = Math.max(0, Math.min(b[3], Math.sqrt(near) - 0.55));
  }
}
await player.load();
// Behind the veil, the world as it will be wandered.
S.T = DAY; goView(0, false); step(1 / 60); step(1 / 60);
note.textContent = '';
veil.classList.add('ready');

const stamp = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const NAME = Object.fromEntries(SHOTS.map((s) => [s.id, s.name])), SUB = { paper: '白纸', ruins: '废墟', lake: '湖', forest: '树林', tower: '云上的塔', summit: '山' };
// A few words in the middle of the picture, for a moment: the name of a place as we come into it; what a key has just done.
const placard = $('place');
let said = 0;
const say = (text, secs = 3.2) => { placard.textContent = text; placard.classList.add('on'); clearTimeout(said); said = setTimeout(() => placard.classList.remove('on'), secs * 1000); };
let last = 0, shown = false, lastRegion = null, heard = { reg: 'ruins', speed: 0, height: 0, rain: 0, snow: 0, night: 0 };
function tick(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  if (S.started && PH) { stepPhoto(dt); player.air({ ...heard, speed: 0 }, dt); }
  else if (S.started) {
    const t0 = performance.now(), was = S.state, fell = S.vel[1], trod = Math.floor(S.walked / 0.8), rings = (S.wake.lake || []).reduce((m, r) => Math.max(m, r[2]), -1e9);
    step(dt);
    S.ms = lerp(S.ms, performance.now() - t0, 0.05); S.fps = lerp(S.fps, 1 / dt, 0.05);
    // What is heard: the air of the place; a footfall every stride; a landing; a drop when a ring starts on the water.
    const wander = S.mode === 'wander' && !S.auto, speed = S.auto ? CAM(S.T).speed ?? 0 : Math.min(V.len(S.vel), 30), onFeet = !S.auto && (S.state === 'ground' || (S.ride && S.ride.kind === 'walk') || (S.tour && !S.ride && S.grounded));
    heard = { reg: S.region, speed, height: Math.max(0, S.pos[1] - PLACE[S.region].off[1]), rain: wander ? S.wx.rain : 0, snow: wander ? S.wx.snow : 0, night: FLECK_LOOK(S.T).night };
    player.air(heard, dt);
    if (onFeet && Math.floor(S.walked / 0.8) !== trod) player.sound('step', 0.45 + 0.55 * ss(2.4, 5.4, speed), wander && S.wx.snow > 0.5 ? 'snow' : S.region === 'lake' ? 'wood' : S.region === 'forest' || S.region === 'summit' ? 'earth' : 'stone');
    if (!S.auto && !S.tour && was !== 'ground' && S.state === 'ground') player.sound('land', clamp(-fell / 9, 0.25, 1));
    if ((S.wake.lake || []).some((r) => r[2] > rings)) player.sound('plip', 1);
    if (S.auto) player.film(S.T);
    const where = S.mode !== 'wander' && S.T < 13.6 ? 'paper' : S.region;
    if (where !== lastRegion) { if (lastRegion !== null || S.mode === 'wander') say(`${NAME[where]} · ${SUB[where]}`); lastRegion = where; }
    if (shown) {
      const what = S.auto ? '影片' : S.edge > 0.5 ? '这里还没有画' : S.mode === 'wander' ? (S.tour ? (S.ride ? S.ride.name : '导览') : S.state === 'ground' ? '散步' : S.state === 'air' ? '跃起' : S.cruise ? '巡航' : '飞行') : S.rate < 0.15 && S.T < END - 0.1 ? `光点在等你 · ${S.far.toFixed(0)} 步外` : S.mode === 'rail' ? '旅程 · 沿路' : S.grounded ? '旅程 · 行走' : '旅程 · 飞行';
      hud.textContent = `${NAME[where]} · ${what} · ${W}×${H} · ${S.fps.toFixed(0)} fps`;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Catching the pointer is a convenience, and not every window allows it (the Claude app's own
// browser pane does not): without it the eye is turned by dragging, or with the arrow keys.
const lock = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* dragging, then */ } };
// The four ways in: to wander; to be carried round; the story, walked; the film.
function begin(kind = 'wander') {
  S.started = true; S.auto = kind === 'auto';
  veil.classList.add('gone');
  player.start();
  if (kind === 'auto' || kind === 'journey') { S.mode = 'free'; S.tour = false; rejoin(0); }
  else { S.mode = 'wander'; S.T = DAY; S.tour = false; if (kind === 'tour') startTour(); else goView(0, false); }
  lastRegion = null;
  if (kind === 'wander' || kind === 'journey') lock();
  $('keys').classList.add('hint');
}
for (const kind of ['wander', 'tour', 'journey', 'auto']) $(kind).addEventListener('click', () => begin(kind));

const takeOver = () => { if (S.auto) { S.auto = false; S.vel = [0, 0, 0]; S.idle = 9; } };
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (!S.started) { if (e.code === 'Enter') begin('wander'); return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (PH) {                                                      // the camera's own keys (the rest is held: W A S D, Space / Q, the arrows, [ ])
    if (e.code === 'KeyP' || e.code === 'Escape') photoOff();
    if (e.code === 'Enter') shoot();
    if (e.code === 'KeyF') { PH.blur = PH.blur ? 0 : 5; say(PH.blur ? '浅景深（点画面对焦）' : '全景深', 1.6); }
    if (e.code === 'Minus' || e.code === 'Equal') { PH.blur = clamp((PH.blur || 0) + (e.code === 'Equal' ? 1.5 : -1.5), 0, 14); say(PH.blur ? `虚化 ${PH.blur.toFixed(1)}` : '全景深', 1.2); }
    if (e.code === 'KeyH') $('photo').classList.toggle('off');
    if (e.code === 'Digit0') { PH.roll = 0; PH.fov = 46; }
    return;
  }
  const wander = S.mode === 'wander' && !S.auto;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) takeOver();
  if (e.code === 'KeyG') { S.auto = !S.auto; if (S.auto) { if (S.mode === 'wander') { S.mode = 'free'; rejoin(0); } say('影片'); } else { S.vel = [0, 0, 0]; S.idle = 9; } }
  if (e.code === 'KeyJ') {                                         // the journey, from its beginning; or back to wandering, where we stand
    S.auto = false;
    if (S.mode === 'wander') { S.blink = 1; S.jump = () => { S.mode = 'free'; S.tour = false; rejoin(0); lastRegion = null; }; say('旅程：跟着光点'); }
    else { S.blink = 1; S.jump = () => { S.mode = 'wander'; S.T = DAY; S.Te = DAY; if (S.region === 'ruins' && S.pos[0] < -18) goView(0, false); }; say('漫游'); }
  }
  if (e.code === 'KeyL') { S.auto = false; S.mode = S.mode === 'rail' ? 'free' : 'rail'; rejoin(S.mode === 'rail' && S.T > END - 1 ? 0 : S.T); say(S.mode === 'rail' ? '旅程 · 沿路' : '旅程'); }
  if (e.code === 'KeyT') {                                         // carried along the film's way (from the point of it nearest us, or its beginning)
    S.auto = false;
    if (S.mode !== 'wander') { S.blink = 1; S.jump = () => startTour(); say('导览'); }
    else if (S.tour && !S.ride) { S.tour = false; say('漫游'); }
    else {
      let best = -1, bd = 144;
      for (let i = Math.round(13.8 * HZ); i <= N; i++) { const w = WAY[i], q = (w[0] - S.pos[0]) ** 2 + (w[1] - S.pos[1]) ** 2 + (w[2] - S.pos[2]) ** 2; if (q < bd) { bd = q; best = i; } }
      S.blink = 1; S.jump = () => startTour(best >= 0 ? best / HZ : 13.8);      // from the point of the way nearest us, if we are near it; else from its beginning
      say('导览');
    }
  }
  if (e.code === 'KeyU' && wander) {                              // carried round the place we are in; or let go
    if (S.ride) { S.tour = false; S.ride = null; S.vel = [0, 0, 0]; say('漫游'); }
    else if (!RIDES[S.region]) say('这里没有可乘的路', 1.8);
    else { const reg = S.region; S.blink = 1; S.jump = () => { if (!startRide(reg)) say('这里没有可乘的路', 1.8); }; say(RIDES[reg].name); }
  }
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') say(`环境声 ${Math.round(player.airLouder(e.code === 'BracketRight' ? 0.1 : -0.1) * 100)}%`, 1.2);
  if (e.code === 'KeyC' && !S.auto) { S.cruise = !S.cruise; say(S.cruise ? '巡航' : '巡航 · 关', 1.4); }
  if (e.code === 'KeyN' && wander) { S.night = !S.night; S.cycleT = 0; say(S.night ? '入夜' : '天亮', 2.4); }
  if (e.code === 'KeyY' && wander) { S.cycle = !S.cycle; S.cycleT = 0; say(S.cycle ? '昼夜流转' : '昼夜流转 · 停', 2); }
  if (e.code === 'KeyK' && wander) { S.weather = (S.weather + 1) % WEATHER.length; say(WEATHER[S.weather], 2); }
  if (e.code === 'KeyZ' || e.code === 'KeyX') {
    if (wander) goView(S.view + (e.code === 'KeyX' ? 1 : -1));     // the next view, or the one before
    else {                                                        // (the journey) to the beginning of the place before, or of the next: the world's clock goes with us
      const starts = SHOTS.map((s) => s.start), i = starts.filter((t) => t <= S.T + 0.01).length - 1;
      S.auto = false; rejoin(e.code === 'KeyX' ? starts[Math.min(starts.length - 1, i + 1)] + 0.05 : starts[Math.max(0, S.T - starts[i] > 3 ? i : i - 1)] + 0.05);
    }
  }
  if (e.code === 'KeyB') { S.auto = false; if (wander) goView(S.view); else rejoin(); }      // back to the last view; (the journey) back beside the fleck
  if (e.code === 'KeyV') S.assist = !S.assist;
  if (e.code === 'KeyP') { if (S.auto) say('影片播放时不能拍照', 1.6); else photoOn(); }
  if (e.code === 'KeyO' && wander) { PAL.on = !PAL.on; say(PAL.on ? '光点同行' : '光点 · 暂别', 1.8); }
  if (e.code === 'KeyI' && wander) { S.breathe = !S.breathe; say(S.breathe ? '随音乐呼吸' : '随音乐呼吸 · 关', 1.8); }
  if (e.code === 'KeyM') say(player.mute() ? '静音' : '有声', 1.2);
  if (e.code === 'Enter') player.toggle();
  if (e.code === 'Comma') player.next(-1);
  if (e.code === 'Period') player.next(1);
  if (e.code === 'Minus') player.louder(-8);
  if (e.code === 'Equal') player.louder(8);
  if (e.code === 'KeyH') { shown = !shown; hud.style.display = shown ? '' : 'none'; $('keys').classList.toggle('show', shown); $('keys').classList.remove('hint'); }
  if (e.code === 'KeyR') { reset(); lastRegion = null; }
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') location.search = `?h=${{ Digit1: 720, Digit2: 900, Digit3: 1080 }[e.code]}`;
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// The mouse: with the pointer caught, it turns the eye and a click drops colour at the middle
// of the picture; with it free, drag to turn and click to drop where the pointer is.
const locked = () => document.pointerLockElement === canvas;
let drag = null;
const turn = (dx, dy) => {
  if (PH) { const k = 0.0023 * (PH.fov / 46); PH.yaw += dx * k; PH.pitch = clamp(PH.pitch - dy * k, -1.4, 1.4); return; }
  if (S.auto) return;                                            // (while the film plays itself the mouse is let be: only W A S D take the camera back)
  S.yaw += dx * 0.0023; S.pitch = clamp(S.pitch - dy * 0.0023, -1.35, 1.35); S.idle = 0;
};
const point = (px, py) => (PH ? photoFocus(px, py) : drop(px, py));      // a click: colour, or (with the camera out) focus
canvas.addEventListener('mousedown', (e) => {
  if (!S.started || e.button !== 0) return;
  if (locked()) { point(W / 2, H / 2); return; }
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
});
addEventListener('mousemove', (e) => {
  if (locked()) turn(e.movementX, e.movementY);
  else if (drag) { drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY); turn(-e.movementX * 1.4, -e.movementY * 1.4); }
});
addEventListener('mouseup', (e) => {
  if (drag && drag.moved < 5) { const r = canvas.getBoundingClientRect(); point(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H); }
  drag = null;
});
canvas.addEventListener('dblclick', lock);
canvas.addEventListener('wheel', (e) => { if (!PH) return; e.preventDefault(); PH.fov = clamp(PH.fov * Math.exp(e.deltaY * 0.0012), 12, 100); }, { passive: false });

// For looking at it from the console, and for timing it without a display.
window.__play = {
  S, FEEL, film, step, drop, begin, reset, rejoin, goView, keys, WAY, ROOM, PLACE, JOIN, mixFor, regionAfter, blocked, player, say, DAY, PAL,
  photoOn, photoOff, shoot, photo: () => PH, stepPhoto, RIDES, RIDE, buildRide, startRide, makeAir,
  // Play n frames of dt seconds with these keys held, from where we are (or from where the story is at T).
  run(n = 60, dt = 1 / 60, heldKeys = ['KeyW'], T = null) {
    if (T !== null) rejoin(T);
    S.started = true; heldKeys.forEach((k) => keys.add(k));
    const t0 = performance.now();
    for (let i = 0; i < n; i++) step(dt);
    film.sync();
    heldKeys.forEach((k) => keys.delete(k));
    return { ms: +((performance.now() - t0) / n).toFixed(2), T: +S.T.toFixed(2), rate: +S.rate.toFixed(2), region: S.region, foot: S.grounded, far: +S.far.toFixed(1), edge: +S.edge.toFixed(2), pos: S.pos.map((x) => +x.toFixed(2)) };
  },
  // Put the eye somewhere (a world point), looking along yaw / pitch, come to from region `reg`.
  place(pos, yaw = S.yaw, pitch = S.pitch, reg = S.region, grounded = false) { Object.assign(S, { pos: [...pos], yaw, pitch, vel: [0, 0, 0], region: reg, grounded, state: grounded ? 'ground' : 'fly', fs: 0, fd: null, idle: 0 }); S.region = regionAfter(reg, S.pos, S.T); return S.region; },
  async snap(name = 'play') {
    const r = await fetch(`/api/snap?name=${encodeURIComponent(name)}&w=${W}&h=${H}&scale=0`, { method: 'POST', body: film.read() });
    return r.json();
  },
};
