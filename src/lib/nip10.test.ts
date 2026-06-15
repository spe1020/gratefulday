import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { buildNip10ReplyTags, isNip10Reply, resolveThreadRoot } from './nip10';

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

  it('accepts a legacy 4-field e tag whose 4th element is a pubkey hint, not a marker', () => {
    // ["e", rootId, relay, rootPubkey] — slot 3 is a pubkey, NOT "root"/"reply".
    // Must not be mistaken for the marked scheme and rejected.
    const reply = {
      ...rootNote({ id: 'r4' }),
      tags: [['e', ROOT, 'wss://relay.example', 'f'.repeat(64)]],
    };
    expect(isNip10Reply(reply, ROOT)).toBe(true);
  });

  it('rejects a note with no e tags', () => {
    expect(isNip10Reply(rootNote({ id: 'top' }), ROOT)).toBe(false);
  });
});

describe('resolveThreadRoot', () => {
  it('returns null for a note that is itself a root (no e tags)', () => {
    expect(resolveThreadRoot(rootNote())).toBeNull();
  });

  it('prefers the root marker, with pubkey + relay hints', () => {
    const reply = rootNote({
      tags: [
        ['e', 'the-root', 'wss://relay', 'root', 'root-author'],
        ['e', 'the-parent', '', 'reply', 'parent-author'],
      ],
    });
    expect(resolveThreadRoot(reply)).toEqual({
      id: 'the-root',
      relayHint: 'wss://relay',
      pubkey: 'root-author',
    });
  });

  it('falls back to the reply marker when there is no root marker', () => {
    const reply = rootNote({ tags: [['e', 'the-parent', '', 'reply', 'parent-author']] });
    expect(resolveThreadRoot(reply)).toEqual({ id: 'the-parent', pubkey: 'parent-author' });
  });

  it('uses the FIRST e tag in the legacy unmarked (positional) scheme', () => {
    const reply = rootNote({ tags: [['e', 'positional-root'], ['e', 'positional-parent']] });
    expect(resolveThreadRoot(reply)).toEqual({ id: 'positional-root' });
  });

  it('reads a pubkey hint from the legacy 4-field positional form', () => {
    const reply = rootNote({ tags: [['e', 'root', 'wss://r', 'root-pubkey']] });
    expect(resolveThreadRoot(reply)).toEqual({ id: 'root', relayHint: 'wss://r', pubkey: 'root-pubkey' });
  });

  it('returns null when the only e tags are mentions (not a reply)', () => {
    expect(resolveThreadRoot(rootNote({ tags: [['e', 'x', '', 'mention']] }))).toBeNull();
  });
});
