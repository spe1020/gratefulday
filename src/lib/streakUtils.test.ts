import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  MILESTONES,
  calculateStreaks,
  dedupeEntriesByDTag,
  getEntryDateStrings,
  getNextMilestone,
  getReachedMilestones,
  pickCelebration,
  shouldShowMilestoneHint,
} from './streakUtils';

const never = () => false;
const always = () => true;

function makeEvent(dTag: string, created_at = 1000): NostrEvent {
  return {
    id: `id-${dTag}-${created_at}`,
    pubkey: 'test-pubkey',
    created_at,
    kind: 36669,
    tags: [['d', dTag]],
    content: 'grateful',
    sig: 'sig',
  };
}

function dates(...dateStrings: string[]): Set<string> {
  return new Set(dateStrings);
}

describe('dedupeEntriesByDTag', () => {
  it('keeps the newest created_at per d tag', () => {
    const stale = makeEvent('2026-06-01', 100);
    const fresh = makeEvent('2026-06-01', 200);
    const other = makeEvent('2026-06-02', 50);

    const result = dedupeEntriesByDTag([stale, fresh, other]);

    expect(result).toHaveLength(2);
    expect(result).toContain(fresh);
    expect(result).toContain(other);
    expect(result).not.toContain(stale);
  });

  it('keeps the newest regardless of input order', () => {
    const fresh = makeEvent('2026-06-01', 200);
    const stale = makeEvent('2026-06-01', 100);

    expect(dedupeEntriesByDTag([fresh, stale])).toEqual([fresh]);
  });

  it('drops events without a d tag', () => {
    const noDTag: NostrEvent = { ...makeEvent('2026-06-01'), tags: [] };

    expect(dedupeEntriesByDTag([noDTag])).toEqual([]);
  });
});

describe('getEntryDateStrings', () => {
  it('returns unique date strings with duplicates collapsed', () => {
    const events = [
      makeEvent('2026-06-01', 100),
      makeEvent('2026-06-01', 200),
      makeEvent('2026-06-02', 100),
    ];

    expect(getEntryDateStrings(events)).toEqual(dates('2026-06-01', '2026-06-02'));
  });

  it('excludes d tags that are not YYYY-MM-DD', () => {
    const events = [
      makeEvent('2026-06-01'),
      makeEvent('not-a-date'),
      makeEvent('2026-6-1'),
      makeEvent('2026-06-01T00:00:00'),
    ];

    expect(getEntryDateStrings(events)).toEqual(dates('2026-06-01'));
  });
});

describe('calculateStreaks', () => {
  const TODAY = '2026-06-09';

  it('returns zeros for an empty set', () => {
    expect(calculateStreaks(dates(), TODAY)).toEqual({
      current: 0,
      longest: 0,
      total: 0,
      todayCompleted: false,
    });
  });

  it('counts a single entry today', () => {
    expect(calculateStreaks(dates('2026-06-09'), TODAY)).toEqual({
      current: 1,
      longest: 1,
      total: 1,
      todayCompleted: true,
    });
  });

  it('keeps the streak alive when today is pending but yesterday has an entry', () => {
    expect(calculateStreaks(dates('2026-06-08'), TODAY)).toEqual({
      current: 1,
      longest: 1,
      total: 1,
      todayCompleted: false,
    });
  });

  it('breaks the current streak once a full day is missed', () => {
    // Entries two and three days ago, nothing yesterday or today.
    const result = calculateStreaks(dates('2026-06-06', '2026-06-07'), TODAY);

    expect(result.current).toBe(0);
    expect(result.longest).toBe(2);
    expect(result.todayCompleted).toBe(false);
  });

  it('does not bridge a gap within the current streak', () => {
    // Today and yesterday, then a gap, then earlier days.
    const result = calculateStreaks(
      dates('2026-06-09', '2026-06-08', '2026-06-06', '2026-06-05'),
      TODAY
    );

    expect(result.current).toBe(2);
    expect(result.longest).toBe(2);
  });

  it('tracks a longest streak distinct from the current streak', () => {
    const result = calculateStreaks(
      dates('2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-08', '2026-06-09'),
      TODAY
    );

    expect(result.current).toBe(2);
    expect(result.longest).toBe(4);
    expect(result.total).toBe(6);
  });

  it('continues a streak across a year boundary', () => {
    const result = calculateStreaks(
      dates('2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'),
      '2026-01-02'
    );

    expect(result.current).toBe(4);
    expect(result.longest).toBe(4);
  });

  it('continues a streak across a leap day', () => {
    const result = calculateStreaks(
      dates('2024-02-28', '2024-02-29', '2024-03-01'),
      '2024-03-01'
    );

    expect(result.current).toBe(3);
    expect(result.longest).toBe(3);
  });

  it('does not bridge Feb 28 to Mar 1 in a leap year', () => {
    const result = calculateStreaks(dates('2024-02-28', '2024-03-01'), '2024-03-01');

    expect(result.current).toBe(1);
    expect(result.longest).toBe(1);
  });

  it('reports total as unique entry days after d-tag dedup', () => {
    // Simulate relay duplicates: three events, two sharing a d tag.
    const events = [
      makeEvent('2026-06-08', 100),
      makeEvent('2026-06-08', 200),
      makeEvent('2026-06-09', 300),
    ];
    const result = calculateStreaks(getEntryDateStrings(events), TODAY);

    expect(result.total).toBe(2);
    expect(result.current).toBe(2);
    expect(result.longest).toBe(2);
  });
});

