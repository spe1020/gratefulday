import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useNip44Support, cacheNip44Support } from '@/hooks/useNip44Support';
import { Nip44UnsupportedError } from '@/lib/privacyUtils';
import {
  SETTINGS_KIND,
  SETTINGS_D_TAG,
  type AppSettings,
  buildSettingsEvent,
  decryptSettings,
  emptySettings,
  encryptSettings,
  needsSeed,
  pickLatestEvent,
  readLocalCache,
  reconcile,
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
 */
export function useAppSettings(): UseAppSettingsResult {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { supported } = useNip44Support();
  const { mutate: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  const pubkey = user?.pubkey;

  // Instant hydrate from cache; re-read when the account changes.
  const [localCache, setLocalCache] = useState<AppSettings>(() =>
    pubkey ? readLocalCache(pubkey) : emptySettings()
  );
  useEffect(() => {
    setLocalCache(pubkey ? readLocalCache(pubkey) : emptySettings());
  }, [pubkey]);

  const remoteQuery = useQuery({
    queryKey: ['app-settings', pubkey],
    // Skip entirely when we know encryption is unavailable — localStorage only.
    enabled: !!pubkey && supported !== false,
    staleTime: 5 * 60 * 1000,
    queryFn: async (c) => {
      if (!pubkey || !user) return null;
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      const events = await nostr.query(
        [{ kinds: [SETTINGS_KIND], authors: [pubkey], '#d': [SETTINGS_D_TAG], limit: 20 }],
        { signal }
      );
      const latest = pickLatestEvent(events);
      if (!latest) return null;
      const settings = await decryptSettings(user.signer, pubkey, latest);
      // A successful decrypt is the definitive bunker capability signal.
      if (settings && user.method === 'bunker') cacheNip44Support(pubkey, true);
      return settings;
    },
  });

  const remote = remoteQuery.data ?? null;
  const settings = useMemo(() => reconcile(localCache, remote), [localCache, remote]);

  const publishSettings = useCallback(
    async (next: AppSettings) => {
      if (!user || !pubkey || supported === false) return; // localStorage-only
      try {
        const ciphertext = await withTimeout(
          encryptSettings(user.signer, pubkey, next),
          ENCRYPT_TIMEOUT_MS
        );
        if (user.method === 'bunker') cacheNip44Support(pubkey, true);
        publish(buildSettingsEvent(ciphertext), {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['app-settings', pubkey] });
          },
        });
      } catch (error) {
        // Fail-soft: the cache already holds `next`, so nothing is lost and
        // nothing scary is surfaced. A bunker that definitively can't encrypt
        // is cached so we stop trying.
        if (user.method === 'bunker' && error instanceof Nip44UnsupportedError) {
          cacheNip44Support(pubkey, false);
        }
      }
    },
    [user, pubkey, supported, publish, queryClient]
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      if (!pubkey) return;
      // privacyDefault overwrites; celebratedMilestones unions (monotonic);
      // lastSeenNotifications takes the max (read-state never regresses).
      const next: AppSettings = {
        privacyDefault: patch.privacyDefault ?? settings.privacyDefault,
        celebratedMilestones: [
          ...new Set([...settings.celebratedMilestones, ...(patch.celebratedMilestones ?? [])]),
        ].sort((a, b) => a - b),
        lastSeenNotifications:
          Math.max(
            settings.lastSeenNotifications ?? 0,
            patch.lastSeenNotifications ?? 0
          ) || undefined,
      };
      writeLocalCache(pubkey, next);
      setLocalCache(next);
      // Optimistically advance the query cache so the local write takes effect
      // immediately. Otherwise `reconcile` would keep preferring the stale
      // remote event's privacyDefault until publish + refetch — and if
      // publishing fails or we're offline, the UI would never reflect the
      // write even though it's safely cached. This keeps the hook fail-soft.
      queryClient.setQueryData(['app-settings', pubkey], next);
      void publishSettings(next);
    },
    [pubkey, settings, publishSettings, queryClient]
  );

  // Migration: seed the relay event once from existing local values when no
  // remote event exists yet (and encryption is available).
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!pubkey || supported === false) return;
    if (remoteQuery.isPending || remoteQuery.isFetching) return;
    if (remote) return; // already have a remote event
    if (seededFor.current === pubkey) return;
    if (!needsSeed(false, localCache)) return;
    seededFor.current = pubkey;
    void publishSettings(localCache);
  }, [
    pubkey,
    supported,
    remote,
    remoteQuery.isPending,
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
