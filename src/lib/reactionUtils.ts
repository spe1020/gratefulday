/**
 * Pure helpers for NIP-25 (kind 7) reactions, kind-routed by target.
 *
 * The interaction standard is chosen by the TARGET's kind, never assumed:
 * - addressable (36669 journal entry): include an `a` coordinate tag alongside
 *   `e`/`p`/`k` (NIP-25: "if the event being reacted to is an addressable
 *   event, an `a` SHOULD be included together with the `e` tag").
 * - regular (kind 1 tagged note): just `e`/`p`/`k`.
 *
 * Sending is curated-only (see CURATED_REACTIONS). Reading is interoperable:
 * non-curated reactions from the wider network are rolled up into `otherCount`
 * (not dropped), so a note popular in other clients doesn't look unreacted here.
 */

import type { NostrEvent } from '@nostrify/nostrify';

export interface CuratedReaction {
  /** The Unicode emoji sent as the kind-7 reaction `content`. */
  emoji: string;
  /** Human label for aria-text / tooltip. */
  label: string;
}

/**
 * The curated reaction set — THE single source of truth. ReactionBar renders
 * from it, the send path validates against it, and aggregateReactions keys on
 * it. Changing the set is a one-line edit here.
 *
 * 🫂 is the people-hugging emoji (NOT 🤗, the single hugging face, which renders
 * inconsistently). ❤️ carries the U+FE0F variation selector; matching normalizes
 * it away so a bare ❤ from another client still counts as a heart.
 */
export const CURATED_REACTIONS: readonly CuratedReaction[] = [
  { emoji: '🙏', label: 'Gratitude' },
  { emoji: '🌱', label: 'Growth' },
  { emoji: '✨', label: 'Delight' },
  { emoji: '🫂', label: 'Hug' },
  { emoji: '❤️', label: 'Love' },
];

/** Just the emoji, in order — the keys aggregateReactions and own-detection use. */
export const CURATED_EMOJIS: readonly string[] = CURATED_REACTIONS.map((r) => r.emoji);

/** Addressable (parameterized replaceable) kinds: 30000–39999. */
export function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

/** The `a` coordinate `kind:pubkey:d` for an addressable target. */
export function addressableCoordinate(target: NostrEvent): string {
  const d = target.tags.find(([name]) => name === 'd')?.[1] ?? '';
  return `${target.kind}:${target.pubkey}:${d}`;
}

/**
 * NIP-25 tags for a kind-7 reaction to `target`. The single `e` tag carries the
 * target id (last, per spec) with the author pubkey hint; addressable targets
 * additionally get the `a` coordinate "together with the `e` tag". The emoji
 * itself is the reaction's `content` (not a tag), so it isn't passed here.
 */
export function buildReactionTags(target: NostrEvent): string[][] {
  const tags: string[][] = [['e', target.id, '', target.pubkey]];
  if (isAddressable(target.kind)) {
    tags.push(['a', addressableCoordinate(target)]);
  }
  tags.push(['p', target.pubkey]);
  tags.push(['k', String(target.kind)]);
  return tags;
}

export interface ReactionTotals {
  /** Per-curated-emoji distinct-reactor counts, keyed by the display emoji. */
  counts: Record<string, number>;
  /**
   * Distinct reactors whose reaction is OUTSIDE the curated set — a single
   * rolled-up bucket for the wider network's reactions (👍/🤙/😂/etc.). Display-
   * only; surfacing it keeps open-network notes from looking unreacted when
   * they're popular in other clients.
   */
  otherCount: number;
}

/** Strip the U+FE0F variation selector so ❤ and ❤️ compare equal. */
function normalizeReaction(content: string): string {
  return content.trim().replace(/\uFE0F/g, '');
}

/**
 * Aggregate kind-7 reactions for one target. Distinct pubkeys per curated emoji
 * (a user double-reacting or relay resends count once), plus an `otherCount`
 * rollup of distinct reactors outside the curated set.
 *
 * NIP-25 content normalization: `-` (dislike) is ignored; `+`/empty (a generic
 * like) and any non-curated emoji fold into the `otherCount` rollup — we never
 * silently recolor a generic like as our ❤️.
 */
export function aggregateReactions(
  events: NostrEvent[],
  curated: readonly string[] = CURATED_EMOJIS
): ReactionTotals {
  const displayByNorm = new Map<string, string>();
  const reactors: Record<string, Set<string>> = {};
  for (const emoji of curated) {
    reactors[emoji] = new Set();
    displayByNorm.set(normalizeReaction(emoji), emoji);
  }
  const others = new Set<string>();

  for (const event of events) {
    if (event.content.trim() === '-') continue; // dislike — not surfaced
    const display = displayByNorm.get(normalizeReaction(event.content));
    if (display) reactors[display].add(event.pubkey);
    else others.add(event.pubkey); // '+'/empty/foreign emoji → network rollup
  }

  const counts: Record<string, number> = {};
  for (const emoji of curated) counts[emoji] = reactors[emoji].size;
  return { counts, otherCount: others.size };
}

/**
 * The user's own kind-7 event for `emoji`, if any — returned (not just a bool)
 * so the caller can reference its id in a NIP-09 delete to un-react. The newest
 * is returned when there are duplicates.
 */
export function findOwnReaction(
  events: NostrEvent[],
  pubkey: string,
  emoji: string
): NostrEvent | undefined {
  return events
    .filter((e) => e.pubkey === pubkey && e.content.trim() === emoji)
    .sort((a, b) => b.created_at - a.created_at)[0];
}
