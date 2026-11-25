import { createContext } from 'react';
import type { RelayMetadata } from '@/contexts/AppContext';

export type RelayListStatus = 'resolved' | 'unresolved';

export interface RelayListContextType {
  /** The signed-in account, or undefined when signed out. */
  activePubkey: string | undefined;
  /**
   * `resolved` once this session has looked up the active account's NIP-65
   * list: it found one, or a majority of relays confirmed there is none.
   * Signed out is always `resolved` (there is nothing to publish as).
   */
  status: RelayListStatus;
  /**
   * Waits until `pubkey` is the active account and its relay list is
   * resolved, then gives the list to use. Rejects with
   * `RelayAccountChangedError` if another account becomes active first, and
   * with `RelayListUnresolvedError` if `signal` aborts first.
   */
  waitForRelayList(pubkey: string, signal?: AbortSignal): Promise<RelayMetadata>;
  /**
   * Whether `pubkey` is the active account right now (not as of the last
   * render). Checked after signing: a publish whose account is no longer
   * active is refused rather than sent to the new account's relays.
   */
  isActive(pubkey: string): boolean;
  /**
   * Record the lookup result for `pubkey`: its newest kind 10002 relays and
   * timestamp, or null when relays confirmed it has none. Ignored if
   * `pubkey` is no longer the active account.
   */
  resolveRelayList(pubkey: string, found: RelayMetadata | null): void;
}

/**
 * Provided by `AccountRelayProvider`. Null only where a test renders a hook
 * without it; `useRelayListGate` then passes the configured list through.
 */
export const RelayListContext = createContext<RelayListContextType | null>(null);
