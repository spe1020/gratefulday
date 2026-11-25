import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const event = vi.fn(async () => {});
vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr: { event } }) }));
const ME = 'a'.repeat(64);
const signEvent = vi.fn(async (t: object) => ({ ...t, id: 'id', pubkey: ME, sig: 'sig' }));
vi.mock('./useCurrentUser', () => ({ useCurrentUser: () => ({ user: { pubkey: ME, signer: { signEvent } } }) }));
vi.mock('@/hooks/useAppContext', () => ({ useAppContext: () => ({ config: { relayMetadata: { relays: [], updatedAt: 0 } } }) }));

import { useNostrPublish } from './useNostrPublish';
import { RelayListContext, type RelayListContextType } from '@/contexts/RelayListContext';
import { RelayAccountChangedError } from '@/lib/accountRelays';

function setup(waitForRelayList: RelayListContextType['waitForRelayList']) {
  const relayList: RelayListContextType = {
    activePubkey: ME,
    status: 'unresolved',
    resolveRelayList: vi.fn(),
    waitForRelayList,
  };
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RelayListContext.Provider value={relayList}>{children}</RelayListContext.Provider>
    </QueryClientProvider>
  );
  return renderHook(() => useNostrPublish(), { wrapper }).result;
}

describe('useNostrPublish — waits for the account relay list', () => {
  it('neither signs nor publishes until the list is known', async () => {
    let release!: () => void;
    const ready = new Promise<void>((r) => (release = r));
    const result = setup(async () => {
      await ready;
      return { relays: [], updatedAt: 0 };
    });
    let publish!: Promise<unknown>;
    act(() => {
      publish = result.current.mutateAsync({ kind: 36669, content: 'x', tags: [] });
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(signEvent).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    release();
    await act(async () => {
      await publish;
    });
    expect(event).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing if the account changes while waiting', async () => {
    signEvent.mockClear();
    event.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = setup(async () => {
      throw new RelayAccountChangedError();
    });
    await act(async () => {
      await expect(result.current.mutateAsync({ kind: 36669, content: 'x', tags: [] })).rejects.toBeInstanceOf(
        RelayAccountChangedError
      );
    });
    expect(signEvent).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });
});
