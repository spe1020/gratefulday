import { describe, it, expect } from 'vitest';
import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';

// In the jsdom environment TextEncoder.encode returns a Uint8Array from a
// different realm, which @noble/hashes rejects ("Uint8Array expected").
// Wrap it to re-create output with this realm's Uint8Array before the
// crypto libraries capture it — hence the dynamic imports below.
const BaseTextEncoder = globalThis.TextEncoder;
globalThis.TextEncoder = class extends BaseTextEncoder {
  encode(input?: string): Uint8Array {
    return Uint8Array.from(super.encode(input));
  }
};

const { generateSecretKey, getPublicKey } = await import('nostr-tools');
const { NSecSigner } = await import('@nostrify/nostrify');
import {
  ENCRYPTED_ALT,
  ENCRYPTED_TAG,
  Nip44UnsupportedError,
  decryptEntryContent,
  encryptEntryContent,
  isEncryptedEntry,
} from './privacyUtils';

function makeEntry(tags: string[][]): NostrEvent {
  return {
    id: 'id',
    pubkey: 'pk',
    created_at: 1000,
    kind: 36669,
    tags,
    content: 'content',
    sig: 'sig',
  };
}

/** A signer that lacks nip44, like an extension without NIP-44 support. */
const unsupportedSigner: NostrSigner = {
  getPublicKey: async () => 'pk',
  signEvent: async () => {
    throw new Error('not needed');
  },
};

describe('encryptEntryContent / decryptEntryContent', () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer = new NSecSigner(sk);

  it('round-trips plaintext when encrypting to self', async () => {
    const plaintext = 'Grateful for quiet mornings ☀️';

    const ciphertext = await encryptEntryContent(signer, pubkey, plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).not.toContain('quiet mornings');

    const decrypted = await decryptEntryContent(signer, pubkey, ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('produces ciphertext another key cannot decrypt', async () => {
    const ciphertext = await encryptEntryContent(signer, pubkey, 'secret entry');

    const otherSk = generateSecretKey();
    const otherSigner = new NSecSigner(otherSk);
    const otherPubkey = getPublicKey(otherSk);

    await expect(
      decryptEntryContent(otherSigner, otherPubkey, ciphertext)
    ).rejects.toThrow();
  });

  it('throws Nip44UnsupportedError when the signer lacks nip44', async () => {
    await expect(
      encryptEntryContent(unsupportedSigner, 'pk', 'text')
    ).rejects.toBeInstanceOf(Nip44UnsupportedError);

    await expect(
      decryptEntryContent(unsupportedSigner, 'pk', 'ciphertext')
    ).rejects.toBeInstanceOf(Nip44UnsupportedError);
  });

  it('throws Nip44UnsupportedError when the nip44 property access throws', async () => {
    // NBrowserSigner's nip44 getter throws when the extension is gone.
    const throwingSigner = {
      getPublicKey: async () => 'pk',
      signEvent: unsupportedSigner.signEvent,
      get nip44(): NostrSigner['nip44'] {
        throw new Error('Browser extension not available');
      },
    } satisfies NostrSigner;

    await expect(
      encryptEntryContent(throwingSigner, 'pk', 'text')
    ).rejects.toBeInstanceOf(Nip44UnsupportedError);
  });
});

describe('isEncryptedEntry', () => {
  it('detects the encrypted nip44 tag', () => {
    expect(isEncryptedEntry(makeEntry([['d', '2026-06-10'], ENCRYPTED_TAG]))).toBe(true);
  });

  it('returns false for plaintext entries', () => {
    expect(isEncryptedEntry(makeEntry([['d', '2026-06-10']]))).toBe(false);
  });

  it('returns false for non-nip44 encrypted markers', () => {
    expect(isEncryptedEntry(makeEntry([['encrypted', 'nip04']]))).toBe(false);
  });
});

describe('constants', () => {
  it('keeps the encrypted alt generic with no plaintext-derived data', () => {
    expect(ENCRYPTED_ALT).toBe('Encrypted gratitude journal entry');
    expect(ENCRYPTED_TAG).toEqual(['encrypted', 'nip44']);
  });
});
