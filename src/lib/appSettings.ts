/**
 * NIP-78 (kind 30078) application settings for gratefulday — relay-stored,
 * user-scoped, synced across the user's installs. The relay event is the
 * source of truth; localStorage is a fast cache for instant reads and offline.
 *
 * The settings payload is NIP-44 encrypted to the user's OWN pubkey (reusing
 * the same self-encryption seam as private journal entries in `privacyUtils`).
 * Nothing sensitive ever lands in tags — only a generic `d`/`alt`.
 */

import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import {
  ENCRYPTED_TAG,
  decryptEntryContent,
  encryptEntryContent,
} from '@/lib/privacyUtils';
import {
  getCelebratedMilestones,
  setCelebratedMilestones,
} from '@/lib/milestoneStore';

/** Standard NIP-78 application-data kind (addressable). */
export const SETTINGS_KIND = 30078;
/** Single settings document per user, namespaced like our localStorage keys. */
export const SETTINGS_D_TAG = 'gratefulday:settings';
/** Generic alt — must not leak anything about the encrypted contents. */
export const SETTINGS_ALT = 'Encrypted gratefulday settings';

const SETTINGS_VERSION = 1;

export interface AppSettings {
  /** Last-used per-entry privacy choice. Undefined until the user picks one. */
  privacyDefault?: boolean;
  /** Streak milestones (7+) already celebrated. Day-1 is never stored here. */
  celebratedMilestones: number[];
  /**
   * Unix seconds of the last time notifications were marked seen. Notifications
   * newer than this are unread. Merged with MAX so read-state never regresses.
   */
  lastSeenNotifications?: number;
}

/** An empty, never-null settings object. */
export function emptySettings(): AppSettings {
  return { celebratedMilestones: [] };
}

function unionSorted(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

/**
 * Reconcile the local cache against the relay event. The asymmetry here is
 * deliberate and is the non-obvious correctness point of the whole feature:
 *
 * - `privacyDefault` is LAST-WRITE-WINS. Every write publishes with
 *   `created_at = now` and the relay keeps the newest event, so when a remote
 *   event exists its value is the latest write across devices and wins;
 *   otherwise the local value is kept.
 * - `celebratedMilestones` is a UNION, never last-write-wins. Celebrations are
 *   monotonic — once celebrated, always celebrated — so a milestone recorded on
 *   one device must NEVER be lost just because another device published a more
 *   recent settings event that happened to omit it. Unioning both sides keeps
 *   every celebration that any device has ever seen.
 */
export function reconcile(local: AppSettings, remote: AppSettings | null): AppSettings {
  // lastSeenNotifications merges with MAX (like celebratedMilestones unions):
  // read-state is monotonic, so a slightly-older-timestamped device sync must
  // never roll it back and re-show already-seen notifications.
  const lastSeen = Math.max(
    local.lastSeenNotifications ?? 0,
    remote?.lastSeenNotifications ?? 0
  );
  return {
    privacyDefault: remote?.privacyDefault ?? local.privacyDefault,
    celebratedMilestones: unionSorted(
      local.celebratedMilestones,
      remote?.celebratedMilestones ?? []
    ),
    lastSeenNotifications: lastSeen || undefined,
  };
}

/**
 * Apply one local change on top of a base. `privacyDefault` overwrites when the
 * patch sets it; `celebratedMilestones` unions (monotonic); and
 * `lastSeenNotifications` takes the max (read-state never regresses).
 */
export function applySettingsPatch(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return {
    privacyDefault: patch.privacyDefault ?? base.privacyDefault,
    celebratedMilestones: unionSorted(base.celebratedMilestones, patch.celebratedMilestones ?? []),
    lastSeenNotifications:
      Math.max(base.lastSeenNotifications ?? 0, patch.lastSeenNotifications ?? 0) || undefined,
  };
}

/**
 * The object to publish: read, merge, then write. Reconcile the local state
 * against the remote copy fetched just before this write, then re-apply the
 * change being made, so neither a field another device changed nor the
 * change itself is lost.
 */
export function mergeForWrite(
  local: AppSettings,
  remote: AppSettings | null,
  patch: Partial<AppSettings>
): AppSettings {
  return applySettingsPatch(reconcile(local, remote), patch);
}

/**
 * Whether to seed a relay event from existing local values: only when no
 * remote event exists yet and the local cache actually holds something worth
 * preserving (a chosen privacy default or a celebrated milestone).
 */
export function needsSeed(remoteExists: boolean, local: AppSettings): boolean {
  if (remoteExists) return false;
  return (
    local.privacyDefault !== undefined ||
    local.celebratedMilestones.length > 0 ||
    local.lastSeenNotifications !== undefined
  );
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify({
    version: SETTINGS_VERSION,
    privacyDefault: settings.privacyDefault,
    celebratedMilestones: unionSorted(settings.celebratedMilestones, []),
    lastSeenNotifications: settings.lastSeenNotifications,
  });
}

/** Tolerant parse — unknown shape degrades to empty rather than throwing. */
export function parseSettings(json: string): AppSettings {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return emptySettings();
    const privacyDefault =
      typeof parsed.privacyDefault === 'boolean' ? parsed.privacyDefault : undefined;
    const celebratedMilestones = Array.isArray(parsed.celebratedMilestones)
      ? parsed.celebratedMilestones.filter((m: unknown): m is number => typeof m === 'number')
      : [];
    const lastSeenNotifications =
      typeof parsed.lastSeenNotifications === 'number' ? parsed.lastSeenNotifications : undefined;
    return {
      privacyDefault,
      celebratedMilestones: unionSorted(celebratedMilestones, []),
      lastSeenNotifications,
    };
  } catch {
    return emptySettings();
  }
}

