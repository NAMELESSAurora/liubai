# 《留白》 renderer

A two-minute short (2560×1440, 60 fps since v11; 1080p24 before) in the manner of GRIS, cut to Berlinist's "Gris before Gris"
(`audio/gris-before-gris.wav`), rendered frame by frame in the browser with Three.js and
encoded with ffmpeg. Story, the music's phrases and camera intent: STORYBOARD.md.

**Scenery: the paintings in `materials/incoming/` are references only.** The user asked
(2026-11-14) for the scenes to be rebuilt in WebGL / Three.js after them, not for the
images to be placed in the film. Which reference each model follows: `materials/INDEX.md`.

**The traveller is not a picture either.** The user's direction, in order: a modelled
character was mediocre (2026-11-15); a puppet made from the character sheet was stiff and
rough (2026-11-19); then, the same day: reduce the body to almost nothing and let an
oversized cloak with real physics carry the character; hair a flowing watercolour bob with
its own physics; the face's features drawn with some care; no brush (its contact with the
world is too hard to do well); the figure itself in watercolour; and wherever the traveller
goes, the world turns from black, white and grey to colour that shines. Then, on the first
cloth version (it still had thin legs, a bare arm at the end, a sheet of hair and drawn
eyes): "人物建模还是太粗糙了": the oversized cloak is meant to *replace* any figurative torso
and limbs, the hair must have real physical quality, and the face is to be blurred or never
given a frontal camera. So the traveller is a cloak, a short cape and a head of hair, all
simulated in `src/traveller.js`; there are no limbs and no features anywhere, and colour
comes from where the traveller touches the world. Do not bring back legs, arms or a face.
On-screen copy is in English (2026-11-18): the title is UNPAINTED.

