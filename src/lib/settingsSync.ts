/**
 * App-wide coordination for settings writes (kind 30078).
 *
 * `useAppSettings` is mounted by several components at once (the day editor,
 * the milestone dialog, notifications). Each write is read → merge → write,
 * which takes a second or more, so two components writing close together
 * would both read the same remote copy and the later publish would drop the
 * earlier one's change. This module holds what those hook instances must
 * share. Everything is keyed by pubkey, so one account's writes never wait
 * on, or mix with, another's.
 */

const writeChains = new Map<string, Promise<void>>();

/** Hold a cross-tab lock while `task` runs, where the browser supports it. */
function withTabLock(pubkey: string, task: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return task();
  return locks.request(`gratefulday:settings-write:${pubkey}`, task);
}

/**
 * Run `task` after every earlier settings write for this pubkey has fully
 * finished (publish included), in this tab and in other tabs of the same
 * browser. A failing task never blocks the ones after it.
 */
export function enqueueSettingsWrite(pubkey: string, task: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(pubkey) ?? Promise.resolve();
  const run = previous.then(() => withTabLock(pubkey, task)).catch(() => {});
  writeChains.set(pubkey, run);
  return run;
}

// --- Active account ---------------------------------------------------------
// The account the app is rendering for right now. An async write started
// under one account checks it before signing or notifying, so it can never
// act as (or speak to) an account the user switched to, even if the component
// that started the write has unmounted.

let activePubkey: string | undefined;

export function setActiveSettingsAccount(pubkey: string | undefined): void {
  activePubkey = pubkey;
}

export function isActiveSettingsAccount(pubkey: string): boolean {
  return activePubkey === pubkey;
}

// --- Local cache changes ----------------------------------------------------
// The local cache lives in localStorage, shared by every hook instance (and
// tab). Instances re-read it whenever any of them, or another tab, changes it,
// so no component keeps computing from its own stale copy.

const listeners = new Set<() => void>();
let localVersion = 0;

export function notifyLocalSettingsChanged(): void {
  localVersion++;
  for (const listener of listeners) listener();
}

export function subscribeLocalSettings(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith('gratefulday:')) {
      localVersion++;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getLocalSettingsVersion(): number {
  return localVersion;
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
  notifiedPending.clear();
  activePubkey = undefined;
}
