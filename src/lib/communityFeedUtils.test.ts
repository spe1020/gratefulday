import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { mergeFeedEvents } from './communityFeedUtils';

function entry36669(id: string, created_at: number, pubkey = 'journaler'): NostrEvent {
  return {
    id,
    pubkey,
    created_at,
    kind: 36669,
    tags: [['d', `2026-06-${id}`]],
    content: 'grateful entry',
    sig: 'sig',
  };
}

function taggedNote(id: string, created_at: number, pubkey = 'author'): NostrEvent {
  return {
    id,
    pubkey,
    created_at,
    kind: 1,
    tags: [['t', 'grateful']],
    content: 'tagged note',
    sig: 'sig',
  };
}

describe('mergeFeedEvents', () => {
  it('interleaves both sources newest-first by created_at', () => {
    const journal = [entry36669('a', 300), entry36669('b', 100)];
    const tagged = [taggedNote('c', 250), taggedNote('d', 150)];

    const merged = mergeFeedEvents(journal, tagged);
    expect(merged.map((e) => e.id)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('preserves each event kind so the renderer can route per card', () => {
    const merged = mergeFeedEvents([entry36669('a', 200)], [taggedNote('c', 100)]);
    expect(merged.map((e) => e.kind)).toEqual([36669, 1]);
  });

  it('applies kind-1 moderation/filtering but leaves journal entries untouched', () => {
    const journal = [entry36669('a', 300, 'journaler')];
    const tagged = [
      taggedNote('keep', 250, 'alice'),
      taggedNote('muted', 240, 'troll'),
      { ...taggedNote('reply', 230), tags: [['t', 'grateful'], ['e', 'parent']] },
      taggedNote('hidden', 220, 'alice'),
    ];

    const merged = mergeFeedEvents(journal, tagged, {
      mutedPubkeys: new Set(['troll']),
      hiddenIds: new Set(['hidden']),
    });
    // troll (muted), reply, and hidden are dropped; journal + keep remain.
    expect(merged.map((e) => e.id)).toEqual(['a', 'keep']);
  });

  it('does not apply the kind-1 mute path to journal authors', () => {
    // A journaler who happens to be muted in the kind-1 path still appears —
    // journal entries are first-party content, not subject to feed mutes.
    const journal = [entry36669('a', 300, 'troll')];
    const merged = mergeFeedEvents(journal, [], { mutedPubkeys: new Set(['troll']) });
    expect(merged.map((e) => e.id)).toEqual(['a']);
  });
});
