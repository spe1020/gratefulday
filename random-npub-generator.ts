/**
 * Random NPUB Generator
 * 
 * A utility for selecting random Nostr pubkeys from active users with lightning addresses.
 * Includes bot detection to identify and categorize bot accounts.
 * 
 * Usage:
 *   import { RandomNpubGenerator } from './random-npub-generator';
 *   const generator = new RandomNpubGenerator(nostrInstance, currentUserPubkey);
 *   const recipient = await generator.selectRandomRecipient();
 */

import type { Nostr } from '@nostrify/nostrify';

export interface RecipientInfo {
  pubkey: string;
  npub: string;
  lightningAddress?: string;
  nip05?: string;
  isBot: boolean;
}

export interface GeneratorStats {
  totalPubkeys: number;
  withLightning: number;
  withoutLightning: number;
  bots: number;
  humans: number;
}

/**
 * Check if a profile is a bot by looking for "bot" or "news" in nip05 or lightning address
 * Accounts with "news" in NIP-05 are treated as bots
 */
export function isBot(nip05?: string, lightningAddress?: string): boolean {
  const nip05Lower = nip05?.toLowerCase() || '';
  const lightningLower = lightningAddress?.toLowerCase() || '';
  return (
    nip05Lower.includes('bot') ||
    nip05Lower.includes('news') ||
    lightningLower.includes('bot')
  );
}

/**
 * Random NPUB Generator class
 * 
 * Selects random Nostr pubkeys from active users, filtering for those with lightning addresses
 * and identifying bot accounts.
 */
export class RandomNpubGenerator {
  private nostr: Nostr;
  private currentUserPubkey?: string;

  constructor(nostr: Nostr, currentUserPubkey?: string) {
    this.nostr = nostr;
    this.currentUserPubkey = currentUserPubkey;
  }

  /**
   * Select a random active Nostr pubkey with lightning address
   * Queries for random active users from recent events and verifies they have lightning addresses
   * 
   * @param limit - Number of recent events to query (default: 50)
   * @param timeout - Query timeout in milliseconds (default: 5000)
   * @returns Selected pubkey or null if none found
   */
  async selectRandomRecipient(
    limit: number = 50,
    timeout: number = 5000
  ): Promise<string | null> {
    try {
      // Query for recent kind 1 events
      const signal = AbortSignal.timeout(timeout);
      const recentEvents = await this.nostr.query(
        [{ kinds: [1], limit }],
        { signal }
      );

      if (recentEvents.length === 0) {
        return null;
      }

      // Get unique pubkeys from recent events
      const pubkeys = Array.from(
        new Set(recentEvents.map((e) => e.pubkey))
      ).filter((pk) => pk !== this.currentUserPubkey); // Exclude current user

      if (pubkeys.length === 0) {
        return null;
      }

      // Check each pubkey for lightning address
      const pubkeysWithLightning: string[] = [];

      // Batch fetch profiles
      const profileSignal = AbortSignal.timeout(timeout);
      const profileEvents = await this.nostr.query(
        [{ kinds: [0], authors: pubkeys, limit: pubkeys.length }],
        { signal: profileSignal }
      );

      // Create a map of pubkey -> profile event
      const profileMap = new Map<string, typeof profileEvents[0]>();
      profileEvents.forEach((event) => {
        profileMap.set(event.pubkey, event);
      });

      // Check each pubkey for lightning address
      for (const pubkey of pubkeys) {
        const profileEvent = profileMap.get(pubkey);
        if (!profileEvent) {
          continue; // Skip if no profile found
        }

        try {
          const profileData = JSON.parse(profileEvent.content);
          const lightningAddress = profileData.lud16 || profileData.lud06;

          if (lightningAddress) {
            pubkeysWithLightning.push(pubkey);
          }
        } catch {
          // Invalid profile JSON, skip
          continue;
        }
      }

      if (pubkeysWithLightning.length === 0) {
        return null;
      }

      // Select random pubkey from those with lightning addresses
      const randomIndex = Math.floor(Math.random() * pubkeysWithLightning.length);
      return pubkeysWithLightning[randomIndex];
    } catch (error) {
      console.error('Error selecting random recipient:', error);
      return null;
    }
  }

