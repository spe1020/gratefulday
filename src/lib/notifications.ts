/**
 * Pure mapping/grouping for in-app notifications: turn raw interaction events
 * (NIP-25 kind 7 reactions, NIP-57 kind 9735 zap receipts, NIP-22 kind 1111
 * comments, NIP-10 kind 1 replies) that reference the current user's content
 * into typed notification items, drop self-interactions, and group them.
 *
 * Privacy by construction: an item never carries the target note's body — only
 * the actor's PUBLIC payload (reaction emoji / comment text / zap amount) and a
 * generic target descriptor. Nothing here decrypts anything.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { nip57 } from 'nostr-tools';
import { isNip10Reply } from '@/lib/nip10';

export type NotificationType = 'reaction' | 'zap' | 'comment' | 'reply';

export interface NotificationTarget {
  /** The user's content kind: 36669 journal entry (addressable) or kind-1 note. */
  kind: 36669 | 1;
  /** Addressable coordinate (`36669:pubkey:d`) for 36669, or the event id for kind 1. */
  ref: string;
}

export interface NotificationItem {
  /** Source interaction event id (used for dedupe + React keys). */
  id: string;
  type: NotificationType;
  /** Pubkey of whoever interacted (for zaps: the zap-request author, not the receipt). */
  actor: string;
  createdAt: number;
  /**
   * Which of the user's notes was interacted with. Always present for
   * reaction/comment/reply; OPTIONAL for zaps — a zap that names the user as
   * recipient (`#p`) but carries no note reference is a profile zap (still
   * notified, just no note to open).
   */
  target?: NotificationTarget;
  /** Reaction emoji (reaction only). */
  emoji?: string;
  /** Zap amount in sats (zap only). */
  amountSats?: number;
  /** Public comment/reply text, untruncated (comment/reply only). */
  snippet?: string;
}

/** The current user's notifiable content: their pubkey + the ids/coords others reference. */
export interface NotifiableContent {
  pubkey: string;
  /** The user's 36669 coordinates (`36669:pubkey:d`). */
  coords: ReadonlySet<string>;
  /** The user's kind-1 note ids. */
  noteIds: ReadonlySet<string>;
}

function firstTagValue(event: NostrEvent, name: string, allowed: ReadonlySet<string>): string | null {
  for (const [tagName, value] of event.tags) {
    if (tagName === name && value && allowed.has(value)) return value;
  }
  return null;
}

/** The zap-request author (the real actor), parsed from the 9735's `description`. */
export function extractZapActor(receipt: NostrEvent): string | null {
  const description = receipt.tags.find(([name]) => name === 'description')?.[1];
  if (description) {
    try {
      const request = JSON.parse(description);
      if (typeof request?.pubkey === 'string') return request.pubkey;
    } catch {
      // fall through to the P tag
    }
  }
  // NIP-57 optional uppercase P tag carries the sender pubkey.
  return receipt.tags.find(([name]) => name === 'P')?.[1] ?? null;
}

/** Zap amount in sats: amount tag → bolt11 → zap-request amount. Null if unknown. */
export function extractZapAmount(receipt: NostrEvent): number | null {
  const amountTag = receipt.tags.find(([name]) => name === 'amount')?.[1];
  if (amountTag && /^\d+$/.test(amountTag)) return Math.floor(parseInt(amountTag, 10) / 1000);

  const bolt11 = receipt.tags.find(([name]) => name === 'bolt11')?.[1];
  if (bolt11) {
    try {
      return nip57.getSatoshisAmountFromBolt11(bolt11);
    } catch {
      // fall through
    }
  }

  const description = receipt.tags.find(([name]) => name === 'description')?.[1];
  if (description) {
    try {
      const request = JSON.parse(description);
      const reqAmount = request?.tags?.find(([name]: string[]) => name === 'amount')?.[1];
      if (reqAmount && /^\d+$/.test(reqAmount)) return Math.floor(parseInt(reqAmount, 10) / 1000);
    } catch {
      // unknown
    }
  }
  return null;
}

/**
 * STRICT target for reactions/comments/replies: the referenced `#a`/`#A` coord
 * or `#e` id must be one of the user's GATHERED notes — that membership is how
 * we know the interaction is on the user's content.
 */
function contentTarget(event: NostrEvent, content: NotifiableContent): NotificationTarget | null {
  const coord =
    firstTagValue(event, 'a', content.coords) ?? firstTagValue(event, 'A', content.coords);
  if (coord) return { kind: 36669, ref: coord };
  const noteId = firstTagValue(event, 'e', content.noteIds);
  if (noteId) return { kind: 1, ref: noteId };
  return null;
}

