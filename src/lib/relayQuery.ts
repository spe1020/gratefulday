/**
 * Reads whose result is about to decide a write.
 *
 * `NPool.query` swallows its abort signal and returns whatever arrived before
 * the timeout ("Skip errors, return partial results"). For display that is the
 * right trade-off, but before a write it is dangerous: a timeout and "nothing
 * exists" both come back as `[]`, and publishing over an address you could not
 * read replaces the newer copy on every relay.
 *
 * `queryForWrite` asks each read relay separately and tracks which ones
 * actually finished (EOSE). The read counts as complete only when a strict
 * majority of the read relays finished before the timeout; otherwise it
 * throws `IncompleteRelayReadError` and the caller must treat the state as
 * unknown — never as empty — and skip the write.
 *
 * Why a majority and not every relay: one dead relay in the user's list would
 * otherwise block every write forever (at the time of writing,
 * `wss://relay.nostr.band` from the default list never answers). A majority
 * still rules out the failure this guards against: a slow network or a stalled
 * read returning an empty, partial result.
 *
 * Availability trade-off (accepted on purpose): a write is refused whenever
 * fewer than a strict majority of the user's read relays answer in time. A
 * relay that is down, too slow, or demands auth counts as unanswered, so a
 * user whose read list is half or more unreliable relays (1 dead of 2, 2 of
 * 4, ...) cannot save entries or sync settings until they fix the list or
 * the relays recover. Nothing is lost when that happens: the editor keeps
 * the writing, settings stay in the local cache, and the user is told. We
 * prefer a blocked save to silently replacing reflections or privacy
 * settings this device could not see.
 *
 * Reads that only decide what to *show* must not be this strict: use
 * `queryForDisplay`, which returns whatever arrived.
 */

import type { NostrEvent, NostrFilter, NostrRelayCLOSED, NostrRelayEOSE, NostrRelayEVENT } from '@nostrify/nostrify';

/** The part of `NPool` this needs (kept narrow so tests can stub it). */
export interface RelayReqClient {
  req(
    filters: NostrFilter[],
    opts?: { signal?: AbortSignal; relays?: string[] }
  ): AsyncIterable<NostrRelayEVENT | NostrRelayEOSE | NostrRelayCLOSED>;
}

export class IncompleteRelayReadError extends Error {
  constructor(
    readonly answered: number,
    readonly total: number
  ) {
    super(`Only ${answered} of ${total} relays answered in time`);
    this.name = 'IncompleteRelayReadError';
  }
}

export interface QueryForWriteOptions {
  /** Hard limit for the whole read. */
  timeoutMs: number;
  /**
   * Once a majority has answered, how long to keep waiting for the rest
   * before returning. Keeps one dead relay from adding the full timeout to
   * every save, while still giving slower healthy relays a moment.
   */
  graceMs?: number;
  signal?: AbortSignal;
}

/** True when `answered` is a strict majority of `total` relays. */
export function hasReadQuorum(answered: number, total: number): boolean {
  return total > 0 && answered * 2 > total;
}

interface RelayReadResult {
  events: NostrEvent[];
  /** Relays that sent EOSE before the read ended. */
  answered: number;
  /** Configured, de-duplicated relays asked. */
  total: number;
  /** The caller's signal aborted the read. */
  aborted: boolean;
}

/**
 * Ask each relay separately and count the ones that finished. Never throws:
 * the two public readers below decide what an incomplete read means.
 */
async function readRelays(
  client: RelayReqClient,
  relays: string[],
  filters: NostrFilter[],
  { timeoutMs, graceMs = 750, signal }: QueryForWriteOptions
): Promise<RelayReadResult> {
  const urls = [...new Set(relays)];
  if (urls.length === 0) return { events: [], answered: 0, total: 0, aborted: false };

  if (signal?.aborted) return { events: [], answered: 0, total: urls.length, aborted: true };

  const controller = new AbortController();
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const abortAll = () => {
    controller.abort();
    release();
  };
  signal?.addEventListener('abort', abortAll, { once: true });
  const timer = setTimeout(release, timeoutMs);

  const events = new Map<string, NostrEvent>();
  let answered = 0;
  let finished = 0;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;

  const perRelay = urls.map(async (url) => {
    let gotEose = false;
    try {
      for await (const msg of client.req(filters, { signal: controller.signal, relays: [url] })) {
        if (msg[0] === 'EVENT') {
          const event = msg[2];
          events.set(event.id, event);
        } else if (msg[0] === 'EOSE') {
          gotEose = true;
          break;
        } else if (msg[0] === 'CLOSED') {
          break;
        }
      }
    } catch {
      // Abort, socket error, or relay failure: this relay did not answer.
    }
    if (controller.signal.aborted && !gotEose) return;
    if (gotEose) answered++;
    finished++;
    if (finished === urls.length) {
      release();
    } else if (gotEose && graceTimer === undefined && hasReadQuorum(answered, urls.length)) {
      graceTimer = setTimeout(release, graceMs);
    }
  });

  try {
    await done;
  } finally {
    clearTimeout(timer);
    clearTimeout(graceTimer);
    signal?.removeEventListener('abort', abortAll);
    controller.abort();
    await Promise.allSettled(perRelay);
  }

  return {
    events: [...events.values()],
    answered,
    total: urls.length,
    aborted: signal?.aborted ?? false,
  };
}

/**
 * Strict read for a result that is about to decide a write. Throws
 * `IncompleteRelayReadError` unless a strict majority of the relays answered
 * before the timeout (an external abort also throws).
 */
export async function queryForWrite(
  client: RelayReqClient,
  relays: string[],
  filters: NostrFilter[],
  options: QueryForWriteOptions
): Promise<NostrEvent[]> {
  const { events, answered, total, aborted } = await readRelays(client, relays, filters, options);
  if (aborted || !hasReadQuorum(answered, total)) {
    throw new IncompleteRelayReadError(answered, total);
  }
  return events;
}

/**
 * Tolerant read for display only. Returns whatever the relays sent before
 * the timeout, quorum or not. It still returns early (majority + grace) so
 * one dead relay doesn't slow every load. An empty result means "nothing
 * seen", NOT "nothing exists": never decide a write from it.
 *
 * It throws `IncompleteRelayReadError` only when not a single relay answered
 * and nothing arrived, so the caller can retry instead of caching "empty".
 */
export async function queryForDisplay(
  client: RelayReqClient,
  relays: string[],
  filters: NostrFilter[],
  options: QueryForWriteOptions
): Promise<NostrEvent[]> {
  const { events, answered, total, aborted } = await readRelays(client, relays, filters, options);
  if (!aborted && answered === 0 && events.length === 0) {
    throw new IncompleteRelayReadError(0, total);
  }
  return events;
}

/** Read relays from the app's relay config (mirrors NostrProvider's reqRouter). */
export function readRelayUrls(relays: { url: string; read: boolean }[]): string[] {
  return relays.filter((r) => r.read).map((r) => r.url);
}
