/**
 * Records brand/video/elysian.html to brand/elysian-10s.mp4 with headless Chrome: the page draws every frame on a
 * canvas and encodes H.264 itself (WebCodecs + mp4-muxer), so nothing but Chrome is needed.
 *   node brand/video/record.mjs            # writes the MP4 and five preview frames under brand/video/frames
 *   FRAMES=1 node brand/video/record.mjs   # preview frames only
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const icons = JSON.parse(readFileSync(path.join(here, '../../web/src/lib/token-icons.json'), 'utf8'));
const page = path.join(here, '.elysian.render.html');
writeFileSync(page, readFileSync(path.join(here, 'elysian.html'), 'utf8').split('__NVDA__').join(icons.NVDA).split('__AAPL__').join(icons.AAPL));

const port = 9400 + Math.floor(Math.random() * 400);
const profile = path.join(here, `.chrome-${port}`);
const chrome = spawn(process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) {
  try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await sleep(250); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Page.navigate', { url: pathToFileURL(page).href });
  await sleep(1500);
  await evaluate('window.__ready');
  console.log('h264 supported:', await evaluate('window.__support()'));
  const frames = path.join(here, 'frames');
  rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });
  for (const t of [1.2, 3.4, 4.6, 6.3, 8.4, 9.9]) {
    await evaluate(`window.__seek(${t})`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(frames, `t${t.toFixed(1)}.png`), Buffer.from(shot.result.data, 'base64'));
  }
  console.log('preview frames written');
  if (!process.env.FRAMES) {
    const t0 = Date.now();
    const size = await evaluate('window.__record()');
    const parts = [];
    for (let offset = 0; offset < size; offset += 3_000_000) parts.push(Buffer.from(await evaluate(`window.__chunk(${offset}, 3000000)`), 'base64'));
    const out = path.join(here, '..', 'elysian-10s.mp4');
    writeFileSync(out, Buffer.concat(parts));
    console.log(`elysian-10s.mp4  ${(size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
} finally {
  ws.close(); chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
