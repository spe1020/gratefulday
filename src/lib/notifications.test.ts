import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  buildNotifications,
  extractZapActor,
  extractZapAmount,
  groupNotifications,
  mapEventToNotification,
  unreadCount,
  type NotifiableContent,
} from './notifications';

const ME = 'me-pubkey';
const COORD = `36669:${ME}:2026-06-14`;
const NOTE_ID = 'my-note-id';

const content: NotifiableContent = {
  pubkey: ME,
  coords: new Set([COORD]),
  noteIds: new Set([NOTE_ID]),
};

function evt(over: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'id',
    pubkey: 'actor',
    created_at: 1000,
    kind: 7,
    tags: [],
    content: '',
    sig: 'sig',
    ...over,
  };
}

/** A 9735 receipt with a 9734 zap request embedded in `description`. */
function zapReceipt(over: { actor?: string; amountMsat?: number; tags?: string[][] } = {}): NostrEvent {
  const request = {
    kind: 9734,
    pubkey: over.actor ?? 'zapper',
    tags: over.amountMsat ? [['amount', String(over.amountMsat)]] : [],
  };
  return evt({
    id: 'zap-id',
    kind: 9735,
    pubkey: 'lnurl-server', // receipts are authored by the server, NOT the zapper
    tags: [...(over.tags ?? []), ['description', JSON.stringify(request)]],
  });
}

describe('extractZapActor', () => {
  it('reads the zapper from the embedded 9734 request, not the 9735 author', () => {
    expect(extractZapActor(zapReceipt({ actor: 'zapper' }))).toBe('zapper');
  });
  it('falls back to the uppercase P tag', () => {
    const r = evt({ kind: 9735, pubkey: 'server', tags: [['P', 'sender']] });
    expect(extractZapActor(r)).toBe('sender');
  });
});

describe('extractZapAmount', () => {
  it('reads the amount tag (millisats → sats)', () => {
    const r = evt({ kind: 9735, tags: [['amount', '21000']] });
    expect(extractZapAmount(r)).toBe(21);
  });
  it('falls back to the zap-request amount in description', () => {
    expect(extractZapAmount(zapReceipt({ amountMsat: 50000 }))).toBe(50);
  });
  it('returns null when no amount is recoverable', () => {
    expect(extractZapAmount(evt({ kind: 9735, tags: [] }))).toBeNull();
  });
});

describe('mapEventToNotification', () => {
  it('maps a reaction on my 36669 entry (via #a)', () => {
    const item = mapEventToNotification(
      evt({ id: 'r1', kind: 7, pubkey: 'alice', content: '🙏', tags: [['a', COORD]] }),
      content
    );
    expect(item).toMatchObject({ type: 'reaction', actor: 'alice', emoji: '🙏', target: { kind: 36669, ref: COORD } });
  });

  it('maps a reaction on my kind-1 note (via #e)', () => {
    const item = mapEventToNotification(
      evt({ id: 'r2', kind: 7, pubkey: 'bob', content: '❤️', tags: [['e', NOTE_ID]] }),
      content
    );
    expect(item).toMatchObject({ type: 'reaction', target: { kind: 1, ref: NOTE_ID } });
  });

  it('maps a zap with the real actor + amount', () => {
    const item = mapEventToNotification(
      zapReceipt({ actor: 'zapper', amountMsat: 21000, tags: [['e', NOTE_ID]] }),
      content
    );
    expect(item).toMatchObject({ type: 'zap', actor: 'zapper', amountSats: 21, target: { kind: 1, ref: NOTE_ID } });
  });

  it('maps a NIP-22 comment on my entry', () => {
    const item = mapEventToNotification(
      evt({ id: 'c1', kind: 1111, pubkey: 'carol', content: 'love this', tags: [['A', COORD]] }),
      content
    );
    expect(item).toMatchObject({ type: 'comment', actor: 'carol', snippet: 'love this', target: { kind: 36669 } });
  });

  it('maps a NIP-10 reply (root-marked) to my kind-1 note', () => {
    const item = mapEventToNotification(
      evt({ id: 'rep1', kind: 1, pubkey: 'dave', content: 'amen', tags: [['e', NOTE_ID, '', 'root', ME]] }),
      content
    );
    expect(item).toMatchObject({ type: 'reply', actor: 'dave', snippet: 'amen' });
  });

  it('does NOT treat a kind-1 mention of my note as a reply', () => {
    const mention = evt({ id: 'm1', kind: 1, pubkey: 'dave', tags: [['e', NOTE_ID, '', 'mention']] });
    expect(mapEventToNotification(mention, content)).toBeNull();
  });

  it('self-filters my own interactions (reaction, zap, comment)', () => {
    expect(mapEventToNotification(evt({ kind: 7, pubkey: ME, tags: [['a', COORD]] }), content)).toBeNull();
    expect(
      mapEventToNotification(zapReceipt({ actor: ME, tags: [['e', NOTE_ID]] }), content)
    ).toBeNull();
    expect(mapEventToNotification(evt({ kind: 1111, pubkey: ME, tags: [['A', COORD]] }), content)).toBeNull();
  });

  it('returns null when the event references nothing of mine', () => {
    expect(
      mapEventToNotification(evt({ kind: 7, pubkey: 'alice', tags: [['e', 'someone-elses-note']] }), content)
    ).toBeNull();
  });
});

