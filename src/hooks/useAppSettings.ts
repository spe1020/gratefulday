import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNip44Support, cacheNip44Support } from '@/hooks/useNip44Support';
import { useToast } from '@/hooks/useToast';
import { Nip44UnsupportedError } from '@/lib/privacyUtils';
import { queryForDisplay, queryForWrite, readRelayUrls } from '@/lib/relayQuery';
import {
  clearPrivacyUnsyncedNotice,
  enqueueSettingsWrite,
  getLocalSettingsVersion,
  isActiveSettingsAccount,
  notifyLocalSettingsChanged,
  setActiveSettingsAccount,
  shouldNotifyPrivacyUnsynced,
  subscribeLocalSettings,
} from '@/lib/settingsSync';
import {
  SETTINGS_KIND,
  SETTINGS_D_TAG,
  type AppSettings,
  applySettingsPatch,
  buildSettingsEvent,
  clearPendingPrivacy,
  effectivePrivacyDefault,
  emptySettings,
  encryptSettings,
  mergeForWrite,
  needsSeed,
  nextSettingsCreatedAt,
  noteKnownSettingsAt,
  pickLatestEvent,
  readKnownSettingsAt,
  readLocalCache,
  readPendingPrivacy,
  reconcile,
  resolveAgainstKnown,
  resolveRemoteSettings,
  setPendingPrivacy,
  writeLocalCache,
} from '@/lib/appSettings';

export interface UseAppSettingsResult {
  settings: AppSettings;
  /**
   * Merge a change in. `privacyDefault` overwrites; `celebratedMilestones`
   * is unioned with what's already known (celebrations are monotonic).
   * Write-throughs localStorage immediately, then publishes to relays.
   */
  updateSettings: (patch: Partial<AppSettings>) => void;
  isLoading: boolean;
}

// Bunker NIP-44 round-trips over relays and can hang far longer than a load
// should wait; a timeout falls back to localStorage-only rather than blocking.
const ENCRYPT_TIMEOUT_MS = 20_000;
/** Settings reads wait at most this long for a majority of read relays. */
const SETTINGS_READ_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Settings signer timed out')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Durable, synced app settings via NIP-78 (kind 30078, NIP-44 encrypted to
 * self), with localStorage as a fast cache. Hydrates from the cache instantly,
 * reconciles with the relay event (relay latest-wins; see `reconcile`), and
 * fails soft to localStorage-only when the signer can't encrypt or relays are
 * unreachable. On first run it seeds the relay event from existing local values
 * so current users keep their state and don't re-celebrate.
 *
 * Every write is read → merge → write: it re-fetches the remote event first
 * and merges against it. If that read times out (fewer than a majority of read
 * relays answered) or the remote event can't be decrypted, the remote state is
 * unknown and nothing is published; the change stays in the local cache.
 * Writes are queued app-wide per account (see `settingsSync`).
 *
 * Showing settings is deliberately less strict than writing them: the display
 * read uses whatever relays answered, so a poor relay list degrades to "local
 * values plus what we could fetch" instead of hiding synced settings.
 */
