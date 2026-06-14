/**
 * Local cache for which streak milestones have been celebrated, keyed by
 * pubkey so accounts don't see each other's state. This is the localStorage
 * cache layer behind `useAppSettings` — the NIP-78 settings event is the
 * durable source of truth; these helpers are the fast/offline read-write seam.
 * Day-1 (`1`) is never stored here — it's derived from data (`total === 1`).
 */

const STORAGE_KEY = 'gratefulday:milestones:v1';

type MilestoneStore = Record<string, number[]>;

function readStore(): MilestoneStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Reject non-objects AND arrays: assigning `store[pubkey]` to an array and
    // then JSON.stringify-ing it silently drops the write (named props on an
    // array are ignored), so a corrupt `'[]'` would make writes vanish.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: MilestoneStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage unavailable (private mode, quota) — the relay event remains
    // the durable store; the cache just won't persist this session.
  }
}

/** Celebrated milestones for a pubkey, ascending. Degrades a corrupt/non-array
 *  value (or non-number elements) to an empty set rather than throwing. */
export function getCelebratedMilestones(pubkey: string): number[] {
  const value = readStore()[pubkey];
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is number => typeof m === 'number');
}

/** Replace the celebrated set for a pubkey, preserving other pubkeys. */
export function setCelebratedMilestones(pubkey: string, milestones: number[]): void {
  const store = readStore();
  // Enforce the invariant at the storage boundary: day-1 (`1`) is never cached
  // here — it's derived from data. Dedupe + sort for a stable, comparable set.
  store[pubkey] = [...new Set(milestones.filter((m) => m > 1))].sort((a, b) => a - b);
  writeStore(store);
}
