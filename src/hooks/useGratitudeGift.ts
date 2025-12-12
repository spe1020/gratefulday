import { useState, useCallback } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { nip57 } from 'nostr-tools';
import type { Event } from 'nostr-tools';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { openInvoiceInWalletApp, getWalletAppInfo } from '@/lib/walletApps';
import { selectRandomZapper } from '@/services/zapDetector';

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
   * Helper function to publish zap request to relays (non-blocking)
   */
  const publishZapRequest = async (zapRequest: unknown) => {
    try {
      await nostr.event(zapRequest as NostrEvent, { signal: AbortSignal.timeout(5000) });
    } catch (error) {
      // Payment succeeded but publishing failed - log but don't fail
      console.warn('Payment succeeded but failed to publish zap request to relays:', error);
    }
  };

  /**
   * Get recent recipients (last 5) from localStorage to avoid repeating
   */
  const getRecentRecipients = useCallback((): string[] => {
    try {
      const stored = localStorage.getItem('gratitudeGift_recentRecipients');
      if (stored) {
        return JSON.parse(stored);
      }
      return [];
    } catch {
      return [];
    }
  }, []);

  /**
   * Save a recipient to the recent recipients list (keeps last 5)
   */
  const saveRecentRecipient = (pubkey: string): void => {
    try {
      const recent = getRecentRecipients();
      // Remove if already exists
      const filtered = recent.filter(p => p !== pubkey);
      // Add to front
      filtered.unshift(pubkey);
      // Keep only last 5
      const toStore = filtered.slice(0, 5);
      localStorage.setItem('gratitudeGift_recentRecipients', JSON.stringify(toStore));
    } catch (error) {
      console.warn('Failed to save recent recipient:', error);
    }
  };

  /**
   * Select a random active Nostr pubkey using zap detector logic
   * Queries multiple relays for zap receipts, filters for valid zaps (> 10 sats),
   * and randomly selects a zapper
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
      
      console.log(`[GratitudeGift] Using zap detector to find random zapper (excluding ${excludePubkeys.length} pubkeys)`);
      
      // Use zap detector to select random zapper
      const selectedZapper = await selectRandomZapper(7, excludePubkeys);
      
      if (!selectedZapper) {
        console.log('[GratitudeGift] No valid zappers found');
        return null;
      }
      
      // Fetch profile for the selected zapper
      const profileSignal = AbortSignal.timeout(5000);
      const profileEvents = await nostr.query(
        [{ kinds: [0], authors: [selectedZapper.zapperPubkey], limit: 1 }],
        { signal: profileSignal }
      );
      
      if (profileEvents.length === 0) {
        console.log('[GratitudeGift] Could not fetch profile for selected zapper');
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
        console.log('[GratitudeGift] Selected zapper has no lightning address');
        return null;
      }
      
      console.log(`[GratitudeGift] Selected zapper: ${selectedZapper.zapperNpub.substring(0, 16)}...`);
      
      return {
        pubkey: selectedZapper.zapperPubkey,
        profileEvent,
        profileData,
        lightningAddress,
      };
    } catch (error) {
      console.error('Error selecting random recipient:', error);
      return null;
    }
  }, [nostr, user?.pubkey, getRecentRecipients]);

  /**
   * Check if an invoice has been paid by querying the zap endpoint
   * Tries multiple methods to verify payment status
   */
  const checkInvoiceStatus = async (zapEndpoint: string, invoice: string): Promise<boolean> => {
    try {
      // Method 1: Try to check invoice status via the zap endpoint
      // Some LNURL endpoints support checking invoice status
      try {
        const response = await fetch(`${zapEndpoint}/check/${encodeURIComponent(invoice)}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.paid === true || data.settled === true) {
            return true;
          }
        }
      } catch {
        // Endpoint doesn't support status checking, try next method
      }

      // Method 2: Extract payment hash for potential future use
      // Note: Most LNURL endpoints don't support payment hash lookup
      // This is kept for potential future service-specific implementations
      
      // Since we can't reliably check invoice status without service-specific APIs,
      // we return false and let polling continue. Users can manually confirm payment.
      return false;
    } catch (error) {
      console.debug('Invoice status check error:', error);
      return false;
    }
  };

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

    if (amount <= 0) {
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
      
      // Get relay URLs for publishing zap request
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

      // Sign the zap request
      const signedZapRequest = await user.signer.signEvent(zapRequest);

      // Get invoice from zap endpoint
      const res = await fetch(
        `${zapEndpoint}?amount=${zapAmount}&nostr=${encodeURI(JSON.stringify(signedZapRequest))}`
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

      // Helper to handle successful payment
      const handlePaymentSuccess = async () => {
        await publishZapRequest(signedZapRequest);
        setIsSending(false);
        return { success: true };
      };

      // Try NWC first
      if (currentNWCConnection?.connectionString && currentNWCConnection.isConnected) {
        try {
          await sendPayment(currentNWCConnection, invoice);
          return await handlePaymentSuccess();
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
          return await handlePaymentSuccess();
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
   * Verify payment and publish zap request after manual payment
   * @param forcePublish - If true, publish zap request even if payment can't be verified (user confirmed payment)
   */
  const verifyAndPublishPayment = async (
    invoice: string,
    zapEndpoint: string,
    signedZapRequest: unknown,
    forcePublish: boolean = false
  ): Promise<boolean> => {
    try {
      // Check if invoice is paid
      const isPaid = await checkInvoiceStatus(zapEndpoint, invoice);
      
      if (isPaid || forcePublish) {
        await publishZapRequest(signedZapRequest);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Payment verification error:', error);
      // If force publish, still try to publish
      if (forcePublish) {
        try {
          await publishZapRequest(signedZapRequest);
          return true;
        } catch (publishError) {
          console.error('Failed to publish zap request:', publishError);
        }
      }
      return false;
    }
  };

  return {
    sendGratitudeGift,
    verifyAndPublishPayment,
    checkInvoiceStatus,
    isSending,
    selectRandomRecipient,
  };
}

