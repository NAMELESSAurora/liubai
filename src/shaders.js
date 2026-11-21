// GLSL for the renderer. Three.js puts "#version 300 es" in front of every one of these.
//
// A shot is drawn in two steps. Its meshes (the ruins, the trees, the tower, the traveller…)
// go into a G-buffer: for every pixel the pigment of the surface there, its normal and its
// place in the world. PAINT then turns that into a watercolour: washes whose strength
// follows the light, pigment pooled against edges, hairlines of ink, colour that comes back
// from grey where the brush has been. Sky, ground, water, weather and the night are painted
// by PAINT directly from the view ray.
//
// World: x right, y up, z away from the camera; one unit is the traveller's height.
// vUv has its origin at the top-left (y down); render targets are sampled with
// gl_FragCoord / uRes, or vec2(vUv.x, 1.0 - vUv.y).

const HEAD = `precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 o;
`;

export const QUAD_VERT = `precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const NOISE = `
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p) { float n = hash21(p); return vec2(n, hash21(p + n * 17.31 + 3.7)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; }
  return s / 0.96875;
}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

const NOISE3 = `
float hash31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s / 0.9375;
}
`;

// ---- meshes → G-buffer ----------------------------------------------------------------
// Every vertex carries its pigment (aCol) and aData = (kind, id, facing, extra):
//   kind    1 stone  2 foliage  3 the traveller's cloak  4 pale things  5 dark solids  6 terrain  7 hair
//           + 16 for anything that is part of the traveller
//   id      one number per stone, puff or part: lines are drawn where it changes
//   facing  0 smooth  1 faceted (the normal is taken from the triangle)  2 a thin sheet seen from both sides
//   extra   stone: height of a course of masonry (0 = none); the cloak 1: the cape over its shoulders;
//           a pale thing 8: the face; hair: a lock's own number below 1, a single hair's from 1, 3: the skull
// With SHADOW defined the same shader writes only depth, as seen from the light.
export const MESH_VERT = `
uniform float uSwayT, uWind;   // seconds; how hard the wind blows
uniform vec3 uEye;             // the eye
uniform vec4 uPush;            // the fleck: xyz, how far it pushes plants aside
in vec3 aCol;
in vec4 aData;
out vec3 vWorld;
out vec3 vNor;
out vec3 vCol;
out vec4 vData;
out vec2 vSt;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  int kind = int(mod(aData.x + 0.5, 16.0));
  if (kind == 8 || kind == 10) {
    // Plants and cloth move: with the wind, a slow wave that crosses the whole scene, and
    // away from the eye (and from the fleck we follow) when either comes close.
    float w = aData.w, wl = min(w, 1.6);
    float ph = dot(wp.xz, vec2(0.31, 0.23)) + aData.y * 6.0;
    vec2 wind = vec2(sin(uSwayT * 1.25 + ph) + 0.45 * sin(uSwayT * 2.9 + ph * 2.3), 0.7 * cos(uSwayT * 1.05 + ph * 1.7));
    vec3 d = vec3(wind.x, 0.0, wind.y) * (kind == 10 ? 0.10 * w : 0.07 * w * min(w, 1.2)) * uWind;
    if (kind == 10) d += vec3(0.0, sin(uSwayT * 4.1 - w * 2.4 + ph), cos(uSwayT * 3.3 - w * 2.0 + ph)) * 0.10 * wl * uWind;
    vec3 a1 = wp.xyz - uEye, a2 = wp.xyz - uPush.xyz;
    a1.y *= 0.3; a2.y *= 0.3;
    d += normalize(a1 + 1e-4) * smoothstep(2.6, 0.5, length(wp.xyz - uEye)) * wl * 0.5;
    d += normalize(a2 + 1e-4) * smoothstep(uPush.w, 0.0, length(wp.xyz - uPush.xyz)) * wl * 0.4;
    wp.xyz += d;
    wp.y -= 0.3 * dot(d.xz, d.xz) / max(w, 0.25) * sign(modelMatrix[1][1]);
  }
  vWorld = wp.xyz;
  vNor = mat3(modelMatrix) * normal;
  vCol = aCol;
  vData = aData;
  vSt = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const MESH_FRAG = `
uniform float uMirror;      // 1: the world is being drawn upside down, for the water to reflect
uniform vec3 uLining;       // the inside of the cloak: the colour of the shot
in vec3 vWorld;
in vec3 vNor;
in vec3 vCol;
in vec4 vData;
in vec2 vSt;
layout(location = 0) out vec4 gA;
#ifndef SHADOW
layout(location = 1) out vec4 gN;
layout(location = 2) out vec4 gP;
#endif
${NOISE}
void main() {
  if (uMirror > 0.5 && vWorld.y > 0.0) discard;             // what is under the water is not reflected
  int kind = int(mod(vData.x + 0.5, 16.0));
  vec3 alb = vCol;
  if (kind == 3) {
    // The cloak (and, with extra = 1, the cape over its shoulders): vSt.x runs round it,
    // vSt.y from the collar to the hem. The hem is cut by hand, a little uneven; the cloth
    // is painted wet in wet; its inside is another colour.
    float v = vSt.y;
    bool cape = vData.w > 0.5;
    vec2 ring = vec2(cos(vSt.x * 6.2832), sin(vSt.x * 6.2832));
    float hem = 1.0 - (cape ? 0.05 : 0.022) * vnoise(ring * 2.3 + 3.1) - (cape ? 0.02 : 0.008) * vnoise(ring * 7.0 + 7.7);
    if (v > hem) discard;
    // Painted on the cloth itself so that the wash travels with it: indigo that runs to
    // ultramarine and to a green-blue, a paler heart where water ran back into it, pigment
    // settled darker towards the hem, faint streaks along the fall.
    vec2 cu = vec2(ring.x * 1.6 + ring.y * 0.9, v * 2.2) + 2.0 * (vec2(vnoise(ring * 1.3 + v * 1.7), vnoise(ring.yx * 1.1 - v * 1.3 + 5.0)) - 0.5);
    float w1 = vnoise(cu * 1.5 + 3.0), w2 = vnoise(cu * 3.1 + 11.0);
    alb = mix(alb, vec3(0.20, 0.30, 0.62), 0.42 * smoothstep(0.35, 0.75, w1));
    alb = mix(alb, vec3(0.14, 0.36, 0.48), 0.32 * smoothstep(0.55, 0.85, w2));
    float run = vnoise(cu * 2.3 + 20.0);
    alb = mix(alb, alb * 1.3 + 0.03, 0.2 * smoothstep(0.62, 0.8, run));
    alb *= (cape ? 1.0 : 1.08 - 0.26 * smoothstep(0.3, 1.0, v));
    alb *= 0.93 + 0.12 * vnoise(vec2(ring.x * 13.0 - ring.y * 9.0, v * 2.5));
    if (dot(vNor, cameraPosition - vWorld) < 0.0) alb = mix(uLining * 0.82, alb, 0.3);
    else {
      // Gold: two fine threads above the hem; on the cape one, and a pale diamond at the nape.
      float d1 = abs(v - (hem - (cape ? 0.10 : 0.030))), d2 = abs(v - (hem - 0.042));
      float thread = smoothstep(cape ? 0.022 : 0.0035, cape ? 0.010 : 0.0015, d1) + (cape ? 0.0 : 0.7 * smoothstep(0.0022, 0.0008, d2));
      alb = mix(alb, vec3(0.86, 0.74, 0.52), 0.85 * min(thread, 1.0));
      if (cape) {
        vec2 dq = abs(vec2((vSt.x - 0.5) * 4.2, v - 0.5));
        if (dq.x / 0.075 + dq.y / 0.125 < 1.0) alb = vec3(0.93, 0.82, 0.70);
      }
    }
  }
  if (kind == 7) {
    // Hair. vSt.x runs across a lock, vSt.y from root to tip; extra is the lock's own
    // number (1 and up: a single fine hair beside a lock; 3: the skull under the hair).
    // Its colour comes with it: traveller.js lays the wash down the whole head. Here the
    // lock is combed into hairs, and towards its tip it comes apart into them.
    float e = vData.w;
    if (e > 2.5) alb *= 0.92;
    else if (e < 0.99) {
      float comb = vnoise(vec2((vSt.x + e * 9.0) * 11.0, e * 53.0));        // the same all the way down: a hair does not break
      if (comb < 0.75 * smoothstep(0.45, 1.0, vSt.y) && abs(vSt.x - 0.5) > 0.06) discard;
      alb *= 0.86 + 0.26 * comb;
      alb *= 1.0 - 0.14 * smoothstep(0.26, 0.5, abs(vSt.x - 0.5));                      // a lock is round, not a ribbon
      if (dot(vNor, cameraPosition - vWorld) < 0.0) alb *= 0.76;
    }
  }
  if (kind == 4 && abs(vData.w - 8.0) < 0.5) {
    // The face has no features. The sphere's own z looks forward; f is the angle across
    // the face and up it. The brow lies in the shade of the fringe, and there is a little
    // colour in the cheek: that is all.
    vec2 f = vec2((vSt.x - 0.25) * 6.2832, (vSt.y - 0.5) * 3.1416);
    alb = mix(alb, vec3(0.78, 0.73, 0.85), 0.6 * smoothstep(-0.30, 0.20, f.y));
    alb = mix(alb, vec3(0.95, 0.72, 0.68), 0.28 * smoothstep(0.42, 0.05, length(vec2(abs(f.x) - 0.6, (f.y + 0.42) * 1.3))));
  }
#ifdef SHADOW
  gA = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
#else
  vec3 toCam = cameraPosition - vWorld;
  vec3 n = normalize(vNor);
  if (vData.z > 0.5 && vData.z < 1.5) n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(n, toCam) < 0.0) n = -n;                          // whatever is seen is seen from its outside
  vec3 P = vWorld;
  if (uMirror > 0.5) { P.y = -P.y; n.y = -n.y; }
  gA = vec4(alb, vData.x / 32.0);
  gN = vec4(n, vData.y);
  gP = vec4(P, vData.w);
#endif
}`;

// ---- the painting ---------------------------------------------------------------------
export const PAINT = `${HEAD}
uniform vec2 uRes, uJit;            // uJit: sub-pixel shift of this sample, px
uniform float uT, uClock, uSeed, uMirror;      // uT: the shot's own script time (the colour comes back by it); uClock: seconds as they pass on screen
uniform vec3 uPaper;
uniform vec3 uRo, uF, uR, uU;       // camera position and basis
uniform vec3 uLens;                 // focal length (picture heights), focus distance, blur at infinity (px)
uniform sampler2D uGA, uGN, uGP;    // G-buffer: pigment + kind, normal + id, position + extra
uniform sampler2D uShadow, uRefl, uTitle;
uniform mat4 uShadowMat;            // world → the light's view
uniform vec4 uShadowP;              // on, map size (px), bias, softness (texels)
uniform vec3 uSkyTop, uSkyLow, uHaze;
uniform float uFog;                 // haze per unit of distance
uniform vec4 uSun;                  // azimuth, elevation, angular radius, strength
uniform vec3 uSunCol;
uniform int uGround;                // 0 none, 1 ground, 2 water
uniform vec3 uGndNear, uGndFar;
uniform float uGndVar;              // how much the ground wash varies
uniform vec4 uLight;                // direction towards the light, strength of shadows on the ground
uniform vec3 uFill;                 // direction towards the soft light that fills the shade
uniform vec3 uShadeTint;            // what shade does to a wash
uniform vec4 uFigB;                 // traveller: opacity, distance from the camera
uniform vec4 uRib[12];              // the wet ribbon behind the brush, on screen: x, y, half width, strength
uniform int uRibN;
uniform vec3 uRibCol;
uniform float uGris;                // 1: the shot starts as a graphite underdrawing
uniform vec4 uPts[8];               // the brush's path through the world: xyz, time it passed
uniform int uPtN;
uniform vec4 uPath;                 // the stroke drawn on the ground: x0, z0, x1, z1
uniform vec4 uTrail;                // stroke start time, stroke end time, bleed radius, stroke opacity
uniform vec4 uSpread;               // bleed stretch x, y, z; how fast it goes on spreading (units a second)
uniform vec4 uBlooms[12];           // xyz, start time (twelve: a place's own, and those the player drops when the world is played live)
uniform vec4 uBloomR[12];           // radius it opens to at once; how fast it goes on spreading
uniform int uBloomN;
uniform vec4 uTint;                 // pigment left inside the blooms: rgb, strength
uniform vec4 uWash;                 // rising wash: front height, lowest height, edge noise, on
uniform vec4 uSweep;                // wash following the traveller along x: front x, lag per unit of z, edge noise, on
uniform float uLine;                // pencil line progress along uPath (< 0: none)
uniform vec4 uDrop;                 // grey drop on the ground: x, z, radius, strength
uniform vec4 uGuide;                // faint construction marks on the paper: circle x, z, radius; strength
uniform vec4 uLeaf;                 // drift x, fall, tumble time, density
uniform vec4 uSlab[8];              // sheets of weather, far to near: kind (0 dust, 1 rain, 2 leaves, 3 leaves on a level sheet), z (3: height), seed
uniform int uSlabN;
uniform vec4 uCloud;                // top layer y, spacing, layers, drift
uniform vec4 uBirds;                // flock centre xyz, on
uniform vec3 uBirdDir;
uniform float uNight;               // night wash progress (< 0: none)
uniform float uDusk;                // walked live: how far the day has gone into night, 0 … 1, in every place (< 0: the film, where dusk goes by uNight)
uniform vec4 uWx;                   // walked live, the weather that was asked for: mist, rain, snow (0 … 1); and how much the music is breathing
float duskOf() { return uDusk >= 0.0 ? uDusk : smoothstep(0.1, 0.7, uNight); }
// What night does to a wash that lies on the ground and to the white of a cloud, and what distance fades to then.
vec3 nightGround() { return mix(vec3(1.0), vec3(0.68, 0.61, 0.78), duskOf()); }
vec3 nightCloud() { return mix(vec3(1.0), vec3(0.66, 0.64, 0.86), duskOf()); }
vec3 hazeNow() { return mix(uHaze, mix(uHaze * vec3(0.60, 0.55, 0.72), vec3(0.80, 0.58, 0.66), 0.4), duskOf()); }
// Rain and snow lay a grey wash over the sky; what is far off takes the same wash (after its colour
// has come back or not: far ground the colour never reached is bare paper, and against a grey
// sky that was a light line along the horizon). far: how much of the thing is lost in the distance.
vec3 farWash(vec3 c, float far) { return c * mix(vec3(1.0), mix(vec3(1.0), vec3(0.83, 0.87, 0.92), uWx.y) * mix(vec3(1.0), vec3(0.84, 0.87, 0.94), uWx.z), far); }
// What night does to a thing that stands in it, walked live: its colour goes out of it a little, and what is left is cooled and darkened.
vec3 nightThing(vec3 c, float dusk) { return mix(c, mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))), 0.38) * vec3(0.58, 0.54, 0.74), dusk); }
uniform vec4 uMoon;                 // azimuth, elevation, angular radius
uniform vec2 uTip;                  // where the night wash starts (azimuth, elevation)
uniform vec4 uTitleBox;             // azimuth, elevation, angular width, height
uniform vec4 uLand;                 // far land below the summit: plane y, on
uniform vec4 uShaft;                // light in the air: strength of the beams, strength of the glare towards the sun
uniform vec4 uWisp[20];             // the fleck we follow and where it has just been: xyz, newest first
uniform int uWispN;
uniform vec4 uWispCol;              // the pigment round it and in its thread: rgb, strength
uniform vec4 uWispP;                // its radius; how far its light reaches; how far colour comes back round it; how much of it there is
uniform float uWispT;               // how much of its thread there is (none while it is drawing the pencil line: the line is its thread)
uniform vec4 uWake[8];              // rings on the water where it touched: x, z, when, strength
uniform int uWakeN;
uniform vec4 uStarC;                // the diagram drawn on the sky: the direction of its centre (where the moon will be); how strongly it is pencilled
uniform vec4 uStarL;                // the pigment its lines are drawn in; how much of it is light
uniform vec4 uCon[8];               // our own constellation: the directions of its stars; w: how far each is lit
uniform int uConN;
uniform vec4 uFig[40];              // the constellations: the directions of their stars; w > 0.5: joined to the star before
uniform int uFigN;
uniform vec4 uVol;                  // the cloud as a body: the height of its top, how deep it is, how much of it there is, its drift
uniform vec4 uVolW;                 // where this place lies in the world (yaw, offset): the cloud is one cloud, laid out in the world
uniform vec4 uBore[6];              // the way the fleck went up through it, which we follow: points; w: how wide the way is there
uniform int uBoreN;
uniform vec4 uPlume;                // where we come out of its top (x, z), and how far the cloud is drawn up after us
${NOISE}${NOISE3}
const vec3 GRAPHITE = vec3(0.50, 0.49, 0.48);
#define PXS (uRes.y / 1080.0)                  // sizes said in pixels are pixels of a 1080-line picture
const float PI = 3.14159265;