**The current cut has no figure in it.** After the redesigned traveller (v5) the user set
the character aside to think about it ("人物这边我再想想如何处理得当") and asked for empty
shots first, with the camera work, the staging and the mood improved; then: make the empty
shots a first-person point of view, and stage each scene with a sense of speed and with
motion and stillness set against each other ("将空镜定位第一人称pov … apply速度感以及动静结合
设计"). So `src/shots.js` is six unbroken first-person passages. On the first of those
cuts (v6) the user said: "有很多无意义运镜，例如很多动作没有规避实质性障碍等。另外整体安排上需要
动静结合以及慢速和快速切换，有些镜头慢慢逛，有些快速穿梭。场景也可以进行重新设计和安排". Three
rules follow, and v7 is built on them:
1. Every move has a thing for its reason: a turn goes round something that stands in the
   way, a dip or a climb goes under, between or over something. No weaving in open space,
   no banking without a turn, no orbit round nothing. The scenery is laid out for the path
   (`layout.js`: the aisle and its fallen roof, the jetty and the channel piles, the trunks
   in the lane, the stair) and `audit()` in shots.js measures every path against it.
2. Two paces take turns, about a phrase of the music each: strolling (slow, the eye going
   from one thing to the next) and tearing through (fast, threaded close past things).
   Hanging motionless in the air is neither; use it sparingly.
3. While we are fast the world ahead is grey pencil; where we slow, the colour we carry
   catches us up and runs on past.
Speed is in the lens (it opens with speed), the bank into real turns, and what stands
close to the path.

On v7 the user said (2026-11-19): "pov视角镜头要有真实感与沉浸感，例如加上手摇镜头以及镜头惯性等，
加入画面真实滤镜后处理等"; "场景设计可以做的更精致"; "运镜要设计的有逻辑和交互感"; and then:
"这三点只是抛砖引玉，你可以发挥自己的能力和创造力". v8 answers with four things (the first
two are what was asked; the fleck is Claude's own answer to "logic and interaction", not
the user's words, and is the first thing to ask about if they dislike the cut):
4. A body under the lens (`pov()` in camera.js): footsteps by distance covered, hand-held
   drift that grows with speed, breathing at rest, a head that arrives late and settles, a
   bank that comes on late, a dip when a climb or fall is checked, focus that hunts. The
   gaze rests on a thing and goes to the next in one glance; it does not pan unless a key
   says `pan`. This is the one place hand-held motion is wanted; it is never beat sync.
5. A real lens in FINISH (shaders.js): barrel distortion, fringing and darker corners that
   grow with speed, film grain, veil / streak / ghosts / dust towards the sun, exposure
   that lags (`frame().lens.exp`), drops on the glass in the rain (`wet`), mist out of the
   cloud (`mist`).
6. A guide, so that every move has a cause: the fleck (`fleck()`, `wispAt()` in shots.js;
   `wisp()` in PAINT), a spot of bare paper with a wash round it. It rests on things and we
   come up to it; it darts off and we chase it. What it passes answers: lamps and windows
   light (K.LAMP, lit at the time `passing()` in scenes.js finds), rings on the water
   (`frame().wake`), crowns turn red, birds go up; plants and cloth (K.BLADE, K.FLAG) move
   in the wind and away from the eye and the fleck. Round it colour shows in a world that
   is still pencil (`uWispP.z`), except before the first colour has fallen. In the last
   shot it rises, swells and is the moon. To see the film without it, give `wispAt` `on: 0`.

On v8 the user said (2026-11-19): "我觉得你做得非常棒，可不可以做成一段连续的长镜头，去掉转场将整个场景
打通，然后给起飞加一段助跑效果并且加一些风吹动布料的音效以及制作一些环境音。发挥你的能力和创造力"; and
while that was being built: "你去查查gris这种星座美学，我觉得现有的天空有些空了，可以加上这种星座+辉光感"
(with a crop of thin concentric rings and nodes on a glowing sky) and "记得修理一下穿模问题" (a banner
hanging through the tower's stair). So v9 is one take:
7. One world, no transitions. The six places keep their own coordinates, sky, light and
   returning colour, and are painted separately; `layout.js` sets them down in one world
   (PLACE: a yaw and an offset each, turned so that every place has the same sun) and says
   where they meet (JOIN). `shots.js` makes ONE camera (CAM) and ONE fleck (FLECK) out of
   every act's keys (acts are keyed in their own place and their own time; an act reads the
   eye back in its own coordinates), and lists the joins (STITCHES). `film.js` paints the
   place the eye is in and, at a join, the next one too, with the same eye; MIX joins the
   two by where things are (each picture carries distance in alpha): across a plane (type
   4: the aqueduct's far face, the lake's shore, the edge of the cloud sea), drawn outwards
   from a point (type 6: the first drop), or one into the other inside cloud (type 5).
8. A run before the take-off (the eye keys of the ruin from 11.75; `run` in pov()).
9. Sound made in code from the eye's own motion: `node audio/sfx.mjs` → out/liubai-sfx.wav
   (air, cloak, feet, places). It reads shots.js, so make it again after any change of path.
10. The sky carries a diagram (`diagram()` in PAINT; uStarC, uStarL, uCon): rings round the
   place where the moon will be, stars joined into figures, pencil by day and light at
   night; and in the last sky our own way as seven stars. (Taken from GRIS only as a
   principle: thin celestial geometry and glow. Nothing of its is copied.)

On v9 the user said (2026-11-19): "音色稍显rough，音量有点大了，另外星座做的有些粗糙了，树根需要精修一下。
然后整体画面可以加上一些合适的滤镜来营造一种梦幻感" and "穿过云海的时候可以做一些物理效果，云海可以做
水彩风格的体积云". v10:
11. The cloud is a body (`cloudVol`, `volDensity` in PAINT; uVol, uVolW, uBore, uPlume): a
   marched density laid out in the WORLD, so the wood (which has it overhead) and the tower
   (which stands out of it) see one cloud; painted in three washes by how its heaps face
   the light, never rendered. The fleck bores a way up through it (uBore: points on our
   own path, wide as the fleck passes, closing behind us) and we fly up that way; where we
   come out the cloud is drawn up in a ring (uPlume). The old layered cloud (`cloudAt`,
   uCloud) is still there but no place uses it.
12. The dream (FINISH: uSoft, uDream): a mist filter (light spreads into shade, never the
   other way), a veil of the picture's own light, corners that go soft, lifted lavender
   darks, motes in the air. `__dream = 0` in the console turns it off.
13. The sky's diagram is drawn with threads of light (no hard edge anywhere) and seven
   designed constellations (FIGURES in shots.js → uFig), not random joins.
14. Sound: pink noise, every bed filtered twice, events slow to start and kept under 4 kHz,
   a reverberant room, and mixed about 12 dB under where the first version sat
   (`volume=-18dB` on the stem). The user called the first version "rough" and loud.

On v10 the user said (2026-11-21, with crops): "全面深度优化与精修场景细节…例如墨线的末端处理，场景切换的光效和草，
树叶浮空，平原场景分界等等"; "优化穿云效果"; "全面优化并精修空中星座的质感，可以参考GRIS"; "输出成片规格改为
1440P 60FPS，在增加分辨率的基础上场景细节也可以对应的进行优化". v11:
15. 2560×1440 at 60 fps (shots.js FPS, W, H). Sizes said in pixels are pixels of a 1080-line
   picture: PAINT multiplies them by PXS, film.js scales the blur. Motion blur is adaptive
   (`samplesFor` in film.js: 6 to 18 moments of the shutter, by how far the picture moves).
16. The export no longer reads the canvas back. The page encodes each frame with WebCodecs
   (hardware H.264, 160 Mb/s) and streams it to the server, which only writes
   out/<name>.h264; the film is made from those afterwards (see Run).

On v11 Claude asked whether stone, wood and the rest should carry more brushwork and texture
at 1440p; the user: "要，加纹理" (2026-11-21). v12:
17. The hand on every surface (shadeMesh in PAINT; `strokes`, `pencil`, `handAt`). In colour,
   by what a thing is made of: stone has grains of settled pigment, soft patches, stains that
   have run down its upright faces and here and there a crack; wood has its grain along its
   length (scenes.js flags wood `extra: -1`); bark is furrowed (`extra: -2`); foliage is dabbed
   on; and where the light is the brush runs dry and the paper shows. In the grey world the
   pencil shading is strokes: along the form on anything upright, a second set across them in
   the darks, the graphite's tooth on what lies flat. All of it fades with distance.

On v12 the user said (2026-11-21, with a crop of the country below the summit): "fabulous！唯一美中不足的
就是场景有点光秃秃的。另外可不可以把留白的世界做成可以实时交互的世界？例如用webgl或者threejs等技术". v13 and
the world played live:
18. Growth and things in every place (scenes.js, the blocks marked v13; helpers `bush`, `smallTree`,
   `flowers`, `climber`, `cypress`, and `tree()` now takes a `palette`). The ruin: round trees
   behind the colonnade and beyond the walk, bushes, flowers, creeper up columns, and far off a
   temple front and lone columns. The lake: boats, herons, islands with reeds and trees, drifts
   of pads and lotus, what is left of arches. The wood: undergrowth, fallen leaves, flowers,
   logs and stumps with toadstools that light, more wood on every side. The tower: pots on the
   stair, window boxes with creeper, dormers; other towers out of the cloud (their windows light
   with the gold), a bridge, crags with trees. The summit: more grass, flowers, a bent pine off
   the edge; the country below has trees with trunks, hedges, avenues, a second blossom, fields
   in flower (landColor), and what we came through, small and far (obelisks in its lake, a run
   of aqueduct, columns, towers on two hills). Night now falls on everything standing there.
19. The world can be walked: `play.html` (src/play.js). It is the film's own renderer
   (`film.renderLive`, one sample a frame, at 720–1080p: `?h=900`) with the eye handed to the
   player. Two clocks: T is the world's (every place's state is a function of it, as in the
   film) and Te is where on the film's path the eye is; T runs while the player keeps up with
   the path and waits when they stop. The eye is kept within ROOM of the path (computed from
   HAZARDS), because the scenery is built to be seen from the path only. A click drops a wash of
   colour (`film.pick` reads the G-buffer's position; up to twelve blooms a place now) and rings
   on the lake. G hands the camera back (the film, in real time, music in step).

Offered the next step, the user chose it (2026-11-21): "扩建自由行走".
20. The world is walked freely (play.js, mode `free`, the default; `rail` is the leash of point
   19, key L). Three things make it possible. (a) Which place is painted goes by where the eye
   is: low down two planes part the ruin, the lake and the wood (JOIN.aqueduct, JOIN.shore;
   the shore's line runs on south of the aqueduct, so the ruin's east side is the wood); over
   the wood is the cloud and above it the tower's place; past the cloud's edge, once the story
   has opened it (T ≥ 97.8), the mountain and its country. `mixFor` gives film.js the place
   and the nearest neighbour (`film.drawFree`; a far neighbour fades: MIX uPortal.w).
   (b) Things can be walked into and stood on: build.js makes colliders as the scenery is
   built, when `Builder.collect` is on (cells of a grid 0.5 wide and 0.25 high that a face of a
   solid thing passes through; balls for foliage; a scene's `ground(x, z)` for relief), and
   play.js keeps the film's own way clear of them (`clearAt`). (c) Each place has bounds;
   in the margin before them the picture goes back to paper. The clock: T runs while the
   player is with the story (near the fleck, or where the film's eye is at T) and waits
   otherwise. W with the mouse left alone is still "follow the story": near the film's way the
   player is led along it (pure pursuit of a point 1.6 units on), takes off where it does and
   lands where it does. Z / X go to the start of the place before / after; B back to the fleck.

Asked whether it could become a small sandbox game, Claude said yes with conditions; the user
answered (2026-11-22): "我觉得核心不用放在交互式玩法上，更多当成一种风景观赏的禅意散步和飞行模拟器+音乐播放器".
21. play.html is a place to walk and fly in and look at, with music, not a game. Its default
   mode is `wander`: the world kept at one moment of its story (DAY = 108: every colour back,
   not yet night), everything of point 20 (free walking and flying, colliders, bounds). Flying
   is made for looking: C cruises (on without W held), the arrow keys turn and tilt the eye,
   we bank into a turn; Z / X go round a list of views (VIEWS: moments of the film's way, and
   two in the country below); N calls night down on the mountain (the story's own ending
   played, T 108 → 116.4, and back); P saves the picture. `tour` (T) is the film's route at the
   film's pace with its rests (S.tourT), the eye free, round and round. The story is still
   there as `journey` (J: point 20's mode, internally 'free'), and the film as `auto` (G).
   The music is a player (`player` in play.js; the strip at the foot of the page): tracks
   listed by the server (GET /api/tracks: audio/gris-before-gris.wav and whatever is put in
   music/), files dropped on the page, play / pause / next / seek / volume / order. server.mjs
   now serves audio types and byte ranges (a player seeking asks for parts of a file).

On the wandering version the user said (2026-11-22): "这个方向很对，我觉得可以优化一下运动手感，做上跳跃动作，
然后飞行手感也要专门优化调校一下。其他的话你看看还有没有可以做的内容（可以发挥你的创造力，可以先设计方案）".
22. How it feels to move (play.js: FEEL, and stepFree's three states `ground` / `air` / `fly`).
   On foot: speed picked up in 0.15 s and let go in 0.22; a jump with weight (gravity 11, a tap
   0.54 high, held 0.98, the rise cut short when Space is let go), coyote time and a jump
   buffer, a landing that dips the eye (a spring); ground too steep to walk is a fall going
   down and a wall going up. Space held on into the air (0.3 s), or pressed again there, and we
   fly; a fall of a second becomes a glide. Flying has momentum: the speed (S.fs) and the way
   we are going (S.fd) are separate; fd comes round to where we look, slower the faster we go
   (so turns are carved, and we lean by how fast fd is turning: S.bank); W builds speed, a dive
   adds to it and it lasts a few seconds after, a climb costs it, let go of we glide to a
   stop and hang; S brakes; low over ground with Q (or hardly moving) we land, running.
   Skimming the lake leaves rings. Measured by scratchpad/pt/feel.js (numbers, not hands):
   nobody has yet said how it feels.
23. play.html, the rest of the plan (the user, 2026-11-22: "手柄适配不急，生灵也暂时不用做（纯靠
   代码可能精度不够），其他的可以开始做起来": so no gamepad and no creatures; all of this is
   for wandering, and none of it changes the film):
   - The hour (`hour()` in play.js; N, Y). Wandering, the last stretch of the story's clock is
     the hour of every place: at DAY (108) it is day, and from there to END (116.4) night comes,
     as it does at the story's end, but everywhere. shots.js (`if (a.live && !a.live.film)`):
     uNight × 2.4 so the wash goes all the way round the sky, out of the moon, which stands the
     same way off in every place (`moonAt`); `uDusk` 0 … 1 for everything under it. PAINT: with
     `uDusk >= 0` the night is laid on the sky itself (`wide`: no seam behind us), things go
     grey-violet (`nightThing`), the ground and the clouds with them (`nightGround`,
     `nightCloud`, `hazeNow`), and lamps are lit over the night, not under it.
   - Weather (K: 晴 · 薄雾 · 雨 · 雪; `S.wx`, `uWx`). Mist: more haze per place (`MIST`), the low
     sky taken, beams in the air. Rain and snow: `weather()` in PAINT, sheets that are upright
     cylinders about the eye, fixed by bearing; a grey wash over the sky; drops on the lens.
     Snow lies: on the ground, on the land, and on whatever faces the sky (shadeMesh).
   - The fleck beside us (`PAL`, `palStep`; O). It goes ahead the way we are going, rests a
     few steps off when we stop (on the ground, or over the water with rings), wears the place's
     pigment, is the film's own fleck on the tour, and at night goes up and is the moon. It
     reaches the renderer as `live.wisp` (world points; film.js reads them into each place).
   - The music, breathing (`player.pulse`; I): loudness against its own recent average →
     the wind in the plants, the mist filter, the diagram on the sky, the fleck's light.
   - A photograph (P; `PH`, `stepPhoto`, `shoot`): the world stops, a camera of its own (move,
     zoom, roll, focus on a click), and Enter prints it with a second film at 2560 × 1440,
     twelve samples (`renderLive(live, samples)`), as a PNG.
   - Rides (U; `RIDES`, `route`, `buildRide`, `stepRide`): a loop to be carried round in each
     place: 廊下漫步, 湖上泛舟, 林间小径, 云海盘旋, 山野滑翔. On foot and by boat the way is
     found (A* on the colliders' own grid, between points that say roughly where to go).
   - The air (`makeAir`; [ ]): each place's sound made from noise, footfalls, a landing, a drop
     on the water. Levels were measured offline (beds about −45 … −35 dBFS, well under music).
   Seen only as stills and numbers: nobody has yet heard any of the sound or watched it move.

The traveller's own cut is kept
whole: `src/shots-traveller.js`, `STORYBOARD-traveller.md`, `out/liubai-v5.mp4`; to see it
again, import that file instead of shots.js in film.js and main.js.

**Pace.** The 48 s version was "too hurried" in camera, chapters and the spreading colour.
Every speed-up and every stop is placed on the music (table in STORYBOARD.md): we gather
speed into a crest and stop on it or just after; stillness is held for four seconds or more.

## Run

- `node server.mjs` (Node is at `~/.local/node/bin/node`) → http://localhost:5188.
  In the Claude desktop app use the `liubai` entry of `Documents/.claude/launch.json`.
- The server has no dependencies. It serves the files and takes rendered frames back:
  `out/snaps/*.png` for stills, `out/*.mp4` for the film (ffmpeg-static in `~/.local`).
- Three.js 0.187 is vendored in `vendor/three` and reached through the import map in
  `index.html`; there is no build step.
- From the page: `__film.snap(t, name, width, samples)`, `__film.export({ name, samples })`,
  `__film.status`. Since v11 an export writes `out/<name>.h264` (a raw H.264 stream made in
  the page; the server no longer encodes). Export in pieces of 10 s (`from` / `to`), then:
  `cat out/NAME-s*.h264 > out/NAME.h264` and
  `ffmpeg -framerate 60 -i out/NAME.h264 -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 out/NAME-silent.mp4`
  (the stream is bt709, limited range: checked against a still), then lay the sound under it.
  What follows about the encoder describes the older raw-frame path, which is still there. A full export at 6 samples takes roughly a quarter of an hour. The
  page does the rendering: if its tab goes away (it did once when a turn ended with the
  export still running; the encoder then sat waiting for hours) the export hangs. So stay
  in the turn until it is done, and export in pieces of about 20 s with `from` / `to`
  (seconds; frames are deterministic, so pieces join exactly), then join them with
  ffmpeg's concat demuxer and `-c copy`. `POST /api/export/abort` closes a hung export
  and leaves a valid mp4 of the frames it had received. The
  export is silent; lay the music under it afterwards:
  `ffmpeg -i out/NAME-silent.mp4 -i audio/gris-before-gris.wav -c:v copy -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart out/NAME.mp4`
- The browser pane may be hidden, where requestAnimationFrame does not run. Snaps and
  exports do not depend on it; review by reading the PNGs in `out/snaps`.
- For look development from the console: `__override = { uGris: 0, … }` replaces scene
  uniforms (uGris 0 shows a shot fully coloured), `__cam = { pos, look, fov, blur }`
  looks at the current shot's scene from anywhere. Set both back to `null`.
  To look at the traveller close, import `/src/shots.js` in the page, take
  `SHOTS[i].figure(t).pos` and put `__cam` beside it.

## Layout

- `src/film.js` — the renderer. Per shot: shadow map → G-buffer (and once more upside
  down when there is water) → PAINT → depth of field. Per sample: one or two shots →
  MIX. Per frame: the samples averaged → GLOW (halation) → FINISH.
- `src/shaders.js` — MESH_* write the G-buffer (pigment + kind, normal + id, position).
  PAINT is the watercolour: washes in layers that follow the light, backruns, pooled and
  lost edges, ink lines from the G-buffer's edges, the grey underdrawing and the colour
  coming back, and everything painted from the view ray (sky, ground, water, cloud,
  weather, the night). DOF, MIX, FINISH, PAPER.
- `src/build.js` — the Builder that merges pieces into one mesh, and the pieces: column
  shafts, ring-shaped stones, rocks, foliage balls, limbs, terrain, pierced walls.
- `src/scenes.js` — the scenery of shots 2 to 6, built from those pieces.
- `src/traveller.js` — the traveller: pose from the path; the unseen form's axes; the cloth
  (`ringSheet`, `blow`, `relax`, `tether`, `clothFor`): the cloak and the cape stepped at
  60 Hz from three seconds before each shot, every other state kept, so any time can be
  asked for; what the cloth lies on (shoulders and a bell on foot, something thin in the
  air, two knees that push the front out in turn, the ground); the hair (`HAIR`, `comb`):
  some 460 strands, each a chain pulled back towards the way it was cut; the meshes (cloth
  drawn twice as fine as it is simulated; a lock and two single hairs for every strand).
- `src/shots.js` — the one take: six acts (a place each: world settings, light, the eye's
  keys and the fleck's keys in that place's coordinates and time), lifted into one camera
  (CAM) and one fleck (FLECK); an eye key with `watch: true` looks at the fleck. STITCHES are
  the joins between places. `src/shots-v8.js` is the cut in six shots with transitions. Keys run past both
  ends of a shot because transitions overlap the cuts. `TRANSITIONS` and the shot lengths
  are the cut. `src/shots-traveller.js` is the cut with the traveller in it (keyed in a
  script time that `at:` stretches against the music).
- `src/camera.js` — keyed tracks; `rig` (a camera placed by hand); `pov` (a first-person
  camera: a path of eye positions, glances at things, and a body: steps, hand, weight);
  the traveller's path.
  `src/layout.js` — numbers shared by the scenery and the timeline; where each place lies
  in the one world (PLACE) and where places meet (JOIN). `audio/sfx.mjs` — the sound.
- `play.html`, `src/play.js` — the world walked in real time: wander / tour / journey / rail /
  auto, the regions and bounds, the eye and its body, the hour and the weather, the fleck beside
  us, rides, the photograph, the music player and the air. `music/` — tracks for the player
  (anything put there is listed).

## Things that are easy to get wrong

- Light is the one thing whiter than the paper (the sun, glare, rim light, lit air go to
  pure white; GLOW spreads only what is above about 0.97). A sky colour that light must
  not exceed 0.97 in luminance or the whole sky blooms.
- The cloth has no keys: to change how the cloak or hair looks, change what it is cut to
  (`fall`, `width`, a strand's `rest`), what it lies on, or the forces. Folds come from
  cutting the cloak wider than the form (not from a wide form: that gave a tent). A point
  pinned somewhere that a collision also forbids is kicked every step and throws the whole
  cloak about. The ground only exists for the cloth where a shot's `figure` passes `ground`.
- A closed cloak cannot make a gesture with an arm: lifting one line of it raises the whole
  side into a pyramid. The ending is therefore the head tipping back (`raise`) and a wind
  across the cloak; `tipOf` then gives the place in the sky the traveller looks at.
- A shot's cloth states are large (about 70 MB); the last three shots' are kept. The first
  frame asked for in a shot costs about half a second for every second since its start.
- What is painted on the traveller (the cloak's washes and gold threads, the hairs within
  a lock) is painted in MESH_FRAG on the cloth's own uv, not in PAINT: washes fixed to the
  world would swim across a moving figure. The hair's run of colour is per vertex, by
  height on the head, so that it does not change from lock to lock: locks cross each
  other, and any difference between neighbours shows as blocks.
- Time: `uT` is the time the colour comes back by and `uClock` is real seconds (weather,
  birds, glints). In the first-person cut they are the same; in shots-traveller.js `uT` is
  the shot's script time.
- Speed of export: reading a 1440p frame back (readPixels is quick, but `toBlob` and the upload
  of 14.7 MB of raw pixels each took about a second a frame, the page being a background
  page) was the whole cost. Do not go back to it. A snap still uses the raw path (fine for
  stills). Test snaps at 3 samples show fast head-turns as three copies of every edge: that
  is the test, not the film.
- Strokes and texture (v12): never lay strokes on slanting planes through the world. They are
  only right on a flat face: across the flutes of a column they came out as fish scales and
  round a trunk as a zebra's stripes. Strokes follow the form (up anything upright). Never get
  streaks by stretching noise one way either: its streaks kink from cell to cell (chevrons,
  agate). No directional strokes on floors: seen at a slant they read as the grain of wood or
  as corrugated board; floors get grain without direction. The pencil's strokes keep their
  spacing on the picture (two octaves blended, `pencil()`), or a floor underfoot is striped.
  Faces a few pixels across (the edge of a paving stone) turn strokes into the teeth of a
  comb: they fade where `pool` says an edge is close on every side. A crack is one level line
  of a SLOW noise, gated to a few places; level lines of a fine noise are closed loops, and
  read as the figure of wood. `patch` is a reserved word in GLSL ES 3; a backtick in a GLSL
  comment ends the JS template string.
- Growth (v13): a bush or a small crown made of few-faced balls of one wash is a boulder: use
  balls of 16 × 11 faces or more, each its own wash, as the tree crowns are. A tall dark single
  form (a cypress as one stretched ball) among columns is one more broken stone in pencil: near
  the eye use round trees; cypresses only far off. A tree close to where we stand at the end
  takes the picture when the eye goes up to the moon: the pine is out past the edge and low.
  Anything standing in the country below must take the night (the dusk tint was on LAND only,
  and the trees stayed day-green). A bush set on a steep face is half inside the rock and shows
  as a green stone set in it (three by the cairn did, and reached a finished render): bushes on
  level ground only. Taking things out of a scene shifts everything built after them unless the
  random draws are still made (they are drawn into a Builder that is thrown away).
- Played live (play.js): a place's `frame(t)` is told the player's eye through `shot.live`,
  set only for the length of that call; scenery must never be BUILT while it is set
  (`clearance` and `passing` read the film's path), so play.js draws every place once with the
  film's own camera before it starts. The place the eye is in is drawn last, for `pick`.
  server.mjs has no audio MIME type: play.js decodes the music itself (fetch + WebAudio).
  W is "on along the way", not "where I look": going only where the eye points, the player was
  left behind at the first place the way winds (round the tree in the wood), and the world
  stopped for good; and where the way comes to rest within a step, W must still take that step.
  Turning the eye to the fleck while it rests at our feet turns us round and round it (near
  it the eye goes where the way goes). The world's clock may hurry after a player who runs
  ahead, but never much (rate ≤ 1.6). While the world waits its story stands still (uT) but
  its air must not (uClock = t + the time waited: rain, sway, rings), and what the player
  drops spreads in the player's time. Held at the edge of the room, take away only the
  outward part of the speed, or strafing along it stops us. Measured on this Mac at 1600×900,
  light mode: 8 to 35 ms a frame on the rail, 13 to 46 walked freely (a neighbour is painted
  more of the time; worst: inside the cloud, and at a join with two places drawn). It has been run in the app's pane and headless (scratchpad playtest.mjs drove it with
  puppeteer from op50-pv/tools/headless); pointer lock and the sound were not checked.
- Walked freely (play.js `free`): what went wrong on the way to it. Led by aiming the eye at
  the fleck, or at the way and going where the eye points, the player cut every corner into
  what the way goes round: when led, go to a point of the way itself, whatever the eye does.
  Sidestepping when stopped (`dodge`) is for things only: at the world's edge, and while led,
  it pushed the player off sideways. Leaving the ground must hold for a moment (`S.air`), or
  the player is put back on it in the same frame. A step is told from a wall by its height,
  so the grid is finer upwards (CELLY); at 0.5 high a column's base was a stair. The grid is
  coarse beside thin things: a post two strides from the film's way filled the cell the way
  goes through (hence `clearAt`). A place's `frame(t)` keys many things to the film's clock
  that mean nothing when one is there at another time: the lens (play.js gives its own,
  `live.lens`), the wood's sweep of colour and its cloud (shots.js, `me.live`). The tower's
  place has no night and the mountain's has: after night falls there is no way back over the
  cloud's edge, and the cloud sea is no longer shown from the mountain. From far above, a join
  is seen for the ruled plane it is: the ceilings are low. Where a join has nothing built on it
  (the lake beyond the aqueduct's ends) the two grounds met in a ruled line: stones and reeds
  along it (a bank of sand was a dark strip with a ruled edge of its own).
- Wandering (play.js `wander`): a place's air must keep its own time while T stands still
  (`me.live.wait` in shots.js: the tower's birds, the wood's leaves, the cloud's drift), or it
  is a photograph. The tour must not be "pursue the way" as the journey's leading is: where
  the film rests for more than a moment there is no point of the way ahead to make for, and
  the tour stood still for ever; it runs on the film's own clock along the way instead.
  Testing in the app's pane PLAYS THE MUSIC on the user's machine: pause it and leave the page
  on its start screen (begun from the console, without a click, it stays silent).
  Movement: things outside stepFree set only `S.grounded` (a view, the tour, the film);
  stepFree brings `S.state` into line at its top. The journey's leading in flight must go at
  the way's own pace and ease up to its target, or with momentum it overshoots and hunts.
- The hour, the weather and the rest of point 23: what went wrong on the way.
  The film must stay the film: everything is gated on `uDusk >= 0` in PAINT and on
  `a.live && !a.live.film` in shots.js (play.js sends `film: S.auto`); the join's `uFar` is 0
  for the film. Night on the ground goes on AFTER `reveal`: ground the colour never reached is
  bare paper, and tinted before it stayed a bright band along the horizon. The wood's cloud is
  a ceiling: wandering (`plain`) it gathers by our height only, or there is no night sky there.
  Weather sheets must not take the eye's place in the world into their pattern (far from the
  origin the rain was squeezed to hairlines), and a flake is round only if its cell is
  squashed by how steeply we look (`lxz`). In rain and snow the haze must darken with the sky.
  Rides: the colonnade stands on a step too high to walk up, so no way on foot goes through
  its aisle; a route's grid must be the colliders' own (0.5: a grid of whole units closed every
  gap); the points of `via` are guides, and the corner at each is cut, or the way goes in to a
  point and back out; a glide's scan for what stands under it must reach above the tallest
  thing there (the towers in the country's lake are 60 high). Sound cannot be checked by
  listening here: render `makeAir` in an OfflineAudioContext and read the levels.
- Marks on the ground are sized across the mark (`fwidth` of the distance to it), never
  along the view: measured along the view a far line swells into a wedge. A join that is
  "drawn outwards" gets one front per frame (the frame's own time) and bands measured in
  pixels, or it shows as terraces. Small foliage needs a twig to hang on. The land mesh
  must run under the mountain: where it began there was a seam across the plain.
- One world: an act's keys must not overlap the next act's in film time (two keys at one
  time break the path). A place that is not the eye's own is painted "quiet" (no weather
  round the eye). What stands past a join in the place before it is never seen: do not build
  it (lake: `ashore()`), or it shows cut. A far place may be faded in (`fade`); a place seen
  in full colour from a place still in pencil breaks the story (the summit's green land from
  the tower: it is only let in when the music stops). The gaze turns by direction and stays
  on a thing that moves (`at`); looking straight up or down at something overhead spins the
  picture: keep the thing ahead. `eye` (the height of the eye on foot) is given by time,
  or flying through that height counts as walking. After any change run the checks in Node:
  `node -e "import('./src/shots.js').then(m => console.log(m.audit()))"`.
- The cloud: lit by the slope of its heaps and darker in its hollows; lit only by "is there
  more cloud towards the sun" it came out flat white. Seen from below it must not be dark
  (it made a blue ceiling over the wood). A place that shares it must be given uVolW (its
  yaw and offset) or the two pictures of it differ at the join. Roots: grow them out of a
  swelling foot on the trunk's own material (one id), curved and tapering; straight cones
  read as a tripod.
- Cloth and creeper near other things: hang banners where nothing passes (under the stair,
  not across it), and take a trunk's real axis (`axes` in forest()), not its mark.
- An export (1440p60, 7200 frames) takes about 50 minutes (twelve pieces of 10 s, chained in the page).
- pov keys: a key without `pos` only moves the gaze; a key that gives no look, aim, fd or
  blur leaves the gaze alone; tilt and zoom stay until changed. The body is simulated at
  120 Hz from the first key, once, so a path is fixed when `pov()` returns; `cam.path(t)` is
  the eye without the body, and that is what `audit()` and `clearance()` measure. A glance
  to something more than about 60° away in under a second is a whip: move the thing, or
  give the key a longer `glance`. Looking at a thing that circles close (the fleck round
  the tree) swings the picture: look at the axis it circles instead.
- The fleck is drawn in PAINT from 18 points; its head and its thread are capped in size
  on the picture, or close to the lens they become a ball and a bar. Its light is a lift
  towards white and washes out whatever is near: keep it low. Bark and other dark pigments
  shown by its pool of colour read as holes in a grey world (the lane has none).
- Lens: try values from the console with `__lensTest = { wet: 0.5, mist: 0.8, exp: 0.4 }`
  (null to clear) and `__lens = 0` for no lens at all. Drops are refraction only: on a
  blank sky they do not show, which is right. Dust and veil need the sun in or near frame.
- New scenery near a path: plants may stand on the path (the eye passes over them); a
  banner or a flag near where we stand takes over the picture (the summit had one).
  Small overlapping leaves of kind PUFF in a grey world turn to soot: use K.BLADE, one id.
- An export at 10 samples now takes about 0.6 s a frame (half an hour for the film).
- First person: what the path goes round is fixed in `layout.js` and the path is keyed
  against it; after moving either, run `(await import('/src/shots.js')).audit()` in the
  page: `hits` must be empty, and `near` lists what each path passes close to and when
  (that list is the path's reasons). A path of keys cuts the corners of a circle, so an
  orbit comes nearer its centre than its keys say. Scattered things (posts, litter, the
  wood's other trunks) are still placed clear of the camera by `clearance` in scenes.js,
  so they move when a path moves. Sheets of weather stand at
  fixed z and are only drawn where the view has some +z in it. Inside the cloud of shot 5
  the picture is white by design. A hard look round (more than a right angle) must be
  given as looks to turn through, or the eye takes the short way.
- Returning colour: `uSpread.w` and `uBloomR[i].y` keep a front spreading (units a script
  second); the freshly coloured band is lit and carries `glints`.
- `uLight.w` scales both the ground shadows and the rim light; `uShaft` the light in the
  air, which needs the shot to have a shadow box.
- World axes: x right, y up, z away from the camera: a left-handed frame. The camera
  matrix given to Three.js is therefore a mirror; every mesh material is two-sided and
  the shader turns normals towards the viewer. Do not rely on face culling.
- A vertex's colour is the pigment of a full-strength wash. PAINT thins it in the light
  and thickens it in shade, so pick mid-tones, not the lightest value in the reference.
- Every piece gets an id; ink lines are drawn where ids change. Pieces that should read
  as one thing (a trunk and its boughs) must share an id.
- Anything built near a camera or flight path must be checked against it: `clearance()`
  in scenes.js samples both for the shot. A camera inside a mesh shows as a flat field.
- A shot throws shadows only if it has `shadow: { c, r, d }` (centre, half-width and
  depth of what the light sees). Things outside that box cast and receive none.
- A camera key marked `hold: true` is a rest; the motion eases in and out of it. Without
  it the camera flows through the key. `blur` carries on from key to key: set it to 0
  where the sky has to be sharp, since the sky is defocused like anything else far away.
- One sample per frame is aliased; edges are smoothed only by averaging samples, each
  drawn a fraction of a pixel aside. Judge quality from snaps with 4 or more samples.
- Review motion with contact sheets (twelve frames per shot), not single stills: a shot
  whose frames all look alike is a camera locked to the traveller.
- Haze is applied before the grey underdrawing, otherwise distance stays coloured.
- Two travellers can be on screen during a wash between shots; choose the wash direction
  so it takes the outgoing one first.
- zsh: `$n:l` is a modifier; write `${n}:layout` in ffmpeg filter strings.
