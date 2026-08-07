/**
 * Pure streak and milestone utilities for gratitude entries.
 *
 * Gratitude entries are Nostr kind 36669 addressable events keyed by a `d` tag
 * in YYYY-MM-DD format (local timezone). All functions here are pure — no
 * hooks, no React, no implicit clock reads. "Today" is always injected as a
 * YYYY-MM-DD string so results are deterministic and testable.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { formatDateString, isValidDateString } from '@/lib/gratitudeUtils';

export interface StreakResult {
  current: number;
  longest: number;
  /** Unique entry days (after d-tag dedup), not raw event count. */
  total: number;
  todayCompleted: boolean;
}

// `1` is the day-1 "foundation" celebration (first entry), not a streak
// trophy — the dialog renders it with distinct copy/visuals. The hint logic
// stays gated at `current >= 3`, so day 1 never produces a "days to next" nudge.
export const MILESTONES = [1, 7, 14, 30, 50, 100, 200, 365] as const;

export type Milestone = (typeof MILESTONES)[number];


/**
 * Dedupe addressable events by `d` tag, keeping the newest `created_at` per
 * tag. Relays can return stale duplicates of replaceable events. Events
 * without a `d` tag are dropped.
 */
export function dedupeEntriesByDTag(events: NostrEvent[]): NostrEvent[] {
  const byDTag = new Map<string, NostrEvent>();

  for (const event of events) {
    const dTag = event.tags.find(([name]) => name === 'd')?.[1];
    if (!dTag) continue;

    const existing = byDTag.get(dTag);
    if (!existing || event.created_at > existing.created_at) {
      byDTag.set(dTag, event);
    }
  }

  return [...byDTag.values()];
}

/**
 * Extract the set of unique YYYY-MM-DD date strings from entry events.
 * Invalid `d` tags (wrong format or impossible dates) are excluded. No
 * dedupeEntriesByDTag pass needed — the Set collapses duplicate `d` tags, and
 * which duplicate "wins" is irrelevant when only the date string is kept.
 */
export function getEntryDateStrings(events: NostrEvent[]): Set<string> {
  const dates = new Set<string>();

  for (const event of events) {
    const dTag = event.tags.find(([name]) => name === 'd')?.[1];
    // Semantic validation, not just shape: a hostile "2026-02-30" would
    // otherwise inflate totals and milestone math.
    if (dTag && isValidDateString(dTag)) {
      dates.add(dTag);
    }
  }

  return dates;
}

/**
 * Step a YYYY-MM-DD string back one calendar day. Uses Date component math
 * (not millisecond arithmetic) so DST transitions don't skip or repeat days.
 */
function previousDateString(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - 1);
  return formatDateString(date);
}

/**
 * Calculate current/longest streaks from a set of entry date strings.
 *
 * Streak semantics: consecutive calendar days each having at least one entry.
 * The current streak stays alive if today has no entry yet but yesterday does
 * (yesterday's count is reported) — it only breaks once a full day is missed.
 */
export function calculateStreaks(dateStrings: Set<string>, today: string): StreakResult {
  const total = dateStrings.size;
  const todayCompleted = dateStrings.has(today);

  // Current streak: count back from today, or from yesterday if today is
  // still pending (the "alive until a full day is missed" rule).
  let current = 0;
  let cursor = todayCompleted ? today : previousDateString(today);
  while (dateStrings.has(cursor)) {
    current++;
    cursor = previousDateString(cursor);
  }

  // Longest streak: walk dates in ascending order, extending a run whenever
  // the previous calendar day was also present.
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const dateString of [...dateStrings].sort()) {
    run = prev !== null && previousDateString(dateString) === prev ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = dateString;
  }

  return { current, longest, total, todayCompleted };
}

/** Milestones already reached by the given streak length, ascending. */
export function getReachedMilestones(current: number): number[] {
  return MILESTONES.filter((milestone) => current >= milestone);
}

export interface CelebrationInput {
  /** Unique entry days — `1` means a true first-ever entry. */
  total: number;
  /** Current consecutive-day streak. */
  current: number;
  /** Whether a streak milestone (7+) has already been celebrated. */
  isCelebrated: (milestone: number) => boolean;
}

/**
 * Decide which celebration (if any) to show. Two distinct tiers:
 *
 * - Day-1 "foundation" (milestone `1`) is derived purely from data — the user's
 *   first-ever entry, `total === 1` — and is NEVER persisted. A wiped browser on
 *   an established account (`total > 1`) therefore can't re-pop it. (Trade-off:
 *   a user stuck at exactly one entry may see it again in a later session; that
 *   is the correct cost of the no-stored-flag rule — do not add a flag to "fix" it.)
 * - Streak milestones (7+) stay celebrated-store gated via `isCelebrated`, so
 *   each fires once. `1` is filtered out of this tier so it can't leak back in
 *   through `getReachedMilestones`.
 *
 * Returns the milestone to celebrate, or null. The highest pending streak
 * milestone wins (a fresh device with a long streak sees one dialog, not many).
 */
export function pickCelebration({ total, current, isCelebrated }: CelebrationInput): number | null {
  if (total === 1) return 1;

  const pending = getReachedMilestones(current).filter(
    (m) => m > 1 && !isCelebrated(m)
  );
  return pending.length > 0 ? pending[pending.length - 1] : null;
}

/** The next milestone ahead of the given streak length, or null past 365. */
export function getNextMilestone(current: number): number | null {
  return MILESTONES.find((milestone) => milestone > current) ?? null;
}

/**
 * Whether to show a "N days to M" hint toward the next milestone.
 * Shown when within 5 days or within 25% of the next milestone, whichever is
 * friendlier — but never below a 3-day streak, so brand-new streaks aren't
 * immediately nudged.
 */
export function shouldShowMilestoneHint(current: number): boolean {
  if (current < 3) return false;

  const next = getNextMilestone(current);
  if (next === null) return false;

  const remaining = next - current;
  return remaining <= 5 || remaining <= next * 0.25;
}
