import { describe, it, expect, vi, afterEach } from 'vitest';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';
import {
  IncompleteRelayReadError,
  hasReadQuorum,
  queryForDisplay,
  queryForWrite,
  readRelayUrls,
  type RelayReqClient,
} from './relayQuery';

type Behavior =
  | { kind: 'eose'; events?: NostrEvent[]; delayMs?: number }
  | { kind: 'closed'; reason?: string }
  | { kind: 'hang'; events?: NostrEvent[] }
  | { kind: 'error' };

function ev(id: string, created_at = 1): NostrEvent {
  return { id, pubkey: 'pk', kind: 30078, created_at, tags: [], content: '', sig: 'sig' };
}

function waitAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

/** Fake pool: each relay URL gets a scripted behavior. Records calls. */
function fakeClient(behaviors: Record<string, Behavior>) {
  const calls: { relays?: string[]; filters: NostrFilter[] }[] = [];
  const client: RelayReqClient = {
    async *req(filters, opts) {
      calls.push({ relays: opts?.relays, filters });
      const url = opts?.relays?.[0] ?? '';
      const b = behaviors[url];
      if (!b) throw new Error(`no behavior for ${url}`);
      if (b.kind === 'error') throw new Error('socket error');
      if (b.kind === 'closed') {
        yield ['CLOSED', 'sub', b.reason ?? 'auth-required: please auth'];
        return;
      }
      for (const e of b.events ?? []) yield ['EVENT', 'sub', e];
      if (b.kind === 'hang') {
        await waitAbort(opts?.signal);
        return;
      }
      if (b.delayMs) {
        await Promise.race([
          new Promise((r) => setTimeout(r, b.delayMs)),
          waitAbort(opts?.signal),
        ]);
      }
      yield ['EOSE', 'sub'];
    },
  };
  return { client, calls };
}

const FIVE = ['wss://a', 'wss://b', 'wss://c', 'wss://d', 'wss://e'];
const FILTERS: NostrFilter[] = [{ kinds: [30078], limit: 1 }];

afterEach(() => {
  vi.useRealTimers();
});

describe('hasReadQuorum', () => {
  it('needs a strict majority of configured relays', () => {
    expect(hasReadQuorum(3, 5)).toBe(true);
    expect(hasReadQuorum(2, 5)).toBe(false);
    expect(hasReadQuorum(2, 2)).toBe(true);
    expect(hasReadQuorum(1, 2)).toBe(false);
    expect(hasReadQuorum(1, 1)).toBe(true);
    expect(hasReadQuorum(0, 0)).toBe(false);
  });
});

