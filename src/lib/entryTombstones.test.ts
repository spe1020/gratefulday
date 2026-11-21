import { describe, it, expect, beforeEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  addEntryTombstone,
  entryAddress,
  getEntryTombstones,
  isEntryTombstoned,
  mergeTombstones,
  tombstonesFromDeletions,
} from './entryTombstones';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function deletion(pubkey: string, created_at: number, tags: string[][]): NostrEvent {
  return { id: `del-${created_at}`, pubkey, kind: 5, created_at, tags, content: 'Deleted gratitude entry', sig: 's' };
}

function entry(pubkey: string, d: string, created_at: number): NostrEvent {
  return { id: `e-${d}-${created_at}`, pubkey, kind: 36669, created_at, tags: [['d', d]], content: 'x', sig: 's' };
}

describe('tombstonesFromDeletions', () => {
  it('reads the web delete shape (a, e, k tags)', () => {
    const map = tombstonesFromDeletions(
      [deletion(ME, 500, [['a', entryAddress(ME, '2026-06-13')], ['e', 'evt'], ['k', '36669']])],
      ME
    );
    expect(map).toEqual({ [entryAddress(ME, '2026-06-13')]: 500 });
  });

  it('keeps the latest deletion per address', () => {
    const a = entryAddress(ME, '2026-06-13');
    const map = tombstonesFromDeletions(
      [deletion(ME, 300, [['a', a]]), deletion(ME, 700, [['a', a]]), deletion(ME, 500, [['a', a]])],
      ME
    );
    expect(map[a]).toBe(700);
  });

  it('ignores deletions signed by someone else, other kinds, and other authors’ coordinates', () => {
    const map = tombstonesFromDeletions(
      [
        deletion(OTHER, 900, [['a', entryAddress(ME, '2026-06-13')]]),
        deletion(ME, 900, [['a', `30078:${ME}:gratefulday:settings`]]),
        deletion(ME, 900, [['a', entryAddress(OTHER, '2026-06-13')]]),
        deletion(ME, 900, [['a', `36669:${ME}:`]]),
        { ...deletion(ME, 900, [['a', entryAddress(ME, '2026-06-14')]]), kind: 1 },
      ],
      ME
    );
    expect(map).toEqual({});
  });

  it('hides versions at or before the deletion, but not a newer re-created entry', () => {
    const map = tombstonesFromDeletions([deletion(ME, 500, [['a', entryAddress(ME, '2026-06-13')]])], ME);
    expect(isEntryTombstoned(entry(ME, '2026-06-13', 400), map)).toBe(true);
    expect(isEntryTombstoned(entry(ME, '2026-06-13', 500), map)).toBe(true);
    expect(isEntryTombstoned(entry(ME, '2026-06-13', 501), map)).toBe(false);
    expect(isEntryTombstoned(entry(ME, '2026-06-14', 400), map)).toBe(false);
  });
});

describe('mergeTombstones', () => {
  beforeEach(() => localStorage.removeItem('gratefulday:deleted-entries:v1'));

  it('combines local and remote tombstones, latest wins', () => {
    addEntryTombstone(ME, '2026-06-13', 300);
    const remote = { [entryAddress(ME, '2026-06-13')]: 200, [entryAddress(ME, '2026-06-14')]: 800 };
    expect(mergeTombstones(getEntryTombstones(), remote)).toEqual({
      [entryAddress(ME, '2026-06-13')]: 300,
      [entryAddress(ME, '2026-06-14')]: 800,
    });
  });

  it('skips non-numeric values from a corrupt store', () => {
    expect(mergeTombstones({ x: 'nope' as unknown as number, y: 5 })).toEqual({ y: 5 });
  });
});
