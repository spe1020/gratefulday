import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { decodeEmbedRef, embedRefKey } from './embedRef';

const ID = 'a'.repeat(64);
const PK = 'b'.repeat(64);

describe('decodeEmbedRef', () => {
  it('decodes a note → event id', () => {
    expect(decodeEmbedRef(nip19.noteEncode(ID))).toEqual({ kind: 'event', id: ID });
  });

  it('decodes an nevent → event id with relay hints', () => {
    const nevent = nip19.neventEncode({ id: ID, relays: ['wss://relay.example'] });
    const ref = decodeEmbedRef(nevent);
    expect(ref).toMatchObject({ kind: 'event', id: ID });
    expect(ref?.kind === 'event' && ref.relays).toContain('wss://relay.example');
  });

  it('decodes an naddr → addressable coordinate (incl. a 36669 entry)', () => {
    const naddr = nip19.naddrEncode({ kind: 36669, pubkey: PK, identifier: '2026-06-14', relays: [] });
    expect(decodeEmbedRef(naddr)).toEqual({
      kind: 'addr',
      eventKind: 36669,
      pubkey: PK,
      identifier: '2026-06-14',
      relays: [],
    });
  });

  it('returns null for npub/nprofile (not embeds)', () => {
    expect(decodeEmbedRef(nip19.npubEncode(PK))).toBeNull();
    expect(decodeEmbedRef(nip19.nprofileEncode({ pubkey: PK }))).toBeNull();
  });

  it('returns null for an undecodable string', () => {
    expect(decodeEmbedRef('note1notvalid')).toBeNull();
  });
});

describe('embedRefKey', () => {
  it('keys events by id and addresses by coordinate', () => {
    expect(embedRefKey({ kind: 'event', id: ID })).toBe(ID);
    expect(
      embedRefKey({ kind: 'addr', eventKind: 36669, pubkey: PK, identifier: 'd1' })
    ).toBe(`36669:${PK}:d1`);
  });
});
