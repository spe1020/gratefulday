/**
 * Content filtering for the tagged gratitude feed.
 *
 * Unlike the community journal (validated kind-36669 entries), this feed
 * surfaces arbitrary public kind-1 notes that merely carry a #grateful /
 * #gratefulchain tag — so anyone can inject spam or off-topic content. These
 * are pure, conservative client-side filters: drop replies (shown out of
 * context), empty notes, obvious hashtag-stuffing, and explicitly blocked or
 * user-muted/hidden content. Everything is deterministic and unit-tested.
 */

import type { NostrEvent } from '@nostrify/nostrify';

/** A note carrying more `t` tags than this reads as hashtag-stuffing spam. */
export const MAX_HASHTAGS = 8;

/** Operator block list for specific abusive notes (by event id). */
export const BLOCKED_EVENT_IDS: ReadonlySet<string> = new Set<string>([]);

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * Whether a note is a reply/thread post (NIP-10 `e` tag). The feed shows
 * standalone reflections, so replies — which read as fragments without their
 * parent — are excluded.
 */
export function isReply(event: NostrEvent): boolean {
  return event.tags.some(([name]) => name === 'e');
}

/** Whether the note has any non-whitespace content to render. */
export function hasMeaningfulContent(event: NostrEvent): boolean {
  return event.content.trim().length > 0;
}

/** Whether the note is stuffed with hashtags (a common spam signal). */
export function isHashtagSpam(event: NostrEvent): boolean {
  return event.tags.filter(([name]) => name === 't').length > MAX_HASHTAGS;
}

export interface TaggedFilterOptions {
  /** Authors the user has muted locally. */
  mutedPubkeys?: ReadonlySet<string>;
  /** Individual notes the user has hidden locally. */
  hiddenIds?: ReadonlySet<string>;
}

/**
 * Filter + dedup a flat list of fetched notes for display. Order is preserved
 * (callers pass newest-first), and the first occurrence of each id wins, so
 * relay resends across page boundaries collapse to one card.
 */
export function filterTaggedNotes(
  events: NostrEvent[],
  options: TaggedFilterOptions = {}
): NostrEvent[] {
  const muted = options.mutedPubkeys ?? EMPTY_SET;
  const hidden = options.hiddenIds ?? EMPTY_SET;

  const seen = new Set<string>();
  const out: NostrEvent[] = [];

  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);

    if (BLOCKED_EVENT_IDS.has(event.id)) continue;
    if (hidden.has(event.id)) continue;
    if (muted.has(event.pubkey)) continue;
    if (isReply(event)) continue;
    if (!hasMeaningfulContent(event)) continue;
    if (isHashtagSpam(event)) continue;

    out.push(event);
  }

  return out;
}
