import { describe, it, expect } from 'vitest';
import {
  getAffirmationForDay,
  getAllDaysInYear,
  getDayOfYear,
  getPromptForDay,
  getQuoteForDay,
  getTotalDaysInYear,
  formatDateString,
  isFuture,
  isLeapYear,
  isToday,
  isValidDateString,
} from './gratitudeUtils';

describe('getDayOfYear', () => {
  it('counts from 1 on January 1st', () => {
    expect(getDayOfYear(new Date(2026, 0, 1))).toBe(1);
  });

  it('is correct after a DST spring-forward', () => {
    // The original implementation divided elapsed local milliseconds, so every
    // date between spring-forward and fall-back came out one short (the day
    // that is only 23 hours long). July 1 2026 is day 182 in a non-leap year.
    expect(getDayOfYear(new Date(2026, 6, 1))).toBe(182);
  });

  it('counts the leap day in a leap year', () => {
    expect(getDayOfYear(new Date(2024, 1, 29))).toBe(60);
    expect(getDayOfYear(new Date(2024, 11, 31))).toBe(366);
  });

  it('ends at 365 in a non-leap year', () => {
    expect(getDayOfYear(new Date(2026, 11, 31))).toBe(365);
  });
});

describe('isLeapYear / getTotalDaysInYear', () => {
  it('applies the full Gregorian rule', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false); // divisible by 100, not 400
    expect(isLeapYear(2000)).toBe(true); // divisible by 400
  });

  it('reports 366 days only for leap years', () => {
    expect(getTotalDaysInYear(2024)).toBe(366);
    expect(getTotalDaysInYear(2026)).toBe(365);
  });
});

describe('formatDateString', () => {
  it('zero-pads month and day', () => {
    expect(formatDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDateString(new Date(2026, 11, 25))).toBe('2026-12-25');
  });

  it('uses local components, not UTC', () => {
    // 23:30 local on the 5th must stay the 5th even where UTC has rolled over.
    expect(formatDateString(new Date(2026, 5, 5, 23, 30))).toBe('2026-06-05');
  });
});

describe('isToday / isFuture', () => {
  it('identifies today regardless of time of day', () => {
    const now = new Date();
    const laterToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    expect(isToday(laterToday)).toBe(true);
    expect(isFuture(laterToday)).toBe(false);
  });

  it('treats tomorrow as future and yesterday as neither', () => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    expect(isFuture(tomorrow)).toBe(true);
    expect(isToday(tomorrow)).toBe(false);
    expect(isFuture(yesterday)).toBe(false);
    expect(isToday(yesterday)).toBe(false);
  });
});

describe('getAllDaysInYear', () => {
  it('emits one entry per day, including the leap day', () => {
    const days = getAllDaysInYear(2024);
    expect(days).toHaveLength(366);
    expect(days[0].dateString).toBe('2024-01-01');
    expect(days[59].dateString).toBe('2024-02-29');
    expect(days[365].dateString).toBe('2024-12-31');
  });

  it('emits 365 entries for a non-leap year with dayOfYear matching position', () => {
    const days = getAllDaysInYear(2026);
    expect(days).toHaveLength(365);
    expect(days.every((day, index) => day.dayOfYear === index + 1)).toBe(true);
    expect(days[59].dateString).toBe('2026-03-01'); // no Feb 29
  });

  it('marks a fully past year as past and unlocked', () => {
    const days = getAllDaysInYear(2020);
    expect(days.every((day) => day.isPast)).toBe(true);
    expect(days.every((day) => day.isUnlocked)).toBe(true);
  });
});

describe('isValidDateString', () => {
  it('accepts real dates, including a leap day', () => {
    expect(isValidDateString('2026-06-10')).toBe(true);
    expect(isValidDateString('2024-02-29')).toBe(true);
  });

  it('rejects shape-valid but impossible dates', () => {
    // These all pass a /^\d{4}-\d{2}-\d{2}$/ check, which is why the shape-only
    // version let a hostile `d` tag inflate streak totals.
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('2026-00-10')).toBe(false);
    expect(isValidDateString('0000-00-00')).toBe(false);
    expect(isValidDateString('2026-02-29')).toBe(false); // 2026 is not a leap year
  });

  it('rejects malformed strings', () => {
    expect(isValidDateString('')).toBe(false);
    expect(isValidDateString('2026-6-10')).toBe(false);
    expect(isValidDateString('06-10-2026')).toBe(false);
    expect(isValidDateString('2026-06-10T00:00:00Z')).toBe(false);
  });
});

describe('daily content cycling', () => {
  it('is stable for a given day', () => {
    expect(getQuoteForDay(1)).toEqual(getQuoteForDay(1));
    expect(getPromptForDay(200)).toBe(getPromptForDay(200));
    expect(getAffirmationForDay(200)).toBe(getAffirmationForDay(200));
  });

  it('cycles back to the first item after one full pool length', () => {
    // Pool sizes are found by probing rather than hardcoded, so adding content
    // doesn't turn this into a false failure.
    const cycleLength = (pick: (day: number) => unknown): number => {
      const first = JSON.stringify(pick(1));
      for (let day = 2; day <= 400; day++) {
        if (JSON.stringify(pick(day)) === first) return day - 1;
      }
      throw new Error('no cycle found within 400 days');
    };

    for (const pick of [getQuoteForDay, getPromptForDay, getAffirmationForDay]) {
      const length = cycleLength(pick);
      expect(JSON.stringify(pick(1))).toBe(JSON.stringify(pick(length + 1)));
      expect(JSON.stringify(pick(2))).toBe(JSON.stringify(pick(length + 2)));
    }
  });

  it('never indexes out of bounds for day 0 or negative days', () => {
    // Day numbers are 1-based everywhere, but `(day - 1) % length` would return
    // -1 for day 0 and hand back undefined.
    expect(getQuoteForDay(0)).toBeDefined();
    expect(getPromptForDay(0)).toBeDefined();
    expect(getAffirmationForDay(0)).toBeDefined();
    expect(getQuoteForDay(-5)).toBeDefined();
  });

  it('covers every day of a leap year without gaps', () => {
    for (let day = 1; day <= 366; day++) {
      expect(getQuoteForDay(day)).toBeDefined();
      expect(getPromptForDay(day)).toBeDefined();
      expect(getAffirmationForDay(day)).toBeDefined();
    }
  });
});
