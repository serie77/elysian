// Read-only local explorer QA. Independent headless Chrome fallback when the in-app browser is unavailable.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpendingKey, encodeViewingKey } from '../../packages/core/dist/index.js';

const observations = JSON.parse(readFileSync(new URL('./privacy-observations.json', import.meta.url), 'utf8'));
const profile = mkdtempSync(join(tmpdir(), 'elysian-privacy-audit-'));
const port = 9643;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 40; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); break; }
    catch { await sleep(250); }
  }
  if (!target) throw new Error('Headless Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  const pending = new Map();
  const requests = [];
  const errors = [];
  let id = 0;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    const timeout = setTimeout(() => { pending.delete(i); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(i, value => { clearTimeout(timeout); resolve(value); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  const pages = [];
  for (const [label, path] of [
    ['home', '/explorer'],
    ['claim', `/explorer/tx/${observations.claims[0].hash}`],
    ['batch', `/explorer/tx/${observations.batches.rows[0].tx}`],
    ['view', '/explorer/view'],
  ]) {
    await send('Page.navigate', { url: `http://localhost:3002${path}` });
    await sleep(3500);
    const text = await evaluate('document.body.innerText');
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(new URL(`./explorer-${label}.png`, import.meta.url), Buffer.from(r.result.data, 'base64'));
    const p = { label, path, text };
    if (label === 'claim') {
      await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Privacy').click()");
      await sleep(250);
      p.privacyText = await evaluate('document.body.innerText');
    }
    if (label === 'view') {
      const syntheticKey = encodeViewingKey(SpendingKey.random().viewingKey());
      const before = requests.length;
      await evaluate(`(() => { const input = document.querySelector('input[placeholder^="elysianview"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(syntheticKey)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(200);
      await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Decrypt').click()");
      await sleep(3500);
      p.afterScanText = await evaluate('document.body.innerText');
      p.syntheticViewingKeyInNetwork = requests.slice(before).some(r => JSON.stringify(r).includes(syntheticKey));
      p.scanRequestUrls = requests.slice(before).map(r => r.url);
    }
    pages.push(p);
  }
  const result = { capturedAt: new Date().toISOString(), pages, errors, requestOrigins: [...new Set(requests.map(r => new URL(r.url).origin))] };
  writeFileSync(new URL('./explorer-browser.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ pages: pages.map(p => ({ label: p.label, loaded: !p.text.includes('Node unreachable'), proofBadge: p.text.includes('Groth16, verified on-chain'), privacyText: p.privacyText, syntheticViewingKeyInNetwork: p.syntheticViewingKeyInNetwork, afterScanText: p.afterScanText })), errors, requestOrigins: result.requestOrigins }, null, 2));
} finally {
  ws?.close();
  chrome.kill();
}