describe('queryForWrite', () => {
  it('passes when 3 of 5 relays send EOSE, and returns their events deduped', async () => {
    const { client, calls } = fakeClient({
      'wss://a': { kind: 'eose', events: [ev('x')] },
      'wss://b': { kind: 'eose', events: [ev('x'), ev('y')] },
      'wss://c': { kind: 'eose' },
      'wss://d': { kind: 'hang' },
      'wss://e': { kind: 'hang' },
    });
    const events = await queryForWrite(client, FIVE, FILTERS, { timeoutMs: 200, graceMs: 10 });
    expect(events.map((e) => e.id).sort()).toEqual(['x', 'y']);
    // One subscription per relay, each pinned to exactly that relay.
    expect(calls.map((c) => c.relays)).toEqual(FIVE.map((u) => [u]));
  });

  it('throws when only 2 of 5 relays send EOSE before the timeout', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'eose', events: [ev('x')] },
      'wss://b': { kind: 'eose' },
      'wss://c': { kind: 'hang', events: [ev('z')] },
      'wss://d': { kind: 'hang' },
      'wss://e': { kind: 'hang' },
    });
    await expect(
      queryForWrite(client, FIVE, FILTERS, { timeoutMs: 50 })
    ).rejects.toMatchObject({ name: 'IncompleteRelayReadError', answered: 2, total: 5 });
  });

  it('does not count a CLOSED (e.g. auth-required) reply as an answer', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'eose' },
      'wss://b': { kind: 'eose' },
      'wss://c': { kind: 'closed', reason: 'auth-required: we only serve authed users' },
      'wss://d': { kind: 'closed' },
      'wss://e': { kind: 'closed' },
    });
    await expect(queryForWrite(client, FIVE, FILTERS, { timeoutMs: 200 })).rejects.toBeInstanceOf(
      IncompleteRelayReadError
    );
  });

  it('does not count a relay that errors', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'eose' },
      'wss://b': { kind: 'error' },
    });
    await expect(
      queryForWrite(client, ['wss://a', 'wss://b'], FILTERS, { timeoutMs: 200 })
    ).rejects.toBeInstanceOf(IncompleteRelayReadError);
  });

  it('does not count a relay whose EOSE arrives after the timeout', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'eose' },
      'wss://b': { kind: 'eose', delayMs: 500 },
      'wss://c': { kind: 'eose', delayMs: 500 },
    });
    await expect(
      queryForWrite(client, ['wss://a', 'wss://b', 'wss://c'], FILTERS, { timeoutMs: 50 })
    ).rejects.toMatchObject({ answered: 1, total: 3 });
  });

  it('throws when there are no read relays', async () => {
    const { client, calls } = fakeClient({});
    await expect(queryForWrite(client, [], FILTERS, { timeoutMs: 50 })).rejects.toBeInstanceOf(
      IncompleteRelayReadError
    );
    expect(calls).toHaveLength(0);
  });

  it('counts duplicate relay URLs once (against the configured, deduplicated set)', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'eose' },
      'wss://b': { kind: 'hang' },
    });
    // Without dedup, a,a,b would look like 2 of 3.
    await expect(
      queryForWrite(client, ['wss://a', 'wss://a', 'wss://b'], FILTERS, { timeoutMs: 50 })
    ).rejects.toMatchObject({ answered: 1, total: 2 });
  });

  it('throws on an external abort, even after a quorum answered', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'eose' },
      'wss://b': { kind: 'eose' },
      'wss://c': { kind: 'hang' },
    });
    const controller = new AbortController();
    const pending = queryForWrite(client, ['wss://a', 'wss://b', 'wss://c'], FILTERS, {
      timeoutMs: 1000,
      graceMs: 500,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toBeInstanceOf(IncompleteRelayReadError);
  });

  it('throws immediately when the signal is already aborted', async () => {
    const { client, calls } = fakeClient({ 'wss://a': { kind: 'eose' } });
    const controller = new AbortController();
    controller.abort();
    await expect(
      queryForWrite(client, ['wss://a'], FILTERS, { timeoutMs: 50, signal: controller.signal })
    ).rejects.toBeInstanceOf(IncompleteRelayReadError);
    expect(calls).toHaveLength(0);
  });

  it('returns as soon as every relay answered, without waiting for the timeout', async () => {
    const { client } = fakeClient({ 'wss://a': { kind: 'eose' }, 'wss://b': { kind: 'eose' } });
    const started = Date.now();
    await queryForWrite(client, ['wss://a', 'wss://b'], FILTERS, { timeoutMs: 5000 });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns after the grace period once a majority answered, not the full timeout', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'eose' },
      'wss://b': { kind: 'eose' },
      'wss://c': { kind: 'hang' },
    });
    const started = Date.now();
    await queryForWrite(client, ['wss://a', 'wss://b', 'wss://c'], FILTERS, {
      timeoutMs: 5000,
      graceMs: 20,
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('collects a late healthy relay inside the grace period', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'eose' },
      'wss://b': { kind: 'eose' },
      'wss://c': { kind: 'eose', events: [ev('newest', 9)], delayMs: 30 },
    });
    const events = await queryForWrite(client, ['wss://a', 'wss://b', 'wss://c'], FILTERS, {
      timeoutMs: 2000,
      graceMs: 500,
    });
    expect(events.map((e) => e.id)).toEqual(['newest']);
  });
});

describe('queryForDisplay', () => {
  it('returns what arrived when fewer than a majority answered', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'eose', events: [ev('1')] },
      'wss://b': { kind: 'hang' },
      'wss://c': { kind: 'closed' },
      'wss://d': { kind: 'error' },
      'wss://e': { kind: 'hang' },
    });
    const events = await queryForDisplay(client, FIVE, FILTERS, { timeoutMs: 50 });
    expect(events.map((e) => e.id)).toEqual(['1']);
    // The same relays refuse a write.
    await expect(queryForWrite(client, FIVE, FILTERS, { timeoutMs: 50 })).rejects.toBeInstanceOf(
      IncompleteRelayReadError
    );
  });

  it('keeps events from a relay that never sent EOSE', async () => {
    const { client } = fakeClient({
      'wss://a': { kind: 'hang', events: [ev('1')] },
      'wss://b': { kind: 'hang' },
    });
    const events = await queryForDisplay(client, ['wss://a', 'wss://b'], FILTERS, { timeoutMs: 50 });
    expect(events.map((e) => e.id)).toEqual(['1']);
  });

  it('returns an empty list when a relay answered with nothing', async () => {
    const { client } = fakeClient({ 'wss://a': { kind: 'eose' }, 'wss://b': { kind: 'hang' } });
    await expect(
      queryForDisplay(client, ['wss://a', 'wss://b'], FILTERS, { timeoutMs: 50 })
    ).resolves.toEqual([]);
  });

  it('throws when no relay answered at all, so the caller can retry', async () => {
    const { client } = fakeClient({ 'wss://a': { kind: 'hang' }, 'wss://b': { kind: 'error' } });
    await expect(
      queryForDisplay(client, ['wss://a', 'wss://b'], FILTERS, { timeoutMs: 50 })
    ).rejects.toBeInstanceOf(IncompleteRelayReadError);
  });
});

describe('readRelayUrls', () => {
  it('keeps only read relays', () => {
    expect(
      readRelayUrls([
        { url: 'wss://r', read: true },
        { url: 'wss://w', read: false },
      ])
    ).toEqual(['wss://r']);
  });
});
