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
  return {
    privacyDefault: remote?.privacyDefault ?? local.privacyDefault,
    celebratedMilestones: unionSorted(
      local.celebratedMilestones,
      remote?.celebratedMilestones ?? []
    ),
  };
}

/**
 * Whether to seed a relay event from existing local values: only when no
 * remote event exists yet and the local cache actually holds something worth
 * preserving (a chosen privacy default or a celebrated milestone).
 */
export function needsSeed(remoteExists: boolean, local: AppSettings): boolean {
  if (remoteExists) return false;
  return local.privacyDefault !== undefined || local.celebratedMilestones.length > 0;
}

export function serializeSettings(settings: AppSettings): string {
  return JSON.stringify({
    version: SETTINGS_VERSION,
    privacyDefault: settings.privacyDefault,
    celebratedMilestones: unionSorted(settings.celebratedMilestones, []),
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
    return { privacyDefault, celebratedMilestones: unionSorted(celebratedMilestones, []) };
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
 * Decrypt + parse a settings event's content. Returns null on any failure so
 * a corrupt or undecryptable event reads as "no remote settings" (fail-soft).
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
// the existing consumers (DayDetailDialog privacy default, milestoneStore)
// never diverge. Phase 3 routes those consumers through this hook; the keys
// stay as the cache layer behind it.

const PRIVACY_DEFAULT_KEY = 'gratefulday:privacy-default:v1';
const MILESTONES_KEY = 'gratefulday:milestones:v1';

function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
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
  const milestones = readMap<number[]>(MILESTONES_KEY)[pubkey] ?? [];
  return {
    privacyDefault: typeof privacy === 'boolean' ? privacy : undefined,
    celebratedMilestones: unionSorted(
      milestones.filter((m) => m > 1),
      []
    ),
  };
}

/** Write-through the cache for a pubkey, preserving other pubkeys' entries. */
export function writeLocalCache(pubkey: string, settings: AppSettings): void {
  if (settings.privacyDefault !== undefined) {
    const privacyMap = readMap<boolean>(PRIVACY_DEFAULT_KEY);
    privacyMap[pubkey] = settings.privacyDefault;
    writeMap(PRIVACY_DEFAULT_KEY, privacyMap);
  }
  const milestoneMap = readMap<number[]>(MILESTONES_KEY);
  milestoneMap[pubkey] = unionSorted(
    settings.celebratedMilestones.filter((m) => m > 1),
    []
  );
  writeMap(MILESTONES_KEY, milestoneMap);
}
