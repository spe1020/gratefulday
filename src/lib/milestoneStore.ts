/**
 * Local-only persistence for which streak milestones have already been
 * celebrated, keyed by pubkey so accounts don't see each other's state.
 * Stored under a single namespaced localStorage key.
 */

import { MILESTONES } from '@/lib/streakUtils';

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
    // localStorage unavailable (private mode, quota) — celebration may
    // re-fire next load, which is acceptable.
  }
}

export function hasMilestoneBeenCelebrated(pubkey: string, milestone: number): boolean {
  return readStore()[pubkey]?.includes(milestone) ?? false;
}

export function markMilestoneCelebrated(pubkey: string, milestone: number): void {
  const store = readStore();
  const celebrated = new Set(store[pubkey] ?? []);
  celebrated.add(milestone);
  store[pubkey] = [...celebrated].sort((a, b) => a - b);
  writeStore(store);
}

/**
 * Mark the given milestone and every lower milestone celebrated in a single
 * write. Used when a streak arrives already past several milestones (e.g. a
 * new device with an empty store) so only the highest one fires a dialog.
 */
export function markMilestonesCelebratedUpTo(pubkey: string, milestone: number): void {
  const store = readStore();
  const celebrated = new Set(store[pubkey] ?? []);
  for (const m of MILESTONES) {
    if (m <= milestone) celebrated.add(m);
  }
  store[pubkey] = [...celebrated].sort((a, b) => a - b);
  writeStore(store);
}