// The underdrawing. A thing that has been drawn is shaded in pencil whatever its colour
// will be: gPencil is that extra graphite, set while a mesh is being shaded.
float gPencil = 0.0;
// Pencil shading is strokes, not a flat grey: gHatch (set in reveal(), from where the point
// is in the world, so that the strokes stay on the thing) makes the graphite heavier along
// some strokes and lighter between them, and a second set crosses the first in the darks.
float gHatch = 0.0, gHatch2 = 0.0;
// A mesh brings its own strokes, laid along its form (gMesh: 1, first set, crossing set). Strokes
// laid on slanting planes through the world are only right on something flat: across the flutes
// of a column they came out as scales, and round a trunk as a zebra's stripes.
vec3 gMesh = vec3(0.0);
float wppAt(float dist);
void hatchAt(vec3 p) {
  gHatch = 0.0; gHatch2 = 0.0;
  if (uMirror > 0.5) return;
  if (gMesh.x > 0.5) { gHatch = gMesh.y; gHatch2 = gMesh.z; return; }
  float wpp = wppAt(length(p - uRo)), fade = smoothstep(0.011, 0.004, wpp);
  if (fade <= 0.0) return;
  float laid = 0.35 + 0.9 * vnoise3(p * 0.8 + 4.0);
  gHatch = (vnoise(vec2(dot(p, vec3(0.62, 0.62, 0.48)) * 40.0, 1.3)) - 0.5) * laid * fade;
  gHatch2 = (vnoise(vec2(dot(p, vec3(-0.62, 0.62, 0.48)) * 30.0, 7.7)) - 0.5) * laid * fade;
}
vec3 gris(vec3 c) {
  float k = clamp(1.0 - lum(c) / lum(uPaper), 0.0, 1.0);
  // Graphite has a narrow range: a pale wash still has to read as pencil, and a dark one
  // must not turn to soot.
  float g = 0.62 * pow(k, 0.55) * (1.0 + 0.55 * gHatch * smoothstep(0.02, 0.2, k) + 0.3 * gHatch2 * smoothstep(0.28, 0.6, k)) + gPencil * (1.0 + 0.6 * gHatch);
  return mix(uPaper, GRAPHITE, clamp(g, 0.0, 0.9));
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float wppAt(float dist) { return dist / (uLens.x * uRes.y); }                                  // world units per pixel
// Defocus in px: negative in front of the focal plane, positive behind it.
float cocAt(float dist) { return clamp(uLens.z * (1.0 - uLens.y / max(dist, 0.01)), -40.0, 40.0); }
vec2 screen() { return (gl_FragCoord.xy / uRes - 0.5) * vec2(uRes.x / uRes.y, 1.0); }           // picture heights from the centre
// How far a point is along the view; in the mirrored world the point is under the water.
float distOf(vec3 p) { if (uMirror > 0.5) p.y = -p.y; return length(p - uRo); }

// ---- colour coming back -------------------------------------------------------------
// How far inside the returned colour a world point is (> 0: inside). nz scales every
// radius and wn shifts the rising wash; both come from noise, so the fronts are ragged.
float sources(vec3 p, float nz, float wn, out float sB) {
  float s = -1e3;
  sB = -1e3;
  for (int i = 0; i < 7; i++) {                              // colour bleeds out from the brush's path
    if (i >= uPtN - 1) break;
    vec3 a = uPts[i].xyz, ab = uPts[i + 1].xyz - a;
    float sn = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float age = uT - mix(uPts[i].w, uPts[i + 1].w, sn);
    if (age > 0.0) s = max(s, (uTrail.z * (1.0 - exp(-age / 1.8)) + uSpread.w * age) * nz - length((p - (a + ab * sn)) / uSpread.xyz));
  }
  for (int i = 0; i < 12; i++) {
    if (i >= uBloomN) break;
    float age = uT - uBlooms[i].w;
    float run = uBloomR[i].z > 0.0 ? smoothstep(0.0, uBloomR[i].z, age) : 1.0;       // a drop lands small before it runs
    if (age > 0.0) sB = max(sB, (uBloomR[i].x * (1.0 - exp(-age / 1.1)) + uBloomR[i].y * age * run) * nz - length(p - uBlooms[i].xyz));
  }
  s = max(s, sB);
  if (uWispP.z > 0.0) s = max(s, uWispP.z * nz - length(p - uWisp[0].xyz));             // and round the fleck, wherever it is now
  if (uWash.w > 0.5) s = max(s, min(uWash.x - p.y + wn * uWash.z * (1.0 + 0.1 * max(p.y, 0.0)), p.y - uWash.y));
  if (uSweep.w > 0.5) s = max(s, uSweep.x - p.x - uSweep.y * p.z + wn * uSweep.z * 10.0);
  return s;
}
// Where colour has just come back it is still wet and holds the light: points of it glint,
// each a small four-pointed star that comes and goes. p: the place; fresh: 1 at the front
// of the colour, falling off behind it. The stars keep their size on the picture.
float glints(vec3 p, float fresh) {
  if (fresh <= 0.0 || uMirror > 0.5) return 0.0;
  float dist = length(p - uRo), wpp = wppAt(dist);
  float cell = exp2(floor(log2(wpp * 70.0)));
  vec3 q = p / cell, id = floor(q + 0.5);
  float h = hash21(id.xy * 1.37 + id.z * 7.91 + uSeed);
  if (h > 0.22 * fresh) return 0.0;
  vec3 at = (id + (vec3(hash21(id.xz + 3.1), hash21(id.yz + 5.7), hash21(id.xy + 9.3)) - 0.5) * 0.5) * cell;
  vec2 d = vec2(dot(p - at, uR), dot(p - at, uU)) / wpp;                // px from the star's heart
  float tw = sin(uClock * (1.6 + 2.4 * hash21(id.xy + 1.9)) + h * 90.0);
  float size = (2.6 + 5.0 * hash21(id.zy + 4.4)) * smoothstep(0.2, 1.0, tw) * PXS;
  if (size <= 0.0) return 0.0;
  float star = max(exp(-abs(d.x) / size) * exp(-d.y * d.y * 1.6), exp(-abs(d.y) / size) * exp(-d.x * d.x * 1.6));
  return star * smoothstep(0.2, 1.0, tw) * exp(-dot(d, d) / (size * size * 6.0)) * min(1.0, fresh * 1.5);
}
// The colour as it is s inside the front: the first of it is laid thin and light, as if the
// wash were still shining wet, and it glints.
vec3 arrive(vec3 c, vec3 p, float s) {
  float fresh = smoothstep(-0.05, 0.25, s) * (1.0 - smoothstep(0.3, 3.2, s));
  c = mix(c, vec3(1.0) - (vec3(1.0) - c) * 0.72, 0.5 * fresh);
  return mix(c, vec3(1.0), clamp(glints(p, 0.12 + 0.88 * fresh) * 1.2, 0.0, 1.0));
}
// wc: 2D coordinates on the surface being shaded, for the edge noise.
vec3 reveal(vec3 c, vec3 p, vec2 wc) {
  if (uGris < 0.5) return c;
  hatchAt(p);
  float sB;
  // Most points are well inside or well outside every front: skip the noise for those.
  float s0 = sources(p, 0.5, -0.1, sB);
  if (s0 > 0.7) return arrive(mix(c, c * uTint.rgb, smoothstep(-0.12, 0.2, sB) * uTint.a), p, s0);
  if (sources(p, 1.5, 0.1, sB) < -0.12) return gris(c);
  vec2 wq = vec2(fbm(wc * 0.13 + uSeed), fbm(wc * 0.13 + uSeed + 5.2)) - 0.5;
  float n1 = fbm(wc * 0.34 + wq * 1.8 + uSeed * 1.3) - 0.5;
  float n2 = fbm(wc * 1.7 + uSeed * 2.1) - 0.5;
  float s = sources(p, 1.0 + 1.1 * n1 + 0.22 * n2, n1 * 0.22 + n2 * 0.04, sB);
  float edge = smoothstep(-0.08, 0.08, s) * (1.0 - smoothstep(0.08, 0.7, s));
  c = mix(gris(c), arrive(c, p, s), smoothstep(-0.12, 0.2, s)) * (1.0 - 0.13 * edge);
  return mix(c, c * uTint.rgb, smoothstep(-0.12, 0.2, sB) * uTint.a);
}

// ---- light --------------------------------------------------------------------------
// How much of the light is cut off at p (0 … 1), from the depth map drawn from the light.
float shadowAt(vec3 p, vec3 n) {
  if (uShadowP.x < 0.5) return 0.0;
  vec4 q = uShadowMat * vec4(p + n * 0.05 + uLight.xyz * 0.05, 1.0);
  vec3 c = q.xyz * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 0.0;
  float sh = 0.0, texel = 1.0 / uShadowP.y;
  float turn = hash21(gl_FragCoord.xy + uJit * 91.0) * 6.2832;
  for (int i = 0; i < 8; i++) {
    float a = turn + float(i) * 2.399963, r = sqrt((float(i) + 0.5) / 8.0) * uShadowP.w;
    sh += step(texture(uShadow, c.xy + vec2(cos(a), sin(a)) * r * texel).r + uShadowP.z, c.z);
  }
  return sh / 8.0;
}

// ---- the traveller's ribbon ---------------------------------------------------------
// The wet ribbon the brush leaves in the air while flying, as a tapering stroke on screen.
vec3 ribbon(vec3 col) {
  if (uRibN < 2) return col;
  vec2 pix = screen();
  float acc = 0.0;
  for (int i = 0; i < 11; i++) {
    if (i >= uRibN - 1) break;
    vec4 a = uRib[i], b = uRib[i + 1];
    vec2 pa = pix - a.xy, ba = b.xy - a.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    float w = mix(a.z, b.z, h);
    acc = max(acc, smoothstep(w, w * 0.4, length(pa - ba * h)) * mix(a.w, b.w, h));
  }
  return mix(col, col * uRibCol, acc * (0.72 + 0.28 * vnoise(pix * 240.0)));
}

// ---- weather ------------------------------------------------------------------------
// One leaf per cell of a grid in the slab, tumbling as it falls: a pointed oval with a
// midrib and veins, vermilion to rose. Premultiplied.
vec4 leaf(vec2 p, float seed, float wpp, float blur) {
  const float CELL = 1.6;
  vec2 q = (p + vec2(-uLeaf.x, uLeaf.y) * (0.8 + 0.4 * hash21(vec2(seed, 1.0)))) / CELL + seed * 13.7;
  vec2 id = floor(q), f = fract(q) - 0.5;
  vec2 r = hash22(id + seed * 31.7);
  if (r.x > uLeaf.w) return vec4(0.0);
  vec2 c = (hash22(id + 5.3) - 0.5) * 0.5;
  c.x += 0.16 * sin(uLeaf.z * (0.6 + r.y) + r.x * 6.28);
  float ang = r.y * 6.28 + uLeaf.z * (0.8 + r.x * 1.4);
  vec2 d = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (f - c);
  float sz = 0.065 + 0.045 * r.y;                             // half length, in cells
  float turn = 0.3 + 0.7 * abs(cos(uLeaf.z * (1.2 + r.x) + r.y * 9.0));
  vec2 l = d / sz * vec2(1.0, 1.0 / turn);                    // -1 … 1 along the leaf
  if (abs(l.x) > 1.3 || abs(l.y) > 1.0) return vec4(0.0);
  float soft = (wpp + blur) / (sz * CELL) + 0.03;
  float half_w = 0.46 * (1.0 - l.x * l.x) * (1.0 - 0.28 * l.x);    // broad near the stem, drawn out to a point
  float e = abs(l.y) - half_w;
  float a = smoothstep(soft, -soft, e) * step(abs(l.x), 1.0);
  a = max(a, smoothstep(0.035 + soft, 0.0, abs(l.y)) * step(-1.28, l.x) * step(l.x, -0.9));        // the stem
  if (a < 0.004) return vec4(0.0);
  float h = hash21(id + seed * 3.3);
  vec3 col = mix(vec3(0.80, 0.19, 0.21), vec3(0.93, 0.42, 0.33), smoothstep(0.0, 0.6, h));
  col = mix(col, vec3(0.90, 0.50, 0.56), smoothstep(0.6, 1.0, h));
  col *= 0.86 + 0.28 * vnoise(l * 3.0 + h * 40.0);
  float fine = 1.0 - smoothstep(0.02, 0.09, soft);            // detail only where the leaf is large enough
  col *= 1.0 - 0.30 * fine * smoothstep(0.07, 0.0, abs(l.y));                                       // midrib
  col *= 1.0 - 0.16 * fine * smoothstep(0.10, 0.0, abs(fract((l.x - abs(l.y) * 0.9) * 3.5) - 0.5)) * step(e, -0.04);
  col *= 1.0 - 0.22 * smoothstep(-0.18, 0.0, e);              // pigment gathered at the edge
  return vec4(col * a, a) * 0.95;
}
float rain(vec2 p, float seed, float wpp) {
  float cx = p.x * 2.4 + seed * 7.0;
  float ci = floor(cx), fx = fract(cx) - 0.5;
  float r = hash21(vec2(ci, seed + 1.0));
  float y = p.y * 0.45 + uClock * (6.5 + r * 2.0) + r * 31.0;
  float on = step(0.87, hash21(vec2(ci * 1.7 + 0.3, floor(y))));
  float fy = fract(y), len = 0.3 + 0.2 * r;
  float hw = max(0.012, 1.1 * wpp * 2.4);                   // half width in cells: at least a pixel
  float thin = smoothstep(hw * 2.0, hw * 0.5, abs(fx + (r - 0.5) * 0.6)) * min(1.0, 0.018 / hw + 0.35);
  return on * smoothstep(0.0, 0.1, fy) * smoothstep(len, len - 0.25, fy) * thin;
}
float dust(vec2 p, float seed, float wpp, float blur) {
  vec2 q = p * 0.9 + vec2(uClock * 0.06, uClock * 0.02) * (1.0 + seed) + seed * 17.0;
  vec2 id = floor(q), f = fract(q);
  vec2 r = hash22(id + seed * 3.1);
  vec2 c = 0.25 + 0.5 * r + 0.1 * vec2(sin(uClock * 0.5 + r.x * 6.3), cos(uClock * 0.4 + r.y * 6.3));
  float r0 = max(0.018 + 0.03 * hash21(id + 2.0), 1.1 * wpp), rad = r0 + blur * 0.45;
  return step(0.55, hash21(id + 9.1)) * smoothstep(rad, rad * 0.25, length(f - c)) * (0.55 + 0.45 * sin(uClock * 0.7 + r.x * 20.0)) * pow(r0 / rad, 1.5);
}
// Snow: a flake to a cell, soft, falling slowly and wandering as it falls.
float snow(vec2 p, float seed, float wpp, float blur, float squash) {
  vec2 q = vec2(p.x * 1.3 + 0.35 * sin(p.y * 0.4 + uClock * 0.6 + seed), p.y * 1.3 + uClock * (0.75 + 0.2 * fract(seed * 0.37))) + seed * 17.0;
  vec2 id = floor(q), f = fract(q);
  vec2 r = hash22(id + seed * 3.1);
  vec2 c = 0.3 + 0.4 * r + vec2(0.12 * sin(uClock * 0.9 + r.x * 6.3), 0.0);
  float r0 = max(0.03 + 0.035 * hash21(id + 2.0), 1.2 * wpp), rad = r0 + blur * 0.5;
  return step(0.35, hash21(id + 9.1)) * smoothstep(rad, rad * 0.3, length((f - c) * vec2(1.0, squash))) * pow(r0 / rad, 1.4);      // (squash: the sheet is seen at a slant when we look up or down, and a flake is round all the same)
}
float rings(vec2 w) {                                        // rain on the water
  vec2 q = w * 0.55;
  vec2 id = floor(q), f = fract(q) - 0.5;
  vec2 r = hash22(id + 2.7);
  float ph = fract(uClock * 0.3 + r.x * 7.0);
  float ring = smoothstep(0.045, 0.0, abs(length(f - (r - 0.5) * 0.2) - ph * 0.42));
  return step(0.55, r.y) * ring * (1.0 - ph) * smoothstep(0.0, 0.12, ph);
}
// A sheet of weather standing at depth z, in front of whatever is at distance tS.
vec3 slab(vec3 col, int kind, float z, float seed, vec3 ro, vec3 rd, float tS) {
  if (kind == 3) {
    // Leaves on a level sheet overhead (z is its height): what is seen looking up. The
    // sheets come down past the eye one after another, so the leaves fall on to us.
    if (rd.y < 0.05) return col;
    float t = (z - ro.y) / rd.y;
    if (t <= 0.3 || t > tS) return col;
    vec3 p = ro + rd * t;
    float wpp = wppAt(t), blur = abs(cocAt(t)) * wpp;
    vec4 lf = leaf(p.xz + seed * 3.1, seed, wpp, blur) * smoothstep(0.3, 1.3, t);
    return col * (1.0 - lf.a) + lf.rgb;
  }
  if (rd.z < 1e-4) return col;
  float t = (z - ro.z) / rd.z;
  if (t <= 0.0 || t > tS) return col;
  vec3 p = ro + rd * t;
  float wpp = wppAt(t), blur = abs(cocAt(t)) * wpp;
  if (kind == 0) return mix(col, mix(col, uPaper, 0.7), 0.6 * dust(p.xy, seed, wpp, blur));     // motes catch the light
  if (kind == 1) return mix(col, col * vec3(0.72, 0.80, 0.84), 0.45 * rain(p.xy, seed, wpp));
  vec4 lf = leaf(p.xy, seed, wpp, blur);
  return col * (1.0 - lf.a) + lf.rgb;
}
// Weather asked for by whoever walks the world (uWx). It has to be all round the eye whichever
// way the eye is turned, so its sheets are upright cylinders about the eye, fixed to the world
// by their bearing: they do not turn with the head. (They go with us as we walk. Sliding them
// by where the eye is in the world squeezed them to hairlines far from the world's middle.)
vec3 weather(vec3 col, vec3 ro, vec3 rd, float tS) {
  float lxz = length(rd.xz);
  if (lxz < 0.12) return col;
  float az = atan(rd.x, rd.z), look = smoothstep(0.12, 0.4, lxz);
  for (int i = 3; i >= 0; i--) {
    float fi = float(i), r = 3.0 * pow(2.1, fi), t = r / lxz;
    if (t > tS) continue;
    vec3 p = ro + rd * t;
    float u = az * r, wpp = wppAt(t), blur = abs(cocAt(t)) * wpp;
    if (uWx.y > 0.003) col = mix(col, col * vec3(0.66, 0.75, 0.81), 0.6 * look * uWx.y * rain(vec2(u + p.y * 0.1, p.y), 11.0 + fi, wpp));
    if (uWx.z > 0.003) col = mix(col, vec3(1.0), look * uWx.z * snow(vec2(u, p.y), 21.0 + fi, wpp, blur, lxz));
  }
  return col;
}
vec3 birds(vec3 col, float tS) {
  if (uBirds.w < 0.5) return col;
  vec2 pix = screen();
  vec3 side = normalize(vec3(-uBirdDir.z, 0.0, uBirdDir.x));
  float acc = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float sgn = mod(fi, 2.0) * 2.0 - 1.0, rank = floor((fi + 1.0) / 2.0);
    vec3 q = uBirds.xyz - uBirdDir * rank * 1.1 + side * sgn * rank * 0.8 + vec3(0.0, rank * 0.2 + 0.15 * sin(uClock * 0.9 + fi * 1.7), 0.0) - uRo;
    float zc = dot(q, uF);
    if (zc < 1.0 || length(q) > tS) continue;                // behind the lens, or behind the tower
    float k = uLens.x / zc;                                  // world units → picture heights
    vec2 d = pix - vec2(dot(q, uR), dot(q, uU)) * k;
    float span = (0.2 + 0.05 * hash21(vec2(fi, 4.2))) * k;
    float lift = span * (0.1 + 0.6 * sin(uClock * 5.0 + fi * 1.9));
    float hw = max(0.0011, 0.013 * k);
    acc = max(acc, smoothstep(hw, hw * 0.4, min(sdSeg(d, vec2(0.0), vec2(-span, lift)), sdSeg(d, vec2(0.0), vec2(span, lift)))));
  }
  return mix(col, col * vec3(0.5, 0.38, 0.27), acc * 0.85);
}

