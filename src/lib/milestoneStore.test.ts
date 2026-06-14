import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCelebratedMilestones,
  setCelebratedMilestones,
} from './milestoneStore';

const PK = 'pk-test';
const OTHER = 'pk-other';

// The single namespaced key milestoneStore writes under — clear only this one
// so the test stays isolated without disturbing unrelated localStorage state.
const MILESTONE_STORAGE_KEY = 'gratefulday:milestones:v1';

describe('milestoneStore cache layer', () => {
  beforeEach(() => {
    localStorage.removeItem(MILESTONE_STORAGE_KEY);
  });

  it('returns an empty array for an unknown pubkey', () => {
    expect(getCelebratedMilestones(PK)).toEqual([]);
  });

  it('round-trips a celebrated set, sorted and deduped', () => {
    setCelebratedMilestones(PK, [30, 7, 7, 14]);
    expect(getCelebratedMilestones(PK)).toEqual([7, 14, 30]);
  });

  it('replaces (not merges) the set on write — the hook owns union semantics', () => {
    setCelebratedMilestones(PK, [7, 14]);
    setCelebratedMilestones(PK, [7]);
    expect(getCelebratedMilestones(PK)).toEqual([7]);
  });

  it('keeps each pubkey isolated', () => {
    setCelebratedMilestones(PK, [7]);
    setCelebratedMilestones(OTHER, [30]);
    expect(getCelebratedMilestones(PK)).toEqual([7]);
    expect(getCelebratedMilestones(OTHER)).toEqual([30]);
  });

  it('strips day-1 (milestone 1) at the storage boundary', () => {
    setCelebratedMilestones(PK, [1, 7, 14]);
    expect(getCelebratedMilestones(PK)).toEqual([7, 14]);
  });

  it('tolerates corrupt storage by reading as empty', () => {
    localStorage.setItem(MILESTONE_STORAGE_KEY, 'not json');
    expect(getCelebratedMilestones(PK)).toEqual([]);
  });

  it('degrades a non-array pubkey value to empty instead of throwing', () => {
    localStorage.setItem(MILESTONE_STORAGE_KEY, JSON.stringify({ [PK]: 'oops' }));
    expect(getCelebratedMilestones(PK)).toEqual([]);
  });

  it('recovers from an array-corrupted store: a subsequent write still persists', () => {
    // An array stringifies dropping named props, so writes onto it would vanish
    // unless readStore rejects arrays. Prove the write survives a round-trip.
    localStorage.setItem(MILESTONE_STORAGE_KEY, '[]');
    setCelebratedMilestones(PK, [7]);
    expect(getCelebratedMilestones(PK)).toEqual([7]);
  });
});
