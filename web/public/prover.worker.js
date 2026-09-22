/* Elysian prover worker: runs Groth16 proving off the main thread. */
importScripts('/snarkjs.min.js');

// The page names the artifact directory, which carries the protocol version, so a browser that cached an
// earlier release can never prove with the wrong keys.
const artifacts = (base, name) => ({ wasm: `${base}/${name}.wasm`, zkey: `${base}/${name}.zkey` });

const cache = {};

async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`missing ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total && onProgress) onProgress(received / total);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function load(base, name, id) {
  const key = `${base}/${name}`;
  if (cache[key]) return cache[key];
  const a = artifacts(base, name);
  const [wasm, zkey] = await Promise.all([
    fetchBytes(a.wasm),
    fetchBytes(a.zkey, (p) => postMessage({ id, type: 'progress', stage: 'loading', progress: p })),
  ]);
  cache[key] = { wasm, zkey };
  return cache[key];
}

onmessage = async (e) => {
  const { id, circuit, inputs, base } = e.data;
  try {
    const { wasm, zkey } = await load(base, circuit, id);
    postMessage({ id, type: 'progress', stage: 'proving', progress: 0 });
    const t0 = performance.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(inputs, wasm, zkey);
    postMessage({ id, type: 'done', proof, publicSignals, ms: performance.now() - t0 });
  } catch (err) {
    postMessage({ id, type: 'error', message: (err && err.message) || String(err) });
  }
};