// The fleck we follow: a spot of the paper left bare, with the wash that was laid round it,
// a thread of that wash drawn out behind it, and the light it gives. s: this pixel on the
// picture; tS: how far away the thing already drawn here is.
vec3 wisp(vec3 col, vec2 s, vec3 rd, float tS, bool mirror) {
  if (uWispN < 2 || uWispP.w <= 0.0) return col;
  float along = dot(rd, uF), px = PXS / uRes.y, tail = 0.0, hz = -1.0, za = -1.0;
  vec2 hs = vec2(0.0), pa = vec2(0.0);
  for (int i = 0; i < 20; i++) {
    if (i >= uWispN) break;
    vec3 q = uWisp[i].xyz;
    if (mirror) q.y = -q.y;
    q -= uRo;
    float z = dot(q, uF);
    vec2 pb = z > 0.15 ? vec2(dot(q, uR), dot(q, uU)) * (uLens.x / z) : vec2(0.0);
    if (i == 0) { hs = pb; hz = z; }
    if (i > 0 && z > 0.15 && za > 0.15) {
      vec2 ba = pb - pa;
      float h = clamp(dot(s - pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
      float zz = mix(za, z, h), age = (float(i) - 1.0 + h) / float(uWispN - 1);
      if (zz / along < tS) {
        float wd = clamp(uWispP.x * mix(0.8, 0.1, pow(age, 0.6)) * uLens.x / zz, 1.1 * px, 0.0048);         // a thread, however near
        wd *= 0.75 + 0.5 * vnoise(vec2(age * 23.0 + uSeed, 3.0));               // a line drawn by hand swells and thins
        tail = max(tail, smoothstep(wd, wd * 0.4, length(s - pa - ba * h)) * pow(1.0 - age, 1.3));
      }
    }
    pa = pb; za = z;
  }
  vec3 pig = uWispCol.rgb;
  col = mix(col, mix(pig, col * pig, 0.3), tail * uWispCol.a * uWispT);
  if (hz > 0.15 && hz / along < tS) {
    float r = clamp(uWispP.x * uLens.x / hz, 2.2 * px, max(0.013, uWispP.x * 0.02)), d = length(s - hs);      // near the lens it does not swell: light has no size
    // The wash round it: ragged, darkest just outside the bare spot.
    float rag = 1.0 + 0.5 * (fbm((s - hs) / r * 0.9 + uSeed) - 0.5);
    float blot = smoothstep(r * 2.7 * rag, r * 1.25, d) * uWispCol.a * smoothstep(0.7, 3.5, hz);      // (close to the lens the wash round it was a smudge over the picture)
    col = mix(col, mix(pig, col * pig, 0.45), 0.6 * blot * uWispP.w);
    vec2 e = abs(s - hs);
    float star = exp(-min(e.x, e.y) / (r * 0.3)) * exp(-max(e.x, e.y) / (r * 4.5));
    float halo = 0.5 * exp(-d / (r * 5.0)) + 0.6 * star * clamp(uWispP.y, 0.0, 1.0);
    col = vec3(1.0) - (vec3(1.0) - col) * (1.0 - clamp(halo, 0.0, 1.0) * uWispP.w);
    col = mix(col, vec3(1.0), smoothstep(r * 1.15, r * 0.8, d) * uWispP.w);
  }
  return col;
}

// ---- marks on the ground: the wet stroke, the pencil line, the first grey drop --------
// graze: sine of the angle between the view ray and the ground, which stretches a pixel's
// footprint along the ground; the marks are never allowed thinner than about a pixel.
vec3 marks(vec3 c, vec3 p, float dist, float graze) {
  vec2 a = uPath.xy, ab = uPath.zw - a;
  float len = length(ab), tu = dot(p.xz - a, ab) / (len * len), along = tu * len;
  float side = ((p.x - a.x) * ab.y - (p.z - a.y) * ab.x) / len;
  float wpp = wppAt(dist) / max(graze, 0.04);
  if (uTrail.w > 0.0 && uTrail.z > 0.0) {
    float head = clamp((uT - uTrail.x) / (uTrail.y - uTrail.x), 0.0, 1.0);
    float inside = smoothstep(0.0, 0.08, along) * smoothstep(0.0, 0.12, (head - tu) * len);
    float wd = max(0.055 * (0.7 + 0.6 * vnoise(vec2(along * 3.0, 3.7))), 1.2 * wpp);
    float dry = 0.55 + 0.45 * vnoise(vec2(along * 11.0, side * 45.0));
    float age = uT - mix(uTrail.x, uTrail.y, clamp(tu, 0.0, 1.0));
    c *= 1.0 - 0.42 * uTrail.w * smoothstep(wd, wd * 0.35, abs(side)) * inside * dry * mix(1.0, 0.4, smoothstep(0.0, 5.0, age));
  }
  if (uGuide.w > 0.0) {
    // What a draughtsman leaves before the drawing: a compass circle, two ruled lines,
    // ticks along the line to come. They lie on the ground, so they show the camera moving.
    float gd = abs(length(p.xz - uGuide.xy) - uGuide.z);
    gd = min(gd, abs(abs(side) - 3.0));
    float tick = abs(fract(along / 2.0 + 0.5) - 0.5) * 2.0;
    if (abs(side) < 0.16 && tu > 0.0 && tu < 1.0) gd = min(gd, tick);
    float gw = min(fwidth(gd), 4.0 * wppAt(dist) / max(graze, 0.04)), wd = max(0.009, 0.75 * gw);       // across the mark, as for the line
    c = mix(c, GRAPHITE, smoothstep(wd + 0.5 * gw, max(wd - 0.5 * gw, 0.0), gd) * uGuide.w * min(1.0, 0.009 / max(0.75 * gw, 1e-5) + 0.3) * (0.45 + 0.55 * vnoise(p.xz * 30.0)));
  }
  if (uLine >= 0.0) {
    // The pencil line. Its width is the pencil's (a pixel and a half at the least, measured
    // across the line: it used to be measured along the view, and far off the line swelled
    // into a wedge). It begins lightly, and where it is still being drawn the point is fine
    // and the pressure light: no line ends square.
    float wob = (fbm(vec2(along * 0.3, 1.3)) - 0.5) * 0.08, sd = abs(side - wob), fw = fwidth(side);
    float toHead = (uLine - tu) * len, press = 0.72 + 0.28 * fbm(vec2(along * 1.7, 5.0));
    float wd = max(0.016 * press, 0.8 * fw) * (0.35 + 0.65 * smoothstep(0.0, 1.6, toHead));
    float aL = smoothstep(wd + 0.6 * fw, max(wd - 0.6 * fw, 0.0), sd) * smoothstep(0.0, 0.5, along) * smoothstep(0.0, 0.25, toHead);
    aL *= min(1.0, 0.016 / max(0.8 * fw, 1e-5) + 0.35);                                  // far off, thinner than a pixel, it is fainter instead of wider
    c = mix(c, GRAPHITE * 0.9, aL * (0.5 + 0.5 * vnoise(p.xz * 30.0)) * (0.6 + 0.3 * press));
  }
  if (uDrop.z > 0.0) {
    float nd = 1.0 + 1.1 * (fbm(p.xz * 1.0 + uSeed) - 0.5) + 0.22 * (fbm(p.xz * 5.0 + uSeed) - 0.5);
    float sd = uDrop.z * nd - length(p.xz - uDrop.xy);
    c *= mix(vec3(1.0), vec3(0.80, 0.80, 0.81), smoothstep(-0.05, 0.12, sd) * uDrop.w);
    c *= 1.0 - 0.10 * uDrop.w * smoothstep(-0.04, 0.04, sd) * (1.0 - smoothstep(0.04, 0.3, sd));
  }
  return c;
}

// ---- the sea of cloud -----------------------------------------------------------------
// Layers of cloud lying flat, marbled like paint drawn through water: white crests, blue
// in the hollows. Returns the layer's colour and cover, and how far along the ray it is.
vec4 cloudAt(int k, vec3 ro, vec3 rd, out float tk) {
  float fk = float(k), y = uCloud.x - fk * uCloud.y;
  tk = -1.0;
  if (rd.y > -1e-4 || ro.y <= y) return vec4(0.0);
  tk = (y - ro.y) / rd.y;
  vec3 p = ro + rd * tk;
  vec2 q = p.xz * 0.045 + fk * 7.3 + vec2(uCloud.w * (1.0 + 0.3 * fk), 0.0);
  vec2 bend = vec2(fbm(q * 0.55 + 2.0), fbm(q * 0.55 + 9.0)) - 0.5;
  float dn = fbm(q + bend * 1.7) + 0.24 * fbm(q * 3.1 - bend * 2.2);
  float vein = smoothstep(0.045, 0.0, abs(fbm(q * 1.6 + bend * 2.6 + 4.0) - 0.5));
  float thick = 1.0 - exp(-tk * 0.012);
  float a = max(smoothstep(0.52 - 0.1 * fk, 0.78 - 0.1 * fk, dn + thick * 0.5), step(uCloud.z - 1.5, fk));
  vec3 hollow = mix(vec3(0.60, 0.74, 0.92), vec3(0.44, 0.60, 0.86), smoothstep(0.55, 0.2, dn));
  hollow = mix(hollow, vec3(0.96, 0.88, 0.74), 0.30);                    // the gold of the sky lies over the blue
  vec3 c = mix(hollow, vec3(1.0, 0.995, 0.975), smoothstep(0.42, 0.9, dn));
  c = mix(c, vec3(1.0, 0.995, 0.98), vein * 0.6 * smoothstep(0.3, 0.6, dn));
  c *= 1.0 - 0.05 * fk;                                                  // deeper layers sit in shade
  c *= nightCloud();
  c = mix(c, hazeNow(), 1.0 - exp(-tk * uFog));
  return vec4(farWash(reveal(c, p, p.xz), 1.0 - exp(-tk * uFog)), a);
}

// ---- the cloud as a body ---------------------------------------------------------------
// A sea of cloud with heaped tops, marched through; but painted, not rendered. What the
// march gives is how much cloud lies along the ray, how far off it begins, and how much of
// the light reaches it. The painting is then done as everything else is: bare paper where
// the light falls, a pale wash where the form turns from it, a deeper one in the hollows,
// the edges of the washes firm but wandering with pigment gathered inside them; and the
// cloud's own edge against the sky a wet edge, firm in places and lost in others.
// Its shape is laid out in the world, so two places that share it see the same cloud.
vec3 volWorld(vec3 p) { float c = cos(uVolW.x), s = sin(uVolW.x); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + uVolW.yzw; }
float volTop(vec2 w) {                                                                    // how high the top is heaped here, above uVol.x
  vec2 q = w * 0.017 + vec2(uVol.w, 0.0);
  return 7.5 * (fbm(q) - 0.47) + 2.4 * (vnoise(q * 3.1 + 5.0) - 0.5);
}
float volDensity(vec3 p, out float deep) {
  vec3 w = volWorld(p);
  float top = uVol.x + volTop(w.xz);
  vec2 pl = p.xz - uPlume.xy;                                                             // where we came out the cloud is drawn up after us, in a ring,
  float rp = length(pl), age = uPlume.z;
  top += uPlume.w * exp(-(rp - 5.0) * (rp - 5.0) / 14.0);
  if (age > 0.0) top += 2.2 * exp(-age * 0.55) * exp(-(rp - 5.0 - 11.0 * age) * (rp - 5.0 - 11.0 * age) / 26.0);      // and a ripple runs out over its top from there
  deep = top - p.y;
  if (deep < -3.0) return 0.0;
  float e = 0.55 * vnoise3(w * 0.19 + vec3(uVol.w * 3.0, 0.0, 0.0)) + 0.3 * vnoise3(w * 0.47 + 7.0) + 0.15 * vnoise3(w * 1.1);     // what eats at its surface
  float d = smoothstep(-1.2, 2.6, deep + 5.0 * (e - 0.5));
  float under = uVol.x - uVol.y + 3.0 * (vnoise(w.xz * 0.06 + 3.0) - 0.5);                 // its underside
  d *= smoothstep(under - 2.0, under + 3.0, p.y + 3.0 * (e - 0.5));
  for (int i = 0; i < 5; i++) {                                                           // the way through it
    if (i >= uBoreN - 1) break;
    vec3 a = uBore[i].xyz, ab = uBore[i + 1].xyz - a;
    float h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0), R = mix(uBore[i].w, uBore[i + 1].w, h);
    if (R > 0.05) d *= smoothstep(R * 0.55, R * 1.45, length(p - a - ab * h) + R * 1.1 * (e - 0.5));
  }
  if (age > 0.0 && age < 2.2 && rp < 26.0) {
    // What we throw up as we break out of it: a few shreds that rise, spread and thin away.
    for (int i = 0; i < 6; i++) {
      float fi = float(i), an = fi * 1.047 + 0.4, sp = 3.0 + 1.3 * mod(fi, 3.0);
      vec3 c = vec3(uPlume.x + cos(an) * (2.5 + sp * age), uVol.x + 1.5 + (7.5 + mod(fi, 2.0) * 2.5) * age - 4.2 * age * age, uPlume.y + sin(an) * (2.5 + sp * age));
      float rr = 1.3 + 1.5 * age;
      d = max(d, smoothstep(rr, rr * 0.35, length(p - c) + rr * 0.9 * (e - 0.5)) * (1.0 - smoothstep(1.2, 2.2, age)));
    }
  }
  return d;
}
vec3 cloudVol(vec3 col, vec3 ro, vec3 rd, inout float tS) {
  float yTop = uVol.x + 8.0 + uPlume.w, yBot = uVol.x - uVol.y - 4.0, t0 = 0.0, t1 = min(tS, 900.0);
  if (abs(rd.y) > 1e-4) { float ta = (yTop - ro.y) / rd.y, tb = (yBot - ro.y) / rd.y; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  else if (ro.y > yTop || ro.y < yBot) return col;
  if (t1 <= t0) return col;
  vec3 sunW = volWorld(uLight.xyz) - uVolW.yzw;                                           // towards the light, in the world
  vec2 sn = normalize(sunW.xz + 1e-5);
  float jit = hash21(gl_FragCoord.xy + uJit * 71.0), T = 1.0, lit = 0.0, wsum = 0.0, tHit = -1.0, t = t0;
  for (int i = 0; i < 36; i++) {
    float dt = 0.75 + t * 0.05, tt = t + dt * jit, deep;
    if (tt > t1 || T < 0.03) break;
    vec3 p = ro + rd * tt;
    float d = volDensity(p, deep) * uVol.z;
    if (d > 0.01) {
      float a = 1.0 - exp(-d * dt * 0.6);
      vec3 w = volWorld(p);
      // Light: which way does the top of the cloud slope here, towards the sun or away from it?
      // (The sun is low: a heap is bright on one side and in shade on the other.) Deep inside,
      // and seen from underneath, it is never dark: light comes through it.
      float slope = (volTop(w.xz + sn * 7.0) - volTop(w.xz - sn * 7.0)) / 14.0;
      float facing = (sunW.y - slope * length(sunW.xz)) / sqrt(1.0 + slope * slope);
      float l = smoothstep(-0.13, 0.34, facing) * (0.7 + 0.3 * smoothstep(6.0, -1.0, deep));
      l *= 0.5 + 0.5 * smoothstep(-3.2, 1.6, p.y + deep - uVol.x);                           // and its hollows lie in shade, whichever way the sun is
      if (deep > 3.5) {
        // Inside it (the walls of the way through it, its underside) the light is what comes
        // down from above: a surface that is open upwards is bright, one that is overhung is
        // in shade; and it is dimmer the deeper in the cloud it lies.
        float dz, above = volDensity(p + vec3(0.0, 1.4, 0.0), dz) * uVol.z;
        float lin = (0.24 + 0.62 * smoothstep(-0.05, 0.45, d - above)) * (0.72 + 0.28 * smoothstep(34.0, 5.0, deep));
        l = mix(l, lin, smoothstep(3.5, 7.0, deep));
      }
      lit += T * a * l; wsum += T * a;
      if (tHit < 0.0 && 1.0 - T * (1.0 - a) > 0.45) tHit = tt;
      T *= 1.0 - a;
    }
    t += dt;
  }
  float alpha = 1.0 - T;
  if (alpha < 0.004) return col;
  if (tHit < 0.0) tHit = t0;
  lit /= max(wsum, 1e-4);
  vec3 pw = ro + rd * tHit, ww = volWorld(pw);
  if (uShadowP.x > 0.5) lit *= 1.0 - 0.45 * shadowAt(pw, vec3(0.0, 1.0, 0.0));            // what stands in the cloud throws its shadow across it
  float wander = fbm(ww.xz * 0.09 + ww.y * 0.06 + uSeed) - 0.5, fine = fbm(ww.xz * 0.6 + ww.y * 0.4 + 3.0) - 0.5;
  float l2 = lit + wander * 0.34 + fine * 0.1;
  float w1 = 1.0 - smoothstep(0.50, 0.56, l2), w2 = 1.0 - smoothstep(0.26, 0.32, l2);
  float tide = smoothstep(0.42, 0.50, l2) * (1.0 - smoothstep(0.50, 0.56, l2)) + 0.7 * smoothstep(0.19, 0.26, l2) * (1.0 - smoothstep(0.26, 0.32, l2));
  vec3 pale = mix(vec3(0.78, 0.86, 0.96), vec3(0.96, 0.88, 0.74), 0.24), hollow = mix(vec3(0.55, 0.69, 0.90), vec3(0.96, 0.88, 0.74), 0.2);
  vec3 c = mix(vec3(1.0, 0.995, 0.975), pale, 0.92 * w1);
  c = mix(c, hollow, 0.85 * w2);
  c *= 1.0 - 0.07 * tide;
  c *= 0.97 + 0.06 * fbm(ww.xz * 0.35 + 9.0);                                              // the wash is never even
  c = mix(c, vec3(1.0), 0.3 * pow(max(dot(rd, uLight.xyz), 0.0), 6.0) * (1.0 - w1));      // towards the sun its lit heaps are light itself
  c *= nightCloud();
  c = mix(c, hazeNow(), 1.0 - exp(-tHit * uFog * 0.55));
  c = farWash(reveal(c, vec3(pw.x, min(pw.y, uVol.x - 2.0), pw.z), pw.xz), 1.0 - exp(-tHit * uFog * 0.55));
  // Its edge: firm where there is body behind it, lost where there is not; pigment gathers just inside.
  float a = smoothstep(0.1, 0.6, alpha), lip = smoothstep(0.18, 0.5, alpha) * (1.0 - smoothstep(0.5, 0.9, alpha));
  c *= 1.0 - 0.08 * lip;
  if (alpha > 0.55) tS = min(tS, tHit);
  return mix(col, c, a);
}

// ---- sky, ground, water -------------------------------------------------------------
float salt(vec2 M) {
  vec2 p = M * 46.0;
  vec2 id = floor(p), f = fract(p);
  vec2 r = hash22(id + 11.3);
  if (r.x > 0.1) return 0.0;
  float rad = 0.05 + 0.12 * r.y;
  return smoothstep(rad, rad * 0.45, length(f - (0.25 + 0.5 * hash22(id + 3.1))) + (vnoise(p * 9.0) - 0.5) * 0.04);
}
// ---- the diagram on the sky -----------------------------------------------------------
// The sky is not empty. A draughtsman's diagram is drawn on it, as on the first sheet:
// rings round the place where the moon will be (a hairline, a full ring, a ring in three
// arcs, a ring with a few marks on it, a ring of points, one long arc), with a small body
// or two going slowly round on each; and constellations: figures of a few stars joined by
// hairlines (uFig, drawn in shots.js), among smaller stars that belong to none. By day it
// is a soft drawing in the pigment of the place (pencil, while the place is in pencil); at
// night it is light. Nothing in it has a hard edge: a line is a thread of light, brightest
// along its middle, and a star is a point with a halo.
// x: lines; y: stars and bodies; z: the glow round all of it.
float angPx() { return 1.0 / (uLens.x * uRes.y); }                                      // the angle one pixel takes up, about
float arcTo(vec3 a, vec3 b) { return acos(clamp(dot(a, b), -1.0, 1.0)); }
float thread(float d, float w) { return exp(-d * d / (w * w)); }
// A drawn line of half-width w: a clean edge, a pixel of softness, nothing more (px: the angle of a pixel).
float pen(float d, float w, float px) { return smoothstep(w + 0.55 * px, max(w - 0.55 * px, 0.0), d); }
// How far rd is from the arc of a great circle from a to b (and how far along it: t).
float arcDist(vec3 rd, vec3 a, vec3 b, out float t) {
  vec3 n = normalize(cross(a, b)), pr = normalize(rd - n * dot(rd, n));
  float len = max(arcTo(a, b), 1e-4);
  t = arcTo(pr, a) / len * sign(dot(cross(a, pr), n));
  float off = abs(asin(clamp(dot(rd, n), -1.0, 1.0)));
  return t < 0.0 ? arcTo(rd, a) : t > 1.0 ? arcTo(rd, b) : off;
}
// A star as it is drawn: a small clean disc, and for the brighter ones four fine rays and four
// shorter ones between them. v: where we are from its middle, in its own right / up; r: its radius.
float starGlyph(vec2 v, float r, float rays, float px) {
  float d = length(v), g = pen(d, r, px);
  if (rays > 0.0) {
    vec2 a = abs(v), dg = abs(vec2(v.x + v.y, v.x - v.y)) * 0.7071;
    g = max(g, pen(min(a.x, a.y), 0.3 * px, px) * smoothstep(r * (4.5 + 5.0 * rays), r * 1.2, max(a.x, a.y)));
    g = max(g, 0.7 * pen(min(dg.x, dg.y), 0.25 * px, px) * smoothstep(r * (2.2 + 2.0 * rays), r * 1.1, max(dg.x, dg.y)));
  }
  return g;
}
// x: lines; y: stars and bodies; z: the glow close round them; w: the wide soft halo each bright thing stands in.
vec4 diagram(vec3 rd) {
  float px = angPx(), w1 = 0.62 * px, w2 = 0.42 * px, line = 0.0, star = 0.0, glow = 0.0, halo = 0.0;
  vec3 C = normalize(uStarC.xyz), e1 = normalize(cross(C, vec3(0.0, 1.0, 0.0))), e2 = cross(e1, C);
  float ang = arcTo(rd, C), th = atan(dot(rd, e2), dot(rd, e1));
  for (int k = 0; k < 6; k++) {
    float fk = float(k), r = k == 0 ? 0.088 : 0.15 * pow(1.5, fk - 1.0), d = abs(ang - r);
    float turn = uClock * (0.02 + 0.011 * fk) * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0) + fk * 1.7, a = th + turn;
    float l = pen(d, k == 1 || k == 3 ? w1 : w2, px) * (k == 0 ? 0.6 : 1.0 - 0.11 * fk);
    if (k == 1) l = max(l, 0.55 * pen(abs(ang - r * 1.045), w2, px));                    // the second ring is double
    if (k == 2) l *= smoothstep(-0.25, 0.1, sin(a * 3.0));                               // three arcs
    if (k == 5) l *= smoothstep(0.2, 0.7, sin(a + 1.0)) * 0.8;                           // one long arc
    if (k == 4) { float u = a * 72.0 / 6.2832, du = (fract(u + 0.5) - 0.5) * 6.2832 / 72.0 * sin(r); l = pen(length(vec2(d, du)), 0.9 * px, px) * 0.8; }      // a ring of points
    if (k == 3) {                                                                       // a ring with a scale: twelve marks, every third one longer
      float u = a * 12.0 / 6.2832, du = abs(fract(u + 0.5) - 0.5) * 6.2832 / 12.0 * sin(r);
      float len = mod(floor(u + 0.5), 3.0) < 0.5 ? 0.022 : 0.009;
      l = max(l, pen(du, w2, px) * smoothstep(len, len * 0.8, d) * 0.9);
    }
    line = max(line, l);
    glow = max(glow, exp(-d / (7.0 * px)) * 0.2 * (1.0 - 0.12 * fk));
    for (int j = 0; j < 2; j++) {
      if (j == 1 && k != 2 && k != 5) break;
      float an = turn * 2.3 + float(j) * 2.7 + fk * 1.3;
      vec3 q = C * cos(r) + (e1 * cos(an) + e2 * sin(an)) * sin(r);
      float dq = arcTo(rd, q), rad = max(0.0023 + 0.0008 * mod(fk + float(j), 3.0), 1.6 * px);
      star = max(star, pen(dq, rad, px));
      line = max(line, pen(abs(dq - rad * 2.7), w2, px) * 0.85);                         // each small body in its own fine ring,
      if (k == 3) line = max(line, pen(abs(dq - rad * 4.3), w2, px) * 0.5 * smoothstep(-0.3, 0.3, sin(atan(dot(rd - q, e2), dot(rd - q, e1)) * 2.0 + uClock * 0.2)));      // one of them in two
      glow = max(glow, exp(-dq / (rad * 3.0)) * 0.7);
      halo = max(halo, exp(-dq * dq / (rad * rad * 90.0)));
    }
  }
  // Small stars, on a map of the sky that keeps circles round: most are points, a few have rays.
  if (rd.y > -0.2) {
    vec2 p = rd.xz / (1.0 + rd.y);
    float S = 10.0, kk = S * 0.5 * (1.0 + dot(p, p)), seen = smoothstep(-0.02, 0.22, rd.y) * smoothstep(0.1, 0.16, ang);
    vec2 P = p * S, id = floor(P);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = id + vec2(float(i), float(j));
      float h = hash21(c + 4.1);
      if (h > 0.72) continue;
      vec2 v = (P - (c + 0.15 + 0.7 * hash22(c + 1.3))) / kk;
      float tw = 0.78 + 0.22 * sin(uClock * (0.8 + 2.0 * h) + h * 40.0), rad = max((0.0008 + 0.002 * h * h) * tw, 0.85 * px);
      star = max(star, starGlyph(v, rad, h > 0.6 ? (h - 0.6) * 4.0 : 0.0, px) * seen * (0.5 + 0.5 * h));
      glow = max(glow, exp(-length(v) / (rad * 3.0)) * seen * h * 0.5);
      if (h > 0.62) halo = max(halo, exp(-dot(v, v) / (rad * rad * 110.0)) * seen * (h - 0.5));
    }
  }
  // The constellations: uFig is a list of stars; w > 0.5 joins a star to the one before it.
  for (int i = 0; i < 40; i++) {
    if (i >= uFigN) break;
    vec3 a = uFig[i].xyz, rt = normalize(cross(vec3(0.0, 1.0, 0.0), a)), up = cross(a, rt);
    vec2 v = vec2(dot(rd - a, rt), dot(rd - a, up));
    float da = length(v), big = fract(uFig[i].w * 7.31 + float(i) * 0.37), tw = 0.82 + 0.18 * sin(uClock * (0.7 + big) + float(i));
    float rad = max((0.0019 + 0.0017 * big) * tw, 1.3 * px);
    star = max(star, starGlyph(v, rad, big > 0.45 ? big : 0.0, px));
    if (big < 0.3) line = max(line, pen(abs(da - rad * 2.6), w2, px) * 0.8);             // the fainter ones are ringed instead
    glow = max(glow, exp(-da / (rad * 3.4)) * 0.8);
    halo = max(halo, exp(-da * da / (rad * rad * 130.0)) * (0.5 + 0.5 * big));
    if (i > 0 && uFig[i].w > 0.5) {
      float t, d = arcDist(rd, uFig[i - 1].xyz, a, t), len = arcTo(uFig[i - 1].xyz, a), gap = 0.012 / len;
      line = max(line, pen(d, w1, px) * smoothstep(gap * 0.8, gap * 1.2, t) * smoothstep(1.0 - gap * 0.8, 1.0 - gap * 1.2, t) * 0.9);
    }
  }
  // Our own: the way we came, as stars, each lit in its turn, a line from each to the next.
  for (int i = 0; i < 8; i++) {
    if (i >= uConN) break;
    vec3 a = uCon[i].xyz, rt = normalize(cross(vec3(0.0, 1.0, 0.0), a)), up = cross(a, rt);
    vec2 v = vec2(dot(rd - a, rt), dot(rd - a, up));
    float da = length(v), lit = uCon[i].w;
    if (i < uConN - 1) {
      star = max(star, starGlyph(v, max(0.003, 1.7 * px), 0.8, px) * lit);
      line = max(line, pen(abs(da - 0.0118), w1, px) * lit);
      glow = max(glow, exp(-da / 0.011) * lit);
      halo = max(halo, exp(-da * da / 0.0016) * lit);
      float t, d = arcDist(rd, a, uCon[i + 1].xyz, t), len = arcTo(a, uCon[i + 1].xyz), gap = 0.018 / len, end = min(uCon[i + 1].w, 1.0 - (i == uConN - 2 ? 4.9 : 1.0) * gap);
      line = max(line, pen(d, w1, px) * smoothstep(gap * 0.85, gap * 1.2, t) * smoothstep(end, end - 0.5 * gap, t) * step(gap, end));
    }
  }
  return vec4(line, star, max(glow, 0.45 * line), halo);
}
vec3 skyColor(vec3 rd) {
  float lxz = max(length(rd.xz), 1e-4);
  vec2 sc = vec2(atan(rd.x, rd.z), atan(rd.y, lxz));        // azimuth, elevation
  vec3 c = mix(uSkyLow, uSkyTop, smoothstep(0.0, 0.7, rd.y / lxz));
  vec3 sd = vec3(sin(uSun.x) * cos(uSun.y), sin(uSun.y), cos(uSun.x) * cos(uSun.y));
  float sunAng = acos(clamp(dot(rd, sd), -1.0, 1.0));
  c *= 1.0 - 0.07 * uSun.w * smoothstep(0.25, 1.5, sunAng);                   // the sky deepens away from the sun
  if (uSun.w > 0.0) c = mix(c, uSunCol, smoothstep(uSun.z, uSun.z - 0.004, sunAng) * uSun.w);
  vec4 dg = (uStarC.w > 0.0 || uStarL.w > 0.0) ? diagram(rd) : vec4(0.0);
  // The diagram, drawn. By day each bright thing is a point of the bare sheet left in a soft
  // wash of the place's pigment (that is how light is painted on a light ground), and the
  // lines are fine lines of the same pigment.
  c = mix(c, c * mix(vec3(1.0), uStarL.rgb, 0.8), clamp(0.9 * dg.x + 0.24 * dg.w, 0.0, 1.0) * uStarC.w);
  c = mix(c, vec3(1.0), dg.y * min(uStarC.w * 1.3, 1.0));
  c = reveal(c, uRo + rd * (150.0 / lxz), sc * 60.0);
  // Light itself is the one thing whiter than the paper. (Only where there is a sun: with
  // none its size is 0, and dividing by that leaves a black speck where it would have stood.)
  if (uSun.w > 0.0) c = mix(c, vec3(1.0), uSun.w * (0.75 * smoothstep(uSun.z, uSun.z * 0.55, sunAng) + 0.4 * exp(-sunAng * sunAng / (uSun.z * uSun.z * 7.0))));

  // Weather that was asked for: mist takes the low sky; rain and snow lay a grey wash over all of it, uneven as any wash.
  if (uWx.x + uWx.y + uWx.z > 0.0) {
    float over = 0.9 + 0.2 * fbm(rd.xz / (1.0 + max(rd.y, -0.3)) * 2.6 + uSeed);
    c *= mix(vec3(1.0), vec3(0.83, 0.87, 0.92) * over, uWx.y);
    c *= mix(vec3(1.0), vec3(0.84, 0.87, 0.94) * over, uWx.z);
    c = mix(c, uHaze, uWx.x * (0.35 + 0.6 * smoothstep(0.75, 0.0, rd.y / lxz)));
  }
  // 6 留白: the night floods out from the brush tip; the moon and the title stay bare paper.
  if (uNight >= 0.0) {
    // (Walked live the night comes all the way round the sky: then it is laid out on the sky itself,
    // not on bearing and height, which has a seam behind us.)
    bool wide = uDusk >= 0.0;
    vec2 M = wide ? rd.xz / (1.0 + max(rd.y, -0.3)) * 2.0 + 3.0 : sc * 1.4;
    float hgt = 0.8 - sc.y * 1.45;                          // 0 high in the sky … 1 at the horizon
    float n1 = fbm(M * 7.0 + uSeed) - 0.5, n2 = fbm(M * 34.0 + uSeed * 2.1) - 0.5;
    // One wash run into another while both were wet: the boundary between them wanders,
    // and where the later wash pushed pigment ahead of it there is a darker tide line.
    vec2 wv = vec2(fbm(M * 2.1 + uSeed), fbm(M * 2.1 + uSeed + 7.3)) - 0.5;
    float run = fbm(M * vec2(3.0, 5.5) + wv * 2.4 + 3.0) - 0.5;
    float h2 = hgt + run * 0.42 + wv.y * 0.22;
    vec3 night = mix(vec3(0.106, 0.196, 0.520), vec3(0.345, 0.275, 0.700), smoothstep(0.16, 0.50, h2));     // ultramarine into violet
    night = mix(night, vec3(0.560, 0.410, 0.790), smoothstep(0.46, 0.68, h2) * 0.85);
    night = mix(night, vec3(0.945, 0.560, 0.690), smoothstep(0.60, 0.88, hgt + run * 0.14 + (fbm(M * 3.1 + 4.0) - 0.5) * 0.12));   // rose at the horizon
    float tide = smoothstep(0.03, 0.0, abs(fract(h2 * 2.6 + wv.x) - 0.5)) * smoothstep(0.75, 0.3, hgt);
    night *= 1.0 - 0.16 * tide;
    night *= 0.86 + 0.24 * fbm(M * 5.0 + wv * 3.0 + 2.0);                                                  // the wash is never even
    night *= 1.0 - 0.10 * smoothstep(0.55, 0.8, vnoise(M * 150.0));                                         // granulation
    vec3 td = vec3(sin(uTip.x) * cos(uTip.y), sin(uTip.y), cos(uTip.x) * cos(uTip.y));
    float s = uNight * 2.8 * (1.0 + 0.5 * n1 + 0.12 * n2) - (wide ? acos(clamp(dot(rd, td), -1.0, 1.0)) * 1.4 : length(M - uTip * 1.4));
    float edge = smoothstep(-0.004, 0.004, s) * (1.0 - smoothstep(0.004, 0.04, s));
    vec3 md = vec3(sin(uMoon.x) * cos(uMoon.y), sin(uMoon.y), cos(uMoon.x) * cos(uMoon.y));
    float dm = acos(clamp(dot(rd, md), -1.0, 1.0)) - uMoon.z;
    vec2 tuv = vec2((sc.x - uTitleBox.x) / uTitleBox.z + 0.5, 0.5 - (sc.y - uTitleBox.y) / uTitleBox.w);
    float title = (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) ? textureLod(uTitle, tuv, max(0.0, log2(256.0 / (uTitleBox.w * uLens.x * uRes.y)) - 0.5)).r : 0.0;
    float bare = smoothstep(0.0, 0.0016, dm + n2 * 0.002) * (1.0 - smoothstep(0.25, 0.6, title));
    float rim = exp(-dm * dm / 0.00002) * step(0.0, dm);    // pigment gathers against the mask
    float a = smoothstep(-0.006, 0.012, s) * bare * (1.0 - salt(M));
    night = mix(night, night * 1.5 + vec3(0.03, 0.0, 0.05), 0.5 * smoothstep(0.52, 0.8, fbm(M * 2.3 + wv * 1.5 + 11.0)) * smoothstep(0.75, 0.35, hgt));      // blooms of a lighter wash, where water was dropped into it
    night = mix(night, vec3(1.0), 0.16 * (1.0 + 0.7 * uWx.w) * exp(-max(dm, 0.0) / 0.2));                    // the night is lighter round the moon
    c = mix(c, c * night * (1.0 - 0.22 * rim) * (1.0 - 0.15 * edge) / uPaper, a);
    // Where the night has come the diagram is light.
    c = mix(c, vec3(1.0), clamp((max(0.9 * dg.x, dg.y) + 0.5 * dg.z + 0.16 * dg.w) * (1.0 + 0.5 * uWx.w), 0.0, 1.0) * uStarL.w * a);
  } else if (uStarL.w > 0.0) c = mix(c, vec3(1.0), clamp(max(0.6 * dg.x, dg.y) + 0.3 * dg.z, 0.0, 1.0) * uStarL.w);
  return c;
}
// How closely something stands over this point of the ground: the dark that gathers where
// a column meets the floor.
float groundShade(vec3 g, float dist) {
  float rad = clamp(0.45 / wppAt(dist), 3.0 * PXS, 40.0 * PXS), occ = 0.0;
  float turn = hash21(gl_FragCoord.xy + uJit * 43.0) * 6.2832;
  for (int i = 0; i < 6; i++) {
    float a = turn + float(i) * 1.0472;
    vec2 at = (gl_FragCoord.xy + vec2(cos(a), sin(a) * 0.6 + 0.5) * rad * (0.4 + 0.6 * fract(float(i) * 0.618))) / uRes;
    if (texture(uGA, at).a <= 0.0) continue;
    vec3 q = texture(uGP, at).xyz;
    occ += smoothstep(0.7, 0.1, length(q.xz - g.xz)) * smoothstep(0.9, 0.0, q.y);
  }
  return clamp(occ / 3.0, 0.0, 1.0);
}
vec3 ground(vec3 g, float dist, float graze) {
  vec3 c = mix(uGndNear, uGndFar, 1.0 - exp(-dist * 0.012));
  c *= 1.0 + uGndVar * (fbm(g.xz * 0.21 + uSeed) - 0.5) * 0.12;
  if (uGuide.w > 0.0) c *= 1.0 + (fbm(g.xz * 4.0) - 0.5) * 0.035 + (vnoise(g.xz * 55.0) - 0.5) * 0.025 * smoothstep(0.02, 0.004, wppAt(dist));   // the sheet's own tooth
  if (uGuide.w <= 0.0) {
    // The ground is laid in with a broad brush: long strokes one way, and the hairs of the brush inside them.
    float wg = wppAt(dist) / max(graze, 0.04);
    vec2 q = vec2(g.x * 0.5 - g.z * 0.866, g.x * 0.866 + g.z * 0.5);
    c *= 1.0 + 0.075 * (vnoise(vec2(q.x * 2.1, q.y * 0.17) + uSeed) - 0.5) * smoothstep(0.3, 0.07, wg) + 0.05 * (vnoise(vec2(q.x * 19.0, q.y * 1.2)) - 0.5) * smoothstep(0.035, 0.009, wg);
  }
  if (uWx.z > 0.0) c = mix(c, vec3(0.985, 0.99, 1.0), uWx.z * (0.6 + 0.3 * fbm(g.xz * 0.35 + 2.0)));      // snow lies on it: the sheet left bare
  if (uLight.w > 0.0) {
    // A shadow is a second wash laid over the ground: cooler, and uneven like any wash.
    float sh = shadowAt(g + vec3(fbm(g.xz * 1.7) - 0.5, 0.0, fbm(g.xz * 1.7 + 8.0) - 0.5) * 0.22, vec3(0.0, 1.0, 0.0));
    float lip = sh * (1.0 - sh) * 4.0;                       // the edge of the wash, where it dried last
    c *= mix(vec3(1.0), uShadeTint * vec3(0.90, 0.91, 0.93) * (0.95 + 0.10 * fbm(g.xz * 0.6 + 4.0)), uLight.w * min(sh + 0.12 * lip, 1.0));
  }
  c *= 1.0 - 0.3 * groundShade(g, dist);
  c *= mix(vec3(1.0), vec3(0.90, 0.92, 0.95), uWx.y);                                       // wet
  float far = 1.0 - exp(-dist * uFog), dk = duskOf();
  c = reveal(mix(c, uHaze, far), g, g.xz);
  c = farWash(c, far);
  c = mix(c * nightGround(), hazeNow(), far * dk);            // (night after the colour has come back or not: ground the colour never reached is bare paper, and that is not dark)
  return marks(c, g, dist, graze);
}
// The lake: the world upside down (painted beforehand into uRefl with the same camera),
// broken by ripples and by the rings of the rain.
vec3 water(vec3 g, vec3 rd, float dist) {
  vec2 w = g.xz;
  float calm = 1.0 / (1.0 + dist * 0.02);
  vec2 rip = vec2(vnoise(w * vec2(0.6, 2.2) + vec2(uClock * 0.3, uClock * 0.1)), vnoise(w * vec2(0.5, 1.8) - vec2(uClock * 0.22, 0.0) + 7.0)) - 0.5;
  float ring = rings(w);
  for (int i = 0; i < 8; i++) {                               // where the fleck touched the water
    if (i >= uWakeN) break;
    float age = uClock - uWake[i].z;
    if (age <= 0.0 || age > 4.5) continue;
    float d = length(w - uWake[i].xy), rr = 0.2 + 1.7 * age, wd = 0.07 + 0.06 * age;
    ring += uWake[i].w * (smoothstep(wd, 0.0, abs(d - rr)) + 0.6 * smoothstep(wd, 0.0, abs(d - rr * 0.55))) * (1.0 - age / 4.5) * smoothstep(0.0, 0.12, age);
  }
  ring = min(ring, 1.5);
  vec2 ruv = gl_FragCoord.xy / uRes + vec2(rip.x * 0.016, rip.y * 0.030 + ring * 0.02) * (0.25 + calm);
  vec3 refl = texture(uRefl, clamp(ruv, 0.001, 0.999)).rgb;
  vec3 base = mix(uGndNear, uGndFar, 1.0 - exp(-dist * 0.02)) * nightGround();
  vec3 c = mix(base, refl * vec3(0.93, 0.97, 0.98), 0.45 + 0.45 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 4.0));
  c = mix(c, c * vec3(0.86, 0.93, 0.95), ring);
  return farWash(reveal(mix(c, hazeNow(), 1.0 - exp(-dist * uFog)), g, w), 1.0 - exp(-dist * uFog));
}
// The country far below the summit: fields laid in with long strokes of a flat brush,
// woods, and a pale lake with a sandy shore.
vec3 landColor(vec3 p) {
  vec2 w = p.xz;
  float f1 = fbm(w * 0.006 + 3.0), f2 = fbm(w * 0.021 + 9.0);
  vec3 c = mix(vec3(0.71, 0.78, 0.46), vec3(0.45, 0.61, 0.34), smoothstep(0.35, 0.68, f1));
  c *= 0.86 + 0.28 * vnoise(vec2(dot(w, vec2(0.8, 0.6)) * 0.011, dot(w, vec2(-0.6, 0.8)) * 0.085));
  c = mix(c, vec3(0.25, 0.41, 0.28), smoothstep(0.57, 0.66, f2) * 0.85);
  // Fields in flower, here and there (yellow, and a lilac), and the grass never one even green.
  float open = 1.0 - smoothstep(0.55, 0.62, f2);
  c = mix(c, vec3(0.90, 0.80, 0.42), smoothstep(0.63, 0.68, fbm(w * 0.012 + 40.0)) * 0.6 * open);
  c = mix(c, vec3(0.74, 0.66, 0.84), smoothstep(0.66, 0.71, fbm(w * 0.015 + 71.0)) * 0.5 * open);
  c *= 0.93 + 0.14 * fbm(w * 0.08 + 5.0);
  float lake = 1.0 - length((w - vec2(-250.0, 520.0)) / vec2(250.0, 130.0)) + (fbm(w * 0.011 + 1.0) - 0.5) * 0.45;
  c = mix(c, vec3(0.93, 0.86, 0.72), smoothstep(-0.07, -0.01, lake) * 0.8);
  c = mix(c, mix(vec3(0.80, 0.89, 0.88), vec3(0.93, 0.93, 0.88), smoothstep(0.0, 0.5, lake)), smoothstep(-0.01, 0.02, lake));
  return c;
}
// Past where the modelled land ends it carries on as a plane.
vec3 land(vec3 g, float dist) {
  vec3 c = landColor(g);
  if (uWx.z > 0.0) c = mix(c, vec3(0.975, 0.98, 0.99), uWx.z * (0.55 + 0.3 * fbm(g.xz * 0.02 + 2.0)));
  float dusk = duskOf();
  if (uDusk >= 0.0) return farWash(mix(nightThing(c, dusk), hazeNow(), 1.0 - exp(-dist * uFog)), 1.0 - exp(-dist * uFog));
  c = mix(c, c * vec3(0.80, 0.70, 0.78), dusk);
  return mix(c, mix(uHaze, vec3(0.910, 0.663, 0.627), dusk * 0.7), 1.0 - exp(-dist * uFog));
}

