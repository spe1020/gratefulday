import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TEACHING_PREFERENCES,
  TEACHING_TRADITIONS,
  getNextTeachingForDay,
  getTeachingForDay,
  getTeachings,
  getTeachingsByTradition,
} from './teachingUtils';
import type { TeachingPreferences } from '@/contexts/AppContext';

const weights = (overrides: Partial<TeachingPreferences>): TeachingPreferences =>
  ({ ...DEFAULT_TEACHING_PREFERENCES, ...overrides }) as TeachingPreferences;

describe('teaching data', () => {
  it('has a non-empty pool for every listed tradition', () => {
    for (const tradition of TEACHING_TRADITIONS) {
      expect(getTeachingsByTradition(tradition).length).toBeGreaterThan(0);
    }
  });

  it('has unique ids', () => {
    const ids = getTeachings().map((teaching) => teaching.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getTeachingForDay', () => {
  it('is deterministic for a given day', () => {
    expect(getTeachingForDay(42)).toEqual(getTeachingForDay(42));
  });

  it('round-robins traditions when no preferences are set', () => {
    const traditions = Array.from(
      { length: TEACHING_TRADITIONS.length },
      (_, i) => getTeachingForDay(i + 1)?.tradition
    );
    expect(new Set(traditions).size).toBe(TEACHING_TRADITIONS.length);
  });

  it('round-robins when all weights are equal, including the persisted default', () => {
    // The all-80s default is what every user who has opened Settings has
    // stored. Treating that as "weighted random" repeated traditions for days
    // on end, contradicting the documented contract.
    const traditions = Array.from(
      { length: TEACHING_TRADITIONS.length },
      (_, i) => getTeachingForDay(i + 1, DEFAULT_TEACHING_PREFERENCES)?.tradition
    );
    expect(new Set(traditions).size).toBe(TEACHING_TRADITIONS.length);
  });

  it('never returns a tradition weighted to 0', () => {
    const prefs = weights({ Christian: 0, Stoic: 0 });
    for (let day = 1; day <= 60; day++) {
      const tradition = getTeachingForDay(day, prefs)?.tradition;
      expect(tradition).not.toBe('Christian');
      expect(tradition).not.toBe('Stoic');
    }
  });

  it('returns only the single enabled tradition when one weight is set', () => {
    const prefs = Object.fromEntries(
      TEACHING_TRADITIONS.map((t) => [t, t === 'Buddhist' ? 100 : 0])
    ) as TeachingPreferences;
    for (let day = 1; day <= 20; day++) {
      expect(getTeachingForDay(day, prefs)?.tradition).toBe('Buddhist');
    }
  });

  it('still shows a teaching when every weight is 0', () => {
    const prefs = Object.fromEntries(
      TEACHING_TRADITIONS.map((t) => [t, 0])
    ) as TeachingPreferences;
    expect(getTeachingForDay(1, prefs)).not.toBeNull();
  });

  it('returns a different teaching for each shuffle offset', () => {
    const first = getTeachingForDay(100, DEFAULT_TEACHING_PREFERENCES, 0);
    const second = getTeachingForDay(100, DEFAULT_TEACHING_PREFERENCES, 1);
    expect(first?.id).not.toBe(second?.id);
  });

  it('returns a teaching for every day of a leap year', () => {
    for (let day = 1; day <= 366; day++) {
      expect(getTeachingForDay(day, DEFAULT_TEACHING_PREFERENCES)).not.toBeNull();
    }
  });
});

describe('getNextTeachingForDay', () => {
  it('previews the following day', () => {
    expect(getNextTeachingForDay(10, 2026)).toEqual(getTeachingForDay(11));
  });

  it('wraps at the end of a non-leap year', () => {
    expect(getNextTeachingForDay(365, 2026)).toEqual(getTeachingForDay(1));
  });

  it('uses day 366 before wrapping in a leap year', () => {
    expect(getNextTeachingForDay(365, 2024)).toEqual(getTeachingForDay(366));
    expect(getNextTeachingForDay(366, 2024)).toEqual(getTeachingForDay(1));
  });
});
