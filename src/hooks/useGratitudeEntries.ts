import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { dedupeEntriesByDTag } from '@/lib/streakUtils';
import { getEntryTombstones, isEntryTombstoned } from '@/lib/entryTombstones';

/**
 * Hook to fetch all gratitude entries for a specific user.
 *
 * Results are validated, filtered against local deletion tombstones, and
 * deduped latest-wins per `d` tag, so consumers never depend on relay-side
 * replacement or deletion behavior.
 */
export function useGratitudeEntries(pubkey: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['gratitude-entries', pubkey],
    queryFn: async (c) => {
      if (!pubkey) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      const events = await nostr.query(
        [
          {
            kinds: [36669],
            authors: [pubkey],
            // Over-fetch past one year of days to tolerate transient
            // duplicates from relays that don't replace addressable events.
            limit: 500,
          },
        ],
        { signal }
      );

      const tombstones = getEntryTombstones();
      return dedupeEntriesByDTag(
        events.filter((e) => validateGratitudeEntry(e) && !isEntryTombstoned(e, tombstones))
      );
    },
    enabled: !!pubkey,
  });
}

/**
 * Hook to fetch a specific gratitude entry for a user and date
 */
export function useGratitudeEntry(pubkey: string | undefined, dateString: string) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['gratitude-entry', pubkey, dateString],
    queryFn: async (c) => {
      if (!pubkey || !dateString) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(1500)]);
      const events = await nostr.query(
        [
          {
            kinds: [36669],
            authors: [pubkey],
            '#d': [dateString],
            // Tolerate stale duplicates from non-replacing relays; the
            // newest version wins below.
            limit: 5,
          },
        ],
        { signal }
      );

      const tombstones = getEntryTombstones();
      const candidates = events.filter(
        (e) => validateGratitudeEntry(e) && !isEntryTombstoned(e, tombstones)
      );

      return candidates.reduce<NostrEvent | null>(
        (newest, e) => (!newest || e.created_at > newest.created_at ? e : newest),
        null
      );
    },
    enabled: !!pubkey && !!dateString,
  });
}

/**
 * Hook to fetch recent community gratitude entries
 */
export function useCommunityGratitude(limit: number = 20) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['community-gratitude', limit],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      const events = await nostr.query(
        [
          {
            kinds: [36669],
            // Over-fetch: validation, encrypted-entry exclusion, and dedup
            // below shrink the result, and the feed should stay full.
            limit: limit * 2,
          },
        ],
        { signal }
      );

      // Encrypted entries are personal — their ciphertext must never render
      // in the community feed.
      const tombstones = getEntryTombstones();
      const visible = events.filter(
        (e) =>
          validateGratitudeEntry(e) &&
          !isEntryTombstoned(e, tombstones) &&
          !e.tags.some(([name]) => name === 'encrypted')
      );

      // Latest-wins per author + d tag.
      const byAddress = new Map<string, NostrEvent>();
      for (const event of visible) {
        const dTag = event.tags.find(([name]) => name === 'd')?.[1];
        const address = `${event.pubkey}:${dTag}`;
        const existing = byAddress.get(address);
        if (!existing || event.created_at > existing.created_at) {
          byAddress.set(address, event);
        }
      }

      return [...byAddress.values()]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit);
    },
  });
}

/**
 * Validate a gratitude entry event
 */
export function validateGratitudeEntry(event: NostrEvent): boolean {
  // Check if it's the correct kind
  if (event.kind !== 36669) return false;

  // Check for required tags
  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  const dayTag = event.tags.find(([name]) => name === 'day')?.[1];
  const publishedAtTag = event.tags.find(([name]) => name === 'published_at')?.[1];

  if (!dTag || !dayTag || !publishedAtTag) return false;

  // Validate date format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dTag)) return false;

  // Validate day is a number
  const day = parseInt(dayTag);
  if (isNaN(day) || day < 1 || day > 366) return false;

  // Validate published_at is a number
  const publishedAt = parseInt(publishedAtTag);
  if (isNaN(publishedAt) || publishedAt <= 0) return false;

  return true;
}
