import { describe, it, expect } from 'vitest';
import { hasEntryConflict } from './entryVersion';

const base = { id: 'base', created_at: 100 };

describe('hasEntryConflict', () => {
  it('no conflict when the relay still has exactly the base version', () => {
    expect(hasEntryConflict(base, { id: 'base', created_at: 100 }, undefined)).toBe(false);
  });

  it('conflict when a newer version was saved elsewhere', () => {
    expect(hasEntryConflict(base, { id: 'other', created_at: 150 }, undefined)).toBe(true);
  });

  it('conflict when a different version has the same created_at', () => {
    expect(hasEntryConflict(base, { id: 'other', created_at: 100 }, undefined)).toBe(true);
  });

  it('no conflict when the relay only has an older, stale copy', () => {
    expect(hasEntryConflict(base, { id: 'older', created_at: 50 }, undefined)).toBe(false);
  });

  it('conflict when the base version was deleted (kind 5 or tombstone at/after it)', () => {
    expect(hasEntryConflict(base, null, 100)).toBe(true);
    expect(hasEntryConflict(base, null, 120)).toBe(true);
  });

  it('a deletion older than the base does not count', () => {
    expect(hasEntryConflict(base, { id: 'base', created_at: 100 }, 90)).toBe(false);
  });

  it('no conflict when the base is simply missing (lagging relay, no deletion)', () => {
    expect(hasEntryConflict(base, null, undefined)).toBe(false);
  });

  it('empty day at open: conflict iff a version exists now', () => {
    expect(hasEntryConflict(null, null, undefined)).toBe(false);
    expect(hasEntryConflict(null, { id: 'new', created_at: 5 }, undefined)).toBe(true);
    // A deleted-then-hidden version is passed in as latest=null by the caller.
    expect(hasEntryConflict(null, null, 200)).toBe(false);
  });
});