  /**
   * Get detailed information about all eligible recipients
   * 
   * @param limit - Number of recent events to query (default: 50)
   * @param timeout - Query timeout in milliseconds (default: 10000)
   * @returns Array of recipient info and statistics
   */
  async getRecipientsWithDetails(
    limit: number = 50,
    timeout: number = 10000
  ): Promise<{
    recipients: RecipientInfo[];
    stats: GeneratorStats;
  }> {
    try {
      // Query for recent kind 1 events
      const signal = AbortSignal.timeout(timeout);
      const recentEvents = await this.nostr.query(
        [{ kinds: [1], limit }],
        { signal }
      );

      if (recentEvents.length === 0) {
        return {
          recipients: [],
          stats: {
            totalPubkeys: 0,
            withLightning: 0,
            withoutLightning: 0,
            bots: 0,
            humans: 0,
          },
        };
      }

      // Get unique pubkeys from recent events
      const pubkeys = Array.from(
        new Set(recentEvents.map((e) => e.pubkey))
      ).filter((pk) => pk !== this.currentUserPubkey);

      if (pubkeys.length === 0) {
        return {
          recipients: [],
          stats: {
            totalPubkeys: 0,
            withLightning: 0,
            withoutLightning: 0,
            bots: 0,
            humans: 0,
          },
        };
      }

      // Batch fetch profiles
      const profileSignal = AbortSignal.timeout(timeout);
      const profileEvents = await this.nostr.query(
        [{ kinds: [0], authors: pubkeys, limit: pubkeys.length }],
        { signal: profileSignal }
      );

      // Create a map of pubkey -> profile event
      const profileMap = new Map<string, typeof profileEvents[0]>();
      profileEvents.forEach((event) => {
        profileMap.set(event.pubkey, event);
      });

      const recipients: RecipientInfo[] = [];
      const recipientsWithoutLightning: string[] = [];

      // Process each pubkey
      for (const pubkey of pubkeys) {
        const profileEvent = profileMap.get(pubkey);
        if (!profileEvent) {
          recipientsWithoutLightning.push(pubkey);
          continue;
        }

        try {
          const profileData = JSON.parse(profileEvent.content);
          const lightningAddress = profileData.lud16 || profileData.lud06;
          const nip05 = profileData.nip05;

          if (lightningAddress) {
            const botStatus = isBot(nip05, lightningAddress);
            recipients.push({
              pubkey,
              npub: '', // Will be encoded by caller if needed
              lightningAddress,
              nip05,
              isBot: botStatus,
            });
          } else {
            recipientsWithoutLightning.push(pubkey);
          }
        } catch {
          // Invalid profile JSON
          recipientsWithoutLightning.push(pubkey);
        }
      }

      const bots = recipients.filter((r) => r.isBot).length;
      const humans = recipients.filter((r) => !r.isBot).length;

      return {
        recipients,
        stats: {
          totalPubkeys: pubkeys.length,
          withLightning: recipients.length,
          withoutLightning: recipientsWithoutLightning.length,
          bots,
          humans,
        },
      };
    } catch (error) {
      console.error('Error getting recipients with details:', error);
      return {
        recipients: [],
        stats: {
          totalPubkeys: 0,
          withLightning: 0,
          withoutLightning: 0,
          bots: 0,
          humans: 0,
        },
      };
    }
  }
}

/**
 * Helper function to encode pubkey to npub format
 * Requires: import { nip19 } from 'nostr-tools';
 */
export function encodeNpub(_pubkey: string): string {
  // This requires nostr-tools - included as a comment for reference
  // import { nip19 } from 'nostr-tools';
  // return nip19.npubEncode(pubkey);
  throw new Error('nip19 encoding not included. Import from nostr-tools: import { nip19 } from "nostr-tools"; nip19.npubEncode(pubkey)');
}

