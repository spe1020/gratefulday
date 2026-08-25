/**
 * Teaching card types and rotation logic for Brief Teaching Cards feature.
 * Supports multiple traditions: Christian, Jewish, Islamic, Buddhist, Taoist, Stoic.
 */

import teachingsData from './data/teachings.json';
import { getTotalDaysInYear } from './gratitudeUtils';
import type { TeachingPreferences } from '@/contexts/AppContext';

export type TeachingTradition = 'Christian' | 'Jewish' | 'Islamic' | 'Buddhist' | 'Taoist' | 'Stoic';

export interface Teaching {
  id: number;
  title: string;
  body: string;
  scripture: string;
  /** Actual quoted text from the reference (e.g. Bible verse). Shown in same style as reference. */
  scriptureQuote?: string;
  category: string;
  tradition: TeachingTradition;
}

const teachings = teachingsData as Teaching[];

// Traditions for filter UI and daily rotation: Christian, Stoic, Buddhist, Taoist, Jewish, Islamic
export const TEACHING_TRADITIONS: TeachingTradition[] = ['Christian', 'Stoic', 'Buddhist', 'Taoist', 'Jewish', 'Islamic'];

/** Default preferences: all traditions equally weighted */
export const DEFAULT_TEACHING_PREFERENCES: TeachingPreferences = Object.fromEntries(
  TEACHING_TRADITIONS.map((t) => [t, 80])
);

// Categories for filter UI (order preserved for display)
export const TEACHING_CATEGORIES = [
  'Foundational',
  'Virtues',
  'Practices',
  'Promises',
  'Attributes of God',
] as const;

export type TeachingCategory = (typeof TEACHING_CATEGORIES)[number];

export function getTeachings(): Teaching[] {
  return teachings;
}

export function getTeachingsByTradition(tradition: TeachingTradition): Teaching[] {
  return teachings.filter((t) => t.tradition === tradition);
}

/**
 * Simple seeded PRNG (mulberry32) for deterministic per-day selection.
 * Returns a function that produces values in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Coprime stride + year offset into a pool. Visits every item before repeating
 * when gcd(stride, length) = 1. Independent per-tradition strides keep the
 * six lineages from locking into the same pairing across years.
 */
function dailyPoolIndex(
  dayOfYear: number,
  year: number,
  length: number,
  stride: number,
  yearStride: number,
): number {
  if (length <= 0) return 0;
  const raw = (dayOfYear - 1) * stride + year * yearStride;
  return ((raw % length) + length) % length;
}

/** Per-tradition (stride, yearStride). All coprime with typical pool sizes. */
const TRADITION_STRIDES: Record<TeachingTradition, readonly [number, number]> = {
  Christian: [17, 11],
  Stoic: [19, 13],
  Buddhist: [23, 25],
  Taoist: [29, 17],
  Jewish: [31, 19],
  Islamic: [37, 23],
};

/**
 * Get the single teaching to show for today based on day of year.
 * Tradition selection (see pickTradition): round-robin when no preferences are
 * set OR all non-zero weights are equal (including the persisted all-80s
 * default), weighted random (seeded by dayOfYear for determinism) otherwise.
 * Traditions with weight 0 or an empty teaching pool are excluded.
 * The `shuffle` offset (default 0) shifts the seed so each value yields a
 * different teaching — used by the "another teaching" button.
 * Pass `year` so next calendar year is not locked to this year's sequence.
 */
