import { describe, it, expect } from 'vitest';
import { canQuickSend, SUGGESTED_GIFT_AMOUNT } from './giftUtils';

describe('canQuickSend', () => {
  it('allows one-tap only with a wallet AND a preset positive amount', () => {
    expect(canQuickSend({ hasWallet: true, defaultAmount: 21 })).toBe(true);
  });

  it('opens the modal (false) when no wallet, even with a preset amount', () => {
    expect(canQuickSend({ hasWallet: false, defaultAmount: 21 })).toBe(false);
  });

  it('opens the modal (false) when no preset amount, even with a wallet', () => {
    // The money-safety crux: a wallet alone never arms a silent send.
    expect(canQuickSend({ hasWallet: true, defaultAmount: undefined })).toBe(false);
  });

  it('rejects non-positive amounts', () => {
    expect(canQuickSend({ hasWallet: true, defaultAmount: 0 })).toBe(false);
    expect(canQuickSend({ hasWallet: true, defaultAmount: -5 })).toBe(false);
  });

  it('exposes 21 as the suggested (not auto-armed) amount', () => {
    expect(SUGGESTED_GIFT_AMOUNT).toBe(21);
  });
});
