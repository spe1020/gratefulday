/**
 * Relay lists are kept per account, never per browser.
 *
 * Before this, the app kept one relay list for the whole browser (inside the
 * `nostr:app-config` key). After a switch from account C to account B, B
 * kept reading from and publishing to C's relays, and a relay edit made as B
 * published C's list as B's own. That breaks sync for B, and lets C's relays
 * link the two identities.
 *
 * Rules:
 * - Each account's list is stored under its pubkey. A signed-out visitor has
 *   a separate guest slot.
 * - The effective list for an account is its own stored list, or the app
 *   defaults. It is never another account's list.
 * - Until this session has looked up the account's NIP-65 list (found one,
 *   or confirmed there is none), nothing is published for it. See
 *   `RelayListContext`.
 * - The old browser-wide list can't be attributed to any account, so it is
 *   dropped, not migrated. The next login fetches the account's list again.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import type { RelayMetadata } from '@/contexts/AppContext';

/** localStorage key: `{ [pubkey | GUEST_SLOT]: RelayMetadata }`. */
export const ACCOUNT_RELAYS_KEY = 'gratefulday:relay-lists:v1';

/** Slot for relay edits made while signed out. Never used by an account. */
export const GUEST_SLOT = 'guest';

export type AccountRelayMap = Record<string, RelayMetadata>;

/** No publish happened because the account's relay list isn't known yet. */
export class RelayListUnresolvedError extends Error {
  constructor() {
    super('Your relay list is still loading. Please try again in a moment.');
    this.name = 'RelayListUnresolvedError';
  }
}

/** The account changed while a write was waiting for its relay list. */
export class RelayAccountChangedError extends Error {
  constructor() {
    super('The signed-in account changed before this could be saved.');
    this.name = 'RelayAccountChangedError';
  }
}

function isRelayMetadata(value: unknown): value is RelayMetadata {
  if (!value || typeof value !== 'object') return false;
  const { relays, updatedAt } = value as Partial<RelayMetadata>;
  return (
    typeof updatedAt === 'number' &&
    Array.isArray(relays) &&
    relays.every(
      (r) =>
        !!r &&
        typeof r.url === 'string' &&
        typeof r.read === 'boolean' &&
        typeof r.write === 'boolean'
    )
  );
}

export function readAccountRelays(): AccountRelayMap {
  try {
    const raw = localStorage.getItem(ACCOUNT_RELAYS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: AccountRelayMap = {};
    for (const [slot, value] of Object.entries(parsed)) {
      if (isRelayMetadata(value)) map[slot] = value;
    }
    return map;
  } catch {
    return {};
  }
}

export function writeAccountRelays(map: AccountRelayMap): void {
  try {
    localStorage.setItem(ACCOUNT_RELAYS_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable: the list still applies for this session.
  }
}

/**
 * The relays in a kind 10002 event (NIP-65). An `r` tag with no marker is
 * both read and write.
 */
export function relaysFromNip65(event: NostrEvent): RelayMetadata['relays'] {
  return event.tags
    .filter(([name, url]) => name === 'r' && typeof url === 'string' && url.length > 0)
    .map(([, url, marker]) => ({
      url,
      read: !marker || marker === 'read',
      write: !marker || marker === 'write',
    }));
}

/**
 * Newest valid kind 10002 by `pubkey` among `events`, or null. Events by
 * anyone else are ignored.
 */
export function latestRelayList(events: NostrEvent[], pubkey: string): NostrEvent | null {
  return events
    .filter((e) => e.kind === 10002 && e.pubkey === pubkey && relaysFromNip65(e).length > 0)
    .reduce<NostrEvent | null>(
      (newest, e) => (!newest || e.created_at > newest.created_at ? e : newest),
      null
    );
}
