import React, { useEffect, useRef } from 'react';
import { NostrEvent, NostrFilter, NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';

interface NostrProviderProps {
  children: React.ReactNode;
}

/** The read set and the write set, as one comparable value. */
function effectiveRelayKey(relays: { url: string; read: boolean; write: boolean }[]): string {
  const urls = (wanted: 'read' | 'write') =>
    [...new Set(relays.filter((r) => r[wanted]).map((r) => r.url))].sort();
  return JSON.stringify([urls('read'), urls('write')]);
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();

  const queryClient = useQueryClient();

  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);

  // The pool is created once, so its routers must not close over `config`
  // from the first render: they read the current relay list from this ref.
  // Otherwise a list that arrives after start (the account's NIP-65 list,
  // synced on login) is ignored until the page is reloaded, and reads and
  // publishes keep going to the previous relays.
  const relayMetadata = useRef(config.relayMetadata);

  // Which relays reads and publishes go to. A change of object identity
  // alone (another setting saved, the same list re-read from storage) is not
  // a change of relays.
  const relayKey = effectiveRelayKey(config.relayMetadata.relays);
  const appliedRelayKey = useRef(relayKey);

  useEffect(() => {
    relayMetadata.current = config.relayMetadata;

    // Invalidate Nostr queries when relay metadata changes
    queryClient.invalidateQueries({ queryKey: ['nostr'] });

    // What the journal queries cached came from the previous relays. "No
    // entries" there says nothing about the new ones, so read again.
    if (appliedRelayKey.current !== relayKey) {
      appliedRelayKey.current = relayKey;
      queryClient.invalidateQueries({ queryKey: ['gratitude-entries'] });
      queryClient.invalidateQueries({ queryKey: ['gratitude-entry'] });
    }
  }, [config.relayMetadata, relayKey, queryClient]);

  // Initialize NPool only once
  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        return new NRelay1(url);
      },
      reqRouter(filters: NostrFilter[]) {
        const routes = new Map<string, NostrFilter[]>();

        // Route to all read relays
        const readRelays = relayMetadata.current.relays
          .filter(r => r.read)
          .map(r => r.url);

        for (const url of readRelays) {
          routes.set(url, filters);
        }

        return routes;
      },
      eventRouter(_event: NostrEvent) {
        // Get write relays from metadata
        const writeRelays = relayMetadata.current.relays
          .filter(r => r.write)
          .map(r => r.url);

        const allRelays = new Set<string>(writeRelays);

        return [...allRelays];
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;