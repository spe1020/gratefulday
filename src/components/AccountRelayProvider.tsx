import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNostrLogin } from '@nostrify/react/login';

import { AppContext, type AppConfig, type AppContextType, type RelayMetadata } from '@/contexts/AppContext';
import { RelayListContext, type RelayListContextType } from '@/contexts/RelayListContext';
import { useAppContext } from '@/hooks/useAppContext';
import {
  ACCOUNT_RELAYS_KEY,
  type AccountRelayMap,
  GUEST_SLOT,
  RelayAccountChangedError,
  RelayListUnresolvedError,
  readAccountRelays,
  writeAccountRelays,
} from '@/lib/accountRelays';

interface AccountRelayProviderProps {
  children: ReactNode;
  /** The app's default relays: used by an account that has no list. */
  defaultRelays: RelayMetadata;
}

/**
 * Makes `config.relayMetadata` the signed-in account's own relay list (see
 * `lib/accountRelays`), and tracks whether that list has been looked up yet.
 *
 * It re-provides `AppContext` so every existing reader of
 * `config.relayMetadata` (the relay pool, the strict pre-write reads, the
 * relay settings screen) gets the active account's list without knowing
 * about accounts. A relay edit made through `updateConfig` is stored for the
 * active account only.
 *
 * Must sit inside `NostrLoginProvider` and `AppProvider`, and outside
 * `NostrProvider`. `NostrSync` performs the lookup and reports it through
 * `resolveRelayList`.
 */
export function AccountRelayProvider({ children, defaultRelays }: AccountRelayProviderProps) {
  const parent = useAppContext();
  const { logins } = useNostrLogin();
  // The first login is the active one (useCurrentUser and account switching
  // use the same order).
  const activePubkey: string | undefined = logins[0]?.pubkey;

  const [stored, setStored] = useState<AccountRelayMap>(readAccountRelays);
  // The account whose lookup finished in this session. Reset by every switch.
  const [resolvedFor, setResolvedFor] = useState<string | undefined>(undefined);

  const slot = activePubkey ?? GUEST_SLOT;
  const relayMetadata = stored[slot] ?? defaultRelays;
  const status = !activePubkey || resolvedFor === activePubkey ? 'resolved' : 'unresolved';

  // Current values for callbacks that outlive a render.
  const current = useRef({ activePubkey, relayMetadata, status });
  current.current = { activePubkey, relayMetadata, status };

  // Keep in step with other tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACCOUNT_RELAYS_KEY) setStored(readAccountRelays());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const storeSlot = useCallback((key: string, value: RelayMetadata) => {
    setStored((prev) => {
      const next = { ...prev, [key]: value };
      writeAccountRelays(next);
      return next;
    });
  }, []);

  const resolveRelayList = useCallback(
    (pubkey: string, found: RelayMetadata | null) => {
      if (pubkey !== current.current.activePubkey) return;
      if (found) {
        // `updatedAt` is only ever compared within one account.
        const existing = readAccountRelays()[pubkey];
        if (!existing || found.updatedAt > existing.updatedAt) storeSlot(pubkey, found);
      }
      // No list found: keep this account's own stored list if it has one (an
      // edit made here), otherwise the defaults apply.
      setResolvedFor(pubkey);
    },
    [storeSlot]
  );

  // Writes waiting for a relay list, re-checked after every change.
  const waiters = useRef(new Set<() => void>());
  useEffect(() => {
    for (const check of [...waiters.current]) check();
  }, [activePubkey, status, relayMetadata]);

  const waitForRelayList = useCallback(
    (pubkey: string, signal?: AbortSignal) =>
      new Promise<RelayMetadata>((resolve, reject) => {
        const finish = () => {
          waiters.current.delete(check);
          signal?.removeEventListener('abort', onAbort);
        };
        const check = () => {
          const now = current.current;
          if (now.activePubkey !== pubkey) {
            finish();
            reject(new RelayAccountChangedError());
          } else if (now.status === 'resolved') {
            finish();
            resolve(now.relayMetadata);
          }
        };
        const onAbort = () => {
          finish();
          reject(new RelayListUnresolvedError());
        };
        if (signal?.aborted) return onAbort();
        waiters.current.add(check);
        signal?.addEventListener('abort', onAbort, { once: true });
        check();
      }),
    []
  );

  const relayList = useMemo<RelayListContextType>(
    () => ({ activePubkey, status, waitForRelayList, resolveRelayList }),
    [activePubkey, status, waitForRelayList, resolveRelayList]
  );

  const { updateConfig: parentUpdateConfig } = parent;
  const updateConfig = useCallback<AppContextType['updateConfig']>(
    (updater) => {
      parentUpdateConfig((raw) => {
        const now = current.current;
        const next = updater({ ...raw, relayMetadata: now.relayMetadata });
        const { relayMetadata: nextRelays, ...rest } = next;
        if (nextRelays && nextRelays !== now.relayMetadata) {
          if (now.status === 'resolved') {
            storeSlot(now.activePubkey ?? GUEST_SLOT, nextRelays);
          } else {
            // Editing before the account's own list is known would replace
            // it with whatever is showing now (the defaults).
            console.warn('Relay list edit ignored: the account’s relay list is still loading.');
          }
        }
        return rest;
      });
    },
    [parentUpdateConfig, storeSlot]
  );

  const config = useMemo<AppConfig>(
    () => ({ ...parent.config, relayMetadata }),
    [parent.config, relayMetadata]
  );

  return (
    <AppContext.Provider value={{ config, updateConfig }}>
      <RelayListContext.Provider value={relayList}>{children}</RelayListContext.Provider>
    </AppContext.Provider>
  );
}
