/**
 * Headless Chrome snapshots of a page at scroll stops, with console and network error capture.
 *   node web/scripts/snapshot.mjs <url> <outPrefix> [width] [height] [scrollStops...]
 * Env: WAIT (ms before first shot), EVAL (expression evaluated at the end), ALL (log every console type), CHROME (binary path).
 */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
const [url, prefix, w = '1440', h = '900', ...stops] = process.argv.slice(2);
const port = 9333 + Math.floor(Math.random() * 500);
const profile = `${process.cwd()}/cdp-profile-${port}`;
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); break; } catch { await sleep(250); } }
if (!target) throw new Error('chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = []; const NL = String.fromCharCode(10);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (process.env.ALL || ['error', 'warning'].includes(m.params.type)) {
      const frames = m.params.stackTrace ? m.params.stackTrace.callFrames.slice(0, 7).map((f) => `${f.functionName || '?'}@${f.url.split('/').pop().split('?')[0]}:${f.lineNumber}`).join(' < ') : '';
      logs.push(`[console.${m.params.type}] ${text.slice(0, 400)}` + (frames ? `${NL}    ${frames}` : ''));
    }
  } else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) { logs.push(`[http ${m.params.response.status}] ${m.params.response.url.slice(0, 200)}`); }
  else if (m.method === 'Network.loadingFailed') { logs.push(`[load failed] ${m.params.errorText} ${m.params.type}`); }
  else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; logs.push(`[exception] ${d.exception?.description?.split(NL).slice(0, 3).join(' | ') ?? d.text}`); }
};
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${prefix}-${name}.png`, Buffer.from(r.result.data, 'base64')); };
await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: Number(process.env.SCALE ?? 1), mobile: Number(w) < 600 });
await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });
await sleep(Number(process.env.WAIT ?? 6000));
if (process.env.CLICK) { await evaluate(`(() => { const el = [...document.querySelectorAll('button, a')].find(e => e.textContent.includes(${JSON.stringify(process.env.CLICK)})); if (el) el.click(); return !!el; })()`); await sleep(600); }
await shot('0');
console.log('hidden .will-reveal:', await evaluate(`[...document.querySelectorAll('.will-reveal')].filter(e => getComputedStyle(e).opacity === '0').length + ' of ' + document.querySelectorAll('.will-reveal').length`));
console.log('doc height:', await evaluate('document.documentElement.scrollHeight'));
for (const s of stops) {
  await evaluate(`window.scrollTo({ top: ${s}, behavior: 'instant' }); window.dispatchEvent(new Event('scroll'));`);
  await sleep(1800); await shot(String(s));
  console.log(`scroll ${s}: hidden in view:`, await evaluate(`[...document.querySelectorAll('.will-reveal')].filter(e => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && getComputedStyle(e).opacity === '0'; }).map(e => e.className.split(' ').slice(0,3).join('.') + '@' + Math.round(e.getBoundingClientRect().top)).slice(0, 8).join(', ') || '-'`));
}
if (process.env.EVAL) console.log('eval:', await evaluate(process.env.EVAL));
console.log(logs.length ? logs.join(NL) : '(no console errors)');
ws.close(); chrome.kill(); await sleep(800);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
