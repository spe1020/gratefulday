import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  groupEntriesByDay,
  getMonthUnixBounds,
  getMonthGrid,
} from './communityUtils';

interface MakeEventOptions {
  dTag?: string;
  pubkey?: string;
  created_at?: number;
  encrypted?: boolean;
}

function makeEvent({
  dTag = '2026-06-01',
  pubkey = 'author-a',
  created_at = 1000,
  encrypted = false,
}: MakeEventOptions = {}): NostrEvent {
  const tags: string[][] = [];
  if (dTag) tags.push(['d', dTag]);
  if (encrypted) tags.push(['encrypted', 'nip44']);
  return {
    id: `id-${pubkey}-${dTag}-${created_at}`,
    pubkey,
    created_at,
    kind: 36669,
    tags,
    content: encrypted ? 'ciphertext==' : 'grateful',
    sig: 'sig',
  };
}

describe('groupEntriesByDay', () => {
  it('returns an empty map for no events', () => {
    expect(groupEntriesByDay([]).size).toBe(0);
  });

  it('groups a single day with a single author', () => {
    const buckets = groupEntriesByDay([makeEvent({ dTag: '2026-06-01' })]);

    expect(buckets.size).toBe(1);
    const bucket = buckets.get('2026-06-01')!;
    expect(bucket.noteCount).toBe(1);
    expect(bucket.authorPubkeys).toEqual(['author-a']);
  });

  it('counts notes and collects distinct authors for a multi-author day', () => {
    const buckets = groupEntriesByDay([
      makeEvent({ dTag: '2026-06-01', pubkey: 'author-a', created_at: 100 }),
      makeEvent({ dTag: '2026-06-01', pubkey: 'author-b', created_at: 300 }),
      makeEvent({ dTag: '2026-06-01', pubkey: 'author-c', created_at: 200 }),
    ]);

    const bucket = buckets.get('2026-06-01')!;
    expect(bucket.noteCount).toBe(3);
    // Newest-first ordering: b (300), c (200), a (100).
    expect(bucket.authorPubkeys).toEqual(['author-b', 'author-c', 'author-a']);
  });

  it('splits one author across two dates into two buckets', () => {
    const buckets = groupEntriesByDay([
      makeEvent({ dTag: '2026-06-01', pubkey: 'author-a' }),
      makeEvent({ dTag: '2026-06-02', pubkey: 'author-a' }),
    ]);

    expect(buckets.size).toBe(2);
    expect(buckets.get('2026-06-01')!.noteCount).toBe(1);
    expect(buckets.get('2026-06-02')!.noteCount).toBe(1);
  });

  it('drops entries with missing or malformed d tags', () => {
    const buckets = groupEntriesByDay([
      makeEvent({ dTag: '' }),
      makeEvent({ dTag: 'June 1st' }),
      makeEvent({ dTag: '2026-6-1' }),
    ]);

    expect(buckets.size).toBe(0);
  });

  it('hard-gates encrypted entries out of grouping', () => {
    const buckets = groupEntriesByDay([
      makeEvent({ dTag: '2026-06-01', pubkey: 'author-a' }),
      makeEvent({ dTag: '2026-06-01', pubkey: 'author-secret', encrypted: true }),
    ]);

    const bucket = buckets.get('2026-06-01')!;
    expect(bucket.noteCount).toBe(1);
    expect(bucket.authorPubkeys).toEqual(['author-a']);
  });

  it('attributes a day by its d tag even when created_at falls in another day', () => {
    // Journaled 2026-06-05 but published much later (backfill). The bucket key
    // must follow the d tag, not the publish time.
    const backfilled = makeEvent({
      dTag: '2026-06-05',
      created_at: Math.floor(new Date(2026, 6, 20, 12).getTime() / 1000),
    });

    const buckets = groupEntriesByDay([backfilled]);

    expect([...buckets.keys()]).toEqual(['2026-06-05']);
  });
});

describe('getMonthUnixBounds', () => {
  it('spans the first instant through the last instant of the month (local tz)', () => {
    const { since, until } = getMonthUnixBounds(2026, 5); // June 2026

    expect(since).toBe(Math.floor(new Date(2026, 5, 1, 0, 0, 0, 0).getTime() / 1000));
    expect(until).toBe(Math.floor(new Date(2026, 5, 30, 23, 59, 59, 999).getTime() / 1000));
    expect(until).toBeGreaterThan(since);
  });

  it('handles February in a leap year', () => {
    const { until } = getMonthUnixBounds(2024, 1); // Feb 2024 (leap)
    expect(until).toBe(Math.floor(new Date(2024, 1, 29, 23, 59, 59, 999).getTime() / 1000));
  });
});

describe('getMonthGrid', () => {
  it('pads leading nulls to the first weekday and lists every day', () => {
    // June 2026: the 1st is a Monday (weekday 1) → 1 leading null.
    const cells = getMonthGrid(2026, 5);

    const leadingNulls = cells.slice(0, 1);
    expect(leadingNulls).toEqual([null]);

    const dayCells = cells.filter((c): c is NonNullable<typeof c> => c !== null);
    expect(dayCells).toHaveLength(30);
    expect(dayCells[0]).toEqual({ day: 1, dateString: '2026-06-01' });
    expect(dayCells[29]).toEqual({ day: 30, dateString: '2026-06-30' });
  });

  it('produces no leading nulls when the month starts on Sunday', () => {
    // February 2026 starts on a Sunday (weekday 0).
    const cells = getMonthGrid(2026, 1);
    expect(cells[0]).toEqual({ day: 1, dateString: '2026-02-01' });
  });
});
