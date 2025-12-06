import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Hook to fetch all gratitude entries for a specific user
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
            limit: 366, // Max days in a year
          },
        ],
        { signal }
      );

      return events;
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
            limit: 1,
          },
        ],
        { signal }
      );

      return events[0] || null;
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
            limit,
          },
        ],
        { signal }
      );

      return events;
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
