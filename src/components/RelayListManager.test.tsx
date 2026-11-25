import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: { relayMetadata: { relays: [{ url: 'wss://default.example/', read: true, write: true }], updatedAt: 0 } },
    updateConfig: vi.fn(),
  }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { pubkey: 'b'.repeat(64) } }) }));
vi.mock('@/hooks/useNostrPublish', () => ({ useNostrPublish: () => ({ mutate: vi.fn() }) }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { RelayListManager } from './RelayListManager';
import { RelayListContext, type RelayListContextType, type RelayListStatus } from '@/contexts/RelayListContext';

function renderWith(status: RelayListStatus) {
  const value: RelayListContextType = {
    activePubkey: 'b'.repeat(64),
    status,
    waitForRelayList: vi.fn(),
    resolveRelayList: vi.fn(),
    isActive: () => true,
  };
  render(
    <RelayListContext.Provider value={value}>
      <RelayListManager />
    </RelayListContext.Provider>
  );
}

describe('RelayListManager while the account relay list loads', () => {
  it('says the relays are loading and disables editing', () => {
    renderWith('unresolved');
    expect(screen.getByTestId('relays-loading')).toHaveTextContent(
      "Loading your relays… You can edit them once they've loaded."
    );
    expect(screen.getByLabelText('Relay URL')).toBeDisabled();
  });

  it('shows no loading line and allows editing once resolved', () => {
    renderWith('resolved');
    expect(screen.queryByTestId('relays-loading')).toBeNull();
    expect(screen.getByLabelText('Relay URL')).toBeEnabled();
  });
});
