/**
 * Drives the Elysian web app end to end in headless Chrome with an injected EIP-1193 provider that
 * forwards to the local Hardhat node (which signs for its unlocked accounts).
 *   node web/scripts/e2e.mjs <baseUrl>   (needs the local stack from npm run dev and a Chrome binary; set CHROME to override)
 */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:3002';
const port = 9333 + Math.floor(Math.random() * 500);
const profile = `${process.cwd()}/cdp-profile-${port}`;
rmSync(profile, { recursive: true, force: true });
const chrome = spawn(
  process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40; i++) {
  try {
    target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    break;
  } catch {
    await sleep(250);
  }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
const NL = String.fromCharCode(10);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(`[console.${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
  }
  if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description?.split(NL)[0] ?? m.params.exceptionDetails.text}`);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && !m.params.response.url.includes('favicon')) {
    logs.push(`[http ${m.params.response.status}] ${m.params.response.url.slice(0, 160)}`);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`e2e-${name}.png`, Buffer.from(r.result.data, 'base64'));
};
const step = (m) => console.log(`  ${m}`);

const providerScript = `
(() => {
  const RPC = 'http://127.0.0.1:8545';
  let seq = 0;
  const listeners = {};
  const rpc = async (method, params) => {
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params: params ?? [] }) });
    const j = await res.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
    return j.result;
  };
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      (window.__calls ||= []).push(method);
      if (method === 'eth_requestAccounts') return rpc('eth_accounts');
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'wallet_getPermissions' || method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }];
      return rpc(method, params);
    },
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
    removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
  };
})();`;

await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: providerScript });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

const waitFor = async (expr, timeout = 30000, label = expr) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(`!!(${expr})`)) return;
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${label}`);
};
const soft = async (path) => {
  const ok = await evaluate(`(() => { const a = document.querySelector('a[href=${JSON.stringify(path)}]'); if (!a) return false; a.click(); return true; })()`);
  if (ok) await waitFor(`location.pathname === ${JSON.stringify(path)}`, 30000, `navigation to ${path}`);
  return ok;
};
// The spending key lives in page memory only, so move between app pages the way a user does: through the nav links.
// A page revisited in a row is left and re-entered so its form starts clean. A full load happens only when no nav exists yet.
const goto = async (path) => {
  if ((await evaluate(`location.pathname === ${JSON.stringify(path)}`)) && (await soft(path === '/app' ? '/app/keys' : '/app'))) await sleep(200);
  if (await soft(path)) {
    await sleep(300);
    return;
  }
  await send('Page.navigate', { url: `${base}${path}` });
  await waitFor(`(() => { const b = document.querySelector('button'); return b && Object.keys(b).some(k => k.startsWith('__reactFiber')); })()`, 60000, 'hydration');
};
const clickText = async (text, tag = 'button') => {
  const ok = await evaluate(
    `(() => { const el = [...document.querySelectorAll('${tag}')].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && !e.disabled && e.offsetParent !== null); if (!el) return false; el.click(); return true; })()`,
  );
  if (!ok) throw new Error(`no clickable ${tag} "${text}"`);
};
const setValue = async (selector, value) => {
  await evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('missing ' + ${JSON.stringify(selector)}); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; })()`,
  );
};
const optionValue = (selectIndex, prefix) =>
  evaluate(`[...document.querySelectorAll('select')[${selectIndex}].options].find(o => o.textContent.startsWith(${JSON.stringify(prefix)})).value`);
const setSelect = async (selectIndex, prefix) => {
  const v = await optionValue(selectIndex, prefix);
  await evaluate(
    `(() => { const s = document.querySelectorAll('select')[${selectIndex}]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
  );
};
const clickSubmit = async () => {
  const ok = await evaluate(`(() => { const b = document.querySelector('form button[type="submit"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
  if (!ok) throw new Error('submit button missing or disabled');
};
const bodyHas = (t) => `document.body.textContent.includes(${JSON.stringify(t)})`;
const mine = () =>
  fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }) });

