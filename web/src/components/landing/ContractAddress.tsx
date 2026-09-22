'use client';

import { useState } from 'react';
import { short } from '@/lib/assets';
import { TOKEN_CA } from '@/lib/token';

/** The token's contract address with one-tap copy. Until there is one, the address sits under a redaction bar. */
export function ContractAddress({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(TOKEN_CA);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!TOKEN_CA}
      className={`ca-box group flex h-12 w-full max-w-[560px] items-center gap-4 rounded-[2px] border border-[var(--line-strong)] bg-[rgba(var(--bg-rgb),0.8)] pl-4 pr-1.5 text-left transition-colors enabled:hover:border-[var(--bone-2)] disabled:cursor-default ${className}`}
      data-cursor={TOKEN_CA ? 'Copy' : undefined}
      aria-label={TOKEN_CA ? 'Copy contract address' : 'Contract address, not announced yet'}
    >
      <span className="mono text-[11px] tracking-[0.16em] text-[var(--ink-3)]">CA</span>
      <span className="mono min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">
        {TOKEN_CA ? (
          <>
            <span className="sm:hidden">{short(TOKEN_CA, 8)}</span>
            <span className="hidden sm:inline">{TOKEN_CA}</span>
          </>
        ) : (
          <span className="bar w-full max-w-[340px] opacity-25" />
        )}
      </span>
      <span className="flex h-9 min-w-[76px] items-center justify-center rounded-[2px] bg-[var(--surface-2)] px-3 text-[12px] font-medium text-[var(--ink-2)] transition-colors group-enabled:group-hover:bg-[var(--bone)] group-enabled:group-hover:text-[var(--bg)]">
        {!TOKEN_CA ? 'Soon' : copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}
