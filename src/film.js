// The renderer: render(t) draws the frame at film time t (seconds) and nothing else
// decides what a frame looks like, so preview and export are the same picture.
//
//   per shot:    its meshes → shadow map, G-buffer (and once more upside down, for water)
//                → paint (the watercolour) → depth of field
//   per sample:  shot A [+ shot B] → mix (the wash between them)
//   per frame:   average the samples (motion blur, and the smoothing of every edge)
//                → finish (paper) → canvas
//
// The scenery is geometry built in scenes.js, or painted from the view ray by the shaders.
// The traveller is a cloak of simulated cloth over a few plain solids (traveller.js).
// No picture is loaded.
import * as THREE from 'three';
import { QUAD_VERT, MESH_VERT, MESH_FRAG, PAINT, DOF, MIX, ACCUM, GLOW, FINISH, PAPER as PAPER_FRAG, BLIT } from './shaders.js';
import { SHOTS, STITCHES, CAM, TOTAL, FPS, W as FILM_W, H as FILM_H, PAPER, BASE, fadeOut } from './shots.js';
import { V, basis, project, lerp, ss } from './camera.js';
import { buildScene } from './scenes.js';
import { createTraveller, makeTitle } from './traveller.js';
import { SUMMIT } from './layout.js';

const SHUTTER = 0.5 / FPS;          // a 180° shutter
const BLOOMS = 12;                  // washes of returning colour a place can hold: its own, and (played live) the ones the player drops
const RIBBON = 12;                  // points along the ribbon behind the brush
const NOWISP = new Float32Array(80);
// Where each sample of a frame sits inside its pixel (a Halton sequence).
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const JITTER = Array.from({ length: 32 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

// w, h: the size of the picture (the film's own by default; the world played live is drawn smaller, to keep up).
// light: the cheaper picture for playing live (the lake's reflection painted at half size, a smaller shadow map).
export async function createFilm(canvas, { w = FILM_W, h = FILM_H, light = false } = {}) {
  const W = w, H = h, SHADOW = light ? 2048 : 4096, MW = light ? W / 2 : W, MH = light ? H / 2 : H;      // shadow map size; the size of the mirrored picture
  canvas.width = W;
  canvas.height = H;
  THREE.ColorManagement.enabled = false;
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const shaderErrors = (window.__shaderErrors = []);
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs), gl.getProgramInfoLog(program)].filter(Boolean).join('\n');
    shaderErrors.push(log);
    console.error(`shader error\n${log}`);
  };

  // ---- full-screen passes -------------------------------------------------------------
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quadCam = new THREE.Camera();
  const SIZE = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 };
  const zero = (type, n) => {
    if (type === 'sampler2D') return blank;
    if (type === 'mat4') return new THREE.Matrix4();
    const size = SIZE[type];
    if (!size) throw new Error(`uniform type ${type} is not handled`);
    if (n) return new Float32Array(n * size);
    return size === 1 ? 0 : new Array(size).fill(0);
  };
  // One fragment shader over the whole picture. Every uniform it declares gets a slot
  // here; run() fills in the ones it is given and draws into `target` (null: the canvas).
  function pass(name, frag, { add = false } = {}) {
    const uniforms = {};
    for (const m of frag.matchAll(/^\s*uniform\s+(\w+)\s+([^;]+);/gm)) {
      for (const decl of m[2].split(',')) {
        const d = decl.trim().match(/^(\w+)(?:\[(\d+)\])?$/);
        if (!d) throw new Error(`pass "${name}": cannot read uniform declaration "${decl}"`);
        uniforms[d[1]] = { value: zero(m[1], d[2] ? Number(d[2]) : 0) };
      }
    }
    const material = new THREE.RawShaderMaterial({
      name, glslVersion: THREE.GLSL3, vertexShader: QUAD_VERT, fragmentShader: frag, uniforms,
      depthTest: false, depthWrite: false,
      blending: add ? THREE.CustomBlending : THREE.NoBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(tri, material);
    mesh.frustumCulled = false;
    return {
      run(values, target) {
        for (const k in values) if (uniforms[k] && values[k] !== undefined) uniforms[k].value = values[k];
        renderer.setRenderTarget(target || null);
        renderer.render(mesh, quadCam);
      },
    };
  }
  const paint = pass('paint', PAINT);
  const dof = pass('dof', DOF);
  const mix = pass('mix', MIX);
  const accum = pass('accum', ACCUM, { add: true });
  const glow = pass('glow', GLOW);
  const finish = pass('finish', FINISH);
  const paperPass = pass('paper', PAPER_FRAG);
  const blit = pass('blit', BLIT);

  // ---- render targets -----------------------------------------------------------------
  const target = (w, h, { type = THREE.UnsignedByteType, filter = THREE.LinearFilter, format = THREE.RGBAFormat, depth = false, count = 1 } = {}) =>
    new THREE.WebGLRenderTarget(w, h, {
      type, format, minFilter: filter, magFilter: filter, depthBuffer: depth, stencilBuffer: false, generateMipmaps: false, count,
    });
  const gbuffer = (gw = W, gh = H) => {
    const g = target(gw, gh, { type: THREE.HalfFloatType, filter: THREE.NearestFilter, depth: true, count: 3 });
    g.textures[2].type = THREE.FloatType;                 // positions need the precision
    return g;
  };
  const gbuf = gbuffer();
  let gbufMirror = null;                                  // made when a shot with water first needs it
  const rtShadow = target(SHADOW, SHADOW, { type: THREE.FloatType, filter: THREE.NearestFilter, format: THREE.RedFormat, depth: true });
  const rtScene = target(W, H, { type: THREE.HalfFloatType });       // the painting + defocus in alpha
  const rtRefl = target(MW, MH);
  const rtA = target(W, H, { type: THREE.HalfFloatType }), rtB = target(W, H, { type: THREE.HalfFloatType });      // a place's picture, and in alpha how far away what it shows is
  const rtMix = target(W, H), rtOut = target(W, H);
  const rtAcc = target(W, H, { type: THREE.HalfFloatType });
  const grain = target(W, H);
  const rtGlowA = target(W / 4, H / 4, { type: THREE.HalfFloatType }), rtGlowB = target(W / 4, H / 4, { type: THREE.HalfFloatType });
  const rtSoftA = target(W / 4, H / 4, { type: THREE.HalfFloatType }), rtSoftB = target(W / 4, H / 4, { type: THREE.HalfFloatType });      // the whole picture, spread wide: for the mist filter
  paperPass.run({ uRes: [W, H], uSeed: 3.7 }, grain);

  const titleTex = new THREE.CanvasTexture(makeTitle(SUMMIT.title.text));
  titleTex.flipY = false;
  titleTex.minFilter = THREE.LinearMipmapLinearFilter;      // it is drawn much smaller than it is made

  // ---- the world ----------------------------------------------------------------------
  const meshOpts = { glslVersion: THREE.GLSL3, vertexShader: MESH_VERT, fragmentShader: MESH_FRAG, side: THREE.DoubleSide };
  const meshUniforms = () => ({ uMirror: { value: 0 }, uLining: { value: [1, 1, 1] }, uSwayT: { value: 0 }, uWind: { value: 1 }, uEye: { value: [0, 0, 0] }, uPush: { value: [0, -999, 0, 0.01] } });
  const gMat = new THREE.ShaderMaterial({ ...meshOpts, name: 'mesh', uniforms: meshUniforms() });
  const sMat = new THREE.ShaderMaterial({ ...meshOpts, name: 'shadow', uniforms: meshUniforms(), defines: { SHADOW: 1 } });
  const root = new THREE.Scene();
  const cam3 = new THREE.PerspectiveCamera(40, W / H, 0.1, 4000);
  cam3.matrixAutoUpdate = false;
  cam3.matrixWorldAutoUpdate = false;
  const lightCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const shadowMat = new THREE.Matrix4();
  const fig = createTraveller([gMat, sMat]);

  // A shot's scenery is built the first time the shot is drawn, and kept.
  const built = new Map();
  function sceneOf(shot) {
    if (!shot.scene) return null;
    if (!built.has(shot.id)) built.set(shot.id, buildScene(shot.scene, gMat, shot));
    return built.get(shot.id);
  }

  // The film's camera is a position and three axes (camera.js); x right, y up, z into the
  // picture is a left-handed frame, so the matrix handed to Three.js is a mirror, which is
  // why every material is two-sided.
  function setCamera(B, fov, jit) {
    cam3.fov = fov;
    if (jit) cam3.setViewOffset(W, H, jit[0], jit[1], W, H); else cam3.clearViewOffset();
    cam3.updateProjectionMatrix();
    const { ro, r, u, f } = B;
    cam3.matrixWorld.set(r[0], u[0], -f[0], ro[0], r[1], u[1], -f[1], ro[1], r[2], u[2], -f[2], ro[2], 0, 0, 0, 1);
    cam3.matrixWorldInverse.copy(cam3.matrixWorld).invert();
  }
  function drawGeometry(into, mirror) {
    gMat.uniforms.uMirror.value = mirror ? 1 : 0;
    root.scale.y = mirror ? -1 : 1;
    renderer.setRenderTarget(into);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(root, cam3);
    root.scale.y = 1;
  }

  let lastShot = null;              // the place whose G-buffer was drawn last (pick() reads it)
  function renderShot(shot, t, into, sample, samples, quiet = false, live = null) {
    // Played live, the eye is the player's: the place is told so before it says what it is doing
    // (its weather and its returning colour go by where the eye is).
    shot.live = live ? { ...shot.local(live.cam), wait: live.wait ?? 0, plain: !!live.plain, film: !!live.film, wx: live.wx || null } : null;
    const f = shot.frame(t);
    shot.live = null;
    if (live?.wisp) {
      // Wandered, the fleck is the wanderer's companion, not the story's guide: where it is and has
      // just been is said in the world (play.js), and read here in this place's own coordinates.
      const lw = live.wisp, pts = new Float32Array(80);
      lw.pts.forEach((p, k) => pts.set([...shot.place.from(p), k / (lw.pts.length - 1)], k * 4));
      f.wisp = { pts, n: lw.pts.length, col: lw.col, p: lw.p, tail: lw.tail ?? 1 };
    }
    if (window.__cam) Object.assign(f.cam, window.__cam);                         // __cam: look at the scene from anywhere, from the console
    const B = basis(f.cam, t);
    lastShot = shot;
    const sc = sceneOf(shot);
    const pose = f.figOpacity > 0 ? shot.figure(t) : null;
    const world = { ...BASE, ...shot.world, ...f.u, ...window.__override };      // __override: for trying values from the console
    const jit = samples > 1 ? JITTER[sample % JITTER.length] : null;
    const drops = live?.blooms?.[shot.id];
    if (drops?.length) {
      // Colour the player has dropped: washes of this place like its own, after its own.
      const n0 = world.uBloomN, n = Math.min(BLOOMS - n0, drops.length), at = new Float32Array(BLOOMS * 4), r = new Float32Array(BLOOMS * 4);
      at.set(world.uBlooms.subarray(0, n0 * 4)); r.set(world.uBloomR.subarray(0, n0 * 4));
      drops.slice(-n).forEach((d, i) => { at.set([d[0], d[1], d[2], t - d[3]], (n0 + i) * 4); r.set([2.6, 0.45, 0.9, 0], (n0 + i) * 4); });      // d[3]: seconds since it fell (they spread in the player's time, not the world's)
      Object.assign(world, { uBlooms: at, uBloomR: r, uBloomN: n0 + n });
    }
    if (live?.wake?.[shot.id]?.length) f.wake = [...live.wake[shot.id].slice(-4), ...(f.wake || [])];

    root.clear();
    if (sc) root.add(sc.object);
    if (pose) { fig.update(shot, t); root.add(fig.group); }
    gMat.uniforms.uLining.value = world.uLining ?? world.uRibCol;
    // The fleck we follow (shots.js), and what moves the plants: time, the wind, the eye, the fleck.
    const wz = f.wisp, wake = new Float32Array(32);
    (f.wake || []).slice(0, 8).forEach((r, i) => wake.set(r, i * 4));
    for (const m of [gMat, sMat]) {
      m.uniforms.uSwayT.value = t + (live?.wait ?? 0); m.uniforms.uWind.value = (world.uWind ?? 1) * (live?.wx ? 0.85 + 0.5 * (live.wx.pulse || 0) + 0.5 * (live.wx.rain || 0) : 1); m.uniforms.uEye.value = B.ro;
      m.uniforms.uPush.value = wz ? [wz.pts[0], wz.pts[1], wz.pts[2], 1.7] : [0, -999, 0, 0.01];
    }

    // What the light sees: the depth of everything that can throw a shadow.
    let shadowP = [0, SHADOW, 0, 2.5];
    if (shot.shadow) {
      const { c, r, d } = shot.shadow, L = world.uLight;
      lightCam.left = -r; lightCam.right = r; lightCam.top = r; lightCam.bottom = -r;
      lightCam.near = 0.1; lightCam.far = 2 * d;
      lightCam.position.set(c[0] + L[0] * d, c[1] + L[1] * d, c[2] + L[2] * d);
      lightCam.lookAt(c[0], c[1], c[2]);
      lightCam.updateProjectionMatrix();
      lightCam.updateMatrixWorld(true);
      shadowMat.multiplyMatrices(lightCam.projectionMatrix, lightCam.matrixWorldInverse);
      root.overrideMaterial = sMat;
      renderer.setRenderTarget(rtShadow);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear();
      renderer.render(root, lightCam);
      root.overrideMaterial = null;
      shadowP = [1, SHADOW, 0.1 / (2 * d), shot.shadow.soft ?? 2.5];
    }

    // The ribbon: where the brush tip has just been, projected to the screen.
    const rib = new Float32Array(RIBBON * 4);
    let ribN = 0;
    if (pose) {
      for (let k = 0; k < RIBBON; k++) {
        const past = shot.figure(t - k * 0.16), p = project(fig.tip(past), B), age = k / (RIBBON - 1);
        const seen = p.z > 0.3;
        // Never wider than a brush stroke on the picture, and gone before it reaches the lens.
        const near = Math.min(1, Math.max(0, (p.z - 0.8) / 2.5));
        rib.set([seen ? p.x : 0, seen ? p.y : 0, seen ? Math.min(0.012, Math.max(0.0012, (lerp(0.07, 0.012, age) * B.focal) / p.z)) : 0.001,
          seen ? 0.85 * past.fly * (1 - age) ** 1.3 * f.figOpacity * near : 0], k * 4);
      }
      ribN = RIBBON;
    }
    // Weather hangs in the air round the eye: a place the eye is not in yet (quiet) has none of it.
    const slabs = new Float32Array(32), list = quiet ? [] : [...(f.slabs || [])].sort((a, b) => b[1] - a[1]).slice(0, 8);
    list.forEach((s, i) => slabs.set([s[0], s[1], s[2], 0], i * 4));

    // Focus: a given plane, or else wherever the traveller is.
    const figDist = pose ? V.len(V.sub(pose.pos, B.ro)) : 1e6;
    const focus = f.cam.fz != null ? (f.cam.fz - B.ro[2]) / Math.max(B.f[2], 0.2) : pose ? figDist : f.cam.fd ?? 20;
    const blur = (f.cam.blur ?? 0) * (H / 1080);            // blur is keyed in pixels of a 1080-line picture
    const u = {
      ...world,
      uRes: [W, H], uJit: jit ? [jit[0], -jit[1]] : [0, 0], uT: shot.tau ? shot.tau(t) : t, uClock: t + (live?.wait ?? 0), uPaper: PAPER, uMirror: 0,      // live, while the world waits for the player its story stands still (uT) but its air does not (uClock: rain, wind, rings, glints)
      uRo: B.ro, uF: B.f, uR: B.r, uU: B.u, uLens: [B.focal, focus, blur],
      uGA: gbuf.textures[0], uGN: gbuf.textures[1], uGP: gbuf.textures[2],
      uShadow: rtShadow.texture, uShadowMat: shadowMat, uShadowP: shadowP, uRefl: blank, uTitle: titleTex,
      uFigB: [pose ? f.figOpacity : 0, figDist, 0, 0],
      uRib: rib, uRibN: ribN, uSlab: slabs, uSlabN: list.length,
      uWisp: wz ? wz.pts : NOWISP, uWispN: wz ? wz.n : 0, uWispCol: wz ? wz.col : [0, 0, 0, 0], uWispP: wz ? wz.p : [0, 0, 0, 0], uWispT: wz ? wz.tail ?? 1 : 0,
      uWake: wake, uWakeN: Math.min(8, (f.wake || []).length),
    };

    if (pose && world.uNight >= 0) {
      // The night pours out of the brush tip as it is drawn, wherever the camera sees it.
      const d = V.sub(fig.tip(pose), B.ro);
      u.uTip = [Math.atan2(d[0], d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))];
    }
    setCamera(B, f.cam.fov ?? 40, jit);
    if (world.uGround === 2) {
      // Water: paint the world upside down first, then let the lake look that picture up.
      gbufMirror ||= gbuffer(MW, MH);
      drawGeometry(gbufMirror, true);
      paint.run({ ...u, uRes: [MW, MH], uMirror: 1, uGA: gbufMirror.textures[0], uGN: gbufMirror.textures[1], uGP: gbufMirror.textures[2] }, rtRefl);
      u.uRefl = rtRefl.texture;
    }
    drawGeometry(gbuf, false);
    paint.run(u, rtScene);
    dof.run({ uA: rtScene.texture, uRes: [W, H], uLens: [B.focal, focus, blur], uMax: Math.min(40, 2.5 * blur), uPhase: sample * 2.399963 * 7 }, into);
    return { f, B, world };
  }

  // One moment of the film into rtMix. The eye is in one place, or at a join between two
  // (STITCHES in shots.js): then both are painted, each from the same eye, and joined.
  const blend = (x, y, w) => Object.fromEntries(Object.entries(x).map(([n, v]) => [n, Array.isArray(v) ? (w < 0.5 ? v : y[n]).map((q, j) => (j === 2 ? lerp(v[2], y[n][2], w) : q)) : lerp(v, y[n], w)]));
  // Walked freely (live.mix), which places are painted is said by where the eye is, not by any
  // clock: { a, b (or null), type, plane, sky, rag, fade | w | R, centre, edge }, the places by
  // their number, `a` the one on the near side of the plane as the film crosses it.
  function drawFree(live, sample = 0, samples = 1) {
    const m = live.mix, tw = live.T, Bw = basis(live.cam, tw);
    const side = m.plane ? V.dot(m.plane, Bw.ro) + m.plane[3] : 0;
    const one = () => renderShot(SHOTS[m.a], tw - SHOTS[m.a].start, rtA, sample, samples, !!m.plane && side > 0, live);
    const two = () => (m.b != null ? renderShot(SHOTS[m.b], tw - SHOTS[m.b].start, rtB, sample, samples, !!m.plane && side < 0, live) : null);
    let w = 0, u = { uType: 0 }, A, Bs;
    if (m.b != null && m.type === 4) { w = ss(-5, 5, side); u = { uType: 4, uPlane: m.plane, uPortal: [m.fade ?? 1, m.sky ?? 12, m.rag ?? 0, m.hold ?? 0] }; }
    else if (m.b != null && m.type === 5) { w = m.w; u = { uType: 5 }; }
    else if (m.b != null && m.type === 6) { w = ss(3, 30, m.R); u = { uType: 6, uTr: [m.centre[0], m.centre[2], m.R, m.sky] }; }
    // The place the eye is in is drawn last: its G-buffer is the one a click is read from.
    if (m.b != null && (m.type === 4 ? side < 0 : m.type === 5 && w < 0.5)) { Bs = two(); A = one(); } else { A = one(); Bs = two(); }
    mix.run({
      uA: rtA.texture, uB: Bs ? rtB.texture : rtA.texture, uRes: [W, H], uMix: w, ...u,
      uRo: Bw.ro, uF: Bw.f, uR: Bw.r, uU: Bw.u, uFocal: Bw.focal, uFar: m.far || [0, 0],
      uEdge: m.edge || [1, 1, 1], uPaper: PAPER, uFade: live.fade ?? 0, uSeed: 11 + m.a * 3.3,
    }, rtMix);
    const lens = Bs ? blend(lensOf(A, live), lensOf(Bs, live), w) : lensOf(A, live);
    return { shot: SHOTS[Bs && w > 0.5 ? m.b : m.a], transition: !!Bs, lens, breath: live.wx?.pulse || 0 };
  }
  // What the lens itself is doing: each place says (frame().lens); at a join it goes over from one
  // to the other. (Walked freely, the player's own state of the lens replaces a place's: a place
  // keys its lens against the film's clock, which then means nothing.)
  const lensOf = ({ f, B, world }, live = null) => {
    const S = world.uSun, d = [Math.sin(S[0]) * Math.cos(S[1]), Math.sin(S[1]), Math.cos(S[0]) * Math.cos(S[1])], z = V.dot(d, B.f);
    const on = S[3] > 0 && z > 0.05 ? S[3] * ss(0.05, 0.3, z) : 0;
    return { exp: 0, wet: 0, mist: 0, ...f.lens, ...live?.lens, ...window.__lensTest, fast: ss(4, 13, f.cam.speed ?? 0), sun: on ? [(V.dot(d, B.r) / z) * B.focal, (V.dot(d, B.u) / z) * B.focal, on * (f.lens?.flare ?? 1), 0] : [0, 0, 0, 0] };
  };
  // Played live (`live`: { T, Te, cam, blooms, wake }) there are two clocks: T is the world's (what
  // every place is doing: its colour, its lamps, the fleck) and Te says where on the way the eye
  // is (which place it is in, and which join it is at); and the eye itself is the player's.
  function drawMix(time, sample, samples, frameTime = time, live = null) {
    if (live?.mix) return drawFree(live, sample, samples);
    const t = Math.min(TOTAL - 1e-4, Math.max(0, live ? live.Te : time)), tw = live ? live.T : t;
    const i = STITCHES.filter((s) => t >= s.to).length;
    const st = STITCHES.find((s) => s.a === i && t >= s.from && t < s.to) || null;
    const Bw = basis(live ? live.cam : CAM(t), t);
    const side = st?.plane ? V.dot(st.plane, Bw.ro) + st.plane[3] : 0;        // < 0: the eye has not passed the join
    const one = () => renderShot(SHOTS[i], tw - SHOTS[i].start, rtA, sample, samples, !!st?.plane && side > 0, live);
    const two = () => (st ? renderShot(SHOTS[st.b], tw - SHOTS[st.b].start, rtB, sample, samples, !!st.plane && side < 0, live) : null);
    // Live, the place the eye is in is drawn last, so that its G-buffer is the one a click is read from.
    let A, Bs;
    if (live && st?.plane && side < 0) { Bs = two(); A = one(); } else { A = one(); Bs = two(); }
    let w = 0, u = { uType: 0 };
    if (st?.type === 4) { w = ss(-5, 5, side); u = { uType: 4, uPlane: st.plane, uPortal: [st.fade ? st.fade(tw) : 1, st.sky ?? 12, st.rag ?? 0, 0] }; }
    else if (st?.type === 5) { w = (t - st.from) / (st.to - st.from); u = { uType: 5 }; }
    else if (st?.type === 6) { const R = st.R(live ? tw : frameTime); w = ss(3, 30, R); u = { uType: 6, uTr: [st.centre[0], st.centre[2], R, st.sky] }; }      // one front a frame: drawn at each moment of the shutter it was a stack of outlines
    mix.run({
      uA: rtA.texture, uB: st ? rtB.texture : rtA.texture, uRes: [W, H], uMix: w, ...u,
      uRo: Bw.ro, uF: Bw.f, uR: Bw.r, uU: Bw.u, uFocal: Bw.focal, uFar: [0, 0],
      uEdge: st?.edge || [1, 1, 1], uPaper: PAPER, uFade: live ? 0 : fadeOut(t), uSeed: 11 + i * 3.3,
    }, rtMix);
    const lens = Bs ? blend(lensOf(A), lensOf(Bs), w) : lensOf(A);
    return { shot: SHOTS[st && w > 0.5 ? st.b : i], transition: !!st, lens };
  }

  // The frame at `time`. samples > 1 averages moments across the shutter (motion blur),
  // each drawn a fraction of a pixel aside, which is also what smooths the edges.
  // How many moments of the shutter a frame needs: more when the picture moves far in it (a
  // quick turn of the head, things close by at speed), or the blur breaks into separate
  // copies of every edge. `base` is the least; three times that the most.
  function samplesFor(time, base) {
    const a = CAM(time - SHUTTER / 2), b = CAM(time + SHUTTER / 2), focal = 0.5 / Math.tan((a.fov * Math.PI) / 360);
    const turn = Math.acos(Math.min(1, V.dot(a.dir, b.dir))), slide = V.len(V.sub(a.pos, b.pos)) / 3;      // radians; and what something three units off moves by
    return Math.max(base, Math.min(base * 3, Math.ceil((Math.max(turn, slide) * focal * H) / 3.5)));
  }
  function render(time, samples = 1) {
    let info;
    if (samples > 1) samples = samplesFor(time, samples);
    renderer.setRenderTarget(rtAcc);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    for (let s = 0; s < samples; s++) {
      info = drawMix(time + ((s + 0.5) / samples - 0.5) * (samples > 1 ? SHUTTER : 0), s, samples, time);
      accum.run({ uA: rtMix.texture, uWeight: 1 / samples }, rtAcc);
    }
    return finishFrame(info, time);
  }
  // The world played live: one moment, the player's eye. One sample a frame to keep up; a still
  // (a photograph, play.js) is given more: the same moment drawn a fraction of a pixel aside
  // each time, which smooths every edge and every grain of the hatching.
  let frameNo = 0;
  function renderLive(live, samples = 1) {
    renderer.setRenderTarget(rtAcc);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    let info;
    for (let s = 0; s < samples; s++) {
      info = drawMix(live.Te, s, samples, live.T, live);
      accum.run({ uA: rtMix.texture, uWeight: 1 / samples }, rtAcc);
    }
    return finishFrame(info, live.clock ?? live.T, frameNo++);
  }
  // Where in the world the picture's point (x, y) is (pixels from its top left), in the place
  // the eye is in: on a thing, or failing that on that place's ground. null: the sky.
  const picked = new Float32Array(4);
  function pick(x, y, cam) {
    if (!lastShot) return null;
    renderer.readRenderTargetPixels(gbuf, Math.round(x), Math.round(H - 1 - y), 1, 1, picked, undefined, 2);
    if (picked[0] !== 0 || picked[1] !== 0 || picked[2] !== 0) return { shot: lastShot, p: [picked[0], picked[1], picked[2]], on: 'thing' };
    const c = lastShot.local(cam), B = basis(c, 0), sx = ((x + 0.5) / W - 0.5) * (W / H), sy = 0.5 - (y + 0.5) / H;
    const rd = V.norm(V.add(V.add(V.scale(B.f, B.focal), V.scale(B.r, sx)), V.scale(B.u, sy)));
    if (rd[1] > -0.02 || c.pos[1] < 0.05) return null;
    const k = -c.pos[1] / rd[1];
    return k < 400 ? { shot: lastShot, p: [c.pos[0] + rd[0] * k, 0, c.pos[2] + rd[2] * k], on: 'ground' } : null;
  }
  function finishFrame(info, time, frame = Math.round(time * FPS)) {
    // Halation: what is brighter than the paper is spread, in two widths.
    glow.run({ uA: rtAcc.texture, uDir: [4 / W, 0], uCut: 1 }, rtGlowA);
    glow.run({ uA: rtGlowA.texture, uDir: [0, 4 / H], uCut: 0 }, rtGlowB);
    glow.run({ uA: rtGlowB.texture, uDir: [10 / W, 0], uCut: 0 }, rtGlowA);
    glow.run({ uA: rtGlowA.texture, uDir: [0, 10 / H], uCut: 0 }, rtGlowB);
    glow.run({ uA: rtAcc.texture, uDir: [4 / W, 0], uCut: 0 }, rtSoftA);
    glow.run({ uA: rtSoftA.texture, uDir: [0, 4 / H], uCut: 0 }, rtSoftB);
    glow.run({ uA: rtSoftB.texture, uDir: [9 / W, 0], uCut: 0 }, rtSoftA);
    glow.run({ uA: rtSoftA.texture, uDir: [0, 9 / H], uCut: 0 }, rtSoftB);
    const L = info.lens;
    finish.run({
      uSoft: rtSoftB.texture, uDream: window.__dream === 0 ? [0, 0, 0, 0] : [0.85 * (1 + 0.3 * (info.breath || 0)), 0.5, 1, 1 + 0.5 * (info.breath || 0)],      // (the music, breathing: the light spreads a little further into the shade)
      uA: rtAcc.texture, uGrain: grain.texture, uGlow: rtGlowB.texture, uPaper: PAPER, uFrame: frame, uTime: time, uRes: [W, H],
      uLensK: window.__lens === 0 ? [0, 0, 0, 0] : [0.055, 0.0016 + 0.003 * L.fast, 0.09 + 0.06 * L.fast, 0.022],
      uGlass: [L.exp, L.wet, L.mist, 0.25 + 1.6 * L.fast], uSunS: L.sun, uSlip: [0, -1],
    }, rtOut);
    blit.run({ uA: rtOut.texture }, null);
    return info;
  }

  const pixels = new Uint8Array(W * H * 4);
  return {
    render, renderLive, pick, W, H,
    // What was built for a place (its mesh, what can be walked into, how high its ground is); null for the bare sheet.
    scene: (id) => sceneOf(SHOTS.find((s) => s.id === id)),
    // The last rendered frame as RGBA bytes, bottom row first.
    read: () => { renderer.readRenderTargetPixels(rtOut, 0, 0, W, H, pixels); return pixels; },
    // Wait for the GPU to have drawn everything asked of it (for timing).
    sync: () => { renderer.readRenderTargetPixels(rtOut, 0, 0, 1, 1, pixels.subarray(0, 4)); },
    shaderErrors,
  };
}