describe('milestones', () => {
  it('defines the expected milestone ladder (day-1 foundation first)', () => {
    expect(MILESTONES).toEqual([1, 7, 14, 30, 50, 100, 200, 365]);
  });

  it('getReachedMilestones returns nothing below the first entry, then the day-1 tier', () => {
    expect(getReachedMilestones(0)).toEqual([]);
    expect(getReachedMilestones(1)).toEqual([1]);
    expect(getReachedMilestones(6)).toEqual([1]);
  });

  it('getReachedMilestones includes a milestone exactly at the boundary', () => {
    expect(getReachedMilestones(7)).toEqual([1, 7]);
    expect(getReachedMilestones(30)).toEqual([1, 7, 14, 30]);
    expect(getReachedMilestones(365)).toEqual([1, 7, 14, 30, 50, 100, 200, 365]);
  });

  it('getNextMilestone returns the milestone ahead, or null past 365', () => {
    expect(getNextMilestone(0)).toBe(1);
    expect(getNextMilestone(1)).toBe(7);
    expect(getNextMilestone(6)).toBe(7);
    expect(getNextMilestone(7)).toBe(14);
    expect(getNextMilestone(200)).toBe(365);
    expect(getNextMilestone(365)).toBeNull();
    expect(getNextMilestone(400)).toBeNull();
  });
});

describe('shouldShowMilestoneHint', () => {
  it('never shows below a 3-day streak', () => {
    expect(shouldShowMilestoneHint(0)).toBe(false);
    expect(shouldShowMilestoneHint(1)).toBe(false);
    expect(shouldShowMilestoneHint(2)).toBe(false);
  });

  it('shows within 5 days of the next milestone', () => {
    expect(shouldShowMilestoneHint(3)).toBe(true); // 4 days to 7
    expect(shouldShowMilestoneHint(9)).toBe(true); // 5 days to 14
    expect(shouldShowMilestoneHint(25)).toBe(true); // 5 days to 30
  });

  it('shows within 25% of a large milestone even when more than 5 days out', () => {
    expect(shouldShowMilestoneHint(280)).toBe(true); // 85 days to 365, within 25%
    expect(shouldShowMilestoneHint(160)).toBe(true); // 40 days to 200, within 25%
  });

  it('hides when far from the next milestone', () => {
    expect(shouldShowMilestoneHint(15)).toBe(false); // 15 days to 30
    expect(shouldShowMilestoneHint(105)).toBe(false); // 95 days to 200
  });

  it('hides once past the final milestone', () => {
    expect(shouldShowMilestoneHint(365)).toBe(false);
    expect(shouldShowMilestoneHint(400)).toBe(false);
  });
});

describe('pickCelebration', () => {
  it('fires the day-1 foundation when total === 1, regardless of streak', () => {
    expect(pickCelebration({ total: 1, current: 1, isCelebrated: never })).toBe(1);
    // Lone old entry: first-ever entry but the streak has lapsed.
    expect(pickCelebration({ total: 1, current: 0, isCelebrated: never })).toBe(1);
  });

  it('does NOT fire day-1 for an established account with an empty store', () => {
    // The regression: wiped browser, total > 1 — must never re-pop day-1.
    expect(pickCelebration({ total: 300, current: 5, isCelebrated: never })).toBeNull();
  });

  it('never returns milestone 1 through the streak-store path', () => {
    // total > 1 with a 1-day current streak: foundation must not leak back in.
    expect(pickCelebration({ total: 2, current: 1, isCelebrated: never })).toBeNull();
  });

  it('fires the highest un-celebrated streak milestone (7+)', () => {
    expect(pickCelebration({ total: 30, current: 30, isCelebrated: never })).toBe(30);
    expect(pickCelebration({ total: 10, current: 7, isCelebrated: never })).toBe(7);
  });

  it('skips already-celebrated streak milestones', () => {
    // 7 celebrated, 14 reached and not — fire 14.
    const only7 = (m: number) => m === 7;
    expect(pickCelebration({ total: 20, current: 14, isCelebrated: only7 })).toBe(14);
    // All reached milestones celebrated — nothing fires.
    expect(pickCelebration({ total: 40, current: 30, isCelebrated: always })).toBeNull();
  });

  it('returns null between milestones', () => {
    expect(pickCelebration({ total: 5, current: 5, isCelebrated: never })).toBeNull();
  });
});
