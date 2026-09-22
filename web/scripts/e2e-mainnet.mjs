/**
 * The same browser drive as e2e.mjs, against MAINNET with a real wallet. The page gets an injected
 * wallet whose requests go to a small local signer (below) that holds the key, signs, and forwards
 * everything else to the chain. Phases keep each run short and restartable:
 *
 *   WALLET=A|B PHASE=address|shield|send|trade|withdraw [TOKEN=USDG] [AMOUNT=1] [TO=elysian1…] [BUY="AI ·"] node web/scripts/e2e-mainnet.mjs <baseUrl>
 *
 * Keys come from the repo-root .env: DEPLOYER_KEY (wallet A) and TEST_WALLET_KEY (wallet B). Every
 * shielded key is derived from a wallet signature, so nothing this script shields can be stranded.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createWalletClient, http as viemHttp, hexToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const account = privateKeyToAccount(process.env.WALLET === 'B' ? process.env.TEST_WALLET_KEY : process.env.DEPLOYER_KEY);
const UPSTREAM = `https://robinhood-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`;
const chain = { id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [UPSTREAM] } } };
const signer = createWalletClient({ account, chain, transport: viemHttp(UPSTREAM) });
const sent = [];

/** Local signer: answers the wallet-only methods itself and relays the rest to the chain. */
createServer(async (req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const { id, method, params = [] } = JSON.parse(raw);
  const reply = (result) => res.writeHead(200, cors).end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  try {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return reply([account.address]);
    if (method === 'eth_chainId') return reply('0x1237');
    if (method === 'net_version') return reply('4663');
    if (method === 'personal_sign') return reply(await account.signMessage({ message: { raw: hexToBytes(params[0]) } }));
    if (method === 'eth_sendTransaction') {
      const t = params[0];
      const hash = await signer.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined });
      sent.push(hash);
      return reply(hash);
    }
    const up = await fetch(UPSTREAM, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    res.writeHead(200, cors).end(await up.text());
  } catch (e) {
    res.writeHead(200, cors).end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: e.shortMessage ?? e.message } }));
  }
}).listen(8549, '127.0.0.1');

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
  const RPC = 'http://127.0.0.1:8549';
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

const PHASE = process.env.PHASE ?? 'address';
const TOKEN = process.env.TOKEN ?? 'USDG';
const AMOUNT = process.env.AMOUNT ?? '1';

try {
  console.log(`mainnet ${PHASE}: wallet ${process.env.WALLET ?? 'A'} ${account.address}`);
  await goto('/app');
  await clickText('Connect wallet');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Sign to derive keys'))`, 30000, 'derive button');
  await clickText('Sign to derive keys');
  await waitFor(bodyHas('Shielded balances'), 30000, 'overview');
  await waitFor(bodyHas('node online'), 30000, 'node online');
  step('connected on Robinhood Chain, keys derived, node online');
  const balances = async () => {
    await goto('/app');
    await sleep(6000);
    return evaluate(`[...document.querySelectorAll('li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim()).filter(t => /Send ?Trade/.test(t)).map(t => t.replace(/Send ?Trade/, '')).join(' | ') || 'nothing shielded'`);
  };

  if (PHASE === 'address') {
    await goto('/app/keys');
    await waitFor(`document.querySelector('p.mono')`, 20000, 'address');
    console.log('ADDRESS ' + (await evaluate(`document.querySelector('p.mono').textContent`)));
  }

  if (PHASE === 'shield') {
    await goto('/app/shield');
    await waitFor(`document.querySelector('select') && document.querySelector('select').options.length > 1`, 30000, 'asset select');
    await setSelect(0, TOKEN);
    await sleep(2500);
    await setValue('input[inputmode="decimal"]', AMOUNT);
    await sleep(1000);
    await clickText('Approve and shield');
    await waitFor(bodyHas('Shielded.'), 300000, 'shield receipt');
    step(`shielded ${AMOUNT} ${TOKEN}`);
  }

  if (PHASE === 'send') {
    await goto('/app/send');
    await waitFor(`document.querySelector('select') && document.querySelector('select').options.length > 1`, 30000, 'send select');
    await setSelect(0, TOKEN);
    await sleep(800);
    await setValue('input[inputmode="decimal"]', AMOUNT);
    await setValue('input[placeholder="elysian1…"]', process.env.TO);
    await setValue('input[placeholder="Only the recipient can read this"]', process.env.MEMO ?? 'mainnet test');
    await sleep(800);
    await clickText('Send privately');
    await waitFor(bodyHas('Sent.'), 300000, 'transfer receipt');
    step(`sent ${AMOUNT} ${TOKEN} privately through the relayer`);
  }

  if (PHASE === 'trade') {
    const BUY = process.env.BUY ?? 'AI ·';
    await goto('/app/trade');
    // Both lists: the "From" list fills once the wallet's first sync has found the shielded notes.
    await waitFor(`document.querySelectorAll('select').length === 2 && document.querySelectorAll('select')[0].options.length > 1 && document.querySelectorAll('select')[1].options.length > 1`, 60000, 'trade selects');
    await setSelect(0, TOKEN);
    await sleep(600);
    await setSelect(1, BUY);
    await sleep(600);
    await setValue('input[inputmode="decimal"]', AMOUNT);
    await sleep(4000);
    step('venue quote: ' + (await evaluate(`[...document.querySelectorAll('dd, .tabular, span')].map(e => e.textContent).find(t => /^[\\d,.]+ AI$/.test(t.trim())) ?? 'n/a'`)));
    await clickText('Seal into batch');
    await waitFor(bodyHas('Intent sealed'), 300000, 'intent receipt');
    step('order sealed; waiting for the batch to clear on Uniswap');
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 420000) {
      ready = await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Claim' && !b.disabled)`);
      if (ready) break;
      await sleep(4000);
    }
    if (!ready) throw new Error('batch never became claimable');
    step(`batch cleared after ${Math.round((Date.now() - t0) / 1000)} s`);
    await clickText('Claim');
    await waitFor(bodyHas('Claimed into the pool'), 300000, 'claim receipt');
    step('claimed');
  }

  if (PHASE === 'withdraw') {
    await goto('/app/send');
    await waitFor(`document.querySelector('select') && document.querySelector('select').options.length > 1`, 30000, 'send select');
    await clickText('Unshield');
    await sleep(500);
    await setSelect(0, TOKEN);
    await sleep(1200);
    if (process.env.AMOUNT) await setValue('input[inputmode="decimal"]', AMOUNT);
    else if (!(await evaluate(`(() => { const el = [...document.querySelectorAll('button, [role=button]')].find(e => e.textContent.trim().toLowerCase().startsWith('max')); if (!el) return false; el.click(); return true; })()`))) throw new Error('no Max control');
    await setValue('input[placeholder="0x…"]', process.env.TO ?? account.address);
    await sleep(800);
    step('withdrawing ' + (await evaluate(`document.querySelector('input[inputmode="decimal"]').value`)) + ` ${TOKEN.replace(' ·', '')} to ${process.env.TO ?? account.address}`);
    await clickSubmit();
    await waitFor(bodyHas('Sent.'), 300000, 'unshield receipt');
    step('withdrawn');
  }

  step('shielded balances now: ' + (await balances()));
  if (sent.length) step('wallet transactions: ' + sent.join(', '));
  console.log('mainnet ' + PHASE + ': ok');
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
