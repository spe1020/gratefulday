import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasMilestoneBeenCelebrated,
  markMilestonesCelebratedUpTo,
} from './milestoneStore';
import { getReachedMilestones } from './streakUtils';

const PK = 'pk-test';

/**
 * Mirror of MilestoneCelebrationDialog's decision: the highest reached
 * milestone not yet celebrated, or null if there's nothing new to fire.
 */
function nextCelebration(pubkey: string, current: number): number | null {
  const pending = getReachedMilestones(current).filter(
    (m) => !hasMilestoneBeenCelebrated(pubkey, m)
  );
  return pending.length > 0 ? pending[pending.length - 1] : null;
}

// The single namespaced key milestoneStore writes under — clear only this one
// so the test stays isolated without disturbing unrelated localStorage state.
const MILESTONE_STORAGE_KEY = 'gratefulday:milestones:v1';

describe('day-1 foundation milestone firing', () => {
  beforeEach(() => {
    localStorage.removeItem(MILESTONE_STORAGE_KEY);
  });

  it('fires the foundation (1) on a fresh account’s first entry', () => {
    expect(nextCelebration(PK, 1)).toBe(1);
  });

  it('does not re-fire on the second day once celebrated', () => {
    const first = nextCelebration(PK, 1);
    expect(first).toBe(1);
    markMilestonesCelebratedUpTo(PK, first!);

    // Day 2: still only the (already-celebrated) day-1 tier is reached.
    expect(nextCelebration(PK, 2)).toBeNull();
    // Day 7: the week tier is new and fires; day-1 stays silent.
    expect(nextCelebration(PK, 7)).toBe(7);
  });

  it('never fires a spurious day-1 popup for an existing user with history', () => {
    // First detection arrives already at a 30-day streak (e.g. new device).
    const highest = nextCelebration(PK, 30);
    expect(highest).toBe(30); // the dialog shows the highest, not day 1
    markMilestonesCelebratedUpTo(PK, highest!);

    // The foundation tier was marked in the same write — it can never surface.
    expect(hasMilestoneBeenCelebrated(PK, 1)).toBe(true);
    expect(nextCelebration(PK, 30)).toBeNull();
  });
});
