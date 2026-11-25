import { useContext, useEffect } from 'react';
import { useNostr } from '@nostrify/react';

import type { RelayMetadata } from '@/contexts/AppContext';
import { RelayListContext } from '@/contexts/RelayListContext';
import { latestRelayList, readAccountRelays, relaysFromNip65 } from '@/lib/accountRelays';
import { queryForWrite, readRelayUrls } from '@/lib/relayQuery';

/** One lookup attempt. */
const LOOKUP_TIMEOUT_MS = 5000;
/** Wait before trying again after too few relays answered. */
const RETRY_DELAY_MS = 5000;

interface NostrSyncProps {
  /** The app's default relays, where NIP-65 lists are looked up. */
  defaultRelays: RelayMetadata;
}

/**
 * Looks up the signed-in account's NIP-65 relay list (kind 10002) once per
 * account per session, and reports the result to `AccountRelayProvider`.
 *
 * "No list" is only concluded when a majority of the relays asked answered
 * (strict read): a timeout is unknown, not empty, so the lookup is retried
 * and writes keep waiting. Relays asked: the app defaults, plus this
 * account's own stored relays.
 */
export function NostrSync({ defaultRelays }: NostrSyncProps) {
  const { nostr } = useNostr();
  const relayList = useContext(RelayListContext);
  const pubkey = relayList?.activePubkey;
  const status = relayList?.status;
  const resolveRelayList = relayList?.resolveRelayList;

  useEffect(() => {
    if (!pubkey || status !== 'unresolved' || !resolveRelayList) return;

    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;

    const lookup = async () => {
      const own = readAccountRelays()[pubkey]?.relays ?? [];
      const relays = [
        ...new Set([...readRelayUrls(defaultRelays.relays), ...readRelayUrls(own)]),
      ];
      try {
        const events = await queryForWrite(
          nostr,
          relays,
          [{ kinds: [10002], authors: [pubkey], limit: 5 }],
          { timeoutMs: LOOKUP_TIMEOUT_MS, signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        const latest = latestRelayList(events, pubkey);
        if (latest) console.log('Syncing relay list from Nostr:', relaysFromNip65(latest));
        resolveRelayList(
          pubkey,
          latest ? { relays: relaysFromNip65(latest), updatedAt: latest.created_at } : null
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('Relay list lookup incomplete, retrying:', error);
        retry = setTimeout(lookup, RETRY_DELAY_MS);
      }
    };

    lookup();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [pubkey, status, resolveRelayList, nostr, defaultRelays]);

  return null;
}
