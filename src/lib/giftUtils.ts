/**
 * Pure helpers for the one-tap gratitude gift.
 *
 * The money-safety rule is enforced here: one-tap-to-instant-send is allowed
 * ONLY when a usable auto-pay wallet exists AND the user has explicitly preset a
 * gift amount. Either missing → the tap must open the configure modal, never
 * spend silently. `giftDefaultAmount` is undefined until the user opts in, so a
 * first tap (even with a wallet) can't auto-spend.
 */

/** Suggested amount pre-filled in the "set as default" control (NOT auto-armed). */
export const SUGGESTED_GIFT_AMOUNT = 21;

export interface QuickSendInput {
  /** A usable auto-pay wallet (NWC active or WebLN) — excludes wallet-app deep links. */
  hasWallet: boolean;
  /** The user's preset gift amount, or undefined if they haven't opted into one-tap. */
  defaultAmount: number | undefined;
}

/** Whether a tap may send instantly (vs. open the modal). */
export function canQuickSend({ hasWallet, defaultAmount }: QuickSendInput): boolean {
  return hasWallet && typeof defaultAmount === 'number' && defaultAmount > 0;
}
