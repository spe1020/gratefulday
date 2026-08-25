import { useState, useMemo, useEffect, useCallback } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useAppContext } from '@/hooks/useAppContext';
import { useToast } from '@/hooks/useToast';
import { useNWC } from '@/hooks/useNWCContext';
import type { NWCConnection } from '@/hooks/useNWC';
import { nip57, verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';

/** Parse a millisat amount tag; null when absent or unusable. */
function msatFromTag(tags: string[][] | undefined): number | null {
  const raw = tags?.find(([name]) => name === 'amount')?.[1];
  if (!raw) return null;
  const millisats = Number(raw);
  return Number.isFinite(millisats) && millisats > 0 ? millisats : null;
}

/**
 * The amount a zap receipt actually represents, in millisats, or null if it
 * can't be trusted as a payment.
 *
 * The bolt11 invoice is preferred, but its parse is not treated as
 * mandatory: nostr-tools returns fractional sats for `n`/`p` multipliers and
 * 0 for non-mainnet invoices, so requiring an exact integer-sat match against
 * the amount tags discarded legitimate zaps. Where both a decoded invoice and
 * a tag exist they must agree within one sat — a real mismatch is a forgery
 * signal and still drops the receipt.
 */
function receiptAmountMsat(receipt: Event, request: Event): number | null {
  const bolt11 = receipt.tags.find(([name]) => name === 'bolt11')?.[1];
  if (!bolt11) return null; // no invoice at all: not a payment

  let invoiceMsat: number | null = null;
  try {
    const sats = nip57.getSatoshisAmountFromBolt11(bolt11);
    if (Number.isFinite(sats) && sats > 0) invoiceMsat = Math.round(sats * 1000);
  } catch {
    invoiceMsat = null;
  }

  const receiptMsat = msatFromTag(receipt.tags);
  const requestMsat = msatFromTag(request.tags);
  const tagMsat = receiptMsat ?? requestMsat;

  // Tags that contradict each other, or a tag that contradicts the invoice.
  const TOLERANCE_MSAT = 1000; // one sat
  if (
    receiptMsat !== null &&
    requestMsat !== null &&
    Math.abs(receiptMsat - requestMsat) > TOLERANCE_MSAT
  ) {
    return null;
  }
  if (
    invoiceMsat !== null &&
    tagMsat !== null &&
    Math.abs(invoiceMsat - tagMsat) > TOLERANCE_MSAT
  ) {
    return null;
  }

  return invoiceMsat ?? tagMsat;
}
import type { WebLNProvider } from '@webbtc/webln-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';

export function useZaps(
  target: Event | Event[],
  webln: WebLNProvider | null,
  _nwcConnection: NWCConnection | null,
  onZapSuccess?: () => void
) {
  const { nostr } = useNostr();
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const queryClient = useQueryClient();

  // Handle the case where an empty array is passed (from ZapButton when external data is provided)
  const actualTarget = Array.isArray(target) ? (target.length > 0 ? target[0] : null) : target;

  const author = useAuthor(actualTarget?.pubkey);
  const { sendPayment, getActiveConnection } = useNWC();
  const [isZapping, setIsZapping] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);

  // Cleanup state when component unmounts
  useEffect(() => {
    return () => {
      setIsZapping(false);
      setInvoice(null);
    };
  }, []);

  const { data: zapEvents, ...query } = useQuery<NostrEvent[], Error>({
    queryKey: ['zaps', actualTarget?.id],
    staleTime: 30000, // 30 seconds
    refetchInterval: (query) => {
      // Only refetch if the query is currently being observed (component is mounted)
      return query.getObserversCount() > 0 ? 180000 : false;
    },
    queryFn: async (c) => {
      if (!actualTarget) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      // Query for zap receipts for this specific event
      if (actualTarget.kind >= 30000 && actualTarget.kind < 40000) {
        // Addressable event
        const identifier = actualTarget.tags.find((t) => t[0] === 'd')?.[1] || '';
        const events = await nostr.query([{
          kinds: [9735],
          '#a': [`${actualTarget.kind}:${actualTarget.pubkey}:${identifier}`],
          limit: 100,
        }], { signal });
        return events;
      } else {
        // Regular event
        const events = await nostr.query([{
          kinds: [9735],
          '#e': [actualTarget.id],
          limit: 100,
        }], { signal });
        return events;
      }
    },
    enabled: !!actualTarget?.id,
  });

  // The author's LNURL server pubkey — the only key allowed to issue zap
  // receipts for them (NIP-57 appendix E). Null when unobtainable.
  const lud16 = author.data?.metadata?.lud16;
  const { data: lnurlNostrPubkey } = useQuery<string | null>({
    queryKey: ['lnurl-nostr-pubkey', lud16 ?? ''],
    enabled: !!lud16,
    staleTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const [name, domain] = (lud16 as string).split('@');
      if (!name || !domain) return null;
      try {
        const res = await fetch(`https://${domain}/.well-known/lnurlp/${name}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.allowsNostr && typeof data.nostrPubkey === 'string'
          ? data.nostrPubkey.toLowerCase()
          : null;
      } catch {
        return null;
      }
    },
  });

  // Process zap events into simple counts and totals. Receipt fields are
  // attacker-controlled, so each receipt is validated: the embedded zap
  // request must verify (nip57.validateZapRequest), the bolt11-decoded amount
  // is authoritative and must agree with the amount tags, and — where the
  // author's LNURL nostrPubkey is known — the receipt must be issued by it.
  const { zapCount, totalSats, zaps } = useMemo(() => {
    if (!zapEvents || !Array.isArray(zapEvents) || !actualTarget) {
      return { zapCount: 0, totalSats: 0, zaps: [] };
    }

    let count = 0;
    let sats = 0;
    const validZaps: NostrEvent[] = [];

    zapEvents.forEach(zap => {
      // Receipt issuer must be the author's LNURL server, when known
      if (lnurlNostrPubkey && zap.pubkey.toLowerCase() !== lnurlNostrPubkey) {
        return;
      }

      // The embedded zap request must be present and validly signed.
      // Deliberately NOT nip57.validateZapRequest: it also requires a `relays`
      // tag, which plenty of legitimate zappers omit, and rejecting those
      // would quietly erase real zaps from the total.
      const descriptionTag = zap.tags.find(([name]) => name === 'description')?.[1];
      if (!descriptionTag) return;

      let request: Event;
      try {
        request = JSON.parse(descriptionTag) as Event;
      } catch {
        return;
      }
      if (request.kind !== 9734 || !verifyEvent(request)) return;

      const amountMsat = receiptAmountMsat(zap, request);
      if (amountMsat === null) return;

      count++;
      sats += amountMsat / 1000;
      validZaps.push(zap);
    });

    return { zapCount: count, totalSats: sats, zaps: validZaps };
  }, [zapEvents, actualTarget, lnurlNostrPubkey]);

  const zap = async (amount: number, comment: string) => {
    if (amount <= 0) {
      return;
    }

    setIsZapping(true);
    setInvoice(null); // Clear any previous invoice at the start

    if (!user) {
      toast({
        title: 'Login required',
        description: 'You must be logged in to send a zap.',
        variant: 'destructive',
      });
      setIsZapping(false);
      return;
    }

    if (!actualTarget) {
      toast({
        title: 'Event not found',
        description: 'Could not find the event to zap.',
        variant: 'destructive',
      });
      setIsZapping(false);
      return;
    }

    try {
      if (!author.data || !author.data?.metadata || !author.data?.event ) {
        toast({
          title: 'Author not found',
          description: 'Could not find the author of this item.',
          variant: 'destructive',
        });
        setIsZapping(false);
        return;
      }

      const { lud06, lud16 } = author.data.metadata;
      if (!lud06 && !lud16) {
        toast({
          title: 'Lightning address not found',
          description: 'The author does not have a lightning address configured.',
          variant: 'destructive',
        });
        setIsZapping(false);
        return;
      }

      // Get zap endpoint using the old reliable method
      const zapEndpoint = await nip57.getZapEndpoint(author.data.event);
      if (!zapEndpoint) {
        toast({
          title: 'Zap endpoint not found',
          description: 'Could not find a zap endpoint for the author.',
          variant: 'destructive',
        });
        setIsZapping(false);
        return;
      }

      // Create zap request - use appropriate event format based on kind
      // For addressable events (30000-39999), pass the object to get 'a' tag
      // For all other events, pass the ID string to get 'e' tag
      const event = (actualTarget.kind >= 30000 && actualTarget.kind < 40000)
        ? actualTarget
        : actualTarget.id;

      const zapAmount = amount * 1000; // convert to millisats

      const zapRequest = nip57.makeZapRequest({
        profile: actualTarget.pubkey,
        event: event,
        amount: zapAmount,
        relays: config.relayMetadata.relays.map(r => r.url),
        comment
      });

      // Sign the zap request (but don't publish to relays - only send to LNURL endpoint)
      if (!user.signer) {
        throw new Error('No signer available');
      }
      const signedZapRequest = await user.signer.signEvent(zapRequest);

      try {
        // encodeURIComponent, not encodeURI: a comment containing & = + or #
        // would otherwise break out of the query parameter.
        const res = await fetch(`${zapEndpoint}?amount=${zapAmount}&nostr=${encodeURIComponent(JSON.stringify(signedZapRequest))}`);
            const responseData = await res.json();

            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${responseData.reason || 'Unknown error'}`);
            }

            const newInvoice = responseData.pr;
            if (!newInvoice || typeof newInvoice !== 'string') {
              throw new Error('Lightning service did not return a valid invoice');
            }

            // Get the current active NWC connection dynamically
            const currentNWCConnection = getActiveConnection();

            // Try NWC first when one is configured. `isConnected` is a live
            // probe hint, not a persisted fact — it is false for every
            // connection restored from storage, so gating on it here would
            // skip NWC forever after a reload.
            if (currentNWCConnection && currentNWCConnection.connectionString) {
              try {
                await sendPayment(currentNWCConnection, newInvoice);

                // Clear states immediately on success
                setIsZapping(false);
                setInvoice(null);

                toast({
                  title: 'Zap successful!',
                  description: `You sent ${amount} sats via NWC to the author.`,
                });

                // Invalidate zap queries to refresh counts
                queryClient.invalidateQueries({ queryKey: ['zaps'] });

                // Close dialog last to ensure clean state
                onZapSuccess?.();
                return;
              } catch (nwcError) {
                console.error('NWC payment failed, falling back:', nwcError);

                // Show specific NWC error to user for debugging
                const errorMessage = nwcError instanceof Error ? nwcError.message : 'Unknown NWC error';
                toast({
                  title: 'NWC payment failed',
                  description: `${errorMessage}. Falling back to other payment methods...`,
                  variant: 'destructive',
                });
              }
            }

            if (webln) {  // Try WebLN next
              try {
                // For native WebLN, we may need to enable it first
                let webLnProvider = webln;
                if (webln.enable && typeof webln.enable === 'function') {
                  const enabledProvider = await webln.enable();
                  // Some implementations return the provider, others return void
                  // Cast to WebLNProvider to handle both cases
                  const provider = enabledProvider as WebLNProvider | undefined;
                  if (provider) {
                    webLnProvider = provider;
                  }
                }

                await webLnProvider.sendPayment(newInvoice);

                // Clear states immediately on success
                setIsZapping(false);
                setInvoice(null);

                toast({
                  title: 'Zap successful!',
                  description: `You sent ${amount} sats to the author.`,
                });

                // Invalidate zap queries to refresh counts
                queryClient.invalidateQueries({ queryKey: ['zaps'] });

                // Close dialog last to ensure clean state
                onZapSuccess?.();
              } catch (weblnError) {
                console.error('WebLN payment failed, falling back:', weblnError);

                // Show specific WebLN error to user for debugging
                const errorMessage = weblnError instanceof Error ? weblnError.message : 'Unknown WebLN error';
                toast({
                  title: 'WebLN payment failed',
                  description: `${errorMessage}. Falling back to other payment methods...`,
                  variant: 'destructive',
                });

                setInvoice(newInvoice);
                setIsZapping(false);
              }
            } else { // Default - show QR code and manual Lightning URI
              setInvoice(newInvoice);
              setIsZapping(false);
            }
          } catch (err) {
            console.error('Zap error:', err);
            toast({
              title: 'Zap failed',
              description: (err as Error).message,
              variant: 'destructive',
            });
            setIsZapping(false);
          }
    } catch (err) {
      console.error('Zap error:', err);
      toast({
        title: 'Zap failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
      setIsZapping(false);
    }
  };

  const resetInvoice = useCallback(() => {
    setInvoice(null);
  }, []);

  return {
    zaps,
    zapCount,
    totalSats,
    ...query,
    zap,
    isZapping,
    invoice,
    setInvoice,
    resetInvoice,
  };
}