/** The newest (highest `created_at`) event, or null. */
export function pickLatestEvent(events: NostrEvent[]): NostrEvent | null {
  let latest: NostrEvent | null = null;
  for (const event of events) {
    if (!latest || event.created_at > latest.created_at) latest = event;
  }
  return latest;
}

/** Encrypt settings to self. Throws Nip44UnsupportedError via privacyUtils. */
export function encryptSettings(
  signer: NostrSigner,
  pubkey: string,
  settings: AppSettings
): Promise<string> {
  return encryptEntryContent(signer, pubkey, serializeSettings(settings));
}

/**
 * Decrypt + parse a settings event's content. Returns null on any failure.
 * Callers that are about to write must use `resolveRemoteSettings`, which
 * turns that null into an error instead of "no remote settings".
 */
export async function decryptSettings(
  signer: NostrSigner,
  pubkey: string,
  event: NostrEvent
): Promise<AppSettings | null> {
  try {
    const json = await decryptEntryContent(signer, pubkey, event.content);
    return parseSettings(json);
  } catch {
    return null;
  }
}

/**
 * The remote settings event exists but could not be decrypted or parsed. This
 * is "unknown", never "no settings": writing over it would replace whatever it
 * holds.
 */
export class SettingsUnreadableError extends Error {
  constructor() {
    super('Remote settings could not be decrypted');
    this.name = 'SettingsUnreadableError';
  }
}

/**
 * Resolve fetched settings events to the remote state: `null` only when no
 * event exists. Throws `SettingsUnreadableError` when the newest event can't
 * be decrypted, so callers can't mistake it for an empty remote.
 */
export async function resolveRemoteSettings(
  signer: NostrSigner,
  pubkey: string,
  events: NostrEvent[]
): Promise<AppSettings | null> {
  const latest = pickLatestEvent(events);
  if (!latest) return null;
  const settings = await decryptSettings(signer, pubkey, latest);
  if (!settings) throw new SettingsUnreadableError();
  return settings;
}

/** Publish template for a settings event (everything but signing/created_at). */
export function buildSettingsEvent(ciphertext: string): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: SETTINGS_KIND,
    content: ciphertext,
    tags: [['d', SETTINGS_D_TAG], ENCRYPTED_TAG, ['alt', SETTINGS_ALT]],
  };
}

