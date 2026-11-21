// Scene geometry shared by the scenery (scenes.js) and the timeline (shots.js), in world
// units (x right, y up, z into the picture; the traveller is 1 unit tall).

export const PAPER_HEX = '#F4EFE6';

// 1 纸: the pencil line on the ground and where the traveller appears on it.
export const SHEET = { z: 20, x0: -14, x1: 14, stand: -5.5 };

// 2 灰. Everything the eye has to go round, between or under on its way through the ruin
// is laid out here, so that the scenery (scenes.js) and the path (shots.js) agree.
//   row     the colonnade: column i stands at x0 + i * pitch
//   aisle   a second row behind it, for columns `from` … `to`: between the two rows runs an
//           aisle, roofed with beams, that ends where its roof has come down (`fall`)
//   arch    the great arch, across the way out of the aisle: its left pillar and its depth
//   drum    a length of fallen column lying across the walk
//   gate    two columns the walk goes between
export const RUINS = {
  pathZ: 24,
  row: { z: 34, x0: -52, pitch: 4.6, n: 27 },
  aisle: { z: 41, from: 12, to: 24, fall: 56.6 },
  arch: { lx: 49.3, z: 66 },
  drum: { x: -10.6, z: 24.4, len: 2.6 },
  gate: [{ x: -5.0, z: 26.0, stump: 1 }, { x: -4.4, z: 21.4, stump: 0.42 }],
  dais: { x: 2.1, z: 24, r: 1.15 },          // a round stone set in the paving: where the first colour falls
  aqueduct: { z: 100, deep: 5.5, arch: 62.3 },      // its near face and thickness; the middle of the arch we fly through
};
export const colX = (i) => RUINS.row.x0 + i * RUINS.row.pitch;

// 3 青. What stands in the water along our way: a jetty we go under, a leaning post, three
// posts lashed together, three piles set down the middle of the channel (we go round them
// in turn), and the two nearest towers, which stand close enough to be gone between.
export const LAKE = {
  jetty: { z: 29.2, x0: -19.8, bays: 11, bay: 3.2, deck: 2.25 },         // piles at x0 + k * bay
  post: { x: -0.9, z: 26.0, h: 3.2 },
  cluster: [[3.6, 35.6, 3.4], [4.3, 35.7, 3.0], [3.95, 36.3, 3.6]],       // x, z, height
  piles: [[6.0, 42.0], [9.1, 50.0], [12.7, 59.5]],
  towers: [[21.6, 96.2, 50, 8.5], [32.6, 100.4, 34, 7.6], [48, 91, 56, 8.6]],      // x, z, height, width
};

// 4 朱. The proportions of the four reference trees (Ff_1 … Ff_4): width / height, and
// the crown as centre x (of width), centre y from the top and radius (both of height).
export const TREES = {
  'tree-1': { aspect: 0.5, crown: [0.506, 0.301, 0.222] },
  'tree-2': { aspect: 0.503, crown: [0.501, 0.256, 0.24] },
  'tree-3': { aspect: 0.384, crown: [0.501, 0.198, 0.185] },
  'tree-4': { aspect: 0.45, crown: [0.499, 0.2305, 0.213] },
};
// A tree standing at x with height h, and where its crown ends up in the world.
const tree = (id, x, h) => {
  const t = TREES[id];
  return { id, x, h, w: h * t.aspect, cx: x + (t.crown[0] - 0.5) * h * t.aspect, cy: h * (1 - t.crown[1]), r: h * t.crown[2] };
};
// The row whose crowns bloom as the traveller passes under them; and the trunks that
// stand in the lane we fly down, one after another, each a little off the middle of it so
// that there is a side to pass it on (`lane`: x, z).
export const FOREST = {
  lane: Array.from({ length: 8 }, (_, k) => [-56 + 9 * k, 22.5 + (k % 2 ? -0.35 : 0.35)]),
  bloomZ: 34,
  row: Array.from({ length: 17 }, (_, k) => tree(`tree-${[2, 4, 1, 3][k % 4]}`, -40 + 5.4 * k, [15, 15.6, 16.2, 15][k % 4])),
  tree,
};

// 5 金: the tower stands on the origin; its stair climbs one pitch per turn.
export const TOWER = { r: 3.2, pitch: 7, top: 30, base: -16 };
// How high the stair's treads are at the angle psi round the tower (psi may run past a turn).
export const stairY = (psi) => TOWER.base + (TOWER.pitch * psi) / (Math.PI * 2);

