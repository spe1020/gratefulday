import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { isNip10Reply } from '@/lib/nip10';

/**
 * Read the NIP-10 reply thread for a kind-1 root note. Queries kind-1 events
 * that `e`-reference the root, keeps the ones that are actually replies (not
 * mentions/quotes), and returns a flat thread oldest-first. Loaded on demand
 * (when the card's replies are expanded), not eagerly per feed card.
 */
export function useNip10Replies(root: NostrEvent, enabled = true) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['nip10-replies', root.id],
    enabled: enabled && !!root.id,
    staleTime: 30_000,
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(4000)]);
      const events = await nostr.query([{ kinds: [1], '#e': [root.id] }], { signal });
      return events
        .filter((e) => isNip10Reply(e, root.id))
        .sort((a, b) => a.created_at - b.created_at);
    },
  });
}
