import { z } from 'zod';
import { DAILY_WISDOM } from './data/dailyWisdom';
import { DAILY_WISDOM_EXPANDED } from './data/dailyWisdomExpanded';
import { DAILY_WISDOM_STATESMEN } from './data/dailyWisdomStatesmen';
import { formatDateString, getDayOfYear, getQuoteForDay } from './gratitudeUtils';

export const wisdomItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  author: z.string().min(1),
  source: z.string().optional(),
  era: z.string().optional(),
  interpretation: z.string().optional(),
  prompt: z.string().optional(),
  themes: z.array(z.string()).optional(),
  provenance: z.object({
    wording: z.enum(['original', 'translation', 'adaptation']),
    url: z.string().url().refine((url) => url.startsWith('https://')),
    location: z.string(),
    credit: z.string().optional(),
  }).optional(),
});

export type WisdomItem = z.infer<typeof wisdomItemSchema>;

// Keep the old calendar intact. Future collections should add a dated schedule
// version rather than changing the length/order of this first rotation.
export const WISDOM_START_DATE = '2026-09-12';
export const WISDOM_EXPANDED_START_DATE = '2026-09-22';

function weaveWisdom(base: readonly WisdomItem[], extra: readonly WisdomItem[], interval: number): WisdomItem[] {
  const rotation: WisdomItem[] = [];
  let extraIndex = 0;
  base.forEach((item, index) => {
    rotation.push(item);
    if ((index + 1) % interval === 0 && extraIndex < extra.length) {
      rotation.push(extra[extraIndex]);
      extraIndex += 1;
    }
  });
  while (extraIndex < extra.length) {
    rotation.push(extra[extraIndex]);
    extraIndex += 1;
  }
  return rotation;
}

// Civic passages are woven through the longer rotation. September 22 still
// opens on the first expanded item; a statesman follows every third of those.
export const WISDOM_ROTATION = weaveWisdom(DAILY_WISDOM_EXPANDED, DAILY_WISDOM_STATESMEN, 3);
const schedules = [
  { from: WISDOM_START_DATE, items: DAILY_WISDOM },
  { from: WISDOM_EXPANDED_START_DATE, items: WISDOM_ROTATION },
] as const;

export function getWisdomForDate(date: Date): WisdomItem | undefined {
  const dateString = formatDateString(date);
  const schedule = [...schedules].reverse().find((item) => item.from <= dateString);
  if (!schedule) return undefined;
  const [year, month, day] = schedule.from.split('-').map(Number);
  const elapsedDays = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(year, month - 1, day)) / 86_400_000);
  return schedule.items[elapsedDays % schedule.items.length];
}

export function getDailyWisdom(date: Date): WisdomItem | { text: string; author: string } {
  return getWisdomForDate(date) ?? getQuoteForDay(getDayOfYear(date), date.getFullYear());
}

export function getWisdomPrompt(wisdom: WisdomItem): string {
  return wisdom.prompt || 'Where might this idea meet your life today?';
}

export function wisdomWording(wisdom: WisdomItem): string {
  const provenance = wisdom.provenance;
  if (!provenance) return 'Source wording not yet verified';
  const label = { original: 'Original wording', translation: 'Translation', adaptation: 'Adapted by Grateful Day' }[provenance.wording];
  return [label, provenance.credit].filter(Boolean).join(' · ');
}
