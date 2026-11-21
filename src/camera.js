// Motion: keyed tracks, the camera rig, and the traveller's path through the world.
// World axes: x right, y up, z away from the camera's usual side. Angles named "yaw"
// are headings: 0 faces +z, π/2 faces +x.

export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k],
};

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
export const ease = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };

// Smooth interpolation through keyed values (a cubic through every key, with the slope
// at each key averaged from its neighbours). keys: [{ t, ...channels }]. A channel
// missing from a key holds the nearest earlier value; values are numbers or arrays.
// A key marked `hold: true` is a rest: the motion eases to a stop there and eases away
// again, so two holds in a row with the same values are a still moment.
// Outside the keyed range the track holds its end values.
export function track(keys, names) {
  const ts = keys.map((k) => k.t);
  const vals = {}, tans = {};
  const slope = (a, b, dt) => (Array.isArray(a) ? a.map((x, j) => (b[j] - x) / dt) : (b - a) / dt);
  const mean = (a, b) => (Array.isArray(a) ? a.map((x, j) => (x + b[j]) / 2) : (a + b) / 2);
  const live = names.filter((n) => keys.some((k) => k[n] !== undefined));
  for (const n of live) {
    let held = keys.find((k) => k[n] !== undefined)[n];
    const v = (vals[n] = keys.map((k) => (held = k[n] ?? held)));
    tans[n] = ts.map((_, i) => {
      if (ts.length === 1 || keys[i].hold) return slope(v[0], v[0], 1);
      if (i === 0) return slope(v[0], v[1], ts[1] - ts[0]);
      if (i === ts.length - 1) return slope(v[i - 1], v[i], ts[i] - ts[i - 1]);
      return mean(slope(v[i - 1], v[i], ts[i] - ts[i - 1]), slope(v[i], v[i + 1], ts[i + 1] - ts[i]));
    });
  }
  return (t) => {
    const out = {};
    if (ts.length === 1) { for (const n of live) out[n] = vals[n][0]; return out; }
    const tt = clamp(t, ts[0], ts[ts.length - 1]);
    let i = 0;
    while (i < ts.length - 2 && tt > ts[i + 1]) i++;
    const dt = ts[i + 1] - ts[i], u = (tt - ts[i]) / dt, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * dt, h01 = -2 * u3 + 3 * u2, h11 = (u3 - u2) * dt;
    for (const n of live) {
      const p0 = vals[n][i], p1 = vals[n][i + 1], m0 = tans[n][i], m1 = tans[n][i + 1];
      out[n] = Array.isArray(p0)
        ? p0.map((x, j) => h00 * x + h10 * m0[j] + h01 * p1[j] + h11 * m1[j])
        : h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
    }
    return out;
  };
}

// A camera move. Channels: pos, look (points), fov (vertical, degrees), roll (degrees),
// fz (world z of the focal plane; without it the focus follows the traveller), fd (the
// focal distance itself, along the view), blur (px of defocus at infinity; 0 = all sharp).
export const rig = (keys) => track(keys, ['pos', 'look', 'fov', 'roll', 'fz', 'fd', 'blur']);

