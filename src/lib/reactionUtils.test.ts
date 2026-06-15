import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  CURATED_REACTIONS,
  aggregateReactions,
  buildReactionTags,
  findOwnReaction,
  isAddressable,
} from './reactionUtils';

function journalEntry(): NostrEvent {
  return {
    id: 'entry-id',
    pubkey: 'journaler',
    created_at: 1000,
    kind: 36669,
    tags: [['d', '2026-06-14']],
    content: 'grateful',
    sig: 'sig',
  };
}

function taggedNote(): NostrEvent {
  return {
    id: 'note-id',
    pubkey: 'author',
    created_at: 1000,
    kind: 1,
    tags: [['t', 'grateful']],
    content: 'grateful note',
    sig: 'sig',
  };
}

function reaction(pubkey: string, content: string, created_at = 1000): NostrEvent {
  return { id: `${pubkey}-${content}-${created_at}`, pubkey, created_at, kind: 7, tags: [], content, sig: 'sig' };
}

describe('isAddressable', () => {
  it('treats 36669 as addressable and 1/7 as regular', () => {
    expect(isAddressable(36669)).toBe(true);
    expect(isAddressable(1)).toBe(false);
    expect(isAddressable(7)).toBe(false);
  });
});

describe('buildReactionTags — kind-routed', () => {
  it('adds an `a` coordinate alongside e/p/k for an addressable (36669) target', () => {
    const tags = buildReactionTags(journalEntry());
    expect(tags).toContainEqual(['e', 'entry-id', '', 'journaler']);
    expect(tags).toContainEqual(['a', '36669:journaler:2026-06-14']);
    expect(tags).toContainEqual(['p', 'journaler']);
    expect(tags).toContainEqual(['k', '36669']);
  });

  it('uses only e/p/k (NO `a`) for a regular kind-1 target', () => {
    const tags = buildReactionTags(taggedNote());
    expect(tags).toContainEqual(['e', 'note-id', '', 'author']);
    expect(tags).toContainEqual(['p', 'author']);
    expect(tags).toContainEqual(['k', '1']);
    expect(tags.some(([name]) => name === 'a')).toBe(false);
  });
});

describe('aggregateReactions', () => {
  it('counts distinct pubkeys per curated emoji, ignoring non-curated content', () => {
    const events = [
      reaction('a', '🙏'),
      reaction('b', '🙏'),
      reaction('a', '🙏'), // same pubkey+emoji — counts once
      reaction('c', '✨'),
      reaction('d', '+'), // non-curated — ignored
      reaction('e', '🔥'), // non-curated — ignored
    ];
    const counts = aggregateReactions(events);
    expect(counts['🙏']).toBe(2);
    expect(counts['✨']).toBe(1);
    expect(counts['🌱']).toBe(0);
  });

  it('returns a zeroed entry for every curated emoji', () => {
    const counts = aggregateReactions([]);
    expect(Object.keys(counts).sort()).toEqual([...CURATED_REACTIONS].sort());
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('trims whitespace around the reaction content', () => {
    expect(aggregateReactions([reaction('a', ' 🙏 ')])['🙏']).toBe(1);
  });
});

describe('findOwnReaction', () => {
  it('returns the user’s own reaction event for an emoji (newest first)', () => {
    const events = [reaction('me', '🙏', 100), reaction('me', '🙏', 200), reaction('other', '🙏', 300)];
    const own = findOwnReaction(events, 'me', '🙏');
    expect(own?.pubkey).toBe('me');
    expect(own?.created_at).toBe(200); // newest of the user's two
  });

  it('returns undefined when the user has not reacted with that emoji', () => {
    expect(findOwnReaction([reaction('me', '🌱')], 'me', '🙏')).toBeUndefined();
    expect(findOwnReaction([reaction('other', '🙏')], 'me', '🙏')).toBeUndefined();
  });
});
