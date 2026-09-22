'use client';

import { useState } from 'react';
import { encodeViewingKey } from '@elysian/core';
import { Gate } from '@/components/app/Gate';
import { Notice, PageHead } from '@/components/app/Pieces';
import { useShielded } from '@/lib/wallet/store';

export default function KeysPage() {
  return (
    <Gate>
      <Keys />
    </Gate>
  );
}

function Keys() {
  const w = useShielded();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const viewingKey = revealed && w.key ? encodeViewingKey(w.key.viewingKey()) : '';

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <>
      <PageHead n="04" title="Keys" sub="Your shielded identity is derived from one wallet signature. Whoever holds that signature holds your balance, so only sign it here. Share the address freely. Share the viewing key deliberately." />
      <div className="space-y-px bg-[var(--line)]">
        <section className="bg-[var(--bg)] p-6 md:p-8">
          <div className="flex items-center justify-between">
            <span className="label">Shielded address</span>
            <button type="button" className="label text-[10px] hover:text-[var(--ink)]" onClick={() => copy('address', w.address!)}>
              {copied === 'address' ? 'copied' : 'copy'}
            </button>
          </div>
          <p className="mono mt-4 break-all text-[13px] leading-[1.7] text-[var(--ink)]">{w.address}</p>
          <p className="mt-4 text-[12px] leading-[1.6] text-[var(--ink-3)]">
            Anyone can send to this address. It contains your note owner key and an encryption key, and nothing that can spend.
          </p>
        </section>

        <section className="bg-[var(--bg)] p-6 md:p-8">
          <div className="flex items-center justify-between">
            <span className="label">Full viewing key</span>
            {revealed ? (
              <button type="button" className="label text-[10px] hover:text-[var(--ink)]" onClick={() => copy('view', viewingKey)}>
                {copied === 'view' ? 'copied' : 'copy'}
              </button>
            ) : null}
          </div>
          {revealed ? (
            <p className="mono mt-4 break-all text-[13px] leading-[1.7] text-[var(--bone)]">{viewingKey}</p>
          ) : (
            <div className="mt-4">
              <button type="button" className="btn" onClick={() => setRevealed(true)}>
                Reveal viewing key
              </button>
            </div>
          )}
          <div className="mt-4">
            <Notice>
              A viewing key lets its holder see every note you own, every memo you received, and when each was spent. It cannot spend.
              Give it to an accountant or a court, and to no one else.
            </Notice>
          </div>
        </section>

        <section className="bg-[var(--bg)] p-6 md:p-8">
          <span className="label">Session</span>
          <p className="mt-4 text-[13px] leading-[1.6] text-[var(--ink-2)]">
            The spending key lives in this tab’s memory and nowhere else. Reloading or closing the tab forgets it, and so does switching
            wallet account or chain. Signing the same message with the same wallet derives it again.
          </p>
          <button type="button" className="btn mt-6" onClick={() => w.forget()}>
            Forget keys now
          </button>
        </section>
      </div>
    </>
  );
}