// A first-person camera: the lens is the traveller's own eye, and there is a body under it.
// keys: [{ t, pos, ... }]
//   pos    where the eye is: one smooth path through the keys (hold: true = at rest there)
//   look   a point in the world to look at; aim (0 … 1) is how far that replaces looking
//          where we are going (default 1 on a key that gives a look, otherwise 0).
//          Eyes do not pan: the gaze rests on one thing, and shortly before the next key's
//          time it goes over to that key's thing in one glance (`glance` seconds; default
//          opts.glance) and rests there. `pan: true` on a key makes the gaze travel to it
//          all the way from the key before.
//   at     instead of look: a function of time that gives the place of a thing that moves;
//          the gaze stays on it for as long as it rests there
//   tilt   added to the height of the direction of travel: the eye a little down or up
//   zoom   degrees added to the lens; fd, blur as in rig(): they change with the glance
// opts.eye is the height of the eye on foot (null: never on foot in this shot).
// What is not keyed, and comes from the body (worked out once, step by step, from the first
// key on, so that any moment can be asked for):
//   steps      on foot the eye rises and falls with each stride and sways from foot to foot,
//              by the distance covered, not by the clock
//   the hand   the picture is never dead still: it drifts a little, more when we move, and
//              is buffeted when we go fast; at rest it breathes
//   weight     the head arrives at what it turns to a moment late and settles; the bank
//              into a turn comes on late and stays a little after; the eye sinks when a
//              climb or a fall is checked; the lens opens with speed and the focus hunts
const wob = (t, f, s) => 0.5 * Math.sin(t * f[0] * 6.2832 + s * 1.7) + 0.32 * Math.sin(t * f[1] * 6.2832 + s * 4.1 + 1.3) + 0.18 * Math.sin(t * f[2] * 6.2832 + s * 9.3 + 2.9);
const RAD = Math.PI / 180;
export function pov(keys, { lead = 0.7, bank = 9, maxBank = 16, fov = [42, 58], speeds = [1, 9], eye = null, glance = 0.7, stride = 0.74, seed = 1, hand = 1, at = null } = {}) {
  keys = [...keys].sort((a, b) => a.t - b.t);
  // A key need not say everything: one without `pos` only moves the gaze; one that gives
  // neither look, aim, fd nor blur leaves the gaze as it was; tilt and zoom stay until changed.
  const P = track(keys.filter((k) => k.pos), ['pos']);
  const S = track(keys.map((k, i) => ({ t: k.t, hold: true, tilt: k.tilt ?? (i ? undefined : 0), zoom: k.zoom ?? (i ? undefined : 0) })), ['tilt', 'zoom']);
  const gk = keys.filter((k, i) => i === 0 || k.look || k.at || k.aim !== undefined || k.fd !== undefined || k.blur !== undefined);
  let held = null, prev = null;
  const G = gk.map((k, i) => {
    if (k.look || k.at) held = { look: k.look, at: k.at };
    const dt = i ? k.t - gk[i - 1].t : 1;
    return (prev = { t: k.t, ...held, aim: k.aim ?? (k.look || k.at ? 1 : prev ? prev.aim : 0), fd: k.fd ?? prev?.fd ?? 24, blur: k.blur ?? prev?.blur ?? 3, g: k.pan ? dt : Math.min(k.glance ?? glance, 0.8 * dt) });
  });
  const slerp = (a, b, k) => {
    const d = clamp(V.dot(a, b), -1, 1), th = Math.acos(d);
    if (th < 1e-3) return b;
    const s = Math.sin(th);
    return V.norm(V.add(V.scale(a, Math.sin((1 - k) * th) / s), V.scale(b, Math.sin(k * th) / s)));
  };
  // What the gaze is on at t, seen from pos: the way to the thing looked at, how far it holds
  // the eye, and the focus. A thing looked at may move (`at`: a function of time that gives
  // its place): the gaze stays on it. Going from one thing to the next the gaze turns from
  // the one direction to the other, so a near thing and a far one are the same to it.
  const toward = (g, t, pos) => { const p = g.at ? g.at(t) : g.look; return p ? V.norm(V.sub(p, pos)) : null; };
  const fix = (t, pos) => {
    let i = 0;
    while (i < G.length - 1 && t >= G[i + 1].t) i++;
    const a = G[i], b = G[i + 1], da = toward(a, t, pos);
    if (!b || t <= b.t - b.g) return { to: da, aim: a.aim, fd: a.fd, blur: a.blur };
    const w = ease(b.t - b.g, b.t, t), db = toward(b, t, pos);
    return { to: da && db ? slerp(da, db, w) : da || db, aim: lerp(a.aim, b.aim, w), fd: lerp(a.fd, b.fd, w), blur: lerp(a.blur, b.blur, w) };
  };
  const speedAt = (t) => V.len(V.sub(P(t + 0.1).pos, P(t - 0.1).pos)) / 0.2;
  const gaze = (t) => {
    const pos = P(t).pos, f = fix(t, pos);
    let go = V.sub(P(t + lead).pos, pos);
    if (V.len(go) < 0.05) go = V.sub(P(t + lead + 0.8).pos, P(t - 0.8).pos);
    const travel = V.len(go) < 1e-3 ? null : V.norm(V.add(V.norm(go), [0, S(t).tilt, 0]));
    return !travel ? f.to || [0, 0, 1] : !f.to ? travel : slerp(travel, f.to, clamp(f.aim));
  };
  const yawOf = (d) => Math.atan2(d[0], d[2]);

  // The body, stepped at 120 Hz from the first key to the last.
  const t0 = keys[0].t, HZ = 120, h = 1 / HZ, n = Math.ceil((keys[keys.length - 1].t - t0) * HZ) + 2;
  const C = ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'fov', 'fd', 'blur', 'speed', 'foot', 'step', 'gait'], rec = Object.fromEntries(C.map((c) => [c, new Float32Array(n)]));
  let yaw = 0, pitch = 0, vyaw = 0, vpitch = 0, roll = 0, vroll = 0, sy = 0, vsy = 0, fovS = 0, lf = 0, vlf = 0, blurS = 0, nod = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * h, pos = P(t).pos, f = fix(t, pos), dir = gaze(t);
    const vel = V.scale(V.sub(P(t + 0.05).pos, P(t - 0.05).pos), 10), flat = Math.hypot(vel[0], vel[2]);
    const sp = (speedAt(t - 0.3) + speedAt(t) + speedAt(t + 0.3)) / 3;
    const acc = (speedAt(t + 0.15) - speedAt(t - 0.15)) / 0.3;
    const ay = (P(t + 0.08).pos[1] - 2 * pos[1] + P(t - 0.08).pos[1]) / 0.0064;
    // `at(t)` may give the lens, the bank and the height of the eye on foot for this moment (a long take crosses many places).
    const o = at ? at(t) : null, eyeY = o && o.eye !== undefined ? o.eye : eye, fovR = o?.fov ?? fov, spR = o?.speeds ?? speeds, bk = o?.bank ?? bank, mb = o?.maxBank ?? maxBank;
    const foot = eyeY == null ? 0 : 1 - ss(0.05, 0.3, Math.abs(pos[1] - eyeY)), gait = foot * ss(0.12, 0.8, flat), air = 1 - foot;
    const run = foot * ss(2.6, 5.6, flat);                    // a run: longer strides, a harder fall on each, the head down a little
    const fovT = lerp(fovR[0], fovR[1], ss(spR[0], spR[1], sp)) + S(t).zoom;
    const rate = turn(yawOf(gaze(t - 0.25)), yawOf(gaze(t + 0.25))) / 0.5;                  // rad/s; positive: turning right
    const rollT = -clamp(rate * bk, -mb, mb) * ss(0.5, 3, sp) * (1 - 0.85 * foot);
    if (i === 0) { yaw = yawOf(dir); pitch = Math.asin(clamp(dir[1], -1, 1)); roll = rollT; fovS = fovT; lf = Math.log(f.fd); blurS = f.blur; }
    // The head: sprung towards what it looks at.
    const wh = lerp(6.2, 8.5, foot), zh = 0.7;
    vyaw += (wh * wh * turn(yaw, yawOf(dir)) - 2 * zh * wh * vyaw) * h; yaw += vyaw * h;
    vpitch += (wh * wh * (Math.asin(clamp(dir[1], -1, 1)) - pitch) - 2 * zh * wh * vpitch) * h; pitch += vpitch * h;
    vroll += (30 * (rollT - roll) - 2 * 0.58 * 5.5 * vroll) * h; roll += vroll * h;
    // The eye on its legs (or on the air): it sinks when a rise or fall is checked.
    vsy += (-72 * sy - 2 * 0.45 * 8.5 * vsy - ay * lerp(0.3, 0.9, foot)) * h; sy = clamp(sy + vsy * h, -0.14, 0.14);
    nod += (clamp(lerp(-0.22, 0.3, foot) * acc, -2.5, 2.5) - 2.4 * run - nod) * Math.min(1, 6 * h);
    fovS += (fovT - fovS) * Math.min(1, 3.5 * h);
    vlf += (49 * (Math.log(f.fd) - lf) - 2 * 0.55 * 7 * vlf) * h; lf += vlf * h;
    blurS += (f.blur - blurS) * Math.min(1, 5 * h);
    ph += (Math.PI * flat * h) / lerp(stride, 1.9, run);
    const still = 1 - ss(0.2, 1.5, sp), slow = air * (1 - ss(2.5, 8, sp));
    const hd = o?.hand ?? hand, amp = hd * (0.2 + 0.2 * gait + 0.42 * ss(4, 13, sp) + 0.08 * air), buf = hd * 0.13 * ss(6, 13, sp);      // (`at` may say the air is rough here)
    const nYaw = amp * wob(t, [0.23, 0.71, 1.7], seed) + buf * wob(t, [3.1, 4.3, 5.2], seed + 11);
    const nPitch = amp * 0.8 * wob(t, [0.29, 0.83, 2.1], seed + 3) + buf * wob(t, [2.7, 3.9, 4.9], seed + 13) + (0.3 + 0.5 * run) * gait * Math.cos(2 * ph) + 0.1 * still * Math.sin(1.571 * t);
    const nRoll = amp * 0.7 * wob(t, [0.19, 0.61, 1.3], seed + 7) + (0.5 + 0.7 * run) * gait * Math.sin(ph);
    const side = (0.02 + 0.012 * run) * gait * Math.sin(ph) + 0.035 * slow * wob(t, [0.13, 0.27, 0.47], seed + 19);
    const up = (0.036 + 0.06 * run) * gait * (Math.abs(Math.sin(ph)) - 0.64) + 0.045 * slow * wob(t, [0.17, 0.31, 0.53], seed + 17) + 0.005 * still * Math.sin(1.571 * t) + sy;
    rec.x[i] = pos[0] + Math.cos(yaw) * side; rec.y[i] = pos[1] + up; rec.z[i] = pos[2] - Math.sin(yaw) * side;
    rec.yaw[i] = yaw + nYaw * RAD; rec.pitch[i] = pitch + (nPitch + nod) * RAD; rec.roll[i] = roll + nRoll;
    rec.fov[i] = fovS; rec.fd[i] = Math.exp(lf); rec.blur[i] = blurS; rec.speed[i] = sp; rec.foot[i] = foot; rec.step[i] = ph; rec.gait[i] = gait * (1 + run);
  }
  const cam = (t) => {
    const x = clamp((t - t0) * HZ, 0, n - 1), i = Math.min(n - 2, Math.floor(x)), k = x - i;
    const g = (c) => rec[c][i] + (rec[c][i + 1] - rec[c][i]) * k;
    const pos = [g('x'), g('y'), g('z')], yw = g('yaw'), pt = g('pitch');
    const dir = [Math.sin(yw) * Math.cos(pt), Math.sin(pt), Math.cos(yw) * Math.cos(pt)];
    return { pos, look: V.add(pos, V.scale(dir, 10)), dir, speed: g('speed'), foot: g('foot'), step: g('step'), gait: g('gait'), fov: g('fov'), roll: g('roll'), fd: g('fd'), blur: g('blur'), steady: true };
  };
  cam.path = (t) => P(t).pos;          // the eye's path without the body: what audit() and the scenery are measured against
  return cam;
}

