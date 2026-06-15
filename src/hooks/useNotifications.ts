import { useCallback, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGratitudeEntries } from '@/hooks/useGratitudeEntries';
import { useAppSettings } from '@/hooks/useAppSettings';
import {
  buildNotifications,
  groupNotifications,
  unreadCount,
  type NotifiableContent,
} from '@/lib/notifications';

// Bounded — notifications are recency-biased; we don't fetch unlimited history.
const WINDOW_DAYS = 30;
const MAX_COORDS = 100; // cap the #a filter list
const MY_NOTES_LIMIT = 50;
const PER_FILTER_LIMIT = 100;

/**
 * In-app notifications for interactions on the current user's content
 * (reactions, zaps, comments on 36669 entries; reactions, zaps, replies on
 * kind-1 notes). Gathers the user's notifiable content (their 36669 coordinates
 * + recent kind-1 note ids), queries the referencing events within a 30-day
 * window, then maps/dedupes/groups via the pure `notifications` layer. Self-
 * interactions are dropped; nothing is decrypted.
 */
export function useNotifications() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { settings, updateSettings } = useAppSettings();
  const pubkey = user?.pubkey;

  // My 36669 entries (existing hook) → addressable coordinates.
  const { data: entries } = useGratitudeEntries(pubkey);
  const coords = useMemo(() => {
    const set = new Set<string>();
    for (const entry of (entries ?? []).slice(0, MAX_COORDS)) {
      const d = entry.tags.find(([name]) => name === 'd')?.[1];
      if (d) set.add(`36669:${entry.pubkey}:${d}`);
    }
    return set;
  }, [entries]);

  // My recent kind-1 note ids (small bounded query).
  const { data: myNotes } = useQuery({
    queryKey: ['my-kind1-notes', pubkey],
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      return nostr.query([{ kinds: [1], authors: [pubkey!], limit: MY_NOTES_LIMIT }], { signal });
    },
  });
  const noteIds = useMemo(() => new Set((myNotes ?? []).map((e) => e.id)), [myNotes]);

  const coordsArr = useMemo(() => [...coords], [coords]);
  const noteIdsArr = useMemo(() => [...noteIds], [noteIds]);
  const ready = !!pubkey && (coordsArr.length > 0 || noteIdsArr.length > 0);

  const {
    data: events,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<NostrEvent[]>({
    queryKey: ['notifications', pubkey, coordsArr.length, noteIdsArr.length],
    enabled: ready,
    staleTime: 60 * 1000,
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);
      const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;
      const filters: NostrFilter[] = [];
      if (noteIdsArr.length) {
        // reactions + replies + zaps on my kind-1 notes
        filters.push({ kinds: [7, 1, 9735], '#e': noteIdsArr, since, limit: PER_FILTER_LIMIT });
      }
      if (coordsArr.length) {
        // reactions + zaps on my 36669 entries
        filters.push({ kinds: [7, 9735], '#a': coordsArr, since, limit: PER_FILTER_LIMIT });
        // NIP-22 comments rooted on my 36669 entries
        filters.push({ kinds: [1111], '#A': coordsArr, since, limit: PER_FILTER_LIMIT });
      }
      if (!filters.length) return [];
      return nostr.query(filters, { signal });
    },
  });

  const content = useMemo<NotifiableContent>(
    () => ({ pubkey: pubkey ?? '', coords, noteIds }),
    [pubkey, coords, noteIds]
  );

  const items = useMemo(
    () => (pubkey ? buildNotifications(events ?? [], content) : []),
    [events, content, pubkey]
  );
  const groups = useMemo(() => groupNotifications(items), [items]);
  const unread = useMemo(
    () => unreadCount(items, settings.lastSeenNotifications),
    [items, settings.lastSeenNotifications]
  );

  const markAllRead = useCallback(() => {
    updateSettings({ lastSeenNotifications: Math.floor(Date.now() / 1000) });
  }, [updateSettings]);

  return {
    items,
    groups,
    unread,
    isLoading: ready && isLoading,
    isError,
    isRefetching,
    refetch,
    markAllRead,
  };
}
