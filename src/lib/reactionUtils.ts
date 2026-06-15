/**
 * Pure helpers for NIP-25 (kind 7) reactions, kind-routed by target.
 *
 * The interaction standard is chosen by the TARGET's kind, never assumed:
 * - addressable (36669 journal entry): include an `a` coordinate tag alongside
 *   `e`/`p`/`k` (NIP-25: "if the event being reacted to is an addressable
 *   event, an `a` SHOULD be included together with the `e` tag").
 * - regular (kind 1 tagged note): just `e`/`p`/`k`.
 *
 * Curated reaction set only — 🙏 🌱 ✨. Any other reaction content (`+`, `-`,
 * arbitrary emoji from other clients) is ignored for our counts.
 */

import type { NostrEvent } from '@nostrify/nostrify';

export const CURATED_REACTIONS = ['🙏', '🌱', '✨'] as const;
export type CuratedReaction = (typeof CURATED_REACTIONS)[number];

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

/**
 * Per-emoji reactor counts restricted to the curated set. Counts DISTINCT
 * pubkeys per emoji, so a user double-reacting (or relay resends) counts once.
 */
export function aggregateReactions(
  events: NostrEvent[],
  curated: readonly string[] = CURATED_REACTIONS
): Record<string, number> {
  const reactors: Record<string, Set<string>> = {};
  for (const emoji of curated) reactors[emoji] = new Set();

  for (const event of events) {
    const content = event.content.trim();
    if (reactors[content]) reactors[content].add(event.pubkey);
  }

  const counts: Record<string, number> = {};
  for (const emoji of curated) counts[emoji] = reactors[emoji].size;
  return counts;
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