// --- localStorage cache layer ----------------------------------------------
// The cache reads/writes the SAME keys the app already uses, so the hook and
// the existing consumers never diverge. The milestone cache delegates to
// `milestoneStore` (it owns that key); the privacy default lives under its own
// existing key. Both stay as the cache layer behind `useAppSettings`.

const PRIVACY_DEFAULT_KEY = 'gratefulday:privacy-default:v1';
const LAST_SEEN_KEY = 'gratefulday:last-seen-notifications:v1';

function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Reject non-objects AND arrays: writing `map[pubkey] = ...` onto an array
    // then JSON.stringify-ing it drops the write, so a corrupt `'[]'` would stop
    // the value from ever persisting.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, map: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // localStorage unavailable (private mode, quota) — relay remains the
    // durable store; the cache just won't persist this session.
  }
}

/** Read the local cache for a pubkey. Day-1 (`1`) is filtered out — never stored. */
export function readLocalCache(pubkey: string): AppSettings {
  const privacy = readMap<boolean>(PRIVACY_DEFAULT_KEY)[pubkey];
  const lastSeen = readMap<number>(LAST_SEEN_KEY)[pubkey];
  return {
    privacyDefault: typeof privacy === 'boolean' ? privacy : undefined,
    celebratedMilestones: unionSorted(
      getCelebratedMilestones(pubkey).filter((m) => m > 1),
      []
    ),
    lastSeenNotifications: typeof lastSeen === 'number' ? lastSeen : undefined,
  };
}

/** Write-through the cache for a pubkey, preserving other pubkeys' entries. */
export function writeLocalCache(pubkey: string, settings: AppSettings): void {
  if (settings.privacyDefault !== undefined) {
    const privacyMap = readMap<boolean>(PRIVACY_DEFAULT_KEY);
    privacyMap[pubkey] = settings.privacyDefault;
    writeMap(PRIVACY_DEFAULT_KEY, privacyMap);
  }
  if (settings.lastSeenNotifications !== undefined) {
    const lastSeenMap = readMap<number>(LAST_SEEN_KEY);
    lastSeenMap[pubkey] = settings.lastSeenNotifications;
    writeMap(LAST_SEEN_KEY, lastSeenMap);
  }
  setCelebratedMilestones(pubkey, settings.celebratedMilestones.filter((m) => m > 1));
}

// --- Pending privacy default ------------------------------------------------
// `privacyDefault` is last-write-wins, so a change this device couldn't
// publish (relays didn't answer, decrypt failed, publish rejected) would be
// overruled by the older remote value on the next reconcile, and then written
// back into the cache by the next successful write. A pending marker keeps the
// user's unsynced choice authoritative on this device until a write carrying
// it succeeds. The two monotonic fields don't need this: union/max can't lose
// a local value.

const PENDING_PRIVACY_KEY = 'gratefulday:privacy-default-pending:v1';

/** This device's privacy-default choice that hasn't reached relays yet. */
export function readPendingPrivacy(pubkey: string): boolean | undefined {
  const value = readMap<boolean>(PENDING_PRIVACY_KEY)[pubkey];
  return typeof value === 'boolean' ? value : undefined;
}

export function setPendingPrivacy(pubkey: string, value: boolean): void {
  const map = readMap<boolean>(PENDING_PRIVACY_KEY);
  map[pubkey] = value;
  writeMap(PENDING_PRIVACY_KEY, map);
}

/**
 * Clear the marker once `published` reached relays — but only if it still
 * holds that value, so a newer unsynced choice made meanwhile survives.
 */
export function clearPendingPrivacy(pubkey: string, published: boolean | undefined): void {
  const map = readMap<boolean>(PENDING_PRIVACY_KEY);
  if (map[pubkey] === undefined || map[pubkey] !== published) return;
  delete map[pubkey];
  writeMap(PENDING_PRIVACY_KEY, map);
}

