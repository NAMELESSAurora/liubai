// Preview player and the hooks used to pull frames out of the browser.
//
//   __film.render(t)                          draw the frame at t seconds
//   __film.snap(t, name, width, samples)      save out/snaps/<name>.png (width 0 = full size)
//   __film.export({ name, from, to, samples}) render every frame into out/<name>.mp4
//   __film.status                             progress of the running export
//
// The preview draws one moment per frame; snaps and exports can average several across
// the shutter for motion blur (`samples`).
import { createFilm } from './film.js';
import { SHOTS, TOTAL, FPS, W, H } from './shots.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view'), scrub = $('scrub'), playBtn = $('play'), timeEl = $('time'), shotEl = $('shot');
const exportBtn = $('export'), statusEl = $('status'), marks = $('marks');

const stamp = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

let film;
try {
  film = await createFilm(canvas);
} catch (err) {
  statusEl.textContent = String(err.message || err);
  throw err;
}

scrub.max = TOTAL;
scrub.step = 1 / FPS;
marks.style.gridTemplateColumns = SHOTS.map((s) => `${s.dur}fr`).join(' ');
marks.innerHTML = SHOTS.map((s, i) => `<span>${i + 1} ${s.name}</span>`).join('');
$('note').textContent = '';

let t = 0, playing = false, last = 0;

function show(time, samples = 1) {
  t = Math.min(TOTAL - 1 / FPS, Math.max(0, time));
  const info = film.render(t, samples);
  scrub.value = t;
  timeEl.textContent = `${stamp(t)} / ${stamp(TOTAL)}`;
  shotEl.textContent = `${SHOTS.indexOf(info.shot) + 1} ${info.shot.name}${info.transition ? ' · 转场' : ''}`;
}

function tick(now) {
  if (playing) {
    const dt = Math.min(0.1, (now - last) / 1000);
    show(t + dt >= TOTAL - 1 / FPS ? 0 : t + dt);
  }
  last = now;
  requestAnimationFrame(tick);
}

function setPlaying(on) {
  playing = on;
  playBtn.textContent = on ? '暂停' : '播放';
}

playBtn.addEventListener('click', () => setPlaying(!playing));
scrub.addEventListener('input', () => { setPlaying(false); show(Number(scrub.value)); });
addEventListener('keydown', (e) => {
  if (e.target === scrub) return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
  if (e.code === 'ArrowRight') { setPlaying(false); show(t + 1 / FPS); }
  if (e.code === 'ArrowLeft') { setPlaying(false); show(t - 1 / FPS); }
});

const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', body });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `${url}: ${r.status}`);
  return data;
};

const hooks = {
  total: TOTAL,
  fps: FPS,
  status: { state: 'idle' },
  render: (time, samples = 1) => { show(time, samples); return t; },
  async snap(time, name = 'snap', width = 0, samples = 1) {
    show(time, samples);
    return post(`/api/snap?name=${encodeURIComponent(name)}&w=${W}&h=${H}&scale=${width}`, film.read());
  },
  async export({ name = 'liubai-placeholder', from = 0, to = TOTAL, samples = 6 } = {}) {
    if (hooks.status.state === 'running') throw new Error('an export is already running');
    setPlaying(false);
    const first = Math.round(from * FPS), count = Math.round(to * FPS) - first;
    const status = (hooks.status = { state: 'running', frame: 0, total: count, started: performance.now() });
    exportBtn.disabled = true;
    try {
      // The frames are encoded here, on the GPU (WebCodecs, H.264 at a bitrate far above what the
      // picture needs), and the stream is sent to the server in pieces; the finished film is made
      // from it with ffmpeg afterwards (CLAUDE.md, "Run"). The canvas is never read back: at 1440p
      // that took about a second a frame, and so did sending raw pixels.
      await post(`/api/export/begin?name=${encodeURIComponent(name)}&w=${W}&h=${H}&fps=${FPS}&fmt=h264`);
      const parts = [];
      let failed = null, sent = 0;
      const enc = new VideoEncoder({ output: (c) => { const u = new Uint8Array(c.byteLength); c.copyTo(u); parts.push(u); }, error: (e) => { failed = e; } });
      enc.configure({ codec: 'avc1.640034', width: W, height: H, bitrate: 160e6, framerate: FPS, avc: { format: 'annexb' }, hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality' });
      const send = async (upTo) => { await enc.flush(); if (failed) throw failed; await post(`/api/export/frame?n=${upTo - sent}`, new Blob(parts.splice(0))); sent = upTo; };
      for (let f = 0; f < count; f++) {
        show((first + f) / FPS, samples);
        const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / FPS) });
        enc.encode(frame, { keyFrame: f % FPS === 0 });
        frame.close();
        if (f % 20 === 19) await send(f + 1);
        status.frame = f + 1;
        if (f % 12 === 0) statusEl.textContent = `导出 ${f + 1} / ${count}`;
      }
      await send(count);
      enc.close();
      const done = await post('/api/export/end');
      Object.assign(status, { state: 'done', ...done, seconds: (performance.now() - status.started) / 1000 });
      statusEl.textContent = `已导出 ${done.file}（${(done.bytes / 1e6).toFixed(1)} MB）`;
    } catch (err) {
      Object.assign(status, { state: 'error', error: String(err.message || err) });
      statusEl.textContent = `导出失败：${status.error}`;
      await fetch('/api/export/abort', { method: 'POST' }).catch(() => {});
    } finally {
      exportBtn.disabled = false;
    }
    return hooks.status;
  },
};
window.__film = hooks;

exportBtn.addEventListener('click', () => hooks.export());
show(0);
requestAnimationFrame(tick);
