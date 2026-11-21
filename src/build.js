// Geometry for the scenes: a Builder that gathers many pieces into one mesh, and the
// pieces themselves (column shafts, ring-shaped stones, rocks, trunks, terrain).
//
// Every vertex carries its pigment and (kind, id, facing, extra); see MESH_FRAG in
// shaders.js for what they mean. Pieces are given in world units (the traveller is 1 tall).
import * as THREE from 'three';

// BLADE: a plant, held at its root (or a vine, held at its top): `extra` is how far along it
// a vertex is from where it is held, and the wind and whoever passes bend it by that.
// LAMP: something that lights; `extra` is the shot time at which it does. FLAG: cloth held
// along one edge; `extra` is the distance from that edge.
export const K = { STONE: 1, PUFF: 2, CAPE: 3, PALE: 4, DARK: 5, LAND: 6, SKIN: 7, BLADE: 8, LAMP: 9, FLAG: 10, FIG: 16 };
export const FACE = { SMOOTH: 0, FACET: 1, SHEET: 2 };

export const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
export const mixc = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
export const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// Repeatable noise of a position: the same point always moves the same way, so the
// copies of a vertex that a geometry keeps per face stay together.
const h3 = (x, y, z, s) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453;
  return v - Math.floor(v);
};
const sm = (t) => t * t * (3 - 2 * t);
export function noise2(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), u = sm(x - xi), v = sm(y - yi);
  const a = h3(xi, yi, 0, s), b = h3(xi + 1, yi, 0, s), c = h3(xi, yi + 1, 0, s), d = h3(xi + 1, yi + 1, 0, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm2(x, y, s = 0, oct = 4) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * noise2(x, y, s + i * 7.3); norm += amp; x = x * 2.03 + 3.1; y = y * 2.03 + 1.7; amp *= 0.5; }
  return sum / norm;
}

const E = new THREE.Euler(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
// A placement: position, rotation (Euler angles, radians, applied x then y then z), scale.
export function mat(p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const sc = Array.isArray(s) ? s : [s, s, s];
  return new THREE.Matrix4().compose(P.set(...p), Q.setFromEuler(E.set(r[0], r[1], r[2], 'ZYX')), S.set(...sc));
}

// What can be walked into (play.js, when the world is walked freely): made here, as the pieces
// are added, when Builder.collect is on. Two kinds: `cells`, the cells of a grid (CELL wide)
// that some face of a solid thing passes through; and `balls` for foliage, which is a great
// many faces and round anyway. Small things, flat things lying on the ground, plants, cloth
// and lamps are not in the way. Ground with relief is not here either: a scene says how high
// its ground is (`ground`).
export const CELL = 0.5, CELLY = 0.25;     // (finer upwards than across: a step is told from a wall by its height)
const cellKey = (x, y, z) => ((Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096)) * 8192 + (Math.floor(y / CELLY) + 1024);
// Is the point (x, y, z), with r of room round it, inside something?
export function blocked(hit, x, y, z, r = 0.2) {
  if (!hit) return false;
  const c = hit.cells;
  if (c.has(cellKey(x, y, z)) || c.has(cellKey(x + r, y, z)) || c.has(cellKey(x - r, y, z)) || c.has(cellKey(x, y, z + r)) || c.has(cellKey(x, y, z - r)) || c.has(cellKey(x, y + r, z)) || c.has(cellKey(x, y - r, z))) return true;
  if (!hit.grid) {                                               // the balls, sorted into a coarse grid the first time they are asked for
    hit.grid = new Map();
    for (const b of hit.balls) {
      for (let i = Math.floor((b[0] - b[3]) / 16); i <= Math.floor((b[0] + b[3]) / 16); i++) for (let k = Math.floor((b[2] - b[3]) / 16); k <= Math.floor((b[2] + b[3]) / 16); k++) {
        const key = i * 4096 + k;
        if (!hit.grid.has(key)) hit.grid.set(key, []);
        hit.grid.get(key).push(b);
      }
    }
  }
  const list = hit.grid.get(Math.floor(x / 16) * 4096 + Math.floor(z / 16));
  if (list) for (const b of list) { const d = b[3] + r; if ((x - b[0]) ** 2 + (y - b[1]) ** 2 + (z - b[2]) ** 2 < d * d) return true; }
  return false;
}

// Makes sure there is room at a point (and r round it): the film's own way must stay open to
// whoever walks it, and the grid is coarse beside what the way passes close to (a post in the
// lake two strides from it filled the cell the way goes through).
export function clearAt(hit, x, y, z, r) {
  for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
    const base = ((ix + 4096) * 8192 + (iz + 4096)) * 8192 + 1024;
    for (let iy = Math.floor((y - r) / CELLY); iy <= Math.floor((y + r) / CELLY); iy++) hit.cells.delete(base + iy);
  }
}
// The top of whatever solid thing lies under the point, no higher than `up` above its feet at y (a
// step can be taken; a wall cannot), looking down as far as `down`. -Infinity: nothing there.
export function floorUnder(hit, x, y, z, up = 0.3, down = 2.5) {
  if (!hit) return -Infinity;
  const base = (Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096);
  for (let iy = Math.floor((y + up + 1e-6) / CELLY) - 1; iy >= Math.floor((y - down) / CELLY); iy--) if (hit.cells.has(base * 8192 + iy + 1024)) return (iy + 1) * CELLY;
  return -Infinity;
}

