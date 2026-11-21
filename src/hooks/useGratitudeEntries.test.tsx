import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

const query = vi.fn<(filters: NostrFilter[], opts?: unknown) => Promise<NostrEvent[]>>();
vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: { query } }) }));

import { useGratitudeEntries, useGratitudeEntry } from './useGratitudeEntries';
import { addEntryTombstone, entryAddress } from '@/lib/entryTombstones';

const ME = 'a'.repeat(64);

function entry(d: string, created_at: number): NostrEvent {
  return {
    id: `e-${d}-${created_at}`,
    pubkey: ME,
    kind: 36669,
    created_at,
    content: 'grateful',
    sig: 's',
    tags: [['d', d], ['published_at', '1700000000'], ['day', '164']],
  };
}

function deletion(d: string, created_at: number, pubkey = ME): NostrEvent {
  return {
    id: `del-${d}-${created_at}`,
    pubkey,
    kind: 5,
    created_at,
    content: 'Deleted gratitude entry',
    sig: 's',
    tags: [['a', entryAddress(ME, d)], ['e', 'x'], ['k', '36669']],
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  query.mockReset();
  localStorage.removeItem('gratefulday:deleted-entries:v1');
});

describe('useGratitudeEntries — kind 5 deletions from other devices', () => {
  it('asks relays for the user’s own 36669 deletions alongside entries', async () => {
    query.mockResolvedValue([]);
    const { result } = renderHook(() => useGratitudeEntries(ME), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(query.mock.calls[0][0]).toContainEqual({ kinds: [5], authors: [ME], '#k': ['36669'], limit: 500 });
  });

  it('hides a day deleted elsewhere, keeps other days and a newer re-created entry', async () => {
    query.mockResolvedValue([
      entry('2026-06-13', 100),
      deletion('2026-06-13', 200),
      entry('2026-06-14', 100),
      deletion('2026-06-14', 50), // older than the entry: re-created after delete
      entry('2026-06-15', 100),
      deletion('2026-06-15', 300, 'b'.repeat(64)), // someone else can't delete my day
    ]);
    const { result } = renderHook(() => useGratitudeEntries(ME), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const days = result.current.data!.map((e) => e.tags.find(([n]) => n === 'd')![1]).sort();
    expect(days).toEqual(['2026-06-14', '2026-06-15']);
  });

  it('still honors local tombstones', async () => {
    addEntryTombstone(ME, '2026-06-13', 150);
    query.mockResolvedValue([entry('2026-06-13', 100)]);
    const { result } = renderHook(() => useGratitudeEntries(ME), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useGratitudeEntry — kind 5 deletions from other devices', () => {
  it('returns null for a day deleted elsewhere, querying deletions by address', async () => {
    query.mockResolvedValue([entry('2026-06-13', 100), deletion('2026-06-13', 200)]);
    const { result } = renderHook(() => useGratitudeEntry(ME, '2026-06-13'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(query.mock.calls[0][0]).toContainEqual({
      kinds: [5],
      authors: [ME],
      '#a': [entryAddress(ME, '2026-06-13')],
      limit: 20,
    });
  });

  it('returns a version saved after the deletion', async () => {
    query.mockResolvedValue([entry('2026-06-13', 300), deletion('2026-06-13', 200)]);
    const { result } = renderHook(() => useGratitudeEntry(ME, '2026-06-13'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.created_at).toBe(300);
  });
});
