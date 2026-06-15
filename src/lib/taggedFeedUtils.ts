/**
 * Content filtering for the tagged gratitude feed.
 *
 * Unlike the community journal (validated kind-36669 entries), this feed
 * surfaces arbitrary public kind-1 notes carrying a gratitude tag — so anyone
 * can inject spam or off-topic content. These are pure, conservative client-
 * side filters: drop empty notes, obvious hashtag-stuffing, and explicitly
 * blocked or user-muted/hidden content. Replies are dropped UNLESS they carry a
 * gratitude tag themselves ("gratitude in conversation" — they qualify on the
 * same tag set as roots). Everything is deterministic and unit-tested.
 */

import type { NostrEvent } from '@nostrify/nostrify';

/**
 * The gratitude hashtags the feed surfaces — THE single source of truth for
 * both root and reply qualification (so they can't drift when a tag is added).
 * `useTaggedGratitude` imports this for its relay query.
 */
export const TAGGED_HASHTAGS = [
  'grateful',
  'gratefulchain',
  'thankful',
  'blessed',
  'faithstr',
  'biblestr',
] as const;

const GRATITUDE_TAG_SET: ReadonlySet<string> = new Set(TAGGED_HASHTAGS);

/** A note carrying more `t` tags than this reads as hashtag-stuffing spam. */
export const MAX_HASHTAGS = 8;

/** Operator block list for specific abusive notes (by event id). */
export const BLOCKED_EVENT_IDS: ReadonlySet<string> = new Set<string>([]);

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * Whether a note is a reply/thread post (NIP-10 `e` tag). A reply is shown only
 * if it carries a gratitude tag of its own (see `hasReplyGratitudeTag`); an
 * untagged reply reads as a fragment without its parent and is dropped.
 */
export function isReply(event: NostrEvent): boolean {
  return event.tags.some(([name]) => name === 'e');
}

/**
 * Whether a note carries one of the gratitude hashtags — the SAME set used for
 * root qualification, so a #thankful reply is treated like a #thankful root
 * ("gratitude in conversation" applies across all the tags equally).
 */
export function hasReplyGratitudeTag(event: NostrEvent): boolean {
  return event.tags.some(([name, value]) => name === 't' && GRATITUDE_TAG_SET.has(value));
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
    // Replies are allowed through ONLY if they carry a gratitude tag themselves
    // (gratitude expressed in conversation); untagged replies still drop.
    if (isReply(event) && !hasReplyGratitudeTag(event)) continue;
    if (!hasMeaningfulContent(event)) continue;
    if (isHashtagSpam(event)) continue;

    out.push(event);
  }

  return out;
}
