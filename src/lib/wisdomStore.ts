import { z } from 'zod';
import { isValidDateString } from './gratitudeUtils';
import { wisdomItemSchema, type WisdomItem } from './wisdom';
import { entryAddress } from './entryTombstones';

const timestamp = z.number().finite().nonnegative();
const interactionSchema = z.object({
  wisdom: wisdomItemSchema,
  date: z.string().refine(isValidDateString),
  openedAt: timestamp,
  addedAt: timestamp.optional(),
  active: z.boolean().default(false),
  reflection: z.object({
    address: z.string(),
    eventId: z.string().min(1),
    linkedAt: timestamp,
  }).optional(),
});

/** Public wisdom snapshot + references only. Never persist the user's writing.
 * Date/address/theme links are the foundation for later, opt-in reflection
 * analysis; neither opening nor adding is evidence of a personal principle.
 */
export type WisdomInteraction = z.infer<typeof interactionSchema>;
const CHANGE_EVENT = 'gratefulday:wisdom-change';
const memory = new Map<string, string>();
const failedWrites = new Set<string>();
const EMPTY = '{"version":1,"interactions":[]}';

export function wisdomStorageKey(pubkey?: string): string {
  return `gratefulday:wisdom:v1:${pubkey ?? 'guest'}`;
}

export function wisdomSnapshot(pubkey?: string): string {
  const key = wisdomStorageKey(pubkey);
  if (!pubkey || failedWrites.has(key)) return memory.get(key) ?? EMPTY;
  try {
    return localStorage.getItem(key) ?? EMPTY;
  } catch {
    return memory.get(key) ?? EMPTY;
  }
}

export function parseWisdomHistory(raw: string): WisdomInteraction[] {
  try {
    const parsed = z.object({ version: z.literal(1), interactions: z.array(z.unknown()) }).parse(JSON.parse(raw));
    return parsed.interactions.flatMap((item) => {
      const result = interactionSchema.safeParse(item);
      return result.success ? [result.data] : [];
    }).sort((a, b) => b.date.localeCompare(a.date) || b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

export function getWisdomHistory(pubkey?: string): WisdomInteraction[] {
  return parseWisdomHistory(wisdomSnapshot(pubkey));
}

function updateHistory(pubkey: string | undefined, update: (history: WisdomInteraction[]) => WisdomInteraction[]): void {
  const key = wisdomStorageKey(pubkey);
  const raw = JSON.stringify({ version: 1, interactions: update(getWisdomHistory(pubkey)) });
  memory.set(key, raw);
  if (pubkey) {
    try {
      localStorage.setItem(key, raw);
      failedWrites.delete(key);
    } catch {
      failedWrites.add(key);
    }
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function wisdomStorageUnavailable(pubkey?: string): boolean {
  return !!pubkey && failedWrites.has(wisdomStorageKey(pubkey));
}

export function subscribeWisdom(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

/** Called only by a deliberate action, never by rendering or an impression. */
export function recordWisdomInteraction(pubkey: string | undefined, wisdom: WisdomItem, date: string, action: 'opened' | 'added'): void {
  if (!isValidDateString(date)) return;
  updateHistory(pubkey, (history) => {
    const existing = history.find((item) => item.date === date && item.wisdom.id === wisdom.id);
    const now = Date.now();
    const item: WisdomInteraction = existing ?? { wisdom, date, openedAt: now, active: false };
    const updated = action === 'added' ? { ...item, addedAt: item.addedAt ?? now, active: true } : item;
    return [...history.filter((entry) => entry !== existing), updated];
  });
}

export function removeWisdomContext(pubkey: string | undefined, date: string, wisdomId: string): void {
  updateHistory(pubkey, (history) => history.map((item) => item.date === date && item.wisdom.id === wisdomId
    ? { ...item, active: false, reflection: undefined } : item));
}

/** Only a successful entry publish with actual writing establishes a link.
 * Capture ids and hasNewWriting at save time, before async signing/publishing.
 */
export function linkWisdomReflection(pubkey: string, date: string, eventId: string, wisdomIds: string[], hasNewWriting: boolean): void {
  if (wisdomIds.length === 0) return;
  updateHistory(pubkey, (history) => history.map((item) => {
    if (item.date !== date || !item.active || item.addedAt === undefined || !wisdomIds.includes(item.wisdom.id)) return item;
    if (!hasNewWriting && !item.reflection) return item;
    return { ...item, reflection: { address: entryAddress(pubkey, date), eventId, linkedAt: item.reflection?.linkedAt ?? Date.now() } };
  }));
}

export function unlinkWisdomReflections(pubkey: string, date: string): void {
  updateHistory(pubkey, (history) => history.map((item) => item.date === date
    ? { ...item, reflection: undefined, active: false } : item));
}
