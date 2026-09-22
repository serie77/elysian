'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/lib/chains';
import { ShieldedWalletProvider } from '@/lib/wallet/store';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      if (localStorage.getItem('elysian.debug')) (window as unknown as { __elysian?: unknown }).__elysian = { config: wagmiConfig };
    } catch {
      /* storage unavailable */
    }
  }, []);
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 5_000 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ShieldedWalletProvider>{children}</ShieldedWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
