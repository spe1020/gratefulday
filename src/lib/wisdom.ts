import { z } from 'zod';
import { DAILY_WISDOM } from './data/dailyWisdom';
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
const schedules = [{ from: WISDOM_START_DATE, items: DAILY_WISDOM }] as const;

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
