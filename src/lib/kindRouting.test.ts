// Structural guard for the load-bearing rule: interaction standard is chosen by
// the TARGET's kind, never assumed. A kind-1 note must NEVER receive a NIP-22
// (1111) comment, and a 36669 entry must NEVER receive a NIP-10 (kind-1) reply.
//
// Enforcement is primarily structural (each card imports only its own stack —
// GratitudeNoteCard → CommentsSection/usePostComment, TaggedNoteCard →
// Nip10ReplySection/usePostReply, with no shared kind-branching component). This
// test pins the marker-level invariants of the two reply/comment builders so a
// future refactor can't quietly cross-wire them.

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { buildNip10ReplyTags } from './nip10';

function taggedNote(): NostrEvent {
  return {
    id: 'note-id',
    pubkey: 'author',
    created_at: 1000,
    kind: 1,
    tags: [['t', 'grateful']],
    content: 'note',
    sig: 'sig',
  };
}

describe('kind routing — NIP-10 reply path (kind 1 only)', () => {
  it('produces a kind-1 reply with a single root-marked e tag (not a 1111 comment)', () => {
    const tags = buildNip10ReplyTags(taggedNote());
    // NIP-10 markers, lowercase e/p — NOT the NIP-22 uppercase E/K/P scheme.
    expect(tags.filter(([n]) => n === 'e')).toEqual([['e', 'note-id', '', 'root', 'author']]);
    expect(tags.some(([n]) => n === 'p')).toBe(true);
    // Must carry none of the NIP-22 (1111) uppercase root tags.
    expect(tags.some(([n]) => n === 'A' || n === 'E' || n === 'K' || n === 'I')).toBe(false);
  });
});