/** Overlay an unsynced privacy choice on reconciled settings. */
export function withPendingPrivacy(settings: AppSettings, pending: boolean | undefined): AppSettings {
  return pending === undefined ? settings : { ...settings, privacyDefault: pending };
}

// --- Newest settings event this device knows of -----------------------------
// Relays don't all hold the same copy: a publish can reach only some of them,
// and a read is answered by whichever relays respond. So a read can return an
// event OLDER than one this device already published or applied. For the two
// monotonic fields that's harmless (union/max). For `privacyDefault` it is
// not: the older value would win the reconcile and the next write would
// publish it, silently reverting the user's choice.
//
// We persist the `created_at` of the newest settings event this device has
// published or applied. The local cache holds `privacyDefault` as of that
// event, so when relays return something older, the local value stands.

const KNOWN_AT_KEY = 'gratefulday:settings-known-at:v1';

/** `created_at` of the newest settings event this device published or applied (0: none). */
export function readKnownSettingsAt(pubkey: string): number {
  const value = readMap<number>(KNOWN_AT_KEY)[pubkey];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Record a settings event this device published or applied. Never moves backwards. */
export function noteKnownSettingsAt(pubkey: string, createdAt: number): void {
  if (!(createdAt > readKnownSettingsAt(pubkey))) return;
  const map = readMap<number>(KNOWN_AT_KEY);
  map[pubkey] = createdAt;
  writeMap(KNOWN_AT_KEY, map);
}

/**
 * Turn what a relay read returned into the remote state to reconcile with.
 *
 * - Not newer than what this device already knows (a stale copy, or the very
 *   event it last published/applied): keep its monotonic fields (they only
 *   ever add), but `privacyDefault` comes from the local cache, which already
 *   reflects that newest event.
 * - Newer: apply it. Remember its timestamp and, unless an unsynced local
 *   choice is pending, store its `privacyDefault` locally so a later stale
 *   read can't undo it.
 */
export function resolveAgainstKnown(
  pubkey: string,
  fetched: AppSettings | null,
  fetchedCreatedAt: number | undefined
): AppSettings | null {
  if (!fetched) return null;
  const at = fetchedCreatedAt ?? 0;
  const known = readKnownSettingsAt(pubkey);
  if (at <= known) {
    const localPrivacy = readLocalCache(pubkey).privacyDefault;
    return { ...fetched, privacyDefault: localPrivacy ?? fetched.privacyDefault };
  }
  if (at > known) {
    noteKnownSettingsAt(pubkey, at);
    if (fetched.privacyDefault !== undefined && readPendingPrivacy(pubkey) === undefined) {
      const privacyMap = readMap<boolean>(PRIVACY_DEFAULT_KEY);
      privacyMap[pubkey] = fetched.privacyDefault;
      writeMap(PRIVACY_DEFAULT_KEY, privacyMap);
    }
  }
  return fetched;
}

/**
 * `created_at` for the next settings event: now, but always after the newest
 * event this device knows of. Two writes in the same second would otherwise
 * tie, and relays keep only one of a tie.
 *
 * Deliberately not capped at "now": if the newest known event is future-dated
 * (another device's clock is wrong), an event stamped "now" would be accepted
 * and then ignored, because relays keep the future-dated one. Stamping just
 * after it is the only way this device's change can take effect.
 */
export function nextSettingsCreatedAt(pubkey: string, nowSeconds = Math.floor(Date.now() / 1000)): number {
  return Math.max(nowSeconds, readKnownSettingsAt(pubkey) + 1);
}

/**
 * The privacy default to show and to build on, in priority order: an unsynced
 * local choice; the local cache (every newer relay event is written into it by
 * `resolveAgainstKnown`, and every tab shares it); and only for a device with
 * nothing stored yet, whatever the fetched copy says. Cached query data never
 * outranks the local cache: it can predate a change made in another tab.
 */
export function effectivePrivacyDefault(
  local: AppSettings,
  remote: AppSettings | null,
  pending: boolean | undefined
): boolean | undefined {
  return pending ?? local.privacyDefault ?? remote?.privacyDefault;
}