export function useAppSettings(): UseAppSettingsResult {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { supported } = useNip44Support();
  // mutateAsync, not mutate: the write queue has to wait for the publish to
  // settle, and per-call mutate callbacks are dropped if the component unmounts.
  const { mutateAsync: publish } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const pubkey = user?.pubkey;

  // The local cache is read straight from localStorage, keyed by the current
  // account, and re-read whenever any hook instance (or another tab) changes
  // it. There is no per-component copy to go stale, and none that could carry
  // one account's values into a render for another.
  const localVersion = useSyncExternalStore(subscribeLocalSettings, getLocalSettingsVersion);
  const localCache = useMemo<AppSettings>(
    () => (pubkey ? readLocalCache(pubkey) : emptySettings()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pubkey, localVersion]
  );

  // The account the app is rendering for right now (see `settingsSync`).
  setActiveSettingsAccount(pubkey);

  const readRelays = useMemo(
    () => readRelayUrls(config.relayMetadata.relays),
    [config.relayMetadata.relays]
  );

  const settingsFilter = useMemo(
    () => (pubkey ? [{ kinds: [SETTINGS_KIND], authors: [pubkey], '#d': [SETTINGS_D_TAG], limit: 20 }] : []),
    [pubkey]
  );

  /**
   * Strict read, used only to protect a write. Resolves `null` only when a
   * majority of read relays answered and none holds an event; throws on a
   * timeout or a decrypt failure so neither can be mistaken for "no settings".
   */
  const fetchRemoteForWrite = useCallback(async (): Promise<AppSettings | null> => {
    if (!pubkey || !user) return null;
    const events = await queryForWrite(nostr, readRelays, settingsFilter, {
      timeoutMs: SETTINGS_READ_TIMEOUT_MS,
    });
    // Bounded like encrypt and sign: a bunker that never answers the decrypt
    // must not hold the write queue (and its cross-tab lock) forever. A
    // timeout is "unknown", so it blocks this write like any failed read.
    const fetched = await withTimeout(
      resolveRemoteSettings(user.signer, pubkey, events),
      ENCRYPT_TIMEOUT_MS
    );
    // A successful decrypt is the definitive bunker capability signal.
    if (fetched && user.method === 'bunker') cacheNip44Support(pubkey, true);
    return resolveAgainstKnown(pubkey, fetched, pickLatestEvent(events)?.created_at);
  }, [nostr, readRelays, settingsFilter, pubkey, user]);

  /**
   * Tolerant read, used only to show settings. It takes whatever the relays
   * sent, with or without a quorum, and an event that can't be decrypted
   * simply shows nothing remote. Its `null` means "nothing seen", so it must
   * never decide a write: every write does its own strict read first.
   */
  const fetchRemoteForDisplay = useCallback(
    async (signal?: AbortSignal): Promise<AppSettings | null> => {
      if (!pubkey || !user) return null;
      const events = await queryForDisplay(nostr, readRelays, settingsFilter, {
        timeoutMs: SETTINGS_READ_TIMEOUT_MS,
        signal,
      });
      let fetched: AppSettings | null = null;
      try {
        fetched = await withTimeout(
          resolveRemoteSettings(user.signer, pubkey, events),
          ENCRYPT_TIMEOUT_MS
        );
      } catch {
        fetched = null;
      }
      if (fetched && user.method === 'bunker') cacheNip44Support(pubkey, true);
      // A copy older than what this device already knows can't override the
      // local privacy default (a single lagging relay is enough to answer a
      // display read); a newer one is applied.
      const resolved = resolveAgainstKnown(pubkey, fetched, pickLatestEvent(events)?.created_at);
      notifyLocalSettingsChanged();
      return resolved;
    },
    [nostr, readRelays, settingsFilter, pubkey, user]
  );

  const remoteQuery = useQuery({
    queryKey: ['app-settings', pubkey],
    // Skip entirely when we know encryption is unavailable — localStorage only.
    enabled: !!pubkey && supported !== false,
    staleTime: 5 * 60 * 1000,
    queryFn: (c) => fetchRemoteForDisplay(c.signal),
  });

  const remote = remoteQuery.data ?? null;
  // Monotonic fields merge local with whatever was fetched. The privacy
  // default comes from the local cache (see `effectivePrivacyDefault`), so a
  // change made in another tab shows here at once and cached query data from
  // before it can't bring the old value back.
  const settings = useMemo(() => {
    const merged = reconcile(localCache, remote);
    const pending = pubkey ? readPendingPrivacy(pubkey) : undefined;
    return { ...merged, privacyDefault: effectivePrivacyDefault(localCache, remote, pending) };
    // `localCache` changes identity whenever local storage (pending marker
    // included) changes, in this tab or another.
  }, [localCache, remote, pubkey]);

  // A blocked write that carried an unsynced privacy choice is made visible
  // once per choice (not on every later blocked retry, and not once per
  // component). Never shown after the user switched to another account.
  const notifyPrivacyUnsynced = useCallback(
    (forPubkey: string) => {
      if (!isActiveSettingsAccount(forPubkey)) return;
      const value = readPendingPrivacy(forPubkey);
      if (value === undefined || !shouldNotifyPrivacyUnsynced(forPubkey, value)) return;
      toast({
        title: 'Privacy default saved on this device',
        description:
          'This entry keeps the setting you chose. Your other devices will get the new default after your next save goes through.',
      });
    },
    [toast]
  );

  /**
   * One read → merge → write. `pubkey`, `user` and its signer are the ones
   * this write was started under; everything it stores is keyed by that
   * pubkey (localStorage maps and the query key), so finishing after an
   * account switch still only touches its own account.
   */
  const writeSettings = useCallback(
    async (patch: Partial<AppSettings>, seedOnly: boolean) => {
      if (!user || !pubkey || supported === false) return; // localStorage-only
      const sameAccount = () => isActiveSettingsAccount(pubkey);
      try {
        // Read: never write against a remote we couldn't read. A timeout or a
        // decrypt failure throws here and skips the publish entirely.
        const remote = await fetchRemoteForWrite();
        notifyLocalSettingsChanged(); // the read may have applied a newer event
        // The seed exists only to create a missing event; if one exists now,
        // let the query pick it up instead.
        if (seedOnly && remote) {
          queryClient.setQueryData(['app-settings', pubkey], remote);
          return;
        }
        // Merge against the local state as it is NOW, not as it was when this
        // write was queued: another component may have changed it since. The
        // user's latest unsynced privacy choice outranks both the remote value
        // and an older queued patch.
        const next = mergeForWrite(readLocalCache(pubkey), remote, {
          ...patch,
          privacyDefault: readPendingPrivacy(pubkey) ?? patch.privacyDefault,
        });
        writeLocalCache(pubkey, next);
        notifyLocalSettingsChanged();
        queryClient.setQueryData(['app-settings', pubkey], next);
        // The publish hook signs as whoever is logged in when it runs. After
        // an account switch that is someone else: stop here. The change is
        // safe in this account's cache and goes out with its next write.
        if (!sameAccount()) return;
        // Write.
        const ciphertext = await withTimeout(
          encryptSettings(user.signer, pubkey, next),
          ENCRYPT_TIMEOUT_MS
        );
        if (user.method === 'bunker') cacheNip44Support(pubkey, true);
        if (!sameAccount()) return;
        const event = await publish({
          ...buildSettingsEvent(ciphertext),
          // Always after the newest settings event this device knows of, so
          // two writes in one second can't tie on relays.
          created_at: nextSettingsCreatedAt(pubkey),
        });
        if (event.pubkey !== pubkey) return;
        // From here on, an older copy from a lagging relay can't override
        // what was just published (see `resolveAgainstKnown`).
        noteKnownSettingsAt(pubkey, event.created_at);
        clearPendingPrivacy(pubkey, next.privacyDefault);
        clearPrivacyUnsyncedNotice(pubkey);
        notifyLocalSettingsChanged();
        queryClient.invalidateQueries({ queryKey: ['app-settings', pubkey] });
      } catch (error) {
        notifyPrivacyUnsynced(pubkey);
        // Fail-soft: the cache already holds the change, so nothing is lost
        // and nothing scary is surfaced; the next successful write carries it.
        // A privacyDefault change also stays marked pending, so it keeps
        // winning over remote here until then.
        // A bunker that definitively can't encrypt is cached so we stop trying.
        if (user.method === 'bunker' && error instanceof Nip44UnsupportedError) {
          cacheNip44Support(pubkey, false);
        }
      }
    },
    [user, pubkey, supported, publish, queryClient, fetchRemoteForWrite, notifyPrivacyUnsynced]
  );

  // Writes for one account run one at a time across the whole app (every
  // component using this hook shares the queue), and each waits for the one
  // before it to finish publishing. So a write always reads what the previous
  // one wrote, and an earlier change can't publish after a later one.
  const publishSettings = useCallback(
    (patch: Partial<AppSettings>, seedOnly = false) => {
      if (!pubkey) return Promise.resolve();
      return enqueueSettingsWrite(pubkey, () => writeSettings(patch, seedOnly));
    },
    [pubkey, writeSettings]
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      if (!pubkey) return;
      // privacyDefault overwrites; celebratedMilestones unions (monotonic);
      // lastSeenNotifications takes the max (read-state never regresses).
      const next = applySettingsPatch(settings, patch);
      // A changed privacy choice outranks remote until a write carrying it
      // succeeds. Re-sending the current value (every entry save does) isn't
      // a change and doesn't mark anything pending.
      if (patch.privacyDefault !== undefined && patch.privacyDefault !== settings.privacyDefault) {
        setPendingPrivacy(pubkey, patch.privacyDefault);
      }
      writeLocalCache(pubkey, next);
      notifyLocalSettingsChanged();
      // Optimistically advance the query cache so the local write takes effect
      // immediately. Otherwise `reconcile` would keep preferring the stale
      // remote event's privacyDefault until publish + refetch — and if
      // publishing fails or we're offline, the UI would never reflect the
      // write even though it's safely cached. This keeps the hook fail-soft.
      queryClient.setQueryData(['app-settings', pubkey], next);
      void publishSettings(patch);
    },
    [pubkey, settings, publishSettings, queryClient]
  );

  // Migration: seed the relay event once from existing local values when no
  // remote event exists yet (and encryption is available). The display read
  // finding nothing only *suggests* that; the seed write does its own strict
  // read and publishes only if a majority of relays confirm there is no event
  // (a timed-out or undecryptable read never seeds).
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pubkey || supported === false) return;
    if (!remoteQuery.isSuccess || remoteQuery.isFetching) return;
    if (remote) return; // already have a remote event
    if (seededFor.current === pubkey) return;
    // This device already published or applied a settings event: one exists
    // (or did), so a read that shows none is relay lag, not a first run.
    if (readKnownSettingsAt(pubkey) > 0) return;
    if (!needsSeed(false, localCache)) return;
    seededFor.current = pubkey;
    void publishSettings({}, true);
  }, [
    pubkey,
    supported,
    remote,
    remoteQuery.isSuccess,
    remoteQuery.isFetching,
    localCache,
    publishSettings,
  ]);

  return {
    settings,
    updateSettings,
    isLoading: remoteQuery.isPending && remoteQuery.fetchStatus !== 'idle',
  };
}
