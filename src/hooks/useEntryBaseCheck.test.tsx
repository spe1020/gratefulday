import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

const nostr = { query: vi.fn(), req: vi.fn() };
const queryForWrite = vi.fn<(...args: unknown[]) => Promise<NostrEvent[]>>();
vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr }) }));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: { relayMetadata: { relays: [{ url: 'wss://a', read: true, write: true }, { url: 'wss://w', read: false, write: true }] } },
  }),
}));
vi.mock('@/lib/relayQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/relayQuery')>();
  return { ...actual, queryForWrite: (...args: unknown[]) => queryForWrite(...args) };
});

import { useEntryBaseCheck } from './useEntryBaseCheck';
import { IncompleteRelayReadError } from '@/lib/relayQuery';
import { addEntryTombstone, entryAddress } from '@/lib/entryTombstones';

const ME = 'a'.repeat(64);
const D = '2026-06-13';

function entry(id: string, created_at: number, pubkey = ME): NostrEvent {
  return {
    id, pubkey, kind: 36669, created_at, content: 'x', sig: 's',
    tags: [['d', D], ['published_at', '1700000000'], ['day', '164']],
  };
}
function deletion(created_at: number): NostrEvent {
  return { id: `del-${created_at}`, pubkey: ME, kind: 5, created_at, content: '', sig: 's', tags: [['a', entryAddress(ME, D)]] };
}

function check() {
  return renderHook(() => useEntryBaseCheck()).result.current;
}

beforeEach(() => {
  queryForWrite.mockReset();
  localStorage.removeItem('gratefulday:deleted-entries:v1');
});

describe('useEntryBaseCheck', () => {
  it('reads the day and its deletions through queryForWrite on read relays only', async () => {
    queryForWrite.mockResolvedValue([entry('base', 100)]);
    expect(await check()(ME, D, { id: 'base', created_at: 100 })).toBe('ok');
    const [client, relays, filters] = queryForWrite.mock.calls[0];
    expect(client).toBe(nostr);
    expect(relays).toEqual(['wss://a']);
    expect(filters).toEqual([
      { kinds: [36669], authors: [ME], '#d': [D], limit: 5 },
      { kinds: [5], authors: [ME], '#a': [entryAddress(ME, D)], limit: 20 },
    ]);
    expect(nostr.query).not.toHaveBeenCalled();
  });

  it('reports a conflict for a newer version saved elsewhere', async () => {
    queryForWrite.mockResolvedValue([entry('base', 100), entry('theirs', 200)]);
    expect(await check()(ME, D, { id: 'base', created_at: 100 })).toBe('conflict');
  });

  it('reports a conflict when the base was deleted elsewhere (kind 5)', async () => {
    queryForWrite.mockResolvedValue([entry('base', 100), deletion(150)]);
    expect(await check()(ME, D, { id: 'base', created_at: 100 })).toBe('conflict');
  });

  it('a new day stays "ok" when the only version there is deleted', async () => {
    queryForWrite.mockResolvedValue([entry('old', 100), deletion(150)]);
    expect(await check()(ME, D, null)).toBe('ok');
  });

  it('honors local tombstones too', async () => {
    addEntryTombstone(ME, D, 150);
    queryForWrite.mockResolvedValue([entry('base', 100)]);
    expect(await check()(ME, D, { id: 'base', created_at: 100 })).toBe('conflict');
  });

  it('ignores versions signed by someone else', async () => {
    queryForWrite.mockResolvedValue([entry('forged', 999, 'b'.repeat(64))]);
    expect(await check()(ME, D, null)).toBe('ok');
  });

  it('propagates an incomplete read so the caller does not save', async () => {
    queryForWrite.mockRejectedValue(new IncompleteRelayReadError(0, 1));
    await expect(check()(ME, D, null)).rejects.toBeInstanceOf(IncompleteRelayReadError);
  });
});
