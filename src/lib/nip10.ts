/**
 * NIP-10 (kind-1 text-note threads) helpers — used ONLY for replying to the
 * open-network kind-1 tagged notes. NIP-10 is explicit: "Kind 1 replies MUST
 * NOT be used to reply to other kinds, use NIP-22 instead." So this path is
 * structurally reachable only from TaggedNoteCard; the 36669 journal card uses
 * the NIP-22 (kind 1111) stack instead.
 *
 * The feed now surfaces gratitude-tagged REPLIES too, so a target here may be a
 * root OR a reply. `resolveThreadRoot` tells them apart, and the composer emits
 * a single "root" marker for a root target but "root" + "reply" markers for a
 * reply target (see buildNip10ReplyTags).
 */

import type { NostrEvent } from '@nostrify/nostrify';

const MARKERS: ReadonlySet<string> = new Set(['root', 'reply', 'mention']);

export interface ThreadRoot {
  /** Event id of the thread root. */
  id: string;
  /** Root author pubkey hint, if the `e` tag carried one (slot 4). */
  pubkey?: string;
  /** Relay hint, if the `e` tag carried one (slot 2). */
  relayHint?: string;
}

/**
 * The thread root of a kind-1 note, from its NIP-10 `e` tags, or null if the
 * note is itself a root (no `e` tags). Priority: `root` marker → `reply` marker
 * (a reply-only note's parent is effectively the root) → positional (the FIRST
 * `e` tag is the root in the legacy unmarked scheme). Pure + testable.
 */
export function resolveThreadRoot(note: NostrEvent): ThreadRoot | null {
  const es = note.tags.filter(([name]) => name === 'e');
  if (es.length === 0) return null;

  const anyMarked = es.some((tag) => MARKERS.has(tag[3]));
  if (anyMarked) {
    const root = es.find((tag) => tag[3] === 'root') ?? es.find((tag) => tag[3] === 'reply');
    if (!root) return null; // only mentions — not a reply to anything
    return { id: root[1], relayHint: root[2] || undefined, pubkey: root[4] || undefined };
  }

  // Legacy positional/unmarked: the FIRST `e` tag is the root (slot 3 may be a
  // pubkey hint in the 4-field form).
  const first = es[0];
  return { id: first[1], relayHint: first[2] || undefined, pubkey: first[3] || undefined };
}

/** An `e` tag with the author pubkey hint only when known (pubkey slot is optional). */
function eTag(id: string, relay: string, marker: string, pubkey?: string): string[] {
  return pubkey ? ['e', id, relay, marker, pubkey] : ['e', id, relay, marker];
}

/**
 * Tags for a kind-1 reply to `target`. The target may itself be a reply now
 * that gratitude-tagged replies appear in the feed, so the markers depend on
 * the target's own shape (resolved via `resolveThreadRoot`):
 *
 * - target is a ROOT → a single `e` marked "root" (NIP-10: "A direct reply to
 *   the root should have a single marked 'e' tag of type 'root'.").
 * - target is itself a REPLY → TWO `e` tags: "root" → the thread root (so the
 *   new reply stays under the same thread in other clients), "reply" → the
 *   immediate target.
 *
 * `p` tags union the whole chain: the target's `p` tags + the target author +
 * the thread root author (deduped) — NIP-10: notify everyone involved.
 */
export function buildNip10ReplyTags(target: NostrEvent, relayHint = ''): string[][] {
  const threadRoot = resolveThreadRoot(target);
  const tags: string[][] = [];

  if (threadRoot) {
    tags.push(eTag(threadRoot.id, threadRoot.relayHint ?? '', 'root', threadRoot.pubkey));
    tags.push(eTag(target.id, relayHint, 'reply', target.pubkey));
  } else {
    tags.push(eTag(target.id, relayHint, 'root', target.pubkey));
  }

  const participants = new Set<string>();
  for (const [name, value] of target.tags) {
    if (name === 'p' && value) participants.add(value);
  }
  participants.add(target.pubkey); // the author being replied to
  if (threadRoot?.pubkey) participants.add(threadRoot.pubkey); // the root author

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
