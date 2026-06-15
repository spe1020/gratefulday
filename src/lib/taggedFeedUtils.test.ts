import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  MAX_HASHTAGS,
  filterTaggedNotes,
  hasMeaningfulContent,
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

describe('filterTaggedNotes', () => {
  it('drops replies, empty notes, and hashtag spam', () => {
    const good = note({ id: 'good' });
    const reply = note({ id: 'reply', tags: [['t', 'grateful'], ['e', 'parent']] });
    const empty = note({ id: 'empty', content: '  ' });
    const spam = note({
      id: 'spam',
      tags: Array.from({ length: MAX_HASHTAGS + 1 }, (_, i) => ['t', `x${i}`]),
    });

    const result = filterTaggedNotes([good, reply, empty, spam]);
    expect(result.map((e) => e.id)).toEqual(['good']);
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
