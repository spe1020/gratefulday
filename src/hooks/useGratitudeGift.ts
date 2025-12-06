import { useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/hooks/useAppContext';
import { nip57 } from 'nostr-tools';
import { useNostr } from '@nostrify/react';

/**
 * Hook for sending anonymous gratitude gifts (zaps) to random Nostr users
 */
export function useGratitudeGift() {
  const [isSending, setIsSending] = useState(false);
  const { user } = useCurrentUser();
  const { webln, activeNWC } = useWallet();
  const { sendPayment, getActiveConnection } = useNWC();
  const { toast } = useToast();
  const { config } = useAppContext();
  const { nostr } = useNostr();

  /**
   * Select a random active Nostr pubkey
   * Queries for random active users from recent events
   */
  const selectRandomRecipient = async (): Promise<string | null> => {
    // Select random recipient from active users
    try {
      // TODO: Query for recently active users or maintain a pool of active pubkeys
      // For now, we'll query for recent kind 1 events and select a random author
      const signal = AbortSignal.timeout(3000);
      const recentEvents = await nostr.query(
        [{ kinds: [1], limit: 50 }],
        { signal }
      );

      if (recentEvents.length === 0) {
        return null;
      }

      // Get unique pubkeys from recent events
      const pubkeys = Array.from(
        new Set(recentEvents.map((e) => e.pubkey))
      ).filter((pk) => pk !== user?.pubkey); // Exclude current user

      if (pubkeys.length === 0) {
        return null;
      }

      // Select random pubkey
      const randomIndex = Math.floor(Math.random() * pubkeys.length);
      return pubkeys[randomIndex];
    } catch (error) {
      console.error('Error selecting random recipient:', error);
      return null;
    }
  };

  /**
   * Send a gratitude gift (zap) to a random Nostr user
   * The zap will appear in the recipient's client notifications
   * @param amount - Amount in sats to send
   * @param message - Optional custom message (defaults to standard gratitude message)
   */
  const sendGratitudeGift = async (amount: number, message?: string): Promise<boolean> => {
    if (!user) {
      toast({
        title: 'Login required',
        description: 'You must be logged in to send a gratitude gift.',
        variant: 'destructive',
      });
      return false;
    }

    if (amount <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please select a valid amount.',
        variant: 'destructive',
      });
      return false;
    }

    setIsSending(true);

    try {
      // Select random recipient
      const recipientPubkey = await selectRandomRecipient();

      if (!recipientPubkey) {
        toast({
          title: 'No recipient found',
          description: 'Could not find a recipient. Please try again later.',
          variant: 'destructive',
        });
        setIsSending(false);
        return false;
      }

      // Fetch recipient's profile to get lightning address
      const profileSignal = AbortSignal.timeout(3000);
      const profileEvents = await nostr.query(
        [{ kinds: [0], authors: [recipientPubkey], limit: 1 }],
        { signal: profileSignal }
      );

      if (profileEvents.length === 0) {
        toast({
          title: 'Recipient not found',
          description: 'Could not find recipient profile. Please try again.',
          variant: 'destructive',
        });
        setIsSending(false);
        return false;
      }

      const profileEvent = profileEvents[0];
      let profileData;
      try {
        profileData = JSON.parse(profileEvent.content);
      } catch {
        toast({
          title: 'Invalid profile',
          description: 'Recipient profile is invalid. Please try again.',
          variant: 'destructive',
        });
        setIsSending(false);
        return false;
      }

      // Check for lightning address
      const lightningAddress = profileData.lud16 || profileData.lud06;
      if (!lightningAddress) {
        toast({
          title: 'No lightning address',
          description: 'Recipient does not have a lightning address configured.',
          variant: 'destructive',
        });
        setIsSending(false);
        return false;
      }

      // Get zap endpoint
      const zapEndpoint = await nip57.getZapEndpoint(profileEvent);
      if (!zapEndpoint) {
        toast({
          title: 'Zap endpoint not found',
          description: 'Could not find zap endpoint for recipient.',
          variant: 'destructive',
        });
        setIsSending(false);
        return false;
      }

      // Create zap request with gratitude message
      const zapAmount = amount * 1000; // convert to millisats
      const gratitudeMessage = message || "A small gift of gratitude from someone who appreciates you today. 💜";
      
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

      // Try NWC first
      if (currentNWCConnection && currentNWCConnection.connectionString && currentNWCConnection.isConnected) {
        try {
          await sendPayment(currentNWCConnection, invoice);
          
          // Publish zap request to relays so recipient sees it in notifications
          try {
            await nostr.event(signedZapRequest, { signal: AbortSignal.timeout(5000) });
          } catch (publishError) {
            // Payment succeeded but publishing failed - log but don't fail
            console.warn('Payment succeeded but failed to publish zap request to relays:', publishError);
          }
          
          setIsSending(false);
          return true;
        } catch (nwcError) {
          console.error('NWC payment failed, falling back:', nwcError);
        }
      }

      // Try WebLN
      if (webln) {
        try {
          let webLnProvider = webln;
          if (webln.enable && typeof webln.enable === 'function') {
            const enabledProvider = await webln.enable();
            const provider = enabledProvider as typeof webln | undefined;
            if (provider) {
              webLnProvider = provider;
            }
          }
          await webLnProvider.sendPayment(invoice);
          
          // Publish zap request to relays so recipient sees it in notifications
          try {
            await nostr.event(signedZapRequest, { signal: AbortSignal.timeout(5000) });
          } catch (publishError) {
            // Payment succeeded but publishing failed - log but don't fail
            console.warn('Payment succeeded but failed to publish zap request to relays:', publishError);
          }
          
          setIsSending(false);
          return true;
        } catch (weblnError) {
          console.error('WebLN payment failed:', weblnError);
          toast({
            title: 'Payment failed',
            description: 'Could not complete payment. Please try again.',
            variant: 'destructive',
          });
          setIsSending(false);
          return false;
        }
      }

      // No payment method available
      toast({
        title: 'No payment method',
        description: 'Please connect a Lightning wallet to send gratitude gifts.',
        variant: 'destructive',
      });
      setIsSending(false);
      return false;
    } catch (error) {
      console.error('Gratitude gift error:', error);
      toast({
        title: 'Gift failed',
        description: error instanceof Error ? error.message : 'Could not send gratitude gift. Please try again.',
        variant: 'destructive',
      });
      setIsSending(false);
      return false;
    }
  };

  return {
    sendGratitudeGift,
    isSending,
  };
}