// A rig whose pos and look are offsets from the traveller: the camera trails `lag`
// seconds behind them and looks `lead` seconds ahead, so it follows with some weight.
export const chase = (keys, pathFn, { lag = 0.25, lead = 0.12, minY = 0.3 } = {}) => {
  const r = rig(keys);
  return (t) => {
    const c = r(t);
    const pos = V.add(pathFn(t - lag).pos, c.pos);
    pos[1] = Math.max(minY, pos[1]);
    return { ...c, pos, look: V.add(pathFn(t + lead).pos, c.look) };
  };
};

function turn(a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }       // shortest way from a to b

// Camera basis for the shader, with a little hand-held drift so it never sits dead still.
export function basis({ pos, look, fov = 40, roll = 0, steady = false }, t = 0) {
  const ro = steady ? pos : V.add(pos, [Math.sin(t * 0.7 + 1) * 0.03, Math.sin(t * 0.53 + 2) * 0.02, 0]);
  const f = V.norm(V.sub(look, ro));
  let r = V.cross([0, 1, 0], f);
  r = V.len(r) < 1e-3 ? [1, 0, 0] : V.norm(r);
  let u = V.cross(f, r);
  if (roll) {
    const a = (roll * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    [r, u] = [V.add(V.scale(r, c), V.scale(u, s)), V.add(V.scale(u, c), V.scale(r, -s))];
  }
  return { ro, f, r, u, focal: 0.5 / Math.tan((fov * Math.PI) / 360) };
}

// A world point on screen: x, y in picture heights from the centre (y up), z = depth.
export function project(p, B) {
  const q = V.sub(p, B.ro), z = V.dot(q, B.f);
  return { x: (V.dot(q, B.r) / z) * B.focal, y: (V.dot(q, B.u) / z) * B.focal, z };
}


// The traveller's path. keys: [{ t, pos, fly, spread, dip, yaw }]
//   fly    0 on foot … 1 gliding          spread  how far the cape is opened (default: fly)
//   dip    1 = brush reaching down to the ground or water while flying
//   yaw    heading where it cannot come from the motion (standing still, landing)
// Heading, climb angle, turn rate and distance travelled are derived from the motion.
export function path(keys) {
  const tr = track(keys, ['pos', 'fly', 'spread', 'dip']);
  const posAt = (t) => tr(t).pos;
  const yawKeys = keys.filter((k) => k.yaw !== undefined);
  const yawTr = yawKeys.length ? track(yawKeys, ['yaw']) : null;
  const t0 = keys[0].t, t1 = keys[keys.length - 1].t, n = Math.max(1, Math.ceil((t1 - t0) * 48));
  const cum = [0];
  for (let i = 1, prev = posAt(t0); i <= n; i++) {
    const p = posAt(t0 + i / 48);
    cum.push(cum[i - 1] + V.len(V.sub(p, prev)));
    prev = p;
  }
  const velAt = (t) => V.scale(V.sub(posAt(t + 0.02), posAt(t - 0.02)), 25);
  const yawAt = (t) => {
    if (yawTr && t >= yawKeys[0].t && t <= yawKeys[yawKeys.length - 1].t) return yawTr(t).yaw;
    const v = velAt(clamp(t, t0 + 0.03, t1 - 0.03));
    return Math.atan2(v[0], v[2]);
  };
  return (t) => {
    const k = tr(t), vel = velAt(t), flat = Math.hypot(vel[0], vel[2]);
    const fly = clamp(k.fly ?? 0);
    const x = clamp((t - t0) * 48, 0, n), i = Math.floor(x);
    return {
      pos: k.pos, vel, speed: V.len(vel), fly,
      spread: clamp(k.spread ?? fly), dip: clamp(k.dip ?? 0),
      yaw: yawAt(t), yawRate: turn(yawAt(t - 0.12), yawAt(t + 0.12)) / 0.24,
      pitch: flat + Math.abs(vel[1]) < 0.05 ? 0 : Math.atan2(vel[1], flat),
      dist: lerp(cum[i], cum[Math.min(n, i + 1)], x - i),
    };
  };
}
