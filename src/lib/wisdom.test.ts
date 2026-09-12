import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DAILY_WISDOM } from './data/dailyWisdom';
import { getDailyWisdom, getWisdomForDate, getWisdomPrompt, wisdomItemSchema, wisdomWording } from './wisdom';
import { getDayOfYear, getQuoteForDay } from './gratitudeUtils';
import { getWisdomHistory, linkWisdomReflection, parseWisdomHistory, recordWisdomInteraction, removeWisdomContext, unlinkWisdomReflections, wisdomStorageKey, wisdomStorageUnavailable } from './wisdomStore';

const wisdom = DAILY_WISDOM[0];
const date = '2026-09-12';

describe('daily wisdom content', () => {
  it('validates every sourced seed and keeps identifiers unique', () => {
    expect(new Set(DAILY_WISDOM.map((item) => item.id)).size).toBe(DAILY_WISDOM.length);
    DAILY_WISDOM.forEach((item) => {
      expect(wisdomItemSchema.safeParse(item).success).toBe(true);
      expect(item.provenance?.url).toMatch(/^https:/);
      expect(item.interpretation).toBeTruthy();
      expect(item.prompt).toBeTruthy();
    });
  });

  it('retains the previous quote selection for historical dates', () => {
    const oldDate = new Date(2026, 8, 11);
    expect(getWisdomForDate(oldDate)).toBeUndefined();
    expect(getDailyWisdom(oldDate)).toEqual(getQuoteForDay(getDayOfYear(oldDate), 2026));
  });

  it('rotates by local calendar day, including DST and leap days', () => {
    expect(getWisdomForDate(new Date(2026, 8, 12))).toEqual(wisdom);
    expect(getWisdomForDate(new Date(2026, 8, 12, 23, 59))).toEqual(wisdom);
    expect(getWisdomForDate(new Date(2026, 8, 18))).toEqual(wisdom);
    for (const [a, b] of [[new Date(2026, 10, 1), new Date(2026, 10, 2)], [new Date(2028, 1, 29), new Date(2028, 2, 1)]]) {
      const first = DAILY_WISDOM.indexOf(getWisdomForDate(a)!);
      expect(getWisdomForDate(b)).toBe(DAILY_WISDOM[(first + 1) % DAILY_WISDOM.length]);
    }
  });

  it('handles optional metadata and labels adaptations instead of claiming a quote', () => {
    const minimal = { id: 'minimal', text: 'A thought', author: 'A writer' };
    expect(wisdomItemSchema.safeParse(minimal).success).toBe(true);
    expect(getWisdomPrompt(minimal)).toMatch(/your life today/);
    expect(wisdomWording(minimal)).toMatch(/not yet verified/);
    expect(wisdomWording({ ...wisdom, provenance: { ...wisdom.provenance!, wording: 'adaptation' } })).toMatch(/Adapted by Grateful Day/);
    expect(wisdomItemSchema.safeParse({ ...wisdom, provenance: { ...wisdom.provenance, url: 'javascript:alert(1)' } }).success).toBe(false);
  });
});

