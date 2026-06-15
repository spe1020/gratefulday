import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  MAX_HASHTAGS,
  filterTaggedNotes,
  hasMeaningfulContent,
  hasReplyGratitudeTag,
  isHashtagSpam,
  isReply,
} from './taggedFeedUtils';

function note(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'id',
    pubkey: 'author',
    created_at: 1000,
    kind: 1,
    tags: [['t', 'grateful']],
    content: 'grateful for the sun',
    sig: 'sig',
    ...overrides,
  };
}

describe('isReply', () => {
  it('treats a note with an e tag as a reply', () => {
    expect(isReply(note({ tags: [['e', 'parent']] }))).toBe(true);
  });
  it('treats a plain tagged note as standalone', () => {
    expect(isReply(note())).toBe(false);
  });
});

describe('hasMeaningfulContent', () => {
  it('rejects empty or whitespace-only content', () => {
    expect(hasMeaningfulContent(note({ content: '' }))).toBe(false);
    expect(hasMeaningfulContent(note({ content: '   \n\t ' }))).toBe(false);
  });
  it('accepts real content', () => {
    expect(hasMeaningfulContent(note({ content: 'thank you' }))).toBe(true);
  });
});

describe('isHashtagSpam', () => {
  it('flags notes stuffed past the hashtag limit', () => {
    const tags = Array.from({ length: MAX_HASHTAGS + 1 }, (_, i) => ['t', `tag${i}`]);
    expect(isHashtagSpam(note({ tags }))).toBe(true);
  });
  it('allows a normal handful of hashtags', () => {
    expect(
      isHashtagSpam(note({ tags: [['t', 'grateful'], ['t', 'gratefulchain'], ['t', 'sunrise']] }))
    ).toBe(false);
  });
});

describe('hasReplyGratitudeTag', () => {
  it('accepts any of the gratitude tags (same set as roots)', () => {
    for (const tag of ['grateful', 'gratefulchain', 'thankful', 'blessed', 'faithstr', 'biblestr']) {
      expect(hasReplyGratitudeTag(note({ tags: [['t', tag]] }))).toBe(true);
    }
  });
  it('rejects a note with no gratitude tag', () => {
    expect(hasReplyGratitudeTag(note({ tags: [['t', 'nostr']] }))).toBe(false);
    expect(hasReplyGratitudeTag(note({ tags: [] }))).toBe(false);
  });
});

describe('filterTaggedNotes', () => {
  it('drops empty notes and hashtag spam', () => {
    const good = note({ id: 'good' });
    const empty = note({ id: 'empty', content: '  ' });
    const spam = note({
      id: 'spam',
      tags: Array.from({ length: MAX_HASHTAGS + 1 }, (_, i) => ['t', `x${i}`]),
    });

    const result = filterTaggedNotes([good, empty, spam]);
    expect(result.map((e) => e.id)).toEqual(['good']);
  });

  it('lets a gratitude-tagged reply through, but drops an untagged reply', () => {
    const taggedReply = note({ id: 'tagged-reply', tags: [['t', 'thankful'], ['e', 'root']] });
    const untaggedReply = note({ id: 'untagged-reply', tags: [['e', 'root']] });
    const root = note({ id: 'root', tags: [['t', 'grateful']] });

    const result = filterTaggedNotes([taggedReply, untaggedReply, root]);
    expect(result.map((e) => e.id)).toEqual(['tagged-reply', 'root']); // untagged reply dropped
  });

  it('still drops a tagged reply that is empty or spammy', () => {
    const emptyReply = note({ id: 'er', content: ' ', tags: [['t', 'grateful'], ['e', 'root']] });
    const spamReply = note({
      id: 'sr',
      // A real gratitude tag (qualifies as a reply) + enough extra t-tags to be spam.
      tags: [['e', 'root'], ['t', 'grateful'], ...Array.from({ length: MAX_HASHTAGS }, (_, i) => ['t', `x${i}`])],
    });
    expect(filterTaggedNotes([emptyReply, spamReply])).toEqual([]);
  });

  it('dedups by id, keeping the first occurrence and preserving order', () => {
    const a1 = note({ id: 'a', created_at: 200 });
    const b = note({ id: 'b', created_at: 150 });
    const a2 = note({ id: 'a', created_at: 200 });

    const result = filterTaggedNotes([a1, b, a2]);
    expect(result.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('excludes muted authors and hidden notes', () => {
    const keep = note({ id: 'keep', pubkey: 'alice' });
    const mutedAuthor = note({ id: 'm', pubkey: 'troll' });
    const hiddenNote = note({ id: 'h', pubkey: 'alice' });

    const result = filterTaggedNotes([keep, mutedAuthor, hiddenNote], {
      mutedPubkeys: new Set(['troll']),
      hiddenIds: new Set(['h']),
    });
    expect(result.map((e) => e.id)).toEqual(['keep']);
  });
});
