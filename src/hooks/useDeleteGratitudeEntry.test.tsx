import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

const event = vi.fn(async () => {});
vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: { event } }) }));
const ME = 'a'.repeat(64);
const signEvent = vi.fn(async (t: object) => ({ ...t, id: 'del', pubkey: ME, sig: 'sig' }));
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { pubkey: ME, signer: { signEvent } } }) }));
vi.mock('@/hooks/useAppContext', () => ({ useAppContext: () => ({ config: { relayMetadata: { relays: [], updatedAt: 0 } } }) }));

import { useDeleteGratitudeEntry } from './useDeleteGratitudeEntry';
import { RelayListContext, type RelayListContextType } from '@/contexts/RelayListContext';
import { RelayAccountChangedError, RelayListUnresolvedError } from '@/lib/accountRelays';

const ENTRY = { id: 'e1', pubkey: ME, kind: 36669, tags: [['d', '2026-11-24']] } as NostrEvent;

describe('useDeleteGratitudeEntry — waits for the account relay list', () => {
  it('signs and sends no deletion while the list is unknown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const relayList: RelayListContextType = {
      activePubkey: ME,
      status: 'unresolved',
      resolveRelayList: vi.fn(),
    isActive: () => true,
      waitForRelayList: async () => {
        throw new RelayListUnresolvedError();
      },
    };
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <RelayListContext.Provider value={relayList}>{children}</RelayListContext.Provider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteGratitudeEntry(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(ENTRY)).rejects.toBeInstanceOf(RelayListUnresolvedError);
    });
    expect(signEvent).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });

  it('sends no deletion if another account became active while signing', async () => {
    signEvent.mockClear();
    event.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let active = ME;
    signEvent.mockImplementationOnce(async (t: object) => {
      active = 'b'.repeat(64);
      return { ...t, id: 'del', pubkey: ME, sig: 'sig' };
    });
    const relayList: RelayListContextType = {
      activePubkey: ME,
      status: 'resolved',
      resolveRelayList: vi.fn(),
      isActive: (pubkey) => pubkey === active,
      waitForRelayList: async () => ({ relays: [], updatedAt: 0 }),
    };
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <RelayListContext.Provider value={relayList}>{children}</RelayListContext.Provider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useDeleteGratitudeEntry(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync(ENTRY)).rejects.toBeInstanceOf(RelayAccountChangedError);
    });
    expect(signEvent).toHaveBeenCalledTimes(1);
    expect(event).not.toHaveBeenCalled();
  });
});