describe('wisdom history persistence', () => {
  beforeEach(() => { localStorage.clear(); });

  it('starts empty, records explicit opens separately, and deduplicates repeated opens', () => {
    expect(getWisdomHistory('alice')).toEqual([]);
    recordWisdomInteraction('alice', wisdom, date, 'opened');
    recordWisdomInteraction('alice', wisdom, date, 'opened');
    expect(getWisdomHistory('alice')).toHaveLength(1);
    expect(getWisdomHistory('alice')[0]).toMatchObject({ active: false, date });
    expect(getWisdomHistory('alice')[0].addedAt).toBeUndefined();
    expect(getWisdomHistory('alice')[0].reflection).toBeUndefined();
  });

  it('persists additions and references without copying writing or crossing accounts', async () => {
    recordWisdomInteraction('alice', wisdom, date, 'added');
    linkWisdomReflection('alice', date, 'saved-event', [wisdom.id], true);
    const raw = localStorage.getItem(wisdomStorageKey('alice'))!;
    expect(parseWisdomHistory(raw)[0].reflection).toMatchObject({ address: `36669:alice:${date}`, eventId: 'saved-event' });
    expect(getWisdomHistory('bob')).toEqual([]);
    vi.resetModules();
    const reloaded = await import('./wisdomStore');
    expect(reloaded.getWisdomHistory('alice')[0].reflection?.eventId).toBe('saved-event');
    expect(Object.keys(parseWisdomHistory(raw)[0])).toEqual(expect.arrayContaining(['wisdom', 'date', 'openedAt', 'addedAt', 'active', 'reflection']));
    expect(raw).not.toContain('content');
  });

  it('does not link a mere open or attach an unchanged existing entry', () => {
    recordWisdomInteraction('alice', wisdom, date, 'opened');
    linkWisdomReflection('alice', date, 'event', [wisdom.id], true);
    expect(getWisdomHistory('alice')[0].reflection).toBeUndefined();
    recordWisdomInteraction('alice', wisdom, date, 'added');
    linkWisdomReflection('alice', date, 'event', [wisdom.id], false);
    expect(getWisdomHistory('alice')[0].reflection).toBeUndefined();
  });

  it('retains separate days, updates saved references, and removes deleted associations', () => {
    recordWisdomInteraction('alice', wisdom, date, 'added');
    recordWisdomInteraction('alice', wisdom, '2026-09-13', 'opened');
    linkWisdomReflection('alice', date, 'first', [wisdom.id], true);
    linkWisdomReflection('alice', date, 'edited', [wisdom.id], false);
    expect(getWisdomHistory('alice')[0].date).toBe('2026-09-13');
    expect(getWisdomHistory('alice')[1].reflection?.eventId).toBe('edited');
    unlinkWisdomReflections('alice', date);
    expect(getWisdomHistory('alice')[1].active).toBe(false);
    expect(getWisdomHistory('alice')[1].reflection).toBeUndefined();
    expect(getWisdomHistory('alice')).toHaveLength(2);
  });

  it('allows removing context without erasing the deliberate interaction', () => {
    recordWisdomInteraction('alice', wisdom, date, 'added');
    removeWisdomContext('alice', date, wisdom.id);
    linkWisdomReflection('alice', date, 'event', [wisdom.id], true);
    expect(getWisdomHistory('alice')[0].active).toBe(false);
    expect(getWisdomHistory('alice')[0].reflection).toBeUndefined();
    expect(getWisdomHistory('alice')[0].addedAt).toBeDefined();
  });

  it('rejects corrupted data and invalid dates while tolerating optional metadata', () => {
    for (const raw of ['[]', 'null', '{broken', '{"version":2,"interactions":[]}']) expect(parseWisdomHistory(raw)).toEqual([]);
    recordWisdomInteraction('alice', wisdom, '2026-02-30', 'added');
    expect(getWisdomHistory('alice')).toEqual([]);
    const item = { wisdom: { id: 'old', text: 'Old thought', author: 'Writer' }, date, openedAt: 1 };
    expect(parseWisdomHistory(JSON.stringify({ version: 1, interactions: [null, item, { ...item, date: 'bad' }] }))).toHaveLength(1);
  });

  it('keeps guests in memory and gracefully handles unavailable browser storage', () => {
    recordWisdomInteraction(undefined, wisdom, date, 'opened');
    expect(getWisdomHistory()).toHaveLength(1);
    expect(localStorage.getItem(wisdomStorageKey())).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    recordWisdomInteraction('limited', wisdom, date, 'added');
    expect(getWisdomHistory('limited')).toHaveLength(1);
    expect(wisdomStorageUnavailable('limited')).toBe(true);
    spy.mockRestore();
  });
});
