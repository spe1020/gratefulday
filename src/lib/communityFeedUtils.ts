/**
 * Merge the two community sources into one interleaved, newest-first feed.
 *
 * - `entries36669`: app-native journal entries. Already validated, encrypted-
 *   excluded, tombstone-filtered and deduped by `pubkey+d` upstream
 *   (`useCommunityGratitude`). NOT subject to the kind-1 mute/hide path — these
 *   are first-party content, moderated at the source.
 * - `taggedNotes`: arbitrary public kind-1 notes from across Nostr. Run through
 *   `filterTaggedNotes` (drops replies/empty/spam, applies the viewer's local
 *   hide/mute, dedups by id).
 *
 * Each event keeps its `kind`, so the renderer routes 36669 → GratitudeNoteCard
 * and kind 1 → TaggedNoteCard. There is intentionally no cross-kind dedup: the
 * two sources are disjoint kinds with disjoint ids.
 */

import type { NostrEvent } from '@nostrify/nostrify';
import { filterTaggedNotes, type TaggedFilterOptions } from '@/lib/taggedFeedUtils';

export function mergeFeedEvents(
  entries36669: NostrEvent[],
  taggedNotes: NostrEvent[],
  moderation: TaggedFilterOptions = {}
): NostrEvent[] {
  const tagged = filterTaggedNotes(taggedNotes, moderation);
  return [...entries36669, ...tagged].sort((a, b) => b.created_at - a.created_at);
}
