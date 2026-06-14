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
    return parsed && typeof parsed === 'object' ? parsed : {};
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

/** Celebrated milestones for a pubkey, ascending. */
export function getCelebratedMilestones(pubkey: string): number[] {
  return readStore()[pubkey] ?? [];
}

/** Replace the celebrated set for a pubkey, preserving other pubkeys. */
export function setCelebratedMilestones(pubkey: string, milestones: number[]): void {
  const store = readStore();
  store[pubkey] = [...new Set(milestones)].sort((a, b) => a - b);
  writeStore(store);
}
