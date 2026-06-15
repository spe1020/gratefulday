import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { buildNip10ReplyTags, isNip10Reply } from './nip10';

function rootNote(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'root-id',
    pubkey: 'author',
    created_at: 1000,
    kind: 1,
    tags: [['t', 'grateful']],
    content: 'a grateful note',
    sig: 'sig',
    ...overrides,
  };
}

describe('buildNip10ReplyTags', () => {
  it('uses a single root-marked e tag with the author pubkey hint', () => {
    const tags = buildNip10ReplyTags(rootNote(), 'wss://relay.example');
    const eTags = tags.filter(([n]) => n === 'e');
    expect(eTags).toHaveLength(1);
    expect(eTags[0]).toEqual(['e', 'root-id', 'wss://relay.example', 'root', 'author']);
  });

  it('p-tags the root author', () => {
    const tags = buildNip10ReplyTags(rootNote());
    expect(tags).toContainEqual(['p', 'author']);
  });

  it('carries all of the root’s p tags plus the author, deduped', () => {
    const root = rootNote({
      pubkey: 'author',
      tags: [['t', 'grateful'], ['p', 'mentioned1'], ['p', 'mentioned2'], ['p', 'author']],
    });
    const pTags = buildNip10ReplyTags(root)
      .filter(([n]) => n === 'p')
      .map(([, v]) => v)
      .sort();
    expect(pTags).toEqual(['author', 'mentioned1', 'mentioned2']);
  });

  it('defaults the relay hint to an empty string', () => {
    const eTag = buildNip10ReplyTags(rootNote()).find(([n]) => n === 'e');
    expect(eTag?.[2]).toBe('');
  });
});

describe('isNip10Reply', () => {
  const ROOT = 'root-id';

  it('accepts a root-marked reply to the root', () => {
    const reply = { ...rootNote({ id: 'r1' }), tags: [['e', ROOT, '', 'root', 'author']] };
    expect(isNip10Reply(reply, ROOT)).toBe(true);
  });

  it('accepts a reply-marked reply to the root', () => {
    const reply = { ...rootNote({ id: 'r2' }), tags: [['e', ROOT, '', 'reply', 'author']] };
    expect(isNip10Reply(reply, ROOT)).toBe(true);
  });

  it('rejects a mention-marked reference to the root (not a reply)', () => {
    const mention = {
      ...rootNote({ id: 'm1' }),
      tags: [['e', 'other-root', '', 'root'], ['e', ROOT, '', 'mention']],
    };
    expect(isNip10Reply(mention, ROOT)).toBe(false);
  });

  it('accepts a legacy positional (unmarked) e-reference to the root', () => {
    const reply = { ...rootNote({ id: 'r3' }), tags: [['e', ROOT]] };
    expect(isNip10Reply(reply, ROOT)).toBe(true);
  });

  it('rejects a note with no e tags', () => {
    expect(isNip10Reply(rootNote({ id: 'top' }), ROOT)).toBe(false);
  });
});
