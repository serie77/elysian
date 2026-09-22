'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { isAddress } from 'viem';
import { erc20Abi } from '../abi';
import { assetsFor, customTokens, removeCustomToken, saveCustomToken, type Asset } from '../assets';
import { useShielded } from './store';

/** The asset picker list for the current chain, plus a way to add any ERC-20 by address. */
export function useAssets() {
  const w = useShielded();
  const client = usePublicClient();
  const [custom, setCustom] = useState<Asset[]>([]);

  useEffect(() => {
    setCustom(customTokens(w.chainId));
  }, [w.chainId]);

  const assets = assetsFor(w.chainId, w.deployment, custom);

  /** Reads symbol, name and decimals from the chain and remembers the token in this browser. */
  const addByAddress = useCallback(
    async (address: string): Promise<Asset> => {
      if (!isAddress(address)) throw new Error('That is not a valid token address.');
      if (!client) throw new Error('No connection to the chain.');
      const addr = address as `0x${string}`;
      const [symbol, name, decimals] = await Promise.all([
        client.readContract({ address: addr, abi: erc20Abi, functionName: 'symbol' }).catch(() => null),
        client.readContract({ address: addr, abi: erc20Abi, functionName: 'name' }).catch(() => null),
        client.readContract({ address: addr, abi: erc20Abi, functionName: 'decimals' }).catch(() => null),
      ]);
      if (symbol === null || decimals === null) throw new Error('No ERC-20 token found at that address.');
      const asset: Asset = { symbol, name: name ?? symbol, address: addr, decimals: Number(decimals), kind: 'custom' };
      setCustom(saveCustomToken(w.chainId, asset));
      return asset;
    },
    [client, w.chainId],
  );

  const remove = useCallback(
    (address: string) => {
      setCustom(removeCustomToken(w.chainId, address));
    },
    [w.chainId],
  );

  return { assets, custom, addByAddress, remove };
}
