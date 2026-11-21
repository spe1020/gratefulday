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

export async function queryForWrite(
  client: RelayReqClient,
  relays: string[],
  filters: NostrFilter[],
  { timeoutMs, graceMs = 750, signal }: QueryForWriteOptions
): Promise<NostrEvent[]> {
  const urls = [...new Set(relays)];
  if (urls.length === 0) throw new IncompleteRelayReadError(0, 0);

  if (signal?.aborted) throw new IncompleteRelayReadError(0, urls.length);

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

  if (signal?.aborted) throw new IncompleteRelayReadError(answered, urls.length);
  if (!hasReadQuorum(answered, urls.length)) {
    throw new IncompleteRelayReadError(answered, urls.length);
  }
  return [...events.values()];
}

/** Read relays from the app's relay config (mirrors NostrProvider's reqRouter). */
export function readRelayUrls(relays: { url: string; read: boolean }[]): string[] {
  return relays.filter((r) => r.read).map((r) => r.url);
}