/**
 * Target for a zap. A 9735 that `#p`-tags the user is a zap TO the user, so the
 * note it references is theirs by definition — we trust the receipt's `#a`/`#e`
 * regardless of whether it's in the gathered window (a zap must never be missed
 * just because the note aged out of the bounded content set). No reference → a
 * profile zap (undefined target).
 */
function zapTarget(event: NostrEvent): NotificationTarget | undefined {
  const coord = event.tags.find(([name]) => name === 'a')?.[1];
  if (coord) return { kind: 36669, ref: coord };
  const noteId = event.tags.find(([name]) => name === 'e')?.[1];
  if (noteId) return { kind: 1, ref: noteId };
  return undefined;
}

/**
 * Map one interaction event → a notification item, or null if it doesn't apply
 * (not on the user's content, or the user's own interaction).
 */
export function mapEventToNotification(
  event: NostrEvent,
  content: NotifiableContent
): NotificationItem | null {
  const base = { id: event.id, createdAt: event.created_at };

  switch (event.kind) {
    case 7: {
      const target = contentTarget(event, content);
      if (!target || event.pubkey === content.pubkey) return null; // not mine / self
      return { ...base, type: 'reaction', actor: event.pubkey, target, emoji: event.content.trim() };
    }
    case 9735: {
      // Scoped by #p = the user (zaps name their recipient), so completeness for
      // zaps doesn't depend on the gathered content window.
      const recipient = event.tags.find(([name]) => name === 'p')?.[1];
      if (recipient !== content.pubkey) return null; // not a zap to me
      const actor = extractZapActor(event);
      if (!actor || actor === content.pubkey) return null; // unknown or self-zap
      return {
        ...base,
        type: 'zap',
        actor,
        target: zapTarget(event),
        amountSats: extractZapAmount(event) ?? undefined,
      };
    }
    case 1111: {
      const target = contentTarget(event, content);
      if (!target || event.pubkey === content.pubkey) return null; // not mine / self
      return { ...base, type: 'comment', actor: event.pubkey, target, snippet: event.content };
    }
    case 1: {
      // A kind-1 referencing my note is a reply only if it's a real NIP-10 reply
      // (not a mention/quote), and not my own.
      const target = contentTarget(event, content);
      if (!target || target.kind !== 1 || event.pubkey === content.pubkey) return null;
      if (!isNip10Reply(event, target.ref)) return null;
      return { ...base, type: 'reply', actor: event.pubkey, target, snippet: event.content };
    }
    default:
      return null;
  }
}

/** Map + dedupe (by event id) + drop nulls + sort newest-first. */
export function buildNotifications(
  events: NostrEvent[],
  content: NotifiableContent
): NotificationItem[] {
  const seen = new Set<string>();
  const items: NotificationItem[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const item = mapEventToNotification(event, content);
    if (item) items.push(item);
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

/** Count of items newer than the last-seen timestamp (unread). */
export function unreadCount(items: NotificationItem[], lastSeen: number | undefined): number {
  const since = lastSeen ?? 0;
  return items.filter((item) => item.createdAt > since).length;
}

export interface NotificationGroup {
  key: string;
  type: NotificationType;
  /** Undefined for a profile-zap group (no note). */
  target?: NotificationTarget;
  /** Members, newest-first. Reactions/zaps on one target collapse here; comments/replies are singletons. */
  items: NotificationItem[];
  /** Distinct actor pubkeys, newest-first by their interaction. */
  actors: string[];
  /** Newest interaction time in the group (used for sorting + unread). */
  latestAt: number;
}

/**
 * Group for display: reactions and zaps on the SAME target collapse into one
 * row ("Alice +3 reacted to your entry"); comments and replies stay individual
 * (distinct content). Groups are newest-first. Input should be newest-first.
 */
export function groupNotifications(items: NotificationItem[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();

  for (const item of items) {
    const collapsible = item.type === 'reaction' || item.type === 'zap';
    // Profile zaps (no target) collapse together under a "profile" bucket.
    const key = collapsible ? `${item.type}:${item.target?.ref ?? 'profile'}` : item.id;

    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      if (!existing.actors.includes(item.actor)) existing.actors.push(item.actor);
      existing.latestAt = Math.max(existing.latestAt, item.createdAt);
    } else {
      groups.set(key, {
        key,
        type: item.type,
        target: item.target,
        items: [item],
        actors: [item.actor],
        latestAt: item.createdAt,
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.latestAt - a.latestAt);
}
