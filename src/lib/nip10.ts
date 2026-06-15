/**
 * NIP-10 (kind-1 text-note threads) helpers — used ONLY for replying to the
 * open-network kind-1 tagged notes. NIP-10 is explicit: "Kind 1 replies MUST
 * NOT be used to reply to other kinds, use NIP-22 instead." So this path is
 * structurally reachable only from TaggedNoteCard; the 36669 journal card uses
 * the NIP-22 (kind 1111) stack instead.
 *
 * The feed only ever shows TOP-LEVEL notes (filterTaggedNotes drops anything
 * with an `e` tag), so every target here is itself a thread root, and a direct
 * reply uses a SINGLE `e` tag marked "root".
 */

import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Tags for a direct kind-1 reply to `root`:
 * - one marked `e`: `["e", root.id, <relay>, "root", root.pubkey]` (NIP-10:
 *   "A direct reply to the root of a thread should have a single marked 'e' tag
 *   of type 'root'.")
 * - `p` tags: all of the root's `p` tags PLUS the root author's pubkey, deduped
 *   (NIP-10: notify thread participants + the author being replied to).
 */
export function buildNip10ReplyTags(root: NostrEvent, relayHint = ''): string[][] {
  const tags: string[][] = [['e', root.id, relayHint, 'root', root.pubkey]];

  const participants = new Set<string>();
  for (const [name, value] of root.tags) {
    if (name === 'p' && value) participants.add(value);
  }
  participants.add(root.pubkey); // the author being replied to

  for (const pubkey of participants) tags.push(['p', pubkey]);
  return tags;
}

/**
 * Whether `event` is a NIP-10 reply to the note `rootId` (vs. a mere mention or
 * quote of it). With the marked scheme, `rootId` must be marked `root`/`reply`
 * (not `mention`); with the legacy positional scheme (no markers), any `e` tag
 * referencing `rootId` counts.
 */
export function isNip10Reply(event: NostrEvent, rootId: string): boolean {
  const eTags = event.tags.filter(([name]) => name === 'e');
  if (eTags.length === 0) return false;

  // A tag uses the marked scheme only if slot 3 is an actual marker word — NOT
  // just any truthy value. The legacy 4-field form `["e", id, relay, pubkey]`
  // puts a pubkey hint in slot 3, which must not be mistaken for a marker (else
  // a legitimate legacy reply gets misclassified as "marked" and rejected).
  const MARKERS = new Set(['root', 'reply', 'mention']);
  const anyMarked = eTags.some((tag) => MARKERS.has(tag[3]));
  if (anyMarked) {
    return eTags.some(
      (tag) => tag[1] === rootId && (tag[3] === 'root' || tag[3] === 'reply')
    );
  }
  // Legacy scheme (positional, or 4-field with a pubkey hint in slot 3): an
  // e-reference to the root is a reply.
  return eTags.some((tag) => tag[1] === rootId);
}
