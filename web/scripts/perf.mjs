/**
 * Frame pacing check in real Chrome with the GPU on: idles on the hero, then scrolls the whole page,
 * and reports how long frames took.
 *   node web/scripts/perf.mjs <url> [width] [height]
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
const [url, w = '1920', h = '1080'] = process.argv.slice(2);
const port = 9400 + Math.floor(Math.random() * 400);
const profile = `${process.cwd()}/cdp-profile-${port}`;
const chrome = spawn(process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', '--no-first-run', '--enable-gpu-rasterization', '--disable-frame-rate-limit=false', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); break; } catch { await sleep(250); } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false });
await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });
await sleep(6500);

const sample = (body) => `(async () => {
  const d = []; let last = performance.now(); let on = true;
  const tick = (t) => { d.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  ${body}
  on = false;
  d.shift(); d.sort((a, b) => a - b);
  const sum = d.reduce((a, b) => a + b, 0);
  return { frames: d.length, fps: +(1000 * d.length / sum).toFixed(1), p50: +d[Math.floor(d.length * 0.5)].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), worst: +d[d.length - 1].toFixed(1), slow: +(100 * d.filter((x) => x > 20).length / d.length).toFixed(1) };
})()`;
const gpu = await evaluate(`(() => { const c = document.createElement('canvas').getContext('webgl'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
console.log(`renderer: ${gpu}`);
console.log('hero idle  ', JSON.stringify(await evaluate(sample('await new Promise((r) => setTimeout(r, 4000));'))));
console.log('full scroll', JSON.stringify(await evaluate(sample(`
  const end = document.documentElement.scrollHeight - innerHeight; const t0 = performance.now(); const dur = 14000;
  await new Promise((done) => { const step = () => { const k = Math.min(1, (performance.now() - t0) / dur); window.scrollTo(0, end * k); k < 1 ? requestAnimationFrame(step) : done(); }; step(); });`))));
ws.close(); chrome.kill(); await sleep(400); rmSync(profile, { recursive: true, force: true });
