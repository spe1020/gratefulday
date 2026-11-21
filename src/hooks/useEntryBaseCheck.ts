import { useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

import { useAppContext } from '@/hooks/useAppContext';
import { validateGratitudeEntry } from '@/hooks/useGratitudeEntries';
import {
  entryAddress,
  getEntryTombstones,
  mergeTombstones,
  tombstonesFromDeletions,
} from '@/lib/entryTombstones';
import { type EntryBase, hasEntryConflict, toEntryBase } from '@/lib/entryVersion';
import { queryForWrite, readRelayUrls } from '@/lib/relayQuery';

/** Wait at most this long for a majority of read relays before a save. */
const BASE_CHECK_TIMEOUT_MS = 4000;

export type EntryBaseCheckResult = 'ok' | 'conflict';

/**
 * Returns a function that re-reads one day from relays and reports whether
 * saving over `base` would replace a version written elsewhere. It throws
 * `IncompleteRelayReadError` when too few relays answered: the caller must
 * treat that as unknown and not save.
 */
export function useEntryBaseCheck() {
  const { nostr } = useNostr();
  const { config } = useAppContext();

  return useCallback(
    async (pubkey: string, dateString: string, base: EntryBase | null): Promise<EntryBaseCheckResult> => {
      const events = await queryForWrite(
        nostr,
        readRelayUrls(config.relayMetadata.relays),
        [
          { kinds: [36669], authors: [pubkey], '#d': [dateString], limit: 5 },
          { kinds: [5], authors: [pubkey], '#a': [entryAddress(pubkey, dateString)], limit: 20 },
        ],
        { timeoutMs: BASE_CHECK_TIMEOUT_MS }
      );

      const address = entryAddress(pubkey, dateString);
      const deletedAt = mergeTombstones(
        getEntryTombstones(),
        tombstonesFromDeletions(events, pubkey)
      )[address];

      const latest = events
        .filter(
          (e) =>
            e.pubkey === pubkey &&
            validateGratitudeEntry(e) &&
            e.tags.find(([name]) => name === 'd')?.[1] === dateString &&
            (deletedAt === undefined || e.created_at > deletedAt)
        )
        .reduce<NostrEvent | null>(
          (newest, e) => (!newest || e.created_at > newest.created_at ? e : newest),
          null
        );

      return hasEntryConflict(base, toEntryBase(latest), deletedAt) ? 'conflict' : 'ok';
    },
    [nostr, config.relayMetadata.relays]
  );
}
