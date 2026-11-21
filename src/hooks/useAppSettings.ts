import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNip44Support, cacheNip44Support } from '@/hooks/useNip44Support';
import { useToast } from '@/hooks/useToast';
import { Nip44UnsupportedError } from '@/lib/privacyUtils';
import { queryForWrite, readRelayUrls } from '@/lib/relayQuery';
import {
  SETTINGS_KIND,
  SETTINGS_D_TAG,
  type AppSettings,
  applySettingsPatch,
  buildSettingsEvent,
  clearPendingPrivacy,
  emptySettings,
  encryptSettings,
  mergeForWrite,
  needsSeed,
  readLocalCache,
  readPendingPrivacy,
  reconcile,
  resolveRemoteSettings,
  setPendingPrivacy,
  withPendingPrivacy,
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
    const timer = setTimeout(() => reject(new Error('Settings encryption timed out')), ms);
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
 */
export function useAppSettings(): UseAppSettingsResult {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { config } = useAppContext();
  const { supported } = useNip44Support();
  const { mutate: publish } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const pubkey = user?.pubkey;

  // Instant hydrate from cache; re-read when the account changes.
  const [localCache, setLocalCache] = useState<AppSettings>(() =>
    pubkey ? readLocalCache(pubkey) : emptySettings()
  );
  useEffect(() => {
    setLocalCache(pubkey ? readLocalCache(pubkey) : emptySettings());
  }, [pubkey]);

  const readRelays = useMemo(
    () => readRelayUrls(config.relayMetadata.relays),
    [config.relayMetadata.relays]
  );

  /**
   * Fetch the remote settings. Resolves `null` only when a majority of read
   * relays answered and none holds an event; throws on a timeout or a
   * decrypt failure so neither can be mistaken for "no settings".
   */
  const fetchRemoteSettings = useCallback(
    async (signal?: AbortSignal): Promise<AppSettings | null> => {
      if (!pubkey || !user) return null;
      const events = await queryForWrite(
        nostr,
        readRelays,
        [{ kinds: [SETTINGS_KIND], authors: [pubkey], '#d': [SETTINGS_D_TAG], limit: 20 }],
        { timeoutMs: SETTINGS_READ_TIMEOUT_MS, signal }
      );
      const settings = await resolveRemoteSettings(user.signer, pubkey, events);
      // A successful decrypt is the definitive bunker capability signal.
      if (settings && user.method === 'bunker') cacheNip44Support(pubkey, true);
      return settings;
    },
    [nostr, readRelays, pubkey, user]
  );

  const remoteQuery = useQuery({
    queryKey: ['app-settings', pubkey],
    // Skip entirely when we know encryption is unavailable — localStorage only.
    enabled: !!pubkey && supported !== false,
    staleTime: 5 * 60 * 1000,
    queryFn: (c) => fetchRemoteSettings(c.signal),
  });

  const remote = remoteQuery.data ?? null;
  // An unsynced local privacy choice wins over the (older) remote value until
  // it has been published; see `setPendingPrivacy`.
  const settings = useMemo(
    () => withPendingPrivacy(reconcile(localCache, remote), pubkey ? readPendingPrivacy(pubkey) : undefined),
    [localCache, remote, pubkey]
  );

  // Writes run one at a time, so a slower read for an earlier change can't
  // publish after (and so replace) a later one.
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());

  // A blocked write that carried an unsynced privacy choice is made visible
  // once per choice (not on every later blocked retry).
  const notifiedPendingRef = useRef<boolean | undefined>(undefined);
  const notifyPrivacyUnsynced = useCallback(
    (value: boolean | undefined) => {
      if (value === undefined || notifiedPendingRef.current === value) return;
      notifiedPendingRef.current = value;
      toast({
        title: 'Privacy choice saved on this device',
        description:
          "It hasn't synced to your other devices yet. It will sync the next time you save an entry.",
      });
    },
    [toast]
  );

  const writeSettings = useCallback(
    async (local: AppSettings, patch: Partial<AppSettings>, seedOnly: boolean) => {
      if (!user || !pubkey || supported === false) return; // localStorage-only
      try {
        // Read: never write against a remote we couldn't read. A timeout or a
        // decrypt failure throws here and skips the publish entirely.
        const remote = await fetchRemoteSettings();
        // The seed exists only to create a missing event; if one exists now,
        // let the query pick it up instead.
        if (seedOnly && remote) {
          queryClient.setQueryData(['app-settings', pubkey], remote);
          return;
        }
        // Merge. An unsynced privacy choice from an earlier blocked write rides
        // along as part of the patch, so it beats the remote value.
        const pendingPrivacy = readPendingPrivacy(pubkey);
        const next = mergeForWrite(local, remote, {
          ...patch,
          privacyDefault: patch.privacyDefault ?? pendingPrivacy,
        });
        writeLocalCache(pubkey, next);
        setLocalCache(next);
        // Write.
        const ciphertext = await withTimeout(
          encryptSettings(user.signer, pubkey, next),
          ENCRYPT_TIMEOUT_MS
        );
        if (user.method === 'bunker') cacheNip44Support(pubkey, true);
        publish(buildSettingsEvent(ciphertext), {
          onSuccess: () => {
            clearPendingPrivacy(pubkey, next.privacyDefault);
            notifiedPendingRef.current = undefined;
            queryClient.invalidateQueries({ queryKey: ['app-settings', pubkey] });
          },
          onError: () => notifyPrivacyUnsynced(readPendingPrivacy(pubkey)),
        });
      } catch (error) {
        notifyPrivacyUnsynced(readPendingPrivacy(pubkey));
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
    [user, pubkey, supported, publish, queryClient, fetchRemoteSettings, notifyPrivacyUnsynced]
  );

  const publishSettings = useCallback(
    (local: AppSettings, patch: Partial<AppSettings>, seedOnly = false) => {
      writeChainRef.current = writeChainRef.current.then(() =>
        writeSettings(local, patch, seedOnly)
      );
      return writeChainRef.current;
    },
    [writeSettings]
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
      setLocalCache(next);
      // Optimistically advance the query cache so the local write takes effect
      // immediately. Otherwise `reconcile` would keep preferring the stale
      // remote event's privacyDefault until publish + refetch — and if
      // publishing fails or we're offline, the UI would never reflect the
      // write even though it's safely cached. This keeps the hook fail-soft.
      queryClient.setQueryData(['app-settings', pubkey], next);
      void publishSettings(next, patch);
    },
    [pubkey, settings, publishSettings, queryClient]
  );

  // Migration: seed the relay event once from existing local values when no
  // remote event exists yet (and encryption is available). Only a successful
  // read that found nothing counts as "no remote event" — a timed-out or
  // undecryptable read is an error, and never seeds.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pubkey || supported === false) return;
    if (!remoteQuery.isSuccess || remoteQuery.isFetching) return;
    if (remote) return; // already have a remote event
    if (seededFor.current === pubkey) return;
    if (!needsSeed(false, localCache)) return;
    seededFor.current = pubkey;
    void publishSettings(localCache, {}, true);
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
