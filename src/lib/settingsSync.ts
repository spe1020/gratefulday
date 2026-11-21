/**
 * App-wide coordination for settings writes (kind 30078).
 *
 * `useAppSettings` is mounted by several components at once (the day editor,
 * the milestone dialog, notifications). Each write is read → merge → write,
 * which takes a second or more, so two components writing close together
 * would both read the same remote copy and the later publish would drop the
 * earlier one's change. This module holds the state those hook instances
 * must share. Everything is keyed by pubkey, so one account's writes never
 * wait on, or mix with, another's.
 */

import type { AppSettings } from '@/lib/appSettings';

const writeChains = new Map<string, Promise<void>>();

/**
 * Run `task` after every earlier settings write for this pubkey has fully
 * finished (publish included). A failing task never blocks the ones after it.
 */
export function enqueueSettingsWrite(pubkey: string, task: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(pubkey) ?? Promise.resolve();
  const run = previous.then(task).catch(() => {});
  writeChains.set(pubkey, run);
  return run;
}

// --- Own last publish -------------------------------------------------------
// Relays don't all store a new event at the same instant. A read made right
// after our own publish can reach a majority that still holds the previous
// event; merging against that would bring back the value we just replaced
// (for `privacyDefault`, the user's older choice). We remember what this tab
// last published and prefer it until relays return something at least as new.

interface PublishedSettings {
  settings: AppSettings;
  createdAt: number;
}

const lastPublished = new Map<string, PublishedSettings>();

export function recordPublishedSettings(pubkey: string, settings: AppSettings, createdAt: number): void {
  lastPublished.set(pubkey, { settings, createdAt });
}

/**
 * The newest remote state this tab knows of: what relays returned, unless our
 * own last publish is strictly newer than the newest event they returned.
 */
export function newestKnownRemote(
  pubkey: string,
  fetched: AppSettings | null,
  fetchedCreatedAt: number | undefined
): AppSettings | null {
  const own = lastPublished.get(pubkey);
  if (!own) return fetched;
  if ((fetchedCreatedAt ?? 0) < own.createdAt) return own.settings;
  // Relays caught up (or hold something newer from another device).
  lastPublished.delete(pubkey);
  return fetched;
}

// --- "Privacy default not synced" notice ------------------------------------
// Shown once per unsynced choice per account, whichever component's write
// happened to be blocked.

const notifiedPending = new Map<string, boolean>();

/** True the first time it is asked about this pubkey's pending `value`. */
export function shouldNotifyPrivacyUnsynced(pubkey: string, value: boolean): boolean {
  if (notifiedPending.get(pubkey) === value) return false;
  notifiedPending.set(pubkey, value);
  return true;
}

export function clearPrivacyUnsyncedNotice(pubkey: string): void {
  notifiedPending.delete(pubkey);
}

/** Test helper: forget all in-memory state. */
export function resetSettingsSync(): void {
  writeChains.clear();
  lastPublished.clear();
  notifiedPending.clear();
}
