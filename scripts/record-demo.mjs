// Records the demo video: dev/demo.html in headless Chrome (via the DevTools
// screencast), with scripted arrivals and a scripted cursor, then encodes it
// with ffmpeg to build/perch-demo.mp4 and docs/demo.gif.
//
//   node scripts/record-demo.mjs      (needs Google Chrome and ffmpeg)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(tmpdir(), `perch-demo-${Date.now()}`);
mkdirSync(join(OUT, 'frames'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
const profile = join(tmpdir(), `perch-rec-${Date.now()}`);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`, '--window-size=960,540',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', 'about:blank',
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const handlers = [];
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

try {
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9333/json/list')).json(); break; } catch { await sleep(200); }
  }
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    } else if (m.method) handlers.forEach((h) => h(m));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8766/dev/demo.html' });
  for (let i = 0; i < 100 && !(await evalJs('!!window.ready').catch(() => false)); i++) await sleep(100);
  await sleep(1200); // first perch scan

  // Mouse helpers: real input events (so Perch sees them), eased paths.
  let mouse = { x: 1000, y: 470 };
  const move = async (x, y, ms = 1200) => {
    const from = { ...mouse }, start = Date.now();
    for (let t = 0; t < 1;) {
      t = Math.min(1, (Date.now() - start) / ms + 0.001);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      mouse = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mouse.x, y: mouse.y });
      await sleep(16);
    }
  };
  // Ease toward a bird, re-reading where it is every step (birds hop).
  const moveToBird = async (sp, ms) => {
    const from = { ...mouse }, start = Date.now();
    let tgt = null;
    for (let t = 0; t < 1;) {
      tgt = (await birdAt(sp)) ?? tgt;
      if (!tgt) return false;
      t = Math.min(1, (Date.now() - start) / ms + 0.001);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      mouse = { x: from.x + (tgt.x - from.x) * e, y: from.y + (tgt.y - from.y) * e };
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mouse.x, y: mouse.y });
      await sleep(16);
    }
    return true;
  };
  const click = async () => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mouse.x, y: mouse.y, button: 'left', clickCount: 1 });
    await sleep(70);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mouse.x, y: mouse.y, button: 'left', clickCount: 1 });
  };
  const birdAt = (sp) => evalJs(`(() => { const b = perch.aviary.birds.find(b => b.sp.id === '${sp}' && b.state === 'perched'); if (!b) return null; const c = b.center(); return { x: c.x, y: c.y }; })()`);
  const summon = (sp) => evalJs(`perch.summon(1, '${sp}')`);

  // Record.
  const frames = [];
  handlers.push(async (m) => {
    if (m.method !== 'Page.screencastFrame') return;
    const { data, metadata, sessionId } = m.params;
    const f = join(OUT, 'frames', `${String(frames.length).padStart(5, '0')}.jpg`);
    frames.push({ f, t: metadata.timestamp });
    writeFileSync(f, Buffer.from(data, 'base64'));
    send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  const t0 = Date.now();
  const at = async (sec) => { const d = t0 + sec * 1000 - Date.now(); if (d > 0) await sleep(d); };

  // ── choreography ──
  await at(0.4); await summon('house_sparrow');
  await at(1.6); await summon('northern_cardinal');
  await at(2.8); await summon('blue_jay');
  await at(3.8); await summon('ruby_throated_hummingbird');
  await at(4.8); await summon('american_goldfinch');
  await at(6.6);
  const target = (await birdAt('northern_cardinal')) ?? (await birdAt('blue_jay')) ?? (await birdAt('house_sparrow'));
  if (target) {
    await move(target.x + 110, target.y + 90, 900);
    const sp = await evalJs(`perch.aviary.birds.find(b => b.state === 'perched' && Math.hypot(b.center().x - ${target.x}, b.center().y - ${target.y}) < 5)?.sp.id`) ?? 'northern_cardinal';
    await moveToBird(sp, 1300);
    await sleep(250);
    const live = await birdAt(sp);
    if (live) await move(live.x, live.y, 250);
    await sleep(150);
    await click();
    await sleep(1100);
    const toast = await evalJs(`(() => { const r = [...document.body.children].find(e => e.shadowRoot?.querySelector('.toast'))?.shadowRoot.querySelector('.toast')?.getBoundingClientRect(); return r && { x: r.x + r.width * 0.45, y: r.y + r.height / 2 }; })()`);
    if (toast) {
      await move(toast.x, toast.y, 700);
      await sleep(450);
      await click();
      await sleep(2300);
      const close = await evalJs(`(() => { const r = [...document.body.children].find(e => e.shadowRoot?.querySelector('.book-wrap'))?.shadowRoot.querySelector('[data-act=close]')?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (close) { await move(close.x, close.y, 600); await sleep(250); await click(); }
    }
  }
  await summon('thunderbird');
  await move(880, 500, 700);
  await sleep(4800);
  await send('Page.stopScreencast');
  await sleep(300);

  // ffmpeg concat list with real frame durations.
  let list = '';
  for (let i = 0; i < frames.length; i++) {
    const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.1;
    list += `file '${frames[i].f}'\nduration ${Math.max(0.001, d).toFixed(4)}\n`;
  }
  list += `file '${frames.at(-1).f}'\n`;
  writeFileSync(join(OUT, 'frames.txt'), list);
  console.log(`frames: ${frames.length}, span: ${(frames.at(-1).t - frames[0].t).toFixed(1)}s`);

  // Encode: a 19 s 1080p MP4 for sharing, and a small GIF for the README.
  mkdirSync(join(ROOT, 'build'), { recursive: true });
  const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  const src = ['-f', 'concat', '-safe', '0', '-i', join(OUT, 'frames.txt'), '-t', '19'];
  ff(...src, '-vf', 'fps=30,scale=1920:1080:flags=lanczos,fade=t=in:st=0:d=0.4,fade=t=out:st=18.4:d=0.6,format=yuv420p',
    '-c:v', 'libx264', '-crf', '19', '-preset', 'slow', '-movflags', '+faststart', join(ROOT, 'build', 'perch-demo.mp4'));
  ff(...src, '-vf', 'fps=15,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    join(ROOT, 'docs', 'demo.gif'));
  console.log('wrote build/perch-demo.mp4 and docs/demo.gif');
} finally {
  ws?.close();
  chrome.kill();
  server.kill();
  setTimeout(() => { for (const d of [profile, OUT]) try { rmSync(d, { recursive: true, force: true }); } catch {} }, 1500);
}
