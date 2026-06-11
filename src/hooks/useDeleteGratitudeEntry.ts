import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { addEntryTombstone, entryAddress } from '@/lib/entryTombstones';

/**
 * Request deletion of a gratitude entry via NIP-09 (kind 5).
 *
 * Deletion on Nostr is a request — most relays honor it, but it is
 * best-effort. On success the entry is evicted from both query caches and a
 * local tombstone is recorded so slow relays can't resurrect it on refetch.
 */
export function useDeleteGratitudeEntry() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (entry: NostrEvent) => {
      if (!user) {
        throw new Error('User is not logged in');
      }
      if (entry.pubkey !== user.pubkey) {
        throw new Error('Cannot delete an entry you do not own');
      }

      const dateString = entry.tags.find(([name]) => name === 'd')?.[1];
      if (!dateString) {
        throw new Error('Entry has no date tag');
      }

      const deletion = await user.signer.signEvent({
        kind: 5,
        content: 'Deleted gratitude entry',
        tags: [
          ['a', entryAddress(user.pubkey, dateString)],
          ['e', entry.id],
          ['k', '36669'],
        ],
        created_at: Math.floor(Date.now() / 1000),
      });

      await nostr.event(deletion, { signal: AbortSignal.timeout(5000) });

      return { deletion, dateString };
    },
    onSuccess: ({ deletion, dateString }) => {
      if (!user) return;

      addEntryTombstone(user.pubkey, dateString, deletion.created_at);

      // Evict from both caches directly — invalidating would refetch from
      // relays that may not have processed the deletion request yet.
      queryClient.setQueryData<NostrEvent[]>(
        ['gratitude-entries', user.pubkey],
        (entries) =>
          entries?.filter(
            (e) => e.tags.find(([name]) => name === 'd')?.[1] !== dateString
          )
      );
      queryClient.setQueryData(['gratitude-entry', user.pubkey, dateString], null);
    },
    onError: (error) => {
      console.error('Failed to request entry deletion:', error);
    },
  });
}
