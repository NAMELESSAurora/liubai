// 《留白》合成器的本地服务：静态文件 + 出帧 / 导出通道。没有依赖。
//
//   node server.mjs            → http://127.0.0.1:5188
//
// 页面把渲染好的帧以原始 RGBA（自下而上，readPixels 的顺序）POST 过来：
//   POST /api/snap?name=&w=&h=&scale=   存一张 PNG 到 out/snaps/
//   POST /api/export/begin?name=&w=&h=&fps=   开一个 ffmpeg 进程
//   POST /api/export/frame              一帧，按到达顺序写进 ffmpeg
//   POST /api/export/end                收尾，返回 mp4 的路径和大小
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5188);
const FFMPEG =
  process.env.FFMPEG || path.join(os.homedir(), '.local/ffmpeg-static/node_modules/ffmpeg-static/ffmpeg');
const OUT = path.join(ROOT, 'out');
const SNAPS = path.join(OUT, 'snaps');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.svg': 'image/svg+xml',
};

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const clean = (s, fallback) => (s || '').replace(/[^\w-]/g, '') || fallback;
const body = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

// Run ffmpeg once with `input` on stdin.
function ffmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => (err += d));
    proc.stdin.on('error', () => {});
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-1500) || `ffmpeg exited ${code}`))));
    proc.stdin.end(input);
  });
}

const raw = (w, h) => ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`];
let job = null; // the one export in flight

async function api(url, req, res) {
  const q = url.searchParams;
  const w = Number(q.get('w')) || 1920;
  const h = Number(q.get('h')) || 1080;
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  switch (url.pathname) {
    case '/api/snap': {
      const buf = await body(req);
      if (buf.length !== w * h * 4) return json(res, 400, { error: `expected ${w * h * 4} bytes, got ${buf.length}` });
      const scale = Number(q.get('scale')) || 0;
      fs.mkdirSync(SNAPS, { recursive: true });
      const file = path.join(SNAPS, `${clean(q.get('name'), 'snap')}.png`);
      const vf = scale ? `vflip,scale=${scale}:-2:flags=lanczos` : 'vflip';
      await ffmpeg(['-y', '-loglevel', 'error', ...raw(w, h), '-i', '-', '-vf', vf, '-frames:v', '1', file], buf);
      return json(res, 200, { file });
    }
    case '/api/export/begin': {
      if (job) return json(res, 409, { error: 'an export is already running' });
      const fps = Number(q.get('fps')) || 24, jpeg = q.get('fmt') === 'jpeg';
      fs.mkdirSync(OUT, { recursive: true });
      if (q.get('fmt') === 'h264') {
        // The page has encoded the frames itself (WebCodecs, on the GPU): what arrives is an H.264
        // stream in pieces, and it is only written down, as <name>.h264. (Reading a 1440p picture
        // back from the GPU, or sending it raw, took about a second a frame; this takes 30 ms.)
        const file = path.join(OUT, `${clean(q.get('name'), 'liubai')}.h264`);
        job = { h264: fs.createWriteStream(file), file, frames: 0 };
        return json(res, 200, { file });
      }
      const file = path.join(OUT, `${clean(q.get('name'), 'liubai')}.mp4`);
      const proc = spawn(
        FFMPEG,
        [
          // Frames come as raw RGBA (bottom row first), or, with fmt=jpeg, as JPEGs straight off the
          // canvas: at 1440p a raw frame is 14.7 MB and the upload of it took longer than drawing it.
          '-y', '-loglevel', 'error', ...(jpeg ? ['-f', 'image2pipe', '-c:v', 'mjpeg'] : raw(w, h)), '-framerate', String(fps), '-i', '-',
          '-vf', `${jpeg ? '' : 'vflip,'}scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
          '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
          '-movflags', '+faststart', file,
        ],
        { stdio: ['pipe', 'ignore', 'pipe'] },
      );
      const j = { proc, file, w, h, jpeg, frames: 0, err: '' };
      j.done = new Promise((resolve) => proc.on('close', resolve));
      proc.stderr.on('data', (d) => (j.err += d));
      proc.stdin.on('error', () => {});
      job = j;
      return json(res, 200, { file });
    }
    case '/api/export/frame': {
      if (!job) return json(res, 409, { error: 'no export running' });
      const buf = await body(req);
      if (job.h264) { if (!job.h264.write(buf)) await once(job.h264, 'drain'); job.frames += Number(q.get('n')) || 0; return json(res, 200, { frames: job.frames }); }
      if (!job.jpeg && buf.length !== job.w * job.h * 4) return json(res, 400, { error: 'frame has the wrong size' });
      if (!job.proc.stdin.write(buf)) await once(job.proc.stdin, 'drain');
      return json(res, 200, { frames: ++job.frames });
    }
    case '/api/export/end':
    case '/api/export/abort': {
      if (!job) return json(res, 409, { error: 'no export running' });
      const j = job;
      job = null;
      if (j.h264) { await new Promise((done) => j.h264.end(done)); return json(res, 200, { file: j.file, frames: j.frames, bytes: fs.statSync(j.file).size }); }
      j.proc.stdin.end();
      const code = await j.done;
      if (code !== 0) return json(res, 500, { error: j.err.slice(-1500) || `ffmpeg exited ${code}` });
      return json(res, 200, { file: j.file, frames: j.frames, bytes: fs.statSync(j.file).size });
    }
    default:
      return json(res, 404, { error: 'unknown endpoint' });
  }
}

// The music the world can be walked to (play.html): what lies in music/ (put any files there), and the film's own track.
const AUDIO = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus']);
function tracks() {
  const out = [];
  for (const dir of ['audio', 'music']) {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, dir)); } catch { /* no such folder */ }
    for (const n of names.sort()) if (AUDIO.has(path.extname(n).toLowerCase())) out.push({ url: `${dir}/${encodeURIComponent(n)}`, file: n, film: dir === 'audio' && n === 'gris-before-gris.wav' });
  }
  return out;
}

function serveStatic(url, req, res) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'not found' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // A part of a file, when asked for (a player seeking in a long track asks for the part it wants).
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let a = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2])), b = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/api/tracks') json(res, 200, { tracks: tracks() });
      else if (url.pathname.startsWith('/api/')) await api(url, req, res);
      else serveStatic(url, req, res);
    } catch (err) {
      json(res, 500, { error: String(err?.message || err) });
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`liubai compositor: http://127.0.0.1:${PORT}`));