export function getTeachingForDay(
  dayOfYear: number,
  preferences?: TeachingPreferences,
  shuffle = 0,
  year?: number,
): Teaching | null {
  const all = getTeachings();
  if (all.length === 0) return null;

  const y = year ?? new Date().getFullYear();
  const seed = dayOfYear + shuffle * 7919 + y * 1009;
  const tradition = pickTradition(seed, preferences);
  if (tradition === null) return null;
  const byTradition = all.filter((t) => t.tradition === tradition);
  if (byTradition.length === 0) return null;

  // Index by this tradition's visit count, not raw day-of-year. Round-robin
  // lands every Nth day on the same lineage; a linear dayOfYear stride then
  // only hits a handful of pool slots. Visit count walks the full pool.
  const [stride, yearStride] = TRADITION_STRIDES[tradition];
  const activeCount = countActiveTraditions(preferences);
  const visit = Math.floor((dayOfYear - 1) / Math.max(activeCount, 1)) + shuffle;
  const index = dailyPoolIndex(visit + 1, y, byTradition.length, stride, yearStride);
  return byTradition[index] ?? null;
}

function countActiveTraditions(preferences?: TeachingPreferences): number {
  const available = TEACHING_TRADITIONS.filter(
    (t) => getTeachingsByTradition(t).length > 0
  );
  if (available.length === 0) return TEACHING_TRADITIONS.length;
  if (!preferences) return available.length;
  const n = available.filter((t) => (preferences[t] ?? 80) > 0).length;
  return n === 0 ? available.length : n;
}

/** Safe cycling index over `length` items for a 1-based day number. */
function roundRobinIndex(dayOfYear: number, length: number): number {
  return (((dayOfYear - 1) % length) + length) % length;
}

/**
 * Pick a tradition for a given day. Only traditions with a non-empty teaching
 * pool are considered (a weight-N tradition with zero teachings must not win
 * the roll and blank the whole day).
 *
 * - No preferences, OR all eligible (weight > 0) weights EQUAL (the persisted
 *   all-80s default included): round-robin over the eligible traditions, so
 *   the tradition genuinely changes every day.
 * - Otherwise: weighted random seeded by dayOfYear — stable for the whole day,
 *   varies day-to-day. Weight-0 traditions are excluded.
 * - All weights 0: round-robin over every non-empty tradition so something
 *   still shows.
 *
 * Returns null only when no tradition has any teachings.
 */
function pickTradition(seed: number, preferences?: TeachingPreferences): TeachingTradition | null {
  const available = TEACHING_TRADITIONS.filter(
    (t) => getTeachingsByTradition(t).length > 0
  );
  if (available.length === 0) return null;

  const entries = available
    .map((t) => ({ tradition: t, weight: preferences?.[t] ?? 80 }))
    .filter((e) => e.weight > 0);

  const allEqual = entries.length > 0 && entries.every((e) => e.weight === entries[0].weight);

  if (!preferences || entries.length === 0 || allEqual) {
    const pool = entries.length > 0 ? entries.map((e) => e.tradition) : available;
    return pool[roundRobinIndex(seed, pool.length)];
  }

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  const rand = mulberry32(seed);
  const roll = rand() * totalWeight;

  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.tradition;
  }
  return entries[entries.length - 1].tradition;
}

/**
 * Get the teaching for "tomorrow" (next day of year, wrapping at year boundary).
 * Used for "New teaching tomorrow" indicator.
 */
export function getNextTeachingForDay(dayOfYear: number, year: number, preferences?: TeachingPreferences): Teaching | null {
  const totalDays = getTotalDaysInYear(year);
  const nextDay = dayOfYear + 1 > totalDays ? 1 : dayOfYear + 1;
  return getTeachingForDay(nextDay, preferences, 0, year);
}

/**
 * Format a teaching as plain text suitable for a Nostr kind-1 note.
 */
export function formatTeachingNote(teaching: Teaching): string {
  const lines: string[] = [];

  lines.push(`${teaching.title} (${teaching.tradition})`);
  lines.push('');
  lines.push(teaching.body);

  if (teaching.scriptureQuote) {
    lines.push('');
    lines.push(`"${teaching.scriptureQuote}"`);
  }

  lines.push(`— ${teaching.scripture}`);
  lines.push('');
  lines.push('https://gratefulday.space');

  return lines.join('\n');
}
