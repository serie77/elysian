'use client';

import { PROTOCOL_VERSION, type Groth16Proof } from '@elysian/core';

/** Proving artifacts are served under the protocol version, so a cached older release can never prove with the wrong keys. */
export const ARTIFACT_BASE = `/circuits/v${PROTOCOL_VERSION}`;

type Circuit = 'transaction' | 'swapClaim';

export interface ProveProgress {
  stage: 'loading' | 'proving';
  progress: number;
}

let worker: Worker | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (v: { proof: Groth16Proof; publicSignals: string[]; ms: number }) => void; reject: (e: Error) => void; onProgress?: (p: ProveProgress) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker('/prover.worker.js');
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as { id: number; type: string; stage?: ProveProgress['stage']; progress?: number; proof?: Groth16Proof; publicSignals?: string[]; ms?: number; message?: string };
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === 'progress') p.onProgress?.({ stage: m.stage!, progress: m.progress ?? 0 });
    else if (m.type === 'done') {
      pending.delete(m.id);
      p.resolve({ proof: m.proof!, publicSignals: m.publicSignals!, ms: m.ms ?? 0 });
    } else if (m.type === 'error') {
      pending.delete(m.id);
      p.reject(new Error(m.message ?? 'proof failed'));
    }
  };
  return worker;
}

export function prove(circuit: Circuit, inputs: Record<string, unknown>, onProgress?: (p: ProveProgress) => void) {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise<{ proof: Groth16Proof; publicSignals: string[]; ms: number }>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, circuit, inputs, base: ARTIFACT_BASE });
  });
}

/** Warm the artifact cache in the background so the first proof does not wait on a download. */
export function warmProver() {
  if (typeof window === 'undefined') return;
  fetch(`${ARTIFACT_BASE}/transaction.zkey`, { method: 'HEAD' }).catch(() => undefined);
}
