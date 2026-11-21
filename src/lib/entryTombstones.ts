/**
 * Local tombstones for deleted gratitude entries.
 *
 * A NIP-09 deletion request is best-effort: slow relays can keep serving a
 * deleted event for a while, which would resurrect it in the UI on refetch.
 * When the user deletes an entry we record its address coordinate and the
 * deletion timestamp here, and the entry hooks filter fetched events against
 * this set. An entry re-created for the same day later (with a newer
 * created_at than the deletion) is not filtered.
 *
 * The delete flow populates this store. Deletions made on another device or
 * client reach this one as the user's own kind 5 events; `tombstonesFromDeletions`
 * turns those into the same map shape so both sources filter identically.
 */

import type { NostrEvent } from '@nostrify/nostrify';

const STORAGE_KEY = 'gratefulday:deleted-entries:v1';

/** Address coordinate (`36669:<pubkey>:<dateString>`) -> deletion created_at. */
export type TombstoneMap = Record<string, number>;

function readStore(): TombstoneMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: TombstoneMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage unavailable — a slow relay may resurrect the entry until
    // the deletion propagates, which is the pre-tombstone behavior.
  }
}

/** NIP-01 address coordinate for a gratitude entry. */
export function entryAddress(pubkey: string, dateString: string): string {
  return `36669:${pubkey}:${dateString}`;
}

/** Record a deletion so fetched copies of the entry are filtered locally. */
export function addEntryTombstone(pubkey: string, dateString: string, deletedAt: number): void {
  const store = readStore();
  const address = entryAddress(pubkey, dateString);
  store[address] = Math.max(store[address] ?? 0, deletedAt);
  writeStore(store);
}

/**
 * Read the tombstone map once. Pass the result to isEntryTombstoned when
 * filtering a batch so localStorage isn't re-parsed per event.
 */
export function getEntryTombstones(): TombstoneMap {
  return readStore();
}

/**
 * Whether this event is covered by a recorded deletion. Per NIP-09 semantics
 * for addressable events, only versions with created_at at or before the
 * deletion are affected — a newer re-created entry stays visible.
 */
export function isEntryTombstoned(event: NostrEvent, tombstones: TombstoneMap): boolean {
  const dTag = event.tags.find(([name]) => name === 'd')?.[1];
  if (!dTag) return false;

  const deletedAt = tombstones[entryAddress(event.pubkey, dTag)];
  return deletedAt !== undefined && event.created_at <= deletedAt;
}

/**
 * Build a tombstone map from fetched NIP-09 deletion events (kind 5). Only a
 * deletion signed by the entry's own author counts, and only for `a`
 * coordinates of that author's gratitude entries; anything else is ignored.
 * Multiple deletions of one address keep the latest timestamp.
 */
export function tombstonesFromDeletions(events: NostrEvent[], pubkey: string): TombstoneMap {
  const prefix = `36669:${pubkey}:`;
  const map: TombstoneMap = {};
  for (const event of events) {
    if (event.kind !== 5 || event.pubkey !== pubkey) continue;
    for (const [name, value] of event.tags) {
      if (name !== 'a' || typeof value !== 'string' || !value.startsWith(prefix)) continue;
      if (value.length === prefix.length) continue;
      map[value] = Math.max(map[value] ?? 0, event.created_at);
    }
  }
  return map;
}

/** Combine tombstone maps, keeping the latest deletion time per address. */
export function mergeTombstones(...maps: TombstoneMap[]): TombstoneMap {
  const merged: TombstoneMap = {};
  for (const map of maps) {
    for (const [address, deletedAt] of Object.entries(map)) {
      if (typeof deletedAt !== 'number') continue;
      merged[address] = Math.max(merged[address] ?? 0, deletedAt);
    }
  }
  return merged;
}
