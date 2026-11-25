import { useCallback, useContext } from 'react';

import type { RelayMetadata } from '@/contexts/AppContext';
import { RelayListContext } from '@/contexts/RelayListContext';
import { useAppContext } from '@/hooks/useAppContext';
import { RelayAccountChangedError, RelayListUnresolvedError } from '@/lib/accountRelays';

/**
 * How long a write waits for the account's relay list before it gives up.
 * The lookup itself is bounded at a few seconds and retried, so this covers
 * a couple of attempts. Until then the save simply shows as saving.
 */
export const RELAY_LIST_WAIT_MS = 15_000;

/**
 * Returns `waitForRelayList(pubkey)`: call it before any read that decides a
 * write, and before any publish. It resolves with the relay list to use for
 * `pubkey` once that account's own list is known, and rejects if it doesn't
 * become known in time or the account changes first. Nothing is ever
 * published for an account to relays chosen before its list was known.
 */
export function useRelayListGate(): (pubkey: string) => Promise<RelayMetadata> {
  const relayList = useContext(RelayListContext);
  const { config } = useAppContext();

  return useCallback(
    async (pubkey: string) => {
      // Only hook unit tests render without AccountRelayProvider.
      if (!relayList) return config.relayMetadata;
      try {
        return await relayList.waitForRelayList(pubkey, AbortSignal.timeout(RELAY_LIST_WAIT_MS));
      } catch (error) {
        if (error instanceof DOMException) throw new RelayListUnresolvedError();
        throw error;
      }
    },
    [relayList, config.relayMetadata]
  );
}

/**
 * Returns `assertStillActive(pubkey)`: call it after signing and right
 * before sending. It throws `RelayAccountChangedError` when another account
 * became active meanwhile (a bunker signature can take seconds), so the
 * event is never sent through the relays of the account now signed in.
 */
export function useAssertStillActive(): (pubkey: string) => void {
  const relayList = useContext(RelayListContext);
  return useCallback(
    (pubkey: string) => {
      if (relayList && !relayList.isActive(pubkey)) throw new RelayAccountChangedError();
    },
    [relayList]
  );
}
