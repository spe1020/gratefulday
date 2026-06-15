import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  CURATED_EMOJIS,
  CURATED_REACTIONS,
  aggregateReactions,
  buildReactionTags,
  findOwnReaction,
  findOwnReactions,
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

describe('CURATED_REACTIONS (single source of truth)', () => {
  it('is exactly the five expected emoji, in order', () => {
    expect(CURATED_REACTIONS.map((r) => r.emoji)).toEqual(['🙏', '🌱', '✨', '🫂', '❤️']);
    expect(CURATED_EMOJIS).toEqual(['🙏', '🌱', '✨', '🫂', '❤️']);
  });
});

describe('aggregateReactions', () => {
  it('counts distinct curated reactors AND rolls up non-curated into otherCount', () => {
    const events = [
      reaction('a', '🙏'),
      reaction('b', '🙏'),
      reaction('a', '🙏'), // same pubkey+emoji — counts once
      reaction('c', '✨'),
      reaction('d', '👍'), // non-curated → others
      reaction('e', '😂'), // non-curated → others
    ];
    const { counts, otherCount } = aggregateReactions(events);
    expect(counts['🙏']).toBe(2);
    expect(counts['✨']).toBe(1);
    expect(counts['🌱']).toBe(0);
    expect(otherCount).toBe(2); // d, e — the wider-network rollup
  });

  it('surfaces a note that looks unreacted but carries only network reactions', () => {
    const { counts, otherCount } = aggregateReactions([reaction('a', '👍'), reaction('b', '🤙')]);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(otherCount).toBe(2);
  });

  it('dedups distinct reactors within the others bucket', () => {
    // Same pubkey, two different non-curated emoji — one distinct reactor.
    const { otherCount } = aggregateReactions([reaction('x', '👍'), reaction('x', '😂')]);
    expect(otherCount).toBe(1);
  });

  it('folds +/empty into others, ignores - (dislike), normalizes ❤ vs ❤️', () => {
    const { counts, otherCount } = aggregateReactions([
      reaction('a', '+'), // generic like → others, NOT recolored to ❤️
      reaction('b', ''), // empty like → others
      reaction('c', '-'), // dislike → ignored entirely
      reaction('d', '❤'), // bare heart → curated ❤️ via normalization
      reaction('e', '❤️'), // heart with variation selector → curated ❤️
    ]);
    expect(counts['❤️']).toBe(2); // d + e
    expect(otherCount).toBe(2); // a + b (c ignored)
  });

  it('returns a zeroed entry for every curated emoji, in order', () => {
    const { counts } = aggregateReactions([]);
    expect(Object.keys(counts)).toEqual([...CURATED_EMOJIS]);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('trims whitespace around the reaction content', () => {
    expect(aggregateReactions([reaction('a', ' 🙏 ')]).counts['🙏']).toBe(1);
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

  it('detects own reactions across interop forms (whitespace, ❤ vs ❤️)', () => {
    // Reacted from another client as bare ❤ (no U+FE0F) or with padding — still
    // recognized as the user's own ❤️, so they can toggle/un-react it.
    expect(findOwnReaction([reaction('me', '❤')], 'me', '❤️')).toBeDefined();
    expect(findOwnReaction([reaction('me', ' ❤️ ')], 'me', '❤️')).toBeDefined();
    expect(findOwnReaction([reaction('me', '🙏')], 'me', '❤️')).toBeUndefined();
  });
});

describe('findOwnReactions (un-react targets)', () => {
  it('returns ALL of the user’s matching reactions, newest first, normalized', () => {
    const events = [
      reaction('me', '❤️', 100),
      reaction('me', '❤', 300), // bare heart, different client
      reaction('me', ' ❤️ ', 200), // padded
      reaction('other', '❤️', 400),
    ];
    const own = findOwnReactions(events, 'me', '❤️');
    expect(own.map((e) => e.created_at)).toEqual([300, 200, 100]); // all three, newest first
    expect(own.every((e) => e.pubkey === 'me')).toBe(true);
  });
});