try {
  console.log('e2e: connect and derive');
  await goto('/app');
  await clickText('Connect wallet');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Sign to derive keys'))`, 30000, 'derive button');
  step('wallet connected');
  await clickText('Sign to derive keys');
  await waitFor(bodyHas('Shielded balances'), 30000, 'overview');
  await waitFor(bodyHas('node online'), 20000, 'node online');
  step('keys derived, node online');
  await shot('overview');

  console.log('e2e: shield 25 NVDA');
  await goto('/app/shield');
  await waitFor(`document.querySelector('select') && document.querySelector('select').options.length > 1`, 30000, 'asset select');
  await setSelect(0, 'NVDA');
  await sleep(1500);
  await setValue('input[inputmode="decimal"]', '25');
  await sleep(800);
  await clickText('Approve and shield');
  await waitFor(bodyHas('Shielded.'), 240000, 'shield receipt');
  step(await evaluate(`[...document.querySelectorAll('.label')].map(l => l.textContent).find(t => t.startsWith('Proved in')) ?? 'proved'`));
  await shot('shielded');

  await goto('/app');
  await waitFor(`${bodyHas('NVDA')} && !${bodyHas('Nothing shielded yet')}`, 60000, 'balance');
  step(`shielded balance shows ${await evaluate(`document.querySelector('li .tabular')?.textContent`)} NVDA`);

  console.log('e2e: private transfer 5 NVDA to self via relayer');
  await goto('/app/keys');
  await waitFor(`document.querySelector('p.mono')`, 20000, 'address');
  const addr = await evaluate(`document.querySelector('p.mono').textContent`);
  if (!addr.startsWith('elysian1')) throw new Error('bad address ' + addr);
  step(`address ${addr.slice(0, 20)}…`);
  await goto('/app/send');
  await waitFor(`document.querySelector('select') && document.querySelector('select').options.length > 1`, 30000, 'send select');
  await setSelect(0, 'NVDA');
  await sleep(500);
  await setValue('input[inputmode="decimal"]', '5');
  await setValue('input[placeholder="elysian1…"]', addr);
  await setValue('input[placeholder="Only the recipient can read this"]', 'e2e memo');
  await sleep(500);
  await clickText('Send privately');
  await waitFor(bodyHas('Sent.'), 240000, 'transfer receipt');
  step('transfer relayed');
  await shot('sent');

  console.log('e2e: unshield 2 NVDA to a fresh address via relayer');
  await goto('/app/send');
  await waitFor(`document.querySelector('select') && document.querySelector('select').options.length > 1`, 30000, 'send select');
  await clickText('Unshield');
  await sleep(300);
  await setSelect(0, 'NVDA');
  await sleep(400);
  await setValue('input[inputmode="decimal"]', '2');
  await setValue('input[placeholder="0x…"]', '0x00000000000000000000000000000000000000bb');
  await sleep(400);
  await clickSubmit();
  await waitFor(bodyHas('Sent.'), 240000, 'unshield receipt');
  step('unshield relayed with fee');

  console.log('e2e: add a token by address and wrap ETH');
  await goto('/app/shield');
  await waitFor(`document.querySelector('select') && document.querySelector('select').options.length > 1`, 30000, 'asset select');
  step('picker options: ' + (await evaluate(`[...document.querySelector('select').options].map(o => o.textContent.trim()).join(' | ')`)));
  const wethAddr = await optionValue(0, 'WETH');
  await evaluate(`(() => { const s = document.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '__custom__'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
  await setValue('input[placeholder^="0x… ERC-20"]', wethAddr);
  await clickText('Add');
  await waitFor(bodyHas('Wrap ETH first'), 30000, 'custom token resolved as WETH');
  step('custom token resolved from chain');
  await setValue('input[placeholder="0.0"]', '1');
  await clickText('Wrap');
  await waitFor(`[...document.querySelectorAll('.label')].some(l => /ETH in wallet/.test(l.textContent)) && ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Wrapping')`, 120000, 'wrap receipt');
  await sleep(1500);
  step('wrapped 1 ETH');
  await setValue('.field .relative input[inputmode="decimal"]', '0.5');
  await sleep(900);
  await clickSubmit();
  await waitFor(bodyHas('Shielded.'), 240000, 'weth shield receipt');
  step('shielded 0.5 WETH');

  console.log('e2e: swap intent 3 NVDA -> USDG');
  await goto('/app/trade');
  await waitFor(`document.querySelectorAll('select').length === 2 && document.querySelectorAll('select')[1].options.length > 1`, 30000, 'trade selects');
  await setSelect(0, 'NVDA');
  await sleep(400);
  await setSelect(1, 'USDG');
  await sleep(400);
  await setValue('input[inputmode="decimal"]', '3');
  await sleep(1500);
  step('venue quote: ' + (await evaluate(`[...document.querySelectorAll('.tabular')].map(e => e.textContent).find(t => t.includes('USDG')) ?? 'n/a'`)));
  await clickText('Seal into batch');
  await waitFor(bodyHas('Intent sealed'), 240000, 'intent receipt');
  step('intent sealed');
  await shot('intent');

  console.log('e2e: wait for the batch to clear, then claim');
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 240000) {
    await mine();
    ready = await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Claim' && !b.disabled)`);
    if (ready) break;
    await sleep(3000);
  }
  if (!ready) throw new Error('batch never became claimable');
  await clickText('Claim');
  await waitFor(bodyHas('Claimed into the pool'), 240000, 'claim receipt');
  step('claimed');
  await shot('claimed');

  await goto('/app');
  await waitFor(bodyHas('USDG'), 60000, 'usdg balance');
  step(`balances: ${await evaluate(`[...document.querySelectorAll('li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim()).filter(t => /NVDA|USDG|WETH/.test(t)).join(' | ')`)}`);
  await goto('/app/activity');
  await waitFor(bodyHas('e2e memo'), 30000, 'memo visible in activity');
  step('memo decrypted in activity');
  await shot('final');
  console.log('e2e: ok');
} catch (e) {
  console.error('e2e failed:', e.message);
  await shot('failure');
  console.log((await evaluate(`document.body.innerText.slice(0, 1200)`).catch(() => '')).replace(/\s+/g, ' '));
} finally {
  console.log(logs.length ? logs.join(NL) : '(no console errors)');
  ws.close();
  chrome.kill();
  await sleep(800);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* chrome still releasing files */
  }
  process.exit(0);
}
