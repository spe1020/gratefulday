import { useState, useCallback } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { nip57 } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import { useNostr } from '@nostrify/react';
import { openInvoiceInWalletApp, getWalletAppInfo } from '@/lib/walletApps';
import { selectRandomZapper } from '@/services/zapDetector';

// Recent recipients stay in memory only for the session — persisting who the
// user paid to localStorage leaks their payment graph. Module-level so the
// list survives modal remounts. Any legacy plaintext list is scrubbed.
let recentRecipients: string[] = [];
try {
  localStorage.removeItem('gratitudeGift_recentRecipients');
} catch {
  // localStorage unavailable — nothing to scrub
}

/**
 * Hook for sending anonymous gratitude gifts (zaps) to random Nostr users
 */
export function useGratitudeGift() {
  const [isSending, setIsSending] = useState(false);
  const { user } = useCurrentUser();
  const { webln } = useWallet();
  const { sendPayment, getActiveConnection } = useNWC();
  const { toast } = useToast();
  const { config } = useAppContext();
  const { nostr } = useNostr();

  /**
   * Get recent recipients (last 5) to avoid repeating
   */
  const getRecentRecipients = useCallback((): string[] => {
    return [...recentRecipients];
  }, []);

  /**
   * Save a recipient to the recent recipients list (keeps last 5)
   */
  const saveRecentRecipient = (pubkey: string): void => {
    const filtered = recentRecipients.filter(p => p !== pubkey);
    filtered.unshift(pubkey);
    recentRecipients = filtered.slice(0, 5);
  };

  /**
   * Select a random active Nostr pubkey using zap detector logic
   * Queries the app relay pool for zap receipts, validates them (signatures +
   * embedded zap request), and randomly selects a zapper
   * Excludes recent recipients to avoid zapping the same person repeatedly
   */
  const selectRandomRecipient = useCallback(async (): Promise<{
    pubkey: string;
    profileEvent: unknown;
    profileData: unknown;
    lightningAddress: string;
  } | null> => {
    try {
      // Get exclude list (current user + recent recipients)
      const excludePubkeys = [
        ...(user?.pubkey ? [user.pubkey] : []),
        ...getRecentRecipients()
      ];

      // Use zap detector to select random zapper via the app relay pool
      const selectedZapper = await selectRandomZapper(nostr, 7, excludePubkeys);

      if (!selectedZapper) {
        return null;
      }

      // Fetch profile for the selected zapper
      const profileSignal = AbortSignal.timeout(5000);
      const profileEvents = await nostr.query(
        [{ kinds: [0], authors: [selectedZapper.zapperPubkey], limit: 1 }],
        { signal: profileSignal }
      );

      if (profileEvents.length === 0) {
        return null;
      }

      const profileEvent = profileEvents[0];
      let profileData: Record<string, unknown> = {};
      try {
        profileData = JSON.parse(profileEvent.content);
      } catch {
        // Invalid JSON, continue with empty profile
      }

      // Check for lightning address
      const lightningAddress = (profileData.lud16 as string) || (profileData.lud06 as string);
      if (!lightningAddress) {
        return null;
      }

      return {
        pubkey: selectedZapper.zapperPubkey,
        profileEvent,
        profileData,
        lightningAddress,
      };
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error selecting random recipient:', error);
      }
      return null;
    }
  }, [nostr, user?.pubkey, getRecentRecipients]);

  /**
   * Check whether a zap receipt (kind 9735) for this invoice has appeared on
   * the relays — the LNURL server publishes one once the invoice is paid.
   */
  const findZapReceipt = useCallback(async (
    invoice: string,
    signedZapRequest: unknown
  ): Promise<boolean> => {
    try {
      const request = signedZapRequest as Event | undefined;
      const recipientPubkey = request?.tags?.find(t => t[0] === 'p')?.[1];
      if (!recipientPubkey || !request) return false;

      const events = await nostr.query(
        [{
          kinds: [9735],
          '#p': [recipientPubkey],
          since: request.created_at - 60,
          limit: 50,
        }],
        { signal: AbortSignal.timeout(5000) }
      );

      return events.some(event =>
        event.tags.some(t => t[0] === 'bolt11' && t[1] === invoice)
      );
    } catch {
      return false;
    }
  }, [nostr]);

  /**
   * Send a gratitude gift (zap) to a random Nostr user
   * The zap will appear in the recipient's client notifications
   * @param amount - Amount in sats to send
   * @param message - Optional custom message (defaults to standard gratitude message)
   * @returns Object with success status and invoice info if manual payment needed
   */
  const sendGratitudeGift = async (
    amount: number,
    message?: string
  ): Promise<{ success: boolean; invoice?: string; zapEndpoint?: string; signedZapRequest?: unknown }> => {
    if (!user) {
      toast({
        title: 'Login required',
        description: 'You must be logged in to send a gratitude gift.',
        variant: 'destructive',
      });
      return { success: false };
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please select a valid amount.',
        variant: 'destructive',
      });
      return { success: false };
    }

    setIsSending(true);

    try {
      // Select random recipient (already includes profile validation)
      const recipient = await selectRandomRecipient();

      if (!recipient) {
        toast({
          title: 'No recipient found',
          description: 'Could not find a recipient. Please try again later.',
          variant: 'destructive',
        });
        setIsSending(false);
        return { success: false };
      }

      const { pubkey: recipientPubkey, profileEvent } = recipient;

      // Save this recipient to recent recipients list to avoid zapping them again soon
      saveRecentRecipient(recipientPubkey);

      // Get zap endpoint
      const zapEndpoint = await nip57.getZapEndpoint(profileEvent as Event);
      if (!zapEndpoint) {
        toast({
          title: 'Zap endpoint not found',
          description: 'Could not find zap endpoint for recipient.',
          variant: 'destructive',
        });
        setIsSending(false);
        return { success: false };
      }

      // Create zap request with gratitude message
      const zapAmount = amount * 1000; // convert to millisats
      const defaultMessage = "A random zap of kindness, sent your way today 💜";
      const baseMessage = message || defaultMessage;
      // Ensure website URL is included (append if not already present)
      const gratitudeMessage = baseMessage.includes("gratefulday.space")
        ? baseMessage
        : `${baseMessage}\nhttps://gratefulday.space`;

      // Relays where the recipient's LNURL server should publish the 9735 receipt
      const relayUrls = config.relayMetadata.relays
        .filter(r => r.write)
        .map(r => r.url);

      const zapRequest = nip57.makeZapRequest({
        profile: recipientPubkey,
        event: null, // No event reference - profile zap
        amount: zapAmount,
        relays: relayUrls.length > 0 ? relayUrls : [],
        comment: gratitudeMessage,
      });

      // Sign the zap request. Per NIP-57 it goes only to the LNURL callback —
      // publishing it to relays would leak payment intent; the 9735 receipt is
      // the recipient's notification.
      const signedZapRequest = await user.signer.signEvent(zapRequest);

      // Get invoice from zap endpoint
      const res = await fetch(
        `${zapEndpoint}?amount=${zapAmount}&nostr=${encodeURIComponent(JSON.stringify(signedZapRequest))}`
      );

      if (!res.ok) {
        throw new Error('Lightning service did not return a valid invoice');
      }

      const data = await res.json();
      const invoice = data.pr;

      if (!invoice) {
        throw new Error('Lightning service did not return a valid invoice');
      }

      // Pay the invoice
      const currentNWCConnection = getActiveConnection();

      // Try NWC first
      if (currentNWCConnection?.connectionString) {
        try {
          await sendPayment(currentNWCConnection, invoice);
          setIsSending(false);
          return { success: true };
        } catch (nwcError) {
          console.error('NWC payment failed, falling back:', nwcError);
        }
      }

      // Try WebLN
      if (webln) {
        try {
          let webLnProvider = webln;
          if (webln.enable && typeof webln.enable === 'function') {
            try {
              await webln.enable();
              // enable() may return a provider or void - use original if void
              webLnProvider = webln;
            } catch {
              // Enable failed, use original provider
              webLnProvider = webln;
            }
          }
          await webLnProvider.sendPayment(invoice);
          setIsSending(false);
          return { success: true };
        } catch (weblnError) {
          console.error('WebLN payment failed, falling back to manual payment:', weblnError);
          // Fall through to manual payment option
        }
      }

      // Try default wallet app
      if (config.defaultWalletApp !== 'none') {
        const walletInfo = getWalletAppInfo(config.defaultWalletApp);
        if (walletInfo && openInvoiceInWalletApp(invoice, config.defaultWalletApp)) {
          // User opened in wallet app - return invoice info for polling
          setIsSending(false);
          return {
            success: false,
            invoice,
            zapEndpoint,
            signedZapRequest,
          };
        }
      }

      // No automatic payment method available - return invoice for manual payment
      setIsSending(false);
      return {
        success: false,
        invoice,
        zapEndpoint,
        signedZapRequest,
      };
    } catch (error) {
      console.error('Gratitude gift error:', error);
      toast({
        title: 'Gift failed',
        description: error instanceof Error ? error.message : 'Could not send gratitude gift. Please try again.',
        variant: 'destructive',
      });
      setIsSending(false);
      return { success: false };
    }
  };

  /**
   * Verify a manual payment by looking for its kind-9735 receipt on relays.
   * Nothing is published here — per NIP-57 the LNURL server publishes the
   * receipt; this only confirms it exists.
   * @param userConfirmed - The user pressed "I've paid". Their say-so still
   *   triggers a real receipt lookup; it only decides what we do when no
   *   receipt is found (accept it rather than keep waiting), so the UI never
   *   claims a payment was verified when nothing was checked.
   */
  const verifyAndPublishPayment = useCallback(async (
    invoice: string,
    _zapEndpoint: string,
    signedZapRequest: unknown,
    userConfirmed: boolean = false
  ): Promise<boolean> => {
    const found = await findZapReceipt(invoice, signedZapRequest);
    return found || userConfirmed;
  }, [findZapReceipt]);

  return {
    sendGratitudeGift,
    verifyAndPublishPayment,
    isSending,
    selectRandomRecipient,
  };
}