// 6 留白. The summit's flat shoulder, where the traveller lands, is at y = 0 round x = 0,
// from the cliff edge at z = 6.6 back to z = 12.6, with the peak rising to the right of it.
export const SUMMIT = {
  stand: [0, 0, 9.9],
  cairn: [1.0, 0.78, 12.45],       // the top of a cairn at the far edge of the shoulder: x, y, z
  moon: [0, 0.379, 0.075],          // azimuth, elevation, radius (radians)
  title: { text: 'UNPAINTED', box: [0, 0.262, 0.34, 0.0425] },       // under the moon: azimuth, elevation, width, height (radians)
};

// ---- one world ----------------------------------------------------------------------------
// Each place above is built in its own coordinates. For the film to be one unbroken take
// they are set down in one world, whose frame is the ruin's: PLACE[id] turns a place about
// y (yaw) and moves it (off). Each is turned so that its own sun is the world's sun.
//   to(p)    a point of the place, in the world          from(p)   a world point, in the place
// Where two places meet there is a JOIN: a plane in the world (nx, ny, nz, w with n·p + w = 0;
// negative on the side of the place we come from), or for the first, the point the world
// is drawn outwards from.
const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
const place = (yaw, off) => ({
  yaw, off,
  to: (p) => { const q = rotY(p, yaw); return [q[0] + off[0], q[1] + off[1], q[2] + off[2]]; },
  from: (p) => rotY([p[0] - off[0], p[1] - off[1], p[2] - off[2]], -yaw),
  dir: (d) => rotY(d, yaw),
});
// Set a place down, turned by yaw, so that its own point `a` lies on the world point `w`.
const pin = (yaw, a, w) => { const q = rotY(a, yaw); return place(yaw, [w[0] - q[0], w[1] - q[1], w[2] - q[2]]); };
const planeAt = (n, p) => [n[0], n[1], n[2], -(n[0] * p[0] + n[1] * p[1] + n[2] * p[2])];

const paperP = place(0, [-20.6, 0, 3.5]);                 // the sheet is the ruin's own ground, before anything is drawn on it
const ruinsP = place(0, [0, 0, 0]);
// The lake lies beyond the aqueduct: we come through an arch of it and down on to the water.
const lakeP = pin(0.72, [-1.0, 0.9, 23.2], [69.3, 0.9, 118.5]);
// The wood stands on the lake's far shore: its own x = SHORE is the water's edge, and the lane begins there.
export const SHORE = -70;
const forestP = pin(0.129, [SHORE, 5.0, 23.3], lakeP.to([41.5, 5.0, 114.2]));
// The tower stands out of the cloud that lies over the wood: we go up into the cloud from one and come out of it at the other.
const towerP = pin(-0.14, [-5.0, -11, -36], forestP.to([12.2, 56, 29.6]));
// The mountain stands at the edge of the cloud sea, beyond the tower from where we end our drift round it (DRIFT).
export const DRIFT = [29 * Math.sin(12.0), 26.3, -29 * Math.cos(12.0)];       // in the tower's coordinates
export const GLIDE = [Math.sin(0.95), 0, Math.cos(0.95)];                     // the way from there to the mountain (the summit's own +z)
const summitP = pin(0.81, [-7, -6, -6], towerP.to([DRIFT[0] + 55 * GLIDE[0], 8, DRIFT[2] + 55 * GLIDE[2]]));
export const PLACE = { paper: paperP, ruins: ruinsP, lake: lakeP, forest: forestP, tower: towerP, summit: summitP };
export const JOIN = {
  drop: paperP.to([6.35, 0, SHEET.z - 0.05]),                                  // where the first drop falls: the world is drawn outwards from here
  aqueduct: planeAt([0, 0, 1], [0, 0, RUINS.aqueduct.z + RUINS.aqueduct.deep + 0.7]),
  shore: planeAt(forestP.dir([1, 0, 0]), forestP.to([SHORE, 0, 0])),
  cloudEdge: planeAt(towerP.dir(GLIDE), towerP.to([DRIFT[0] + 38 * GLIDE[0], 0, DRIFT[2] + 38 * GLIDE[2]])),
};
// How far a point of one place is past a join, in world units (> 0: on the far side).
export const past = (join, placeId, p) => { const w = PLACE[placeId].to(p), j = JOIN[join]; return j[0] * w[0] + j[1] * w[1] + j[2] * w[2] + j[3]; };
