/**
 * Presentational bucketing for the gratitude vine year-view.
 *
 * PRESENCE ONLY: buckets are derived from the set of local-tz `YYYY-MM-DD`
 * dates that have a 36669 entry (via getEntryDateStrings). This never reads or
 * decrypts entry content — `count` is "how many days this week were journaled"
 * (0–7), not a note count. Kept separate from streakUtils, which is streak math.
 */

import { formatDateString } from '@/lib/gratitudeUtils';

/** One week of the vine: the local Sunday it starts on, and 0–7 journaled days. */
export interface WeekBucket {
  /** YYYY-MM-DD of the week's Sunday (local tz). */
  weekStart: string;
  /** Journaled days in this week so far (0–7); the current week counts only elapsed days. */
  count: number;
}

/** Local-midnight copy, so week math aligns to local-tz `d` tags. */
function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Trailing weekly buckets over the last `weeks` Sundays through today.
 *
 * Weeks are Sunday-start (consistent with the calendar). The last bucket is the
 * current — possibly partial — week: future days can't be in `entryDates`, so a
 * mid-week today simply yields a count of the elapsed journaled days and can
 * never reach 7 until the week completes. Dates are stepped with Date component
 * math so DST transitions don't skew week boundaries.
 */
export function getWeeklyBuckets(
  entryDates: Set<string>,
  today: Date,
  weeks = 53
): WeekBucket[] {
  const end = atMidnight(today);
  const lastSunday = new Date(end);
  lastSunday.setDate(end.getDate() - end.getDay());
  const firstSunday = new Date(lastSunday);
  firstSunday.setDate(lastSunday.getDate() - (weeks - 1) * 7);

  const buckets: WeekBucket[] = [];
  for (let w = 0; w < weeks; w++) {
    const sunday = new Date(firstSunday);
    sunday.setDate(firstSunday.getDate() + w * 7);

    let count = 0;
    for (let d = 0; d < 7; d++) {
      const day = new Date(sunday);
      day.setDate(sunday.getDate() + d);
      // Don't count the future; only elapsed days can have an entry anyway.
      if (day.getTime() > end.getTime()) break;
      if (entryDates.has(formatDateString(day))) count++;
    }

    buckets.push({ weekStart: formatDateString(sunday), count });
  }
  return buckets;
}