export class Builder {
  constructor(seed = 1) {
    this.rnd = rng(seed);
    this.pos = []; this.nor = []; this.col = []; this.dat = []; this.uv = []; this.idx = [];
    this.count = 0;
    this.hit = Builder.collect ? { cells: new Set(), balls: [], grid: null } : null;
    this.heart = [0, 0, 0]; this.reach = 420;                    // only what is within `reach` of `heart` can be walked into: the rest is backdrop
  }
  // The piece just added (vertices from `start` in pos, `n` of them; its faces in idx from `i0`): what of it is in the way.
  collide(start, n, i0, kind) {
    const P = this.pos;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = start; i < start + n * 3; i += 3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, most = Math.max(dx, dy, dz), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    if (kind === K.BLADE || kind === K.FLAG || kind === K.LAMP || most < 0.45 || most > 420) return;
    if (dy < 0.14 && y1 < 0.35) return;                          // lying flat on the ground: stepped over
    if (Math.hypot(cx - this.heart[0], cz - this.heart[2]) - most / 2 > this.reach) return;
    if (kind === K.PUFF) { this.hit.balls.push([cx, cy, cz, 0.42 * ((dx + dy + dz) / 3)]); return; }
    const cells = this.hit.cells, I = this.idx, step = CELLY * 0.8;
    for (let t = i0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ax = P[a], ay = P[a + 1], az = P[a + 2], ux = P[b] - ax, uy = P[b + 1] - ay, uz = P[b + 2] - az, vx = P[c] - ax, vy = P[c + 1] - ay, vz = P[c + 2] - az;
      const n1 = Math.max(1, Math.ceil(Math.hypot(ux, uy, uz) / step)), n2 = Math.max(1, Math.ceil(Math.hypot(vx, vy, vz) / step));
      for (let i = 0; i <= n1; i++) {
        const u = i / n1, m = Math.ceil(n2 * (1 - u));
        for (let j = 0; j <= m; j++) { const v = Math.min(1 - u, j / n2); cells.add(cellKey(ax + ux * u + vx * v, ay + uy * u + vy * v, az + uz * u + vz * v)); }
      }
    }
  }
  id() { return 0.03 + 0.96 * this.rnd(); }
  // geom: a BufferGeometry. m: where it goes. color: [r, g, b], or a function of the placed (so may `extra` be)
  // vertex (x, y, z, and the vertex before placing: lx, ly, lz). rest: a height to stand it on.
  add(geom, { m = null, color = [1, 1, 1], kind = K.STONE, id = this.id(), face = FACE.FACET, extra = 0, rest = null, solid = true } = {}) {
    if (!geom.attributes.normal) geom.computeVertexNormals();
    const gp = geom.attributes.position, gn = geom.attributes.normal, gu = geom.attributes.uv;
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    const v = new THREE.Vector3(), n = new THREE.Vector3(), base = this.count, start = this.pos.length;
    let low = Infinity;
    for (let i = 0; i < gp.count; i++) {
      v.fromBufferAttribute(gp, i);
      const lx = v.x, ly = v.y, lz = v.z;
      n.fromBufferAttribute(gn, i);
      if (m) { v.applyMatrix4(m); n.applyMatrix3(nm).normalize(); }
      low = Math.min(low, v.y);
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      const c = typeof color === 'function' ? color(v.x, v.y, v.z, lx, ly, lz) : color;
      this.col.push(c[0], c[1], c[2]);
      this.dat.push(kind, id, face, typeof extra === 'function' ? extra(v.x, v.y, v.z, lx, ly, lz) : extra);
      this.uv.push(gu ? gu.getX(i) : 0, gu ? gu.getY(i) : 0);
    }
    if (rest !== null) for (let i = start + 1; i < this.pos.length; i += 3) this.pos[i] += rest - low;
    const i0 = this.idx.length;
    if (geom.index) for (let i = 0; i < geom.index.count; i++) this.idx.push(base + geom.index.getX(i));
    else for (let i = 0; i < gp.count; i++) this.idx.push(base + i);
    this.count += gp.count;
    if (this.hit && solid) this.collide(start, gp.count, i0, kind);
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aData', new THREE.Float32BufferAttribute(this.dat, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
  mesh(material) {
    const m = new THREE.Mesh(this.geometry(), material);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    return m;
  }
}

// ---- pieces ---------------------------------------------------------------------------
function indexed(pos, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Moves every vertex by up to `amount`, the same way for every copy of it.
export function roughen(geom, amount, seed = 0) {
  const p = geom.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = Math.round(p.getX(i) * 500), y = Math.round(p.getY(i) * 500), z = Math.round(p.getZ(i) * 500);
    p.setXYZ(i, p.getX(i) + (h3(x, y, z, seed) - 0.5) * 2 * amount, p.getY(i) + (h3(y, z, x, seed + 1) - 0.5) * 2 * amount, p.getZ(i) + (h3(z, x, y, seed + 2) - 0.5) * 2 * amount);
  }
  geom.computeVertexNormals();
  return geom;
}

// A column shaft, or the part of one between heights `from` and `to`: `flutes` concave
// channels meeting in sharp arrises (0: plain), narrowing over its full height h with a
// slight swell. breakTop / breakBase: how ragged the end is where it snapped, in units.
export function shaft({ r, h, from = 0, to = h, flutes = 20, taper = 0.14, rows = 3, breakTop = 0, breakBase = 0, seed = 0 }) {
  const per = flutes ? 4 : 1, n = flutes ? flutes * per : 28, pos = [], idx = [];
  const jag = (a, s) => 0.5 + 0.35 * Math.sin(a * 2 + s) + 0.3 * (h3(Math.round(a * 3), s, 0, seed) - 0.5) + 0.25 * Math.sin(a * 5 + s * 2.3);
  for (let j = 0; j <= rows; j++) {
    const y0 = from + ((to - from) * j) / rows;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const flute = flutes ? 1 - 0.075 * Math.sin(Math.PI * ((i % per) / per)) : 1;
      let y = y0;
      if (j === rows && breakTop) y -= breakTop * jag(a, seed + 1.7);
      if (j === 0 && breakBase) y += breakBase * jag(a, seed + 4.1);
      const rad = r * (1 - taper * Math.pow(y0 / h, 1.6)) * flute;
      pos.push(Math.sin(a) * rad, y, -Math.cos(a) * rad);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + ((i + 1) % n), c = a + n, d = b + n;
    idx.push(a, c, b, b, c, d);
  }
  const top = pos.length / 3;
  pos.push(0, to - breakTop * 0.45, 0);
  const bot = top + 1;
  pos.push(0, from + breakBase * 0.45, 0);
  for (let i = 0; i < n; i++) {
    idx.push(rows * n + i, top, rows * n + ((i + 1) % n));
    idx.push(i, (i + 1) % n, bot);
  }
  return indexed(pos, idx);
}

// A stone shaped like a piece of a ring round the y axis: between radii r0 and r1, angles
// a0 and a1 (0 is towards -z, growing towards +x) and heights y0 and y1.
// Stood up with a quarter turn about x it is a voussoir of an arch.
export function sector({ r0, r1, a0, a1, y0, y1, seg = 3 }) {
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg, sx = Math.sin(a), cz = -Math.cos(a);
    pos.push(sx * r0, y0, cz * r0, sx * r1, y0, cz * r1, sx * r0, y1, cz * r0, sx * r1, y1, cz * r1);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 4, b = a + 4;
    idx.push(a + 1, b + 1, a + 3, b + 1, b + 3, a + 3);     // outer face
    idx.push(a, a + 2, b, b, a + 2, b + 2);                 // inner face
    idx.push(a + 2, a + 3, b + 2, b + 2, a + 3, b + 3);     // top
    idx.push(a, b, a + 1, b, b + 1, a + 1);                 // bottom
  }
  const e = seg * 4;
  idx.push(0, 1, 2, 1, 3, 2, e, e + 2, e + 1, e + 1, e + 2, e + 3);     // the two ends
  return indexed(pos, idx);
}

