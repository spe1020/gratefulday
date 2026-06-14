import { describe, it, expect } from 'vitest';
import { getWeeklyBuckets } from './vineUtils';

// 2026-06-17 is a Wednesday; its week's Sunday is 2026-06-14.
const WED = new Date(2026, 5, 17);
// 2026-06-14 is a Sunday (start of the current week).
const SUN = new Date(2026, 5, 14);

const sum = (buckets: { count: number }[]) =>
  buckets.reduce((acc, b) => acc + b.count, 0);

describe('getWeeklyBuckets', () => {
  it('returns `weeks` ordered Sunday buckets ending at the current week', () => {
    const buckets = getWeeklyBuckets(new Set(), WED);
    expect(buckets).toHaveLength(53);
    expect(buckets[buckets.length - 1].weekStart).toBe('2026-06-14');
    // Default 53-week trailing window starts 52 Sundays earlier.
    expect(buckets[0].weekStart).toBe('2025-06-15');
    // Ascending order by weekStart.
    const sorted = [...buckets].map((b) => b.weekStart).sort();
    expect(buckets.map((b) => b.weekStart)).toEqual(sorted);
  });

  it('empty set → every bucket is zero', () => {
    const buckets = getWeeklyBuckets(new Set(), WED);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
    expect(sum(buckets)).toBe(0);
  });

  it('a fully journaled completed week → count 7 (and spans a month boundary correctly)', () => {
    // Week of Sun 2026-05-31 through Sat 2026-06-06 spans May→June.
    const week = new Set([
      '2026-05-31', '2026-06-01', '2026-06-02', '2026-06-03',
      '2026-06-04', '2026-06-05', '2026-06-06',
    ]);
    const buckets = getWeeklyBuckets(week, WED);
    const bucket = buckets.find((b) => b.weekStart === '2026-05-31');
    expect(bucket?.count).toBe(7);
    expect(sum(buckets)).toBe(7); // nothing leaked into adjacent weeks
  });

  it('scattered days land in the right weeks with the right counts', () => {
    const dates = new Set([
      '2026-05-31', '2026-06-03', // 2 in week of 05-31
      '2026-06-07', // 1 in week of 06-07
    ]);
    const buckets = getWeeklyBuckets(dates, WED);
    expect(buckets.find((b) => b.weekStart === '2026-05-31')?.count).toBe(2);
    expect(buckets.find((b) => b.weekStart === '2026-06-07')?.count).toBe(1);
    expect(sum(buckets)).toBe(3);
  });

  it('partial current week: 3 elapsed journaled days → count 3, never a 7/7 bloom', () => {
    // today = Wed 2026-06-17; current week Sun..Wed elapsed (14,15,16,17).
    const dates = new Set([
      '2026-06-14', '2026-06-16', '2026-06-17', // 3 journaled, all <= today
      '2026-06-18', // Thursday this week — in the future, must NOT count
    ]);
    const buckets = getWeeklyBuckets(dates, WED);
    const current = buckets[buckets.length - 1];
    expect(current.weekStart).toBe('2026-06-14');
    expect(current.count).toBe(3);
    expect(current.count).not.toBe(7);
  });

  it('counts a date exactly on the window edge, excludes anything older', () => {
    const dates = new Set([
      '2025-06-15', // exactly the oldest bucket's Sunday — included
      '2025-01-01', // before the trailing window — excluded
    ]);
    const buckets = getWeeklyBuckets(dates, WED);
    expect(buckets[0].weekStart).toBe('2025-06-15');
    expect(buckets[0].count).toBe(1);
    expect(sum(buckets)).toBe(1); // the older date contributes nothing
  });

  it('a single entry counts exactly once', () => {
    const buckets = getWeeklyBuckets(new Set(['2026-06-10']), WED);
    expect(sum(buckets)).toBe(1);
  });

  it('honors a custom window length', () => {
    const buckets = getWeeklyBuckets(new Set(), SUN, 4);
    expect(buckets).toHaveLength(4);
    expect(buckets[buckets.length - 1].weekStart).toBe('2026-06-14');
    expect(buckets[0].weekStart).toBe('2026-05-24'); // 3 Sundays earlier
  });
});
