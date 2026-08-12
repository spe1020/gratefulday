import { describe, it, expect, beforeEach } from 'vitest';
import {
  readEntryDraft,
  writeEntryDraft,
  clearEntryDraft,
  DRAFT_TTL_MS,
} from './entryDraft';

const DRAFT_KEY = 'gratefulday:entry-draft:v1';
const DAY = '2026-06-13';

describe('entryDraft', () => {
  beforeEach(() => {
    localStorage.removeItem(DRAFT_KEY);
  });

  it('round-trips draft notes for the same day', () => {
    writeEntryDraft(DAY, ['first', 'second'], 1_000);
    expect(readEntryDraft(DAY, 2_000)).toEqual(['first', 'second']);
  });

  it('drops blank notes on write and clears when nothing is worth keeping', () => {
    writeEntryDraft(DAY, ['keep me', '   ', ''], 1_000);
    expect(readEntryDraft(DAY, 2_000)).toEqual(['keep me']);

    writeEntryDraft(DAY, ['', '   '], 3_000);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('expires (and purges) a draft older than 24 hours', () => {
    writeEntryDraft(DAY, ['stale thought'], 1_000);
    expect(readEntryDraft(DAY, 1_000 + DRAFT_TTL_MS + 1)).toEqual([]);
    // Expiry also scrubs the plaintext from the device.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('still reads a draft right at the edge of the window', () => {
    writeEntryDraft(DAY, ['fresh enough'], 1_000);
    expect(readEntryDraft(DAY, 1_000 + DRAFT_TTL_MS)).toEqual(['fresh enough']);
  });

  it("purges a draft that belongs to a different day (yesterday's text never leaks into today)", () => {
    writeEntryDraft(DAY, ['yesterday'], 1_000);
    expect(readEntryDraft('2026-06-14', 2_000)).toEqual([]);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('reads corrupt storage as empty and purges it', () => {
    localStorage.setItem(DRAFT_KEY, 'not json{');
    expect(readEntryDraft(DAY)).toEqual([]);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('clearEntryDraft removes the backup', () => {
    writeEntryDraft(DAY, ['gone soon'], 1_000);
    clearEntryDraft();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
