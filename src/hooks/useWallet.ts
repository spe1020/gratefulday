import { useMemo } from 'react';
import { useNWC } from '@/hooks/useNWCContext';
import type { WebLNProvider } from '@webbtc/webln-types';

export interface WalletStatus {
  hasNWC: boolean;
  webln: WebLNProvider | null;
  activeNWC: ReturnType<typeof useNWC>['getActiveConnection'] extends () => infer T ? T : null;
  preferredMethod: 'nwc' | 'webln' | 'manual';
}

export function useWallet() {
  const { connections, getActiveConnection } = useNWC();

  // Get the active connection directly - no memoization to avoid stale state
  const activeNWC = getActiveConnection();

  // Access WebLN directly from browser global scope
  const webln = (globalThis as { webln?: WebLNProvider }).webln || null;

  // Calculate status values reactively
  // A stored wallet counts as available. `isConnected` only reflects a live
  // probe this session, so requiring it would report "no wallet" after every
  // reload for a perfectly good connection.
  const hasNWC = useMemo(() => connections.length > 0, [connections]);

  // Determine preferred payment method
  const preferredMethod: WalletStatus['preferredMethod'] = activeNWC
    ? 'nwc'
    : webln
    ? 'webln'
    : 'manual';

  const status: WalletStatus = {
    hasNWC,
    webln,
    activeNWC,
    preferredMethod,
  };

  return status;
}