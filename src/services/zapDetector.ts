/**
 * Zap Detector Service
 * 
 * Queries multiple relays for zap receipts, filters for valid zaps (> 10 sats),
 * and randomly selects a zapper npub.
 */

import { Relay } from 'nostr-tools/relay';
import { nip57, nip19 } from 'nostr-tools';
import type { Event } from 'nostr-tools';

// Three relays to query in parallel
const RELAYS = [
  'wss://relay.nostr.band',
  'wss://relay.damus.io',
  'wss://nos.lol',
];

interface ZapDetectorResult {
  zapperNpub: string;
  zapperPubkey: string;
  amount: number;
}

/**
 * Query a single relay for zap receipts
 */
async function queryRelay(relayUrl: string, since: number, limit = 1000): Promise<{ relay: string; events: Event[]; success: boolean }> {
  return new Promise((resolve) => {
    const zapReceipts: Event[] = [];
    let relay: any = null;
    let sub: any = null;
    let timeoutId: NodeJS.Timeout | null = null;

    Relay.connect(relayUrl)
      .then((r) => {
        relay = r;
        sub = relay.subscribe(
          [
            {
              kinds: [9735], // Zap receipt
              since,
              limit,
            },
          ],
          {
            onevent(event: Event) {
              zapReceipts.push(event);
            },
            oneose() {
              if (timeoutId) clearTimeout(timeoutId);
              // Don't close relay here - let it close naturally or on timeout
              // Closing here can cause race conditions
              resolve({ relay: relayUrl, events: zapReceipts, success: true });
            },
          }
        );

        // Timeout after 15 seconds per relay
        timeoutId = setTimeout(() => {
          try {
            if (sub) {
              sub.close();
            }
            // Let relay close naturally - don't force close to avoid WebSocket errors
          } catch (error) {
            console.debug('[ZapDetector] Error on timeout:', error);
          }
          resolve({ relay: relayUrl, events: zapReceipts, success: false });
        }, 15000);
      })
      .catch(() => {
        resolve({ relay: relayUrl, events: [], success: false });
      });
  });
}

/**
 * Select a random zapper from recent zap receipts
 * @param hoursBack - How many hours back to look (default: 7)
 * @param excludePubkeys - Pubkeys to exclude from selection
 * @returns Randomly selected zapper npub and pubkey, or null if none found
 */
export async function selectRandomZapper(
  hoursBack: number = 7,
  excludePubkeys: string[] = []
): Promise<ZapDetectorResult | null> {
  try {
    const since = Math.floor(Date.now() / 1000) - (hoursBack * 60 * 60);
    const excludeSet = new Set(excludePubkeys);

    console.log(`[ZapDetector] Querying ${RELAYS.length} relays for zaps from last ${hoursBack} hours...`);

    // Query all relays in parallel
    const relayResults = await Promise.all(
      RELAYS.map(relayUrl => queryRelay(relayUrl, since))
    );

    // Combine all events from all relays
    const allEvents: Event[] = [];
    relayResults.forEach((result) => {
      allEvents.push(...result.events);
    });

    console.log(`[ZapDetector] Total events from all relays: ${allEvents.length}`);

    // Deduplicate by event ID
    const eventMap = new Map<string, Event>();
    allEvents.forEach(event => {
      if (!eventMap.has(event.id)) {
        eventMap.set(event.id, event);
      }
    });

    const uniqueEvents = Array.from(eventMap.values());
    console.log(`[ZapDetector] Unique events after deduplication: ${uniqueEvents.length}`);

    // Process zaps
    const processedZaps: ZapDetectorResult[] = [];
    
    for (const event of uniqueEvents) {
      const bolt11Tag = event.tags.find(t => t[0] === 'bolt11');
      const descriptionTag = event.tags.find(t => t[0] === 'description');
      const eTag = event.tags.find(t => t[0] === 'e');
      const aTag = event.tags.find(t => t[0] === 'a');
      
      // Must have event or addressable event reference
      if (!eTag && !aTag) continue;
      
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
      
      let zapEvent: any = null;
      if (descriptionTag && descriptionTag[1]) {
        try {
          zapEvent = JSON.parse(descriptionTag[1]);
        } catch {
          // Ignore parse errors
        }
      }
      
      const zapperPubkey = zapEvent?.pubkey;
      if (!zapperPubkey || excludeSet.has(zapperPubkey)) {
        continue;
      }
      
      // Encode pubkey to npub format
      let zapperNpub: string;
      try {
        zapperNpub = nip19.npubEncode(zapperPubkey);
      } catch {
        // If encoding fails, skip
        continue;
      }
      
      processedZaps.push({
        zapperNpub,
        zapperPubkey,
        amount,
      });
    }
    
    if (processedZaps.length === 0) {
      console.log('[ZapDetector] No valid zappers found');
      return null;
    }
    
    // Shuffle array using Fisher-Yates algorithm
    for (let i = processedZaps.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [processedZaps[i], processedZaps[j]] = [processedZaps[j], processedZaps[i]];
    }
    
    // Select first one (already randomized)
    const selected = processedZaps[0];
    console.log(`[ZapDetector] Selected zapper: ${selected.zapperNpub.substring(0, 16)}... (${selected.amount} sats)`);
    
    return selected;
  } catch (error) {
    console.error('[ZapDetector] Error selecting random zapper:', error);
    return null;
  }
}

