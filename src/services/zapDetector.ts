/**
 * Zap Detector Service
 *
 * Queries the app's relay pool for zap receipts, filters for valid zaps
 * (> 10 sats), and randomly selects a zapper npub.
 *
 * Kind-9735 receipts are forgeable: anyone can sign a "receipt" whose
 * description names themselves as the zapper and get paid real sats by the
 * gift feature. Every candidate is therefore validated before selection:
 * the receipt signature must verify, the embedded zap request must pass
 * `nip57.validateZapRequest` (which verifies its own signature), and — where
 * obtainable — the receipt issuer must match the zapped user's LNURL
 * `nostrPubkey`.
 */

import { nip57, nip19, verifyEvent } from 'nostr-tools';
import type { Event } from 'nostr-tools';

/**
 * Minimal structural view of the app's NPool — pass `nostr` from `useNostr()`
 * so queries route through the user's configured relays instead of a
 * hardcoded list.
 */
export interface ZapDetectorPool {
  query(
    filters: { kinds: number[]; authors?: string[]; since?: number; limit?: number }[],
    opts?: { signal?: AbortSignal },
  ): Promise<Event[]>;
}

interface ZapDetectorResult {
  zapperNpub: string;
  zapperPubkey: string;
  amount: number;
}

interface ZapCandidate extends ZapDetectorResult {
  receipt: Event;
  description: string;
  recipientPubkey?: string;
}

// How many shuffled candidates to fully validate before giving up. Each
// validation can cost a profile query + an LNURL fetch, so it must be bounded.
const MAX_VALIDATION_ATTEMPTS = 8;

/** Resolve a lud16 lightning address to its LNURL-pay metadata URL. */
function lud16ToUrl(lud16: string): string | null {
  const [name, domain] = lud16.split('@');
  if (!name || !domain) return null;
  return `https://${domain}/.well-known/lnurlp/${name}`;
}

/**
 * Verify the receipt issuer against the zapped user's LNURL `nostrPubkey`.
 * Returns false only on a definitive mismatch; "unobtainable" (no profile, no
 * lud16, fetch failure, server without nostrPubkey) passes — the signature
 * checks have already run at that point.
 */
async function receiptIssuerMatchesLnurl(
  pool: ZapDetectorPool,
  candidate: ZapCandidate,
): Promise<boolean> {
  const { recipientPubkey, receipt } = candidate;
  if (!recipientPubkey) return true;

  try {
    const profiles = await pool.query(
      [{ kinds: [0], authors: [recipientPubkey], limit: 1 }],
      { signal: AbortSignal.timeout(3000) },
    );
    const profile = profiles[0];
    if (!profile) return true;

    const metadata = JSON.parse(profile.content) as { lud16?: string };
    if (!metadata.lud16) return true; // lud06 decoding not supported — treat as unobtainable

    const url = lud16ToUrl(metadata.lud16);
    if (!url) return true;

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return true;
    const lnurlData = (await res.json()) as { allowsNostr?: boolean; nostrPubkey?: string };
    if (!lnurlData.allowsNostr || !lnurlData.nostrPubkey) return true;

    // Hex comparison must be case-insensitive — some LNURL servers return
    // uppercase, which would reject every one of their receipts.
    return lnurlData.nostrPubkey.toLowerCase() === receipt.pubkey.toLowerCase();
  } catch {
    return true;
  }
}

/** Full validation of a candidate receipt; drops forgeries. */
async function validateCandidate(pool: ZapDetectorPool, candidate: ZapCandidate): Promise<boolean> {
  try {
    // Receipt itself must be validly signed
    if (!verifyEvent(candidate.receipt)) return false;

    // Embedded zap request must be a signature-verified kind 9734.
    // Deliberately NOT nip57.validateZapRequest — it also demands a `relays`
    // tag that many legitimate zappers omit, which would shrink the candidate
    // pool to nothing.
    const request = JSON.parse(candidate.description) as Event;
    if (request.kind !== 9734 || !verifyEvent(request)) return false;

    return await receiptIssuerMatchesLnurl(pool, candidate);
  } catch {
    return false;
  }
}

/**
 * Select a random zapper from recent zap receipts
 * @param pool - The app's relay pool (`nostr` from `useNostr()`)
 * @param hoursBack - How many hours back to look (default: 7)
 * @param excludePubkeys - Pubkeys to exclude from selection
 * @returns Randomly selected zapper npub and pubkey, or null if none found
 */
export async function selectRandomZapper(
  pool: ZapDetectorPool,
  hoursBack: number = 7,
  excludePubkeys: string[] = [],
): Promise<ZapDetectorResult | null> {
  try {
    const since = Math.floor(Date.now() / 1000) - (hoursBack * 60 * 60);
    const excludeSet = new Set(excludePubkeys);

    let events: Event[] = [];
    try {
      events = await pool.query(
        [{ kinds: [9735], since, limit: 1000 }],
        { signal: AbortSignal.timeout(15000) },
      );
    } catch {
      // Timeout with partial/no results — proceed with whatever arrived
    }

    // Deduplicate by event ID
    const eventMap = new Map<string, Event>();
    events.forEach(event => {
      if (!eventMap.has(event.id)) {
        eventMap.set(event.id, event);
      }
    });

    const uniqueEvents = Array.from(eventMap.values());

    // Cheap structural filtering first; expensive signature/LNURL validation
    // runs only on the shuffled candidates actually considered.
    const candidates: ZapCandidate[] = [];

    for (const event of uniqueEvents) {
      const bolt11Tag = event.tags.find(t => t[0] === 'bolt11');
      const descriptionTag = event.tags.find(t => t[0] === 'description');
      const eTag = event.tags.find(t => t[0] === 'e');
      const aTag = event.tags.find(t => t[0] === 'a');
      const pTag = event.tags.find(t => t[0] === 'p');

      // Must have event or addressable event reference
      if (!eTag && !aTag) continue;
      if (!descriptionTag || !descriptionTag[1]) continue;

      let amount = 0;
      if (bolt11Tag && bolt11Tag[1]) {
        try {
          // Use nostr-tools' browser-compatible function
          amount = nip57.getSatoshisAmountFromBolt11(bolt11Tag[1]);
        } catch {
          // Ignore decode errors
        }
      }

      // Must be > 10 sats
      if (amount <= 10) continue;

      let zapperPubkey: string | undefined;
      try {
        zapperPubkey = (JSON.parse(descriptionTag[1]) as { pubkey?: string }).pubkey;
      } catch {
        continue;
      }
      if (!zapperPubkey || excludeSet.has(zapperPubkey)) continue;

      let zapperNpub: string;
      try {
        zapperNpub = nip19.npubEncode(zapperPubkey);
      } catch {
        continue;
      }

      candidates.push({
        zapperNpub,
        zapperPubkey,
        amount,
        receipt: event,
        description: descriptionTag[1],
        recipientPubkey: pTag?.[1],
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    // Shuffle array using Fisher-Yates algorithm
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // Walk the shuffled list until a candidate survives full validation
    for (const candidate of candidates.slice(0, MAX_VALIDATION_ATTEMPTS)) {
      if (await validateCandidate(pool, candidate)) {
        return {
          zapperNpub: candidate.zapperNpub,
          zapperPubkey: candidate.zapperPubkey,
          amount: candidate.amount,
        };
      }
    }

    return null;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[ZapDetector] Error selecting random zapper:', error);
    }
    return null;
  }
}