describe('buildNotifications', () => {
  it('dedupes by id, drops nulls, sorts newest-first', () => {
    const a = evt({ id: 'a', kind: 7, pubkey: 'x', content: '🙏', tags: [['a', COORD]], created_at: 100 });
    const b = evt({ id: 'b', kind: 7, pubkey: 'y', content: '✨', tags: [['e', NOTE_ID]], created_at: 300 });
    const dupA = { ...a };
    const mine = evt({ id: 'self', kind: 7, pubkey: ME, tags: [['a', COORD]], created_at: 999 });

    const items = buildNotifications([a, b, dupA, mine], content);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']); // newest-first, self dropped, dedup
  });
});

describe('unreadCount', () => {
  it('counts items strictly newer than last-seen', () => {
    const items = buildNotifications(
      [
        evt({ id: 'old', kind: 7, pubkey: 'x', tags: [['a', COORD]], created_at: 100 }),
        evt({ id: 'new', kind: 7, pubkey: 'y', tags: [['e', NOTE_ID]], created_at: 300 }),
      ],
      content
    );
    expect(unreadCount(items, 200)).toBe(1);
    expect(unreadCount(items, undefined)).toBe(2); // never seen → all unread
    expect(unreadCount(items, 300)).toBe(0);
  });
});

describe('groupNotifications', () => {
  it('collapses reactions/zaps on one target; keeps comments/replies individual', () => {
    const items = buildNotifications(
      [
        evt({ id: 'r1', kind: 7, pubkey: 'alice', content: '🙏', tags: [['a', COORD]], created_at: 100 }),
        evt({ id: 'r2', kind: 7, pubkey: 'bob', content: '✨', tags: [['a', COORD]], created_at: 200 }),
        evt({ id: 'c1', kind: 1111, pubkey: 'carol', content: 'nice', tags: [['A', COORD]], created_at: 300 }),
        evt({ id: 'c2', kind: 1111, pubkey: 'dave', content: 'great', tags: [['A', COORD]], created_at: 400 }),
      ],
      content
    );
    const groups = groupNotifications(items);
    // 1 reaction group (alice+bob) + 2 comment groups (individual) = 3, newest-first.
    expect(groups).toHaveLength(3);
    const reactionGroup = groups.find((g) => g.type === 'reaction')!;
    expect(reactionGroup.actors.sort()).toEqual(['alice', 'bob']);
    expect(reactionGroup.items).toHaveLength(2);
    expect(groups.filter((g) => g.type === 'comment')).toHaveLength(2);
    expect(groups[0].latestAt).toBe(400); // newest group first
  });
});
