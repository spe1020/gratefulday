/**
 * Pure helpers for the community calendar / galaxy views.
 *
 * SOURCE OF TRUTH = the `d` tag (local-tz YYYY-MM-DD journaled date), NEVER
 * `created_at` (publish time): the two legitimately diverge when someone
 * backfills a day. `since`/`until` (see getMonthUnixBounds) are ONLY a fetch
 * optimization — grouping and day attribution always use `d`.
 *
 * HARD ENCRYPTION GATE: groupEntriesByDay defensively drops any entry tagged
 * `encrypted`, so even if a ciphertext entry slipped past the hook it can never
 * be grouped or rendered. Callers must still source events exclusively from
 * useCommunityGratitude (which already excludes encrypted entries) — never from
 * raw relay queries.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { formatDateString, isValidDateString } from '@/lib/gratitudeUtils';
import { isEncryptedEntry } from '@/lib/privacyUtils';

/** Public gratitude entries journaled for a single local-tz day. */
export interface CommunityDayBucket {
  /** YYYY-MM-DD from the `d` tag. */
  dateString: string;
  /** Entries for this day, newest `created_at` first (one per author per day). */
  events: NostrEvent[];
  /** Number of entries (one 36669 per author per day). */
  noteCount: number;
  /** Distinct author pubkeys, in newest-entry-first order. */
  authorPubkeys: string[];
}

/** A single day cell in a month grid, or null for leading weekday padding. */
export interface MonthGridCell {
  day: number;
  dateString: string;
}

/**
 * Group public entries into day buckets keyed by their `d` tag.
 *
 * Encrypted entries and entries with a missing/malformed `d` tag are dropped.
 * Within a bucket, events are ordered newest-first and `authorPubkeys` holds
 * the distinct pubkeys in that same order.
 */
export function groupEntriesByDay(
  events: NostrEvent[]
): Map<string, CommunityDayBucket> {
  const buckets = new Map<string, CommunityDayBucket>();

  const sorted = [...events].sort((a, b) => b.created_at - a.created_at);

  // Relays that don't replace addressable events can hand back several
  // versions of the same author's same-day entry; keep only the newest per
  // pubkey+d (sorted newest-first, so first seen wins).
  const seenAddress = new Set<string>();
  const seenAuthors = new Map<string, Set<string>>();

  for (const event of sorted) {
    // Hard gate: ciphertext must never be grouped or surfaced publicly.
    if (isEncryptedEntry(event)) continue;

    const dTag = event.tags.find(([name]) => name === 'd')?.[1];
    if (!dTag || !isValidDateString(dTag)) continue;

    const address = `${event.pubkey}:${dTag}`;
    if (seenAddress.has(address)) continue;
    seenAddress.add(address);

    let bucket = buckets.get(dTag);
    if (!bucket) {
      bucket = { dateString: dTag, events: [], noteCount: 0, authorPubkeys: [] };
      buckets.set(dTag, bucket);
      seenAuthors.set(dTag, new Set());
    }

    bucket.events.push(event);
    const authors = seenAuthors.get(dTag)!;
    if (!authors.has(event.pubkey)) {
      authors.add(event.pubkey);
      bucket.authorPubkeys.push(event.pubkey);
    }
  }

  for (const bucket of buckets.values()) {
    bucket.noteCount = bucket.events.length;
  }

  return buckets;
}

/**
 * Unix-second bounds (local tz) spanning the first instant of a month through
 * the last instant of its final day. `month` is 0-indexed (0 = January).
 *
 * This is a FETCH HINT ONLY. Because publish time can fall outside the
 * journaled month (backfills), grouping still keys off the `d` tag — a few
 * far-backfilled entries may simply not be fetched, which is acceptable.
 */
export function getMonthUnixBounds(
  year: number,
  month: number
): { since: number; until: number } {
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return {
    since: Math.floor(start.getTime() / 1000),
    until: Math.floor(end.getTime() / 1000),
  };
}

/**
 * Build a Sunday-start month grid: leading nulls pad to the first weekday,
 * followed by one cell per day with its local-tz `d`-style date string.
 * `month` is 0-indexed.
 */
export function getMonthGrid(year: number, month: number): (MonthGridCell | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (MonthGridCell | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, dateString: formatDateString(new Date(year, month, day)) });
  }
  return cells;
}