// ---- meshes ---------------------------------------------------------------------------
// What lies round this pixel in the G-buffer: is it on an outline (line), on a fold of the
// same thing (crease), and how much of its neighbourhood is something else (pool: pigment
// gathers there). Lines are put on one side of an edge only, so they stay a pixel wide.
void edges(vec2 guv, vec3 p, vec3 n, float id, float dist, out float line, out float crease, out float pool, out float shut) {
  line = 0.0; crease = 0.0; pool = 0.0; shut = 0.0;
  float thr = 0.004 * dist + 0.004;
  vec2 px = 1.0 / uRes;
  float order = n.x + n.y * 0.61 + n.z * 0.37;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = i < 4 ? fi * 1.5708 : (fi - 4.0) * 0.7854 + 0.39;
    vec2 at = guv + vec2(cos(a), sin(a)) * (i < 4 ? 1.0 : 5.0) * px * PXS;
    vec4 Nn = texture(uGN, at);
    bool sil = Nn.w <= 0.0, flush = false;
    if (!sil) {
      vec3 q = texture(uGP, at).xyz;
      float plane = abs(dot(q - p, n));
      sil = plane > thr && distOf(q) > dist;                 // it lies behind this surface
      flush = plane <= thr * 3.0;                            // it carries on from this surface
    }
    bool other = flush && abs(Nn.w - id) > 0.003;
    if (i < 4) {
      if (sil) line = 1.0;
      else if (other) { if (Nn.w > id) line = max(line, 0.7); }
      else if (flush && dot(Nn.xyz, n) < 0.6 && Nn.x + Nn.y * 0.61 + Nn.z * 0.37 > order) crease = 1.0;
    } else if (sil || other) pool += 0.125;
  }
  // How shut-in the point is by what stands near it (a corner, a joint, the foot of a wall):
  // less light gets there, and a wash dries darker in a hollow.
  float rad = clamp(0.7 / wppAt(dist), 5.0 * PXS, 60.0 * PXS);
  float turn = hash21(gl_FragCoord.xy + uJit * 31.0) * 6.2832;
  for (int i = 0; i < 8; i++) {
    float a = turn + float(i) * 0.7854;
    vec2 at = guv + vec2(cos(a), sin(a)) * rad * (0.3 + 0.7 * fract(float(i) * 0.618 + 0.2)) * px;
    if (texture(uGA, at).a <= 0.0) continue;
    vec3 v = texture(uGP, at).xyz - p;
    float dv = length(v);
    shut += max(dot(n, v) / (dv + 1e-3) - 0.12, 0.0) * smoothstep(1.6, 0.2, dv);
  }
  shut = clamp(shut / 8.0 * 2.4, 0.0, 1.0);
  if (uGround == 1) shut = max(shut, 0.55 * smoothstep(0.7, 0.0, p.y) * (1.0 - max(n.y, 0.0)));
}
// The marks of the hand at a place on a surface, by a coordinate across the form and one
// along it: x broad strokes, y the hairs of the brush inside them, z stains that have run
// (stone), w something between the two (the furrows of bark, the figure of wood).
// A set of straight strokes along v, about 1 / F apart across it: each has its own weight,
// and comes and goes along its length. (Never noise stretched one way: its strokes kink.)
float strokes(float u, float v, float F, float seed) {
  return (vnoise(vec2(u * F + seed, 3.7)) - 0.5) * (0.5 + 0.95 * vnoise(vec2(u * F * 0.31 + seed, v * 0.8)));
}
// The pencil's strokes keep about the same spacing on the picture however near the thing is
// (a fixed spacing in the world made a floor underfoot look like corrugated board): two sets
// an octave apart, one giving way to the other. px: the spacing in pixels.
float pencil(float u, float v, float wpx, float px, float seed) {
  float l = log2(clamp(1.0 / (px * wpx), 10.0, 420.0)), o = floor(l), f = exp2(o);
  return mix(strokes(u, v, f, seed + 1.7 * o), strokes(u, v, 2.0 * f, seed + 1.7 * (o + 1.0)), fract(l));
}
vec4 handAt(float across, float along, float id) {
  return vec4(strokes(across, along, 7.0, id * 31.0), strokes(across, along, 31.0, id * 7.0 + 5.0),
              fbm(vec2(across * 1.6 + id * 7.0, along * 0.22)),
              strokes(across + 0.05 * sin(along * 0.9 + id * 20.0), along, 12.0, id * 3.0));
}
vec3 shadeMesh(vec3 p, vec3 n, vec3 alb, float id, int kind, float course, float dist, vec2 guv, bool fig) {
  float line = 0.0, crease = 0.0, pool = 0.0, shut = 0.0;
  if (uMirror < 0.5) edges(guv, p, n, id, dist, line, crease, pool, shut);

  // How each kind of thing takes the light and the brush:
  // response to light, thinnest and fullest wash, unevenness, pooling, ink.
  float kLit = 1.0, dThin = 0.30, dFull = 1.30, kBloom = 0.70, kPool = 0.40, kLine = 0.75;                     // stone
  if (kind == 2) { kLit = 0.55; dThin = 0.55; dFull = 1.25; kBloom = 0.9; kPool = 0.6; kLine = 0.2; }          // foliage
  else if (kind == 3) { kLit = 0.85; dThin = 0.86; dFull = 1.5; kBloom = 0.1; kPool = 0.5; kLine = 0.45; }      // the cloak: its washes are painted on the cloth
  else if (kind == 7) { kLit = 0.45; dThin = 0.75; dFull = 1.2; kBloom = 0.1; kPool = 0.45; kLine = 0.3; }     // hair
  else if (kind == 4) { kLit = 0.75; dThin = 0.5; dFull = 2.4; kBloom = 0.15; kPool = 0.5; kLine = 0.85; }     // pale
  else if (kind == 5) { kLit = 0.8; dThin = 0.72; dFull = 1.3; kBloom = 0.5; kPool = 0.3; kLine = 0.5; }       // dark
  else if (kind == 6) { kLit = 0.6; dThin = 0.72; dFull = 1.22; kBloom = 0.55; kPool = 0.25; kLine = 0.15; }   // terrain
  else if (kind == 8) { kLit = 0.6; dThin = 0.55; dFull = 1.3; kBloom = 0.5; kPool = 0.3; kLine = 0.4; }       // plants
  else if (kind == 10) { kLit = 0.8; dThin = 0.6; dFull = 1.5; kBloom = 0.35; kPool = 0.45; kLine = 0.55; }    // cloth

  float sh = shadowAt(p, n);
  float key = smoothstep(-0.25, 0.4, dot(n, uLight.xyz)) * (1.0 - sh);
  float fill = 0.5 + 0.5 * dot(n, uFill);
  float light = mix(0.55, clamp(0.68 * key + 0.40 * fill * fill + 0.10 * max(-n.y, 0.0) - 0.32 * shut, 0.0, 1.0), kLit);
  // Where the light grazes an edge turned towards it, it flares.
  vec3 eye = uRo - p;
  if (uMirror > 0.5) eye.y = -uRo.y - p.y;
  float rim = pow(1.0 - max(dot(n, normalize(eye)), 0.0), 3.0) * smoothstep(-0.3, 0.35, dot(n, uLight.xyz)) * (1.0 - sh) * uLight.w;
  rim *= clamp(pool * 2.5, 0.0, 1.0);                          // an edge, not a whole floor seen at a slant

  // Each stone has its own strength of wash.
  float own = hash21(vec2(id * 91.7, id * 13.3)) - 0.5;
  if (kind == 6 && course > 0.5) alb = landColor(p);
  if (kind == 1 && course > 0.0 && abs(n.y) < 0.7) {
    // Masonry drawn on a wall that was built in one piece: courses, with the joints staggered.
    float row = p.y / course;
    float u = (abs(n.z) > abs(n.x) ? p.x : p.z) / (course * 2.3) + 0.5 * floor(row) + 0.31 * hash21(vec2(floor(row), 7.0));
    float wpp = wppAt(dist);
    float joint = min(abs(fract(row + 0.5) - 0.5) * course, abs(fract(u + 0.5) - 0.5) * course * 2.3);
    line = max(line, 0.5 * smoothstep(1.3 * wpp + 0.012, 0.4 * wpp, joint) * smoothstep(110.0, 40.0, dist * 0.5));
    own = hash21(vec2(floor(row), floor(u)) + id * 31.0) - 0.5;
  }

  // The brush lays washes, not gradients: a pale one over everything, a second where the
  // form turns from the light, a third in the deep shade. Their edges are firm but wander,
  // and pigment gathers just inside each edge.
  float wander = fbm3(p * 0.7 + id * 5.0) - 0.5, fine = fbm3(p * 2.3 + 3.0) - 0.5;
  float l2 = light + wander * 0.2 + fine * 0.07;
  float w1 = 1.0 - smoothstep(0.42, 0.47, l2), w2 = 1.0 - smoothstep(0.24, 0.29, l2);
  float tide = smoothstep(0.34, 0.42, l2) * (1.0 - smoothstep(0.42, 0.47, l2)) + 0.7 * smoothstep(0.17, 0.24, l2) * (1.0 - smoothstep(0.24, 0.29, l2));
  float d = mix(mix(dFull, dThin, light), dThin + (dFull - dThin) * (0.6 * w1 + 0.4 * w2), 0.78) + 0.10 * tide * kLit;
  d += 0.38 * shut * kLit;
  d *= 1.0 - 0.7 * rim;
  // Within a wash the pigment is never even: backruns where wet met wet, each with its own
  // paler heart and darker lip.
  vec3 q = p * 0.26 + id * 17.0;
  q += (vec3(fbm3(q + 1.7), fbm3(q + 9.2), fbm3(q + 5.3)) - 0.5) * 1.6;
  float run = fbm3(q) - 0.5;
  d *= 1.0 + kBloom * (0.9 * run + 0.35 * fine + 0.5 * own + 0.25 * smoothstep(0.03, 0.0, abs(run)) * step(0.0, run));
  // The hand in it. A wash is put on with a brush, and the brush shows: broad strokes that
  // follow the form (up a wall or a trunk, across a floor), the hairs of the brush inside
  // them, and here and there the brush running dry so that the paper shows through. Then
  // what the thing is made of: stains run down stone and it cracks; wood has its grain
  // along its length; bark is furrowed; foliage is dabbed on. All of it fades with distance,
  // before it is finer than the picture can hold. (course: above 0 masonry, -1 wood, -2 bark.)
  float wpx = wppAt(dist), near1 = smoothstep(0.05, 0.014, wpx), near2 = smoothstep(0.013, 0.004, wpx), dry = 0.0;
  vec2 pen = vec2(0.0);                                        // the pencil's strokes on this thing, for the underdrawing
  // A crack is one level line of a slow noise, shaken a little (taken out here for its derivative).
  float crv = vnoise3((p + fine * vec3(0.5, 0.3, -0.4)) * 0.3 + id * 3.0) - 0.5, crw = fwidth(crv);
  if (near1 > 0.0 && !fig && uMirror < 0.5) {
    bool upright = abs(n.y) < 0.75;
    float wx = n.x * n.x / max(n.x * n.x + n.z * n.z, 1e-4);
    float wpe = wpx / max(abs(dot(n, normalize(eye))), 0.25);      // a pixel's size on the surface itself, seen at a slant
    vec4 H;
    if (upright) {
      H = wx * handAt(p.z, p.y, id) + (1.0 - wx) * handAt(p.x, p.y, id);
      pen = vec2(wx * pencil(p.z, p.y, wpe, 2.6, id) + (1.0 - wx) * pencil(p.x, p.y, wpe, 2.6, id + 3.0), pencil(p.y, p.x + p.z, wpe, 3.4, id + 9.0));
    } else {
      // Lying flat: a plank's grain runs its length; anything else is brushed one way, aslant.
      vec2 f = kind == 1 && course < -0.5 ? p.xz : vec2(p.x * 0.5 - p.z * 0.866, p.x * 0.866 + p.z * 0.5);
      H = handAt(f.x, f.y, id);
      // No strokes on what lies flat: those that run away from the eye are seen at their full
      // width and those across it are pressed together. The graphite's tooth instead.
      float l = log2(clamp(1.0 / (3.0 * wpx), 10.0, 420.0)), o = floor(l);
      pen = vec2(0.55 * (mix(vnoise3(p * exp2(o) + o * 7.3), vnoise3(p * exp2(o + 1.0) + (o + 1.0) * 7.3), fract(l)) - 0.5), 0.0);
    }
    // On a face only a few pixels across (the edge of a paving stone, the riser of a step) strokes
    // are the teeth of a comb: let them go where an edge is close on every side.
    float open = 1.0 - smoothstep(0.1, 0.45, pool);
    H *= open;
    pen *= smoothstep(0.03, 0.012, wpe) * (upright ? open : 1.0);
    float tex = 0.0;
    if (kind == 1 && course >= 0.0) {
      // Stone: the pigment settles in grains and in soft patches; down its faces stains have run;
      // and here and there, a crack. No strokes across a floor: seen at a slant they are the grain of wood.
      tex = 0.2 * (vnoise3(p * 6.0 + id * 5.0) - 0.5) * near1 + 0.3 * (smoothstep(0.3, 0.8, vnoise3(p * 45.0)) - 0.5) * smoothstep(0.008, 0.003, wpx);
      if (upright) {
        tex += 0.34 * smoothstep(0.52, 0.78, H.z) * near1 + 0.14 * H.x * near1;
        dry = smoothstep(0.16, 0.34, H.y) * near2;
      }
      float gate = smoothstep(0.6, 0.72, vnoise3(p * 0.3 + id * 11.0));
      line = max(line, 0.45 * smoothstep(1.5 * crw, 0.5 * crw, abs(crv)) * gate * smoothstep(0.05, 0.02, crw) * smoothstep(0.03, 0.012, wpx));
    } else {
      tex = 0.3 * H.x * near1 + 0.24 * H.y * near2;
      dry = smoothstep(0.16, 0.34, H.y) * near2;
      if (kind == 1) {
        tex += 0.5 * H.y * near2 + 0.45 * H.w * near1;                                    // wood: its grain, along its length
        dry *= 0.5;
      } else if ((kind == 5 || kind == 4) && course < -1.5) {
        tex += (kind == 5 ? 0.7 : 0.48) * smoothstep(0.07, 0.012, abs(H.w)) * near1 + 0.14 * H.y * near2;        // bark: furrows
      } else if (kind == 2) {
        tex = 0.5 * (smoothstep(0.42, 0.58, vnoise3(p * 3.0 + id * 17.0)) - 0.5) * near1 + 0.3 * (vnoise3(p * 8.5 + 3.0) - 0.5) * near2;   // foliage: dabbed on
        dry = 0.0; pen *= 0.4;
      } else if (kind == 9 || kind == 6 || kind == 8) { tex *= 0.3; dry = 0.0; pen *= 0.4; }
    }
    d *= 1.0 + tex;
  }
  // Salt thrown into the wet wash of a pale stone: a few small stars where it drew the pigment away.
  if (kind == 1) d *= 1.0 - 0.3 * smoothstep(0.86, 0.90, vnoise3(p * 13.0 + id * 40.0)) * smoothstep(60.0, 15.0, dist) * smoothstep(0.45, 0.6, lum(alb));
  d *= mix(0.78, 1.0, smoothstep(0.0, 5.0, p.y));              // thinner near the ground, where the light comes back up
  // Against an edge: pigment pools on the shaded side; on the lit side the brush stops
  // short and leaves a sliver of paper.
  d += kPool * pool * (1.0 - 1.9 * key);
  vec3 T = clamp(alb / uPaper, 0.03, 1.0);
  vec3 c = uPaper * pow(T, vec3(max(d, 0.04)));
  c *= mix(uShadeTint, vec3(1.0), smoothstep(0.08, 0.5, light));
  c *= mix(vec3(1.03, 1.0, 0.95), vec3(0.96, 0.99, 1.04), smoothstep(-0.2, 0.2, wander));     // the pigments part company a little
  c = mix(c, vec3(1.0), 0.5 * rim);
  c = mix(c, uPaper, 0.2 * dry * smoothstep(0.3, 0.65, light));                           // dry brush, where the light is

  if (!fig && uWx.z > 0.0) {
    // Snow lies on whatever faces the sky: the sheet left bare there, a shade cooler where it turns from the light.
    float lie = smoothstep(0.42, 0.78, n.y + 0.3 * (vnoise3(p * 1.3 + 5.0) - 0.5)) * uWx.z;
    c = mix(c, vec3(0.985, 0.99, 1.0) * mix(vec3(0.90, 0.93, 0.98), vec3(1.0), smoothstep(0.2, 0.7, light)), 0.92 * lie);
  }
  if (!fig) c *= mix(vec3(1.0), vec3(0.91, 0.93, 0.96), uWx.y);                           // wet
  // Ink: outlines always, folds only where they are large enough on screen to be read.
  // The line is drawn by hand: it swells, thins and now and then lifts off the paper.
  float hand = smoothstep(0.18, 0.5, vnoise3(p * 3.1 + 2.0)) * (0.55 + 0.45 * vnoise3(p * 11.0));
  float ln = max(line, crease * 0.26 * smoothstep(60.0, 12.0, dist)) * hand;
  vec3 ink = uPaper * pow(T, vec3(2.4)) * 0.72;
  if (kind == 4) ink = mix(ink, vec3(0.42, 0.40, 0.42), 0.55);          // pale things are held by their outline
  c = mix(c, ink, ln * kLine * smoothstep(300.0, 40.0, dist));

  float clear = exp(-dist * uFog);
  c = mix(c, uHaze, 1.0 - clear);
  if (fig) return c;
  // What stands in the cloud is lost in it before it reaches the cloud's surface.
  bool late = uDusk >= 0.0;        // walked live, night is laid on first and the lamps lit over it (in the film no lamp stands where night falls)
  float dusk = duskOf();
  if (late && uNight >= 0.0) {
    c = nightThing(c, dusk);
    c = mix(c, vec3(0.80, 0.58, 0.66), dusk * 0.4 * (1.0 - clear));
  }
  if (uCloud.z > 0.5) c = mix(c, vec3(1.0, 0.995, 0.975) * nightCloud(), 0.9 * smoothstep(uCloud.x + 5.0, uCloud.x - 1.0, p.y + 1.5 * (fbm3(p * 0.4) - 0.5)));
  gPencil = (0.07 + 0.24 * (1.0 - smoothstep(0.15, 0.75, light)) + 0.10 * ln) * clear * (kind == 6 ? 0.4 : 1.0);
  gMesh = vec3(1.0, pen);
  c = farWash(reveal(c, p, p.xy + p.z * vec2(0.37, 0.11)), 1.0 - clear);
  gPencil = 0.0; gMesh = vec3(0.0);
  if (kind == 9) {
    // A lamp, once it has been lit: light, which is whiter than the paper, warm at its edge.
    float on = smoothstep(course, course + 0.7, uT) * (0.9 + 0.1 * sin(uClock * 7.0 + id * 40.0));
    c = mix(c, mix(vec3(1.0, 0.93, 0.74), vec3(1.0), smoothstep(0.1, 0.75, max(dot(n, normalize(uRo - p)), 0.0))), on * max(clear, 0.6 * dusk));
  }
  if (!late && uNight >= 0.0) {
    // Night comes down on everything that stands in the country, not on the ground only
    // (trees stayed day-green on a dusk-brown land).
    c = mix(c, c * (kind == 6 ? vec3(0.80, 0.70, 0.78) : vec3(0.60, 0.55, 0.72)), dusk);
    c = mix(c, vec3(0.910, 0.663, 0.627), dusk * 0.5 * (1.0 - clear));
  }
  return c;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 s = ((frag + uJit) / uRes - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 rd = normalize(uF * uLens.x + uR * s.x + uU * s.y);
  bool mirror = uMirror > 0.5;
  vec3 col = skyColor(mirror ? vec3(rd.x, -rd.y, rd.z) : rd);
  float tS = 1e6;                                             // how far away the thing drawn at this pixel is
  if (!mirror && rd.y < -1e-4) {
    if (uLand.y > 0.5) { float t = (uLand.x - uRo.y) / rd.y; col = land(uRo + rd * t, t); tS = t; }
    if (uGround > 0) {
      float t = -uRo.y / rd.y;
      vec3 g = uRo + rd * t;
      col = uGround == 2 ? water(g, rd, t) : ground(g, t, -rd.y);
      tS = t;
    }
  }

  // The meshes. A hand does not draw an edge dead straight: the G-buffer is read a pixel
  // or two off, by an amount fixed to the thing being drawn so that it does not swim.
  float k0 = texture(uGA, frag / uRes).a;
  vec3 anchor = k0 > 0.0 ? texture(uGP, frag / uRes).xyz : rd * 30.0;
  vec2 wob = (vec2(vnoise3(anchor * 1.1 + uSeed), vnoise3(anchor * 1.1 + uSeed + 31.7)) - 0.5) * 2.4
           + (vec2(vnoise3(anchor * 5.0 + 3.0), vnoise3(anchor * 5.0 + 17.0)) - 0.5);
  int kHere = int(mod(k0 * 32.0 + 0.5, 16.0));
  wob *= PXS;
  if (kHere == 2) wob *= 1.6;                                  // foliage is put down wet: its edge runs
  if (k0 * 32.0 > 15.5) wob *= 0.55;                           // the traveller is drawn with a steadier hand
  vec2 guv = (frag + wob) / uRes;
  vec4 A = texture(uGA, guv);
  bool fig = false;
  if (A.a > 0.0) {
    vec4 N = texture(uGN, guv), P = texture(uGP, guv);
    float dm = distOf(P.xyz);
    if (dm < tS) {
      int kind = int(A.a * 32.0 + 0.5);
      fig = kind >= 16;
      if (fig) kind -= 16;
      vec3 mc = shadeMesh(P.xyz, normalize(N.xyz), A.rgb, N.w, kind, P.w, dm, guv, fig);
      float a = fig ? uFigB.x : 1.0;
      col = mix(col, mc, a);
      if (a > 0.5) tS = dm; else fig = false;
    }
  }

  if (uWispP.w > 0.0 && uWispP.y > 0.0 && tS < 1e5) {
    // What the fleck lights: whatever is near it is taken a step towards the bare paper.
    vec3 dw = uRo + rd * tS - uWisp[0].xyz;
    if (mirror) dw.y = -uRo.y - rd.y * tS - uWisp[0].y;
    col = mix(col, vec3(1.0, 0.995, 0.97), 0.3 * uWispP.w * exp(-dot(dw, dw) / (uWispP.y * uWispP.y)));
  }
  if (mirror) col = wisp(col, s, rd, tS, true);
  if (!mirror) {
    int n = int(uCloud.z + 0.5);
    for (int k = 7; k >= 0; k--) {                           // lowest (farthest) layer first
      if (k >= n) continue;
      float tk;
      vec4 cl = cloudAt(k, uRo, rd, tk);
      if (tk < 0.0 || tk > tS) continue;
      col = mix(col, cl.rgb, cl.a);
      if (cl.a > 0.6) { tS = tk; fig = false; }
    }
    if (uVol.z > 0.0) col = cloudVol(col, uRo, rd, tS);
    if (!fig && tS > uFigB.y - 1.0) col = ribbon(col);
    // Seen from inside the cloud there is nothing but white, thinning in wisps as the eye
    // comes up through the top of it.
    if (uCloud.z > 0.5) col = mix(col, vec3(1.0, 0.995, 0.975) * nightCloud(), 0.97 * smoothstep(uCloud.x + 0.9, uCloud.x - 2.4, uRo.y - 1.6 * (fbm(screen() * 2.6 + vec2(uClock * 0.35, 0.0)) - 0.5)));
    col = wisp(col, s, rd, tS, false);
    for (int i = 0; i < 8; i++) {
      if (i >= uSlabN) break;
      col = slab(col, int(uSlab[i].x + 0.5), uSlab[i].y, uSlab[i].z, uRo, rd, tS);
    }
    if (uWx.y + uWx.z > 0.003) col = weather(col, uRo, rd, tS);
    col = birds(col, tS);
    if (uShaft.x > 0.0 && uShadowP.x > 0.5) {
      // Light in the air. Where the ray runs through a shadow the air is a shade darker and
      // cooler; where it runs through light it is a shade whiter than the paper. Between a
      // row of columns or trunks that reads as beams.
      float lit = 0.0, wsum = 0.0, reach = min(tS, 75.0), jit = hash21(frag + uJit * 57.0);
      for (int i = 0; i < 16; i++) {
        float t = reach * (float(i) + jit) / 16.0;
        vec3 q = uRo + rd * t;
        vec3 c3 = (uShadowMat * vec4(q, 1.0)).xyz * 0.5 + 0.5;
        // The air right in front of the lens counts for little, or one near trunk darkens half the picture.
        float w = exp(-t * 0.03 - max(q.y, 0.0) * 0.05) * smoothstep(1.0, 9.0, t);
        bool outside = c3.x < 0.0 || c3.x > 1.0 || c3.y < 0.0 || c3.y > 1.0 || c3.z > 1.0;
        lit += w * (outside ? 1.0 : step(c3.z, texture(uShadow, c3.xy).r + uShadowP.z));
        wsum += w;
      }
      lit /= max(wsum, 1e-4);
      float thick = 1.0 - exp(-reach * 0.05);
      float toward = pow(max(dot(rd, uLight.xyz), 0.0), 3.0);
      col *= mix(vec3(1.0), mix(vec3(1.0), uShadeTint, 0.7) * 0.88, uShaft.x * thick * (0.45 + 0.55 * toward) * smoothstep(0.0, 0.8, 1.0 - lit));
      col = mix(col, vec3(1.0), uShaft.y * thick * toward * lit * lit);
    }
  }
  o = vec4(col, min(tS, 6.0e4));                               // the picture, and how far away what it shows is
}`;

// Depth of field. The painting carries each pixel's defocus in alpha (signed, so it also
// says which of two pixels is nearer). Taps on a spiral; a blurred thing in front spreads
// over what is behind it, and nothing behind spreads over something sharp in front.
export const DOF = `${HEAD}
uniform sampler2D uA;
uniform vec2 uRes;
uniform vec3 uLens;               // focal length, focus distance, blur at infinity (px)
uniform float uMax, uPhase;       // largest defocus in this frame (px); turn of the spiral for this sample
${NOISE}
float cocOf(float d) { return clamp(uLens.z * (1.0 - uLens.y / max(d, 0.01)), -40.0, 40.0); }      // px: negative in front of the focal plane
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 c0 = texture(uA, uv);
  if (uMax < 0.5) { o = c0; return; }
  float k0 = cocOf(c0.a), coc0 = abs(k0);
  vec3 acc = c0.rgb;
  float tot = 1.0;
  float turn = uPhase + hash21(gl_FragCoord.xy) * 6.2832;
  const int N = 44;
  for (int i = 0; i < N; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(N)) * uMax, a = fi * 2.399963 + turn;
    vec4 sm = texture(uA, uv + vec2(cos(a), sin(a)) * r / uRes);
    float ks = cocOf(sm.a), cs = abs(ks);
    if (ks > k0) cs = min(cs, coc0 * 2.0);
    float m = smoothstep(r - 0.5, r + 0.5, cs);
    acc += mix(acc / tot, sm.rgb, m);
    tot += 1.0;
  }
  o = vec4(acc / tot, c0.a);
}`;

// Two places → one picture. The film is one take through one world, but each place is
// painted by itself (its own sky, light and returning colour), with the same eye; here
// they are joined, pixel by pixel, by where things are (each picture carries, in alpha,
// how far away what it shows is):
//   4  across a plane in the world: whatever lies before the plane belongs to the place the
//      eye is in, whatever lies beyond it to the other; the two skies go over into each
//      other as the eye comes up to the plane and passes it
//   6  drawn outwards: the second place exists as far as uTr.z from a point on the ground
//      (uTr.xy), and beyond that there is only the first (the bare sheet)
//   5  one into the other (inside cloud, where both are white)
export const MIX = `${HEAD}
uniform sampler2D uA, uB;
uniform vec2 uRes;
uniform float uMix;       // 5: how far over
uniform int uType;        // 0: one place only
uniform vec4 uTr;         // 6: centre x, z; radius; the radius at which the sky follows
uniform vec4 uPlane;      // 4: the plane (n, w); negative on A's side
uniform vec2 uFar;        // 4, walked freely: how far off the join may be met and what lies beyond it still be shown (from, to; 0: always)
uniform vec4 uPortal;     // 4: how much of B there is yet; over what distance the skies change; how ragged the join is; how much of A is withheld when it is seen from B's side (walked freely: a place far behind us goes)
uniform vec3 uRo, uF, uR, uU;
uniform float uFocal;
uniform vec3 uEdge;       // pigment gathered at the front of what is being drawn
uniform vec3 uPaper;
uniform float uFade;      // fade to bare paper
uniform float uSeed;
${NOISE}
void main() {
  vec2 fuv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 a = texture(uA, fuv);
  vec3 col = a.rgb;
  if (uType == 5) col = mix(a.rgb, texture(uB, fuv).rgb, clamp(uMix, 0.0, 1.0));
  else if (uType == 4 || uType == 6) {
    vec4 b = texture(uB, fuv);
    vec2 s = (fuv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    vec3 rd = normalize(uF * uFocal + uR * s.x + uU * s.y);
    bool skyA = a.a > 5.0e4, skyB = b.a > 5.0e4;
    if (uType == 6) {
      // The world is drawn outwards from where the first drop fell, as a painter would do
      // it, in two fronts. First the pencil: ahead of the wash only what is darker than the
      // bare sheet shows, faintly (lines, the shade under things). Behind it the wash, and
      // its edge is a wet edge: lobed, as water runs on paper; a fine dark line where the
      // pigment has gathered at it; and just inside, the shine of water not yet dry.
      vec3 p = uRo + rd * min(b.a, 4000.0);
      vec2 v = p.xz - uTr.xy, dir = normalize(v + 1e-5);
      float R = uTr.z, r = skyB ? uTr.w : length(v);
      float lobes = 0.5 * (fbm(dir * 1.3 + uSeed) - 0.5) + 0.2 * (fbm(dir * 4.3 + 7.0 + R * 0.01) - 0.5)
                  + (0.06 * (fbm(p.xz * 0.9 + uSeed) - 0.5) + 0.02 * (fbm(p.xz * 5.0) - 0.5)) * min(1.0, 6.0 / max(R, 1.0) + 0.3);
      float sg = R * (1.0 + lobes) - r, fw = max(fwidth(r), 1e-4), ew = 1.1 * fw, sp = sg / fw;      // sp: how many pixels inside the wash's edge
      float k = smoothstep(-ew, ew, sg);
      float sg2 = R * (1.5 + 0.6 * lobes) + 0.5 - r, kp = smoothstep(-0.4 * R - 0.3, 0.0, sg2);
      float darker = clamp(1.0 - lum(b.rgb) / max(lum(a.rgb), 1e-3), 0.0, 1.0);
      col = a.rgb * (1.0 - 0.5 * kp * (1.0 - k) * smoothstep(0.2, 0.42, darker));
      col = mix(col, b.rgb, k);
      float tide = smoothstep(-1.0, 1.0, sp) * (1.0 - smoothstep(1.2, 4.0, sp));               // (bands measured in pixels: in world units they were terraces when seen at a slant)
      float wet = smoothstep(3.0, 9.0, sp) * (1.0 - smoothstep(9.0, 46.0, sp));
      float near = 1.0 - smoothstep(40.0, 170.0, R);
      col *= 1.0 - 0.16 * tide * near * (0.6 + 0.8 * fbm(p.xz * 3.0 + 2.0));
      col = mix(col, col * uEdge, 0.25 * tide * near);
      col = mix(col, vec3(1.0) - (vec3(1.0) - col) * 0.9, 0.35 * wet * near);
    } else {
      float side = dot(uPlane.xyz, uRo) + uPlane.w, den = dot(uPlane.xyz, rd);
      float tp = abs(den) > 1e-5 ? -side / den : -1.0;
      if (uPortal.z > 0.0 && tp > 0.0) {
        // A ragged join (the edge of a bank of cloud): the plane is moved by where it is met.
        vec3 q = uRo + rd * tp, tng = normalize(cross(uPlane.xyz, vec3(0.0, 1.0, 0.0)));
        tp = -(side + uPortal.z * 2.0 * (fbm(vec2(dot(q, tng) * 0.045, q.y * 0.03) + uSeed) - 0.5)) / den;
      }
      // (Where a ray meets the join a long way off, what lies beyond it is only haze by then, and
      // the other place's haze, not ours: a ruled edge up the sky where the join runs out of sight.
      // There it is let go, and our own place is seen.)
      float gone = uFar.y > 0.0 ? smoothstep(uFar.x, uFar.y, tp) : 0.0;
      if (skyA && skyB) col = mix(a.rgb, b.rgb, side < 0.0 ? smoothstep(-uPortal.y, uPortal.y, side) * uPortal.x : mix(smoothstep(-uPortal.y, uPortal.y, side), 1.0, uPortal.w));
      else if (side < 0.0) col = (tp < 0.0 || a.a < tp) ? a.rgb : mix(a.rgb, b.rgb, uPortal.x * (1.0 - gone));
      else col = (tp < 0.0 || b.a < tp) ? b.rgb : mix(a.rgb, b.rgb, max(uPortal.w, gone));
    }
  }
  o = vec4(mix(col, uPaper, uFade), 1.0);
}`;

// One sample added into the running average of the frame (motion blur).
export const ACCUM = `${HEAD}
uniform sampler2D uA;
uniform float uWeight;
void main() { o = texture(uA, vec2(vUv.x, 1.0 - vUv.y)) * uWeight; }`;

// The averaged picture, laid on paper: pigment settles into the tooth, so darker
// washes granulate more.
// What is brighter than the paper, spread: uDir is the step of one tap. The first of the
// passes (uCut 1) keeps only light; the rest go on spreading it.
export const GLOW = `${HEAD}
uniform sampler2D uA;
uniform vec2 uDir;
uniform float uCut;
${NOISE}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 acc = vec3(0.0);
  float tot = 0.0;
  for (int i = -5; i <= 5; i++) {
    float w = exp(-float(i * i) / 9.0);
    vec3 c = texture(uA, uv + uDir * float(i)).rgb;
    if (uCut > 0.5) c *= smoothstep(0.972, 1.0, lum(c));
    acc += c * w; tot += w;
  }
  o = vec4(acc / tot, 1.0);
}`;

// The averaged picture, seen through a lens and laid on paper. The lens is a real one: it
// bows straight lines a little, splits colour towards the corners, is darker there, veils
// and ghosts when it looks at the sun, has dust on it that the sun finds, takes a moment to
// find its exposure, carries drops of water when it has been in the rain or the cloud, and
// the film behind it has grain. uA and uGlow are held with y up.
export const FINISH = `${HEAD}
uniform sampler2D uA, uGrain, uGlow, uSoft;
uniform vec3 uPaper;
uniform vec2 uRes;
uniform float uFrame, uTime;
uniform vec4 uDream;     // a mist filter (light spreads into shade); the field going soft towards the corners; the grade; motes in the air
uniform vec4 uLensK;     // barrel distortion, colour fringing, darkening of the corners, grain
uniform vec4 uGlass;     // exposure (stops), drops on the glass 0 … 1, mist on it 0 … 1, how fast the drops run
uniform vec4 uSunS;      // the sun on the picture: x, y (picture heights from the centre), strength
uniform vec2 uSlip;      // which way the drops run
${NOISE}
float A;
vec2 uvOf(vec2 p) { return vec2(p.x / A + 0.5, p.y + 0.5); }
// Drops on the glass: xy how far what is behind is displaced, z how much of a drop is here, w its rim.
vec4 drops(vec2 p, float wet) {
  vec4 acc = vec4(0.0);
  if (wet <= 0.001) return acc;
  for (int l = 0; l < 3; l++) {
    float fl = float(l), cell = l == 0 ? 0.15 : l == 1 ? 0.075 : 0.036;
    vec2 q = p / cell + fl * 17.3 - (l == 2 ? vec2(0.0) : uSlip * uTime * uGlass.w * (l == 0 ? 1.0 : 0.35) / cell);
    if (l < 2) q.x += 0.35 * sin(q.y * 1.3 + fl * 4.0) ;                       // a drop that runs does not run straight
    vec2 id = floor(q), f = fract(q);
    vec2 h = hash22(id + 3.1);
    float keep = step(hash21(id + 9.7), wet * (l == 2 ? 0.3 : 0.4));
    float life = fract(uTime / (5.0 + 5.0 * h.x) + h.y * 7.0);
    float env = smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.75, 1.0, life));
    float r = (0.12 + 0.16 * hash21(id + 1.3)) * env * keep;
    if (r < 0.01) continue;
    vec2 d = (f - (0.5 + (h - 0.5) * 0.4)) * vec2(1.0, 0.82);                  // a little taller than wide
    float len = length(d) / r;
    if (len >= 1.0) continue;
    float m = smoothstep(1.0, 0.55, len);
    acc.xy += -d * cell * 1.7 * m * (0.4 + 0.6 * len);
    acc.z = max(acc.z, m);
    acc.w = max(acc.w, smoothstep(0.2, 0.8, len) * m * (0.5 + 0.5 * smoothstep(0.3, -0.6, d.y / r)));
  }
  return acc;
}
void main() {
  A = uRes.x / uRes.y;
  vec2 p = vec2((vUv.x - 0.5) * A, 0.5 - vUv.y);                               // picture heights from the centre, y up
  float r2max = (A * A + 1.0) * 0.25, r2 = dot(p, p);
  vec2 ps = p * (1.0 + uLensK.x * r2) / (1.0 + uLensK.x * r2max);
  vec4 dr = drops(p, uGlass.y);
  ps += dr.xy;
  float fr = uLensK.y * (r2 + 0.4 * dr.z);
  vec3 col = vec3(texture(uA, uvOf(ps * (1.0 + fr))).r, texture(uA, uvOf(ps)).g, texture(uA, uvOf(ps * (1.0 - fr))).b);
  vec3 glow = texture(uGlow, uvOf(ps)).rgb;
  col = vec3(1.0) - (vec3(1.0) - col) * (vec3(1.0) - 0.9 * glow);                                              // light spills over what it stands behind
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);                                                         // a little more depth in the darks
  // The dream. A mist filter before the lens: light spreads into whatever is darker beside
  // it, and nothing dark spreads; a veil of the picture's own light lies over everything;
  // and the field goes soft away from the middle, as with an old lens wide open.
  vec3 soft = texture(uSoft, uvOf(ps)).rgb;
  col = mix(col, max(col, soft), 0.5 * uDream.x);
  col = vec3(1.0) - (vec3(1.0) - col) * (vec3(1.0) - 0.2 * uDream.x * soft * soft);
  col = mix(col, soft, uDream.y * smoothstep(0.3, 1.0, r2 / r2max));
  // Motes in the air, near the lens and out of focus: they drift up, and each comes and goes.
  if (uDream.w > 0.0) {
    float m = 0.0;
    for (int l = 0; l < 3; l++) {
      float fl = float(l), cell = l == 0 ? 0.27 : l == 1 ? 0.17 : 0.11;
      vec2 q = (p + vec2(0.013 * sin(uTime * 0.31 + fl), uTime * (0.010 + 0.006 * fl)) * -1.0 + vec2(0.05 * sin(uTime * 0.13 + fl * 2.0), 0.0)) / cell + fl * 31.7;
      vec2 id = floor(q), h = hash22(id + 2.3);
      if (hash21(id + 8.1) > 0.3) continue;
      vec2 c = 0.2 + 0.6 * h + 0.08 * vec2(sin(uTime * 0.7 + h.x * 20.0), cos(uTime * 0.5 + h.y * 20.0));
      float rad = (0.06 + 0.1 * h.y) * (l == 0 ? 1.0 : 0.8), d = length(fract(q) - c);
      m += exp(-d * d / (rad * rad)) * (0.35 + 0.65 * smoothstep(-0.2, 0.8, sin(uTime * (0.5 + h.x) + h.y * 30.0))) * (l == 0 ? 0.6 : 1.0);
    }
    col = vec3(1.0) - (vec3(1.0) - col) * (vec3(1.0) - clamp(m, 0.0, 1.0) * uDream.w * 0.16 * vec3(1.0, 0.97, 0.9));
  }
  // The grade: the darks lifted a little towards lavender, the lights a breath warmer.
  float lg = lum(col);
  col += uDream.z * 0.07 * (1.0 - col) * (1.0 - col) * vec3(0.92, 0.88, 1.0);
  col *= mix(vec3(1.0), vec3(1.01, 1.0, 0.985), uDream.z * smoothstep(0.55, 1.0, lg));
  col = mix(vec3(lum(col)), col, 1.0 + 0.07 * uDream.z);
  // A drop is a small lens of its own: dark along its lower rim, a point of light at the top.
  col *= 1.0 - 0.045 * dr.w;
  // Mist on the glass: it clears from the middle outwards.
  if (uGlass.z > 0.001) {
    float m = uGlass.z * smoothstep(0.25, 0.85, fbm(p * 1.7 + 4.0) + 0.5 * sqrt(r2) - 0.9 * (1.0 - uGlass.z));
    col = mix(col, vec3(0.985, 0.985, 0.975), 0.86 * m);
  }
  // Towards the sun: a veil over everything near it, a cold streak across it, ghosts on the
  // line through the middle of the picture, and the dust on the glass.
  if (uSunS.z > 0.001) {
    vec2 sp = uSunS.xy, suv = clamp(uvOf(sp), 0.02, 0.98);
    float seen = smoothstep(0.08, 0.6, lum(texture(uGlow, suv).rgb)) * uSunS.z * smoothstep(0.5, 0.0, length(uvOf(sp) - suv));
    float ds = length(p - sp);
    float veil = 0.09 * exp(-ds * ds * 1.3) + 0.2 * exp(-ds * 7.0);
    float streak = 0.2 * exp(-abs(p.y - sp.y) * 110.0) * exp(-abs(p.x - sp.x) * 1.7);
    vec3 fl = veil * vec3(1.0, 0.97, 0.9) + streak * vec3(0.78, 0.9, 1.0);
    for (int i = 0; i < 4; i++) {
      float k = i == 0 ? -0.42 : i == 1 ? 0.36 : i == 2 ? 0.78 : 1.35, rg = i == 0 ? 0.05 : i == 1 ? 0.028 : i == 2 ? 0.085 : 0.15;
      float dg = length(p + sp * k) / rg;
      fl += 0.05 * smoothstep(1.0, 0.86, dg) * (0.35 + 0.65 * smoothstep(0.4, 1.0, dg)) * (i == 1 ? vec3(1.0, 0.85, 0.7) : i == 2 ? vec3(0.75, 0.9, 1.0) : vec3(0.85, 1.0, 0.92));
    }
    float dust = smoothstep(0.9, 0.97, vnoise(p * 57.0 + 9.0)) + 0.5 * smoothstep(0.86, 0.95, vnoise(p * 23.0 + 3.0));
    fl += dust * (0.25 * veil + 0.02 * exp(-ds * 1.2));
    col = vec3(1.0) - (vec3(1.0) - col) * (vec3(1.0) - clamp(fl * seen, 0.0, 1.0));
  }
  col = vec3(1.0) - pow(max(vec3(1.0) - col, 0.0), vec3(exp2(uGlass.x)));                                       // exposure: opened, the lights go first
  col *= 1.0 - uLensK.z * pow(r2 / r2max, 1.7);
  float g = texture(uGrain, vUv).r;
  float dens = clamp(1.0 - lum(col) / lum(uPaper), 0.0, 1.0);
  col *= 1.0 + (g - 0.5) * (0.07 + 0.22 * dens);
  // The grain of the film: new on every frame, coarser than a pixel, strongest in the half-tones.
  float l = clamp(lum(col), 0.0, 1.0);
  float gr = 0.55 * (hash21(gl_FragCoord.xy + uFrame * 1.7) - 0.5) + 0.45 * (hash21(floor(gl_FragCoord.xy * 0.5) + uFrame * 3.1 + 40.0) - 0.5);
  col += gr * uLensK.w * (0.35 + 2.6 * l * (1.0 - l));
  col += (hash21(gl_FragCoord.xy + uFrame * 1.7 + 9.0) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

// The sheet the film is painted on: fine tooth, cold-press dimples, a few fibres.
export const PAPER = `${HEAD}
uniform vec2 uRes;
uniform float uSeed;
${NOISE}
void main() {
  vec2 M = vec2(vUv.x * uRes.x / uRes.y, vUv.y);
  float fine = fbm(M * 420.0 + uSeed);
  float tooth = fbm(M * 120.0 + uSeed * 2.0);
  float fibre = 0.5 * vnoise(vec2(M.x * 30.0 + uSeed, M.y * 520.0)) + 0.5 * vnoise(vec2(M.x * 480.0, M.y * 24.0 + uSeed));
  float g = 0.5 + (fine - 0.5) * 0.9 + (tooth - 0.5) * 0.6 + (fibre - 0.5) * 0.25;
  o = vec4(vec3(clamp(g, 0.0, 1.0)), 1.0);
}`;

export const BLIT = `${HEAD}
uniform sampler2D uA;
void main() { o = texture(uA, vec2(vUv.x, 1.0 - vUv.y)); }`;
