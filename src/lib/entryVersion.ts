/**
 * Base-version check for saving a day's entry.
 *
 * A save republishes the whole day as a new 36669 with `created_at = now`, and
 * relays keep only the newest event per day. So if another device or browser
 * saved (or deleted) this day after the editor loaded it, saving here would
 * silently replace that work. Before publishing, the editor re-reads the day
 * and compares it with the version it started from (its "base").
 *
 * This narrows the window; it cannot close it. Two saves that both pass the
 * check before either reaches the relays still race, and the newer
 * `created_at` wins. Nostr has no compare-and-swap.
 */

import type { NostrEvent } from '@nostrify/nostrify';

/** The version the editor started from; `null` when the day was empty. */
export interface EntryBase {
  id: string;
  created_at: number;
}

export function toEntryBase(event: NostrEvent | null | undefined): EntryBase | null {
  return event ? { id: event.id, created_at: event.created_at } : null;
}

/**
 * Whether saving over `base` would replace someone else's newer work.
 *
 * @param base     the version the editor started from (null: day was empty)
 * @param latest   newest valid, non-deleted version on relays right now
 * @param deletedAt latest deletion time for this day (remote kind 5 or local
 *                  tombstone), if any
 */
export function hasEntryConflict(
  base: EntryBase | null,
  latest: EntryBase | null,
  deletedAt: number | undefined
): boolean {
  if (!base) {
    // The day was empty when the editor opened; anything there now was
    // written somewhere else in the meantime.
    return latest !== null;
  }

  // The version we started from was deleted (here or elsewhere). Saving would
  // silently undo that delete.
  if (deletedAt !== undefined && deletedAt >= base.created_at) return true;

  if (!latest) {
    // Nothing visible and no deletion covering our base: most likely a relay
    // that hasn't caught up with our own earlier save. Not evidence of a
    // conflicting write.
    return false;
  }

  if (latest.id === base.id) return false;
  // A different version at the same time or later was written elsewhere. An
  // older one is a stale relay copy and doesn't matter.
  return latest.created_at >= base.created_at;
}
