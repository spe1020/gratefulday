import { useCallback, useMemo } from 'react';
// (useMemo also memoizes the query key so the react() callback stays stable.)
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import {
  CURATED_REACTIONS,
  addressableCoordinate,
  aggregateReactions,
  buildReactionTags,
  findOwnReaction,
  isAddressable,
} from '@/lib/reactionUtils';

export interface UseReactionsResult {
  /** Per-curated-emoji counts (distinct reactors). */
  counts: Record<string, number>;
  /** Whether the current user has reacted with each curated emoji. */
  own: Record<string, boolean>;
  /** Toggle the user's reaction for an emoji (react, or NIP-09 delete to un-react). */
  react: (emoji: string) => void;
  isLoading: boolean;
}

/**
 * NIP-25 reactions for a single target, kind-routed. Reads kind-7 events
 * (by `#a` for addressable 36669, by `#e` for kind 1), aggregates the curated
 * set, and toggles the user's reaction optimistically:
 * - react → publish a kind-7 with kind-correct tags;
 * - un-react → publish a NIP-09 kind-5 delete of the user's own reaction
 *   (interoperable, not local-only).
 *
 * One light query per card (like zaps); generous staleTime, no polling.
 */
export function useReactions(target: NostrEvent): UseReactionsResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { mutate: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  const addressable = isAddressable(target.kind);
  const coordinate = addressable ? addressableCoordinate(target) : null;
  const queryKey = useMemo(() => ['reactions', coordinate ?? target.id], [coordinate, target.id]);

  const { data: events, isLoading } = useQuery({
    queryKey,
    staleTime: 60_000,
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);
      const filter: NostrFilter = addressable
        ? { kinds: [7], '#a': [coordinate!] }
        : { kinds: [7], '#e': [target.id] };
      return nostr.query([filter], { signal });
    },
  });

  const counts = useMemo(() => aggregateReactions(events ?? []), [events]);

  const own = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const emoji of CURATED_REACTIONS) {
      map[emoji] = user ? !!findOwnReaction(events ?? [], user.pubkey, emoji) : false;
    }
    return map;
  }, [events, user]);

  const react = useCallback(
    (emoji: string) => {
      if (!user) return;

      const current = events ?? [];
      const mine = findOwnReaction(current, user.pubkey, emoji);

      if (mine) {
        // Un-react: optimistically drop it, then publish a NIP-09 delete.
        queryClient.setQueryData<NostrEvent[]>(queryKey, (prev) =>
          (prev ?? []).filter((e) => e.id !== mine.id)
        );
        publish(
          { kind: 5, content: '', tags: [['e', mine.id], ['k', '7']] },
          {
            onSettled: () => queryClient.invalidateQueries({ queryKey }),
          }
        );
      } else {
        // React: optimistically add a placeholder, then publish the kind-7.
        const optimistic: NostrEvent = {
          id: `optimistic-${emoji}-${user.pubkey}`,
          pubkey: user.pubkey,
          created_at: Math.floor(Date.now() / 1000),
          kind: 7,
          tags: buildReactionTags(target),
          content: emoji,
          sig: '',
        };
        queryClient.setQueryData<NostrEvent[]>(queryKey, (prev) => [...(prev ?? []), optimistic]);
        publish(
          { kind: 7, content: emoji, tags: buildReactionTags(target) },
          {
            // Refetch true state on success or failure (fail-soft: a failed
            // publish simply reverts to the relay's view on refetch).
            onSettled: () => queryClient.invalidateQueries({ queryKey }),
          }
        );
      }
    },
    [user, events, queryClient, queryKey, target, publish]
  );

  return { counts, own, react, isLoading };
}