// A box whose corners are knocked about a little.
export function block(w, h, d, rough = 0, seed = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  return rough ? roughen(g, rough, seed) : g;
}

// A lump of rock: a faceted ball, pulled out of round.
export function rock(r, seed = 0, detail = 1, rough = 0.28) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  return roughen(g, r * rough, seed);
}

// A soft ball for foliage: lumpy, so its outline is scalloped.
export function puff(r, seed = 0, lumps = 0.16, ws = 22, hs = 15) {
  const g = new THREE.SphereGeometry(1, ws, hs), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = r * (1 + lumps * (Math.sin(x * 5.1 + seed) * Math.sin(y * 4.7 + seed * 1.7) + Math.sin(z * 5.9 + seed * 0.6) * Math.sin(x * 3.3 - seed)));
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// A surface of revolution from a profile of [radius, height] pairs.
export const lathe = (profile, seg = 24) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);

// A round limb along a line of points, its radius given at each: trunks, branches, posts.
export function limb(points, radii, seg = 8, capped = true) {
  const pos = [], idx = [], n = points.length;
  const pt = points.map((p) => new THREE.Vector3(...p));
  const ref = new THREE.Vector3(0.31, 0.17, 0.93).normalize(), t = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
  for (let j = 0; j < n; j++) {
    t.subVectors(pt[Math.min(n - 1, j + 1)], pt[Math.max(0, j - 1)]).normalize();
    u.crossVectors(t, ref).normalize();
    w.crossVectors(t, u);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, c = Math.cos(a) * radii[j], s = Math.sin(a) * radii[j];
      pos.push(pt[j].x + u.x * c + w.x * s, pt[j].y + u.y * c + w.y * s, pt[j].z + u.z * c + w.z * s);
    }
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * seg + i, b = j * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, b, c, b, d, c);
  }
  if (capped) {
    const top = pos.length / 3;
    pos.push(pt[n - 1].x, pt[n - 1].y, pt[n - 1].z, pt[0].x, pt[0].y, pt[0].z);
    for (let i = 0; i < seg; i++) {
      idx.push((n - 1) * seg + i, (n - 1) * seg + ((i + 1) % seg), top);
      idx.push(i, top + 1, (i + 1) % seg);
    }
  }
  return indexed(pos, idx);
}

