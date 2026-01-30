/**
 * Teaching card types and rotation logic for Brief Teaching Cards feature.
 * Supports multiple traditions: Christian, Jewish, Islamic, Buddhist, Taoist, Stoic.
 */

import teachingsData from './data/teachings.json';

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
 * Get the single teaching to show for today based on day of year.
 * Rotation: cycles by tradition (Christian → Stoic → Buddhist → Taoist → Jewish → Islamic), then within that tradition.
 */
export function getTeachingForDay(dayOfYear: number): Teaching | null {
  const all = getTeachings();
  if (all.length === 0) return null;

  const traditionIndex = (dayOfYear - 1) % TEACHING_TRADITIONS.length;
  const tradition = TEACHING_TRADITIONS[traditionIndex];
  const byTradition = all.filter((t) => t.tradition === tradition);
  if (byTradition.length === 0) return null;

  const withinIndex = Math.floor((dayOfYear - 1) / TEACHING_TRADITIONS.length) % byTradition.length;
  return byTradition[withinIndex] ?? null;
}
