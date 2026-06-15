import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { embedRefKey, type EmbedRef } from '@/lib/embedRef';

/**
 * Fetch a single embedded event for a decoded NIP-19 ref.
 *
 * - `staleTime: Infinity` — an embedded event is immutable, so it's never
 *   refetched while it stays in cache; multiple cards referencing the same note
 *   share the one fetch. `gcTime` (~30 min) bounds memory: an entry inactive for
 *   that long is dropped and re-fetched if seen again — a deliberate trade-off
 *   over `gcTime: Infinity`, which would retain every embed ever viewed.
 * - `enabled` is gated by the caller (IntersectionObserver) so off-screen embeds
 *   don't fetch until scrolled near — lazy load + implicit concurrency cap.
 * - Relay hints from the ref are captured; routing them is a follow-up (queries
 *   currently go to the configured pool). Returns null when nothing is found.
 */
export function useEmbeddedEvent(ref: EmbedRef | null, enabled: boolean) {
  const { nostr } = useNostr();

  return useQuery<NostrEvent | null>({
    queryKey: ['embedded-event', ref ? embedRefKey(ref) : null],
    enabled: enabled && !!ref,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    queryFn: async (c) => {
      if (!ref) return null;
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);
      const filter: NostrFilter =
        ref.kind === 'event'
          ? { ids: [ref.id], limit: 1 }
          : {
              kinds: [ref.eventKind],
              authors: [ref.pubkey],
              '#d': [ref.identifier],
              limit: 1,
            };
      const events = await nostr.query([filter], { signal });
      return events[0] ?? null;
    },
  });
}