// Ground with relief: a grid of nx by nz cells laid over the world by at(u, v) → [x, z]
// (u, v from 0 to 1, so the grid can be made finer where it matters), with its height from
// height(x, z). `shake` moves the grid points about (as a fraction of a cell) so that the
// facets are not regular.
export function terrain({ nx, nz, at, height, shake = 0, seed = 0 }) {
  const pos = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const edge = i === 0 || j === 0 || i === nx || j === nz;
    const [x, z] = at((i + (edge ? 0 : (h3(i, j, 0, seed) - 0.5) * shake)) / nx, (j + (edge ? 0 : (h3(j, i, 1, seed) - 0.5) * shake)) / nz);
    pos.push(x, height(x, z), z);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if ((i + j) % 2) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  return indexed(pos, idx);
}
// The plain case of `at`: a rectangle.
export const rect = (x0, x1, z0, z1) => (u, v) => [x0 + (x1 - x0) * u, z0 + (z1 - z0) * v];

Builder.collect = false;

// A flat outline pushed back into depth: Shape (with holes) → solid. Lies in the xy plane,
// from z = 0 to z = depth.
export function slabOf(outline, holes, depth, curve = 10) {
  const sh = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) sh.holes.push(h);
  return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: curve });
}
// An opening with a round head, for slabOf: from the floor at y0, w wide, straight up to
// `spring`, then a half circle.
export function archHole(cx, y0, w, spring) {
  const p = new THREE.Path();
  p.moveTo(cx - w / 2, y0);
  p.lineTo(cx - w / 2, spring);
  p.absarc(cx, spring, w / 2, Math.PI, 0, true);
  p.lineTo(cx + w / 2, y0);
  p.closePath();
  return p;
}
