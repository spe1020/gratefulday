import { useNostr } from '@nostrify/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

/** Which open-network gratitude hashtags to surface. */
export type TaggedFilter = 'all' | 'grateful' | 'gratefulchain';

const PAGE_SIZE = 20;

function tagsForFilter(filter: TaggedFilter): string[] {
  return filter === 'all' ? ['grateful', 'gratefulchain'] : [filter];
}

/**
 * Fetch open-network kind 1 notes tagged #grateful / #gratefulchain.
 *
 * Unlike the kind-36669 community journal, this inherits arbitrary public
 * Nostr content. Notes are newest-first; `until`-based pagination loads older
 * pages (one relay round trip per page, no re-fetch of earlier pages). Callers
 * should dedup the flattened pages by event id — relays can resend across
 * page boundaries.
 */
export function useTaggedGratitude(filter: TaggedFilter = 'all') {
  const { nostr } = useNostr();

  return useInfiniteQuery({
    queryKey: ['tagged-gratitude', filter],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal: querySignal }) => {
      const signal = AbortSignal.any([querySignal, AbortSignal.timeout(3000)]);
      const filterObj: {
        kinds: number[];
        '#t': string[];
        limit: number;
        until?: number;
      } = {
        kinds: [1],
        '#t': tagsForFilter(filter),
        limit: PAGE_SIZE,
      };
      if (pageParam !== undefined) filterObj.until = pageParam;

      const events = await nostr.query([filterObj], { signal });
      return events.sort((a, b) => b.created_at - a.created_at);
    },
    getNextPageParam: (lastPage: NostrEvent[]) => {
      // A short page means the relay has nothing older to give.
      if (lastPage.length < PAGE_SIZE) return undefined;
      const oldest = lastPage[lastPage.length - 1];
      return oldest.created_at - 1;
    },
  });
}
