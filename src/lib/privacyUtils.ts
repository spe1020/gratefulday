/**
 * NIP-44 self-encryption helpers for private gratitude entries.
 *
 * Private entries keep kind 36669 and all metadata tags (`d`, `day`,
 * `published_at` stay public — an accepted, documented limitation); only the
 * content is NIP-44 ciphertext, encrypted to the user's OWN pubkey via their
 * signer. No cryptography is implemented here — everything delegates to
 * `signer.nip44`, and when a signer lacks it the feature degrades instead of
 * falling back to local crypto.
 */

import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';

/** Tag marking an entry's content as NIP-44 ciphertext. */
export const ENCRYPTED_TAG: [string, string] = ['encrypted', 'nip44'];

/** Generic alt tag for encrypted entries — must not leak anything about the plaintext. */
export const ENCRYPTED_ALT = 'Encrypted gratitude journal entry';

/** Thrown when an operation needs NIP-44 but the signer doesn't provide it. */
export class Nip44UnsupportedError extends Error {
  constructor() {
    super("Your signer doesn't support NIP-44 encryption");
    this.name = 'Nip44UnsupportedError';
  }
}

/** Whether this entry's content is NIP-44 ciphertext. */
export function isEncryptedEntry(event: NostrEvent): boolean {
  return event.tags.some(
    ([name, value]) => name === 'encrypted' && value === 'nip44'
  );
}

/**
 * Resolve the signer's nip44 implementation or throw Nip44UnsupportedError.
 * NBrowserSigner's `nip44` getter throws when the extension is unavailable,
 * so the property access itself is guarded too.
 */
function getNip44(signer: NostrSigner): NonNullable<NostrSigner['nip44']> {
  let nip44: NostrSigner['nip44'];
  try {
    nip44 = signer.nip44;
  } catch {
    throw new Nip44UnsupportedError();
  }
  if (!nip44) {
    throw new Nip44UnsupportedError();
  }
  return nip44;
}

/**
 * Encrypt entry content to the given pubkey (the user's own, for journal
 * entries). Throws Nip44UnsupportedError if the signer lacks NIP-44.
 */
export async function encryptEntryContent(
  signer: NostrSigner,
  pubkey: string,
  plaintext: string
): Promise<string> {
  return getNip44(signer).encrypt(pubkey, plaintext);
}

/**
 * Decrypt entry content with the given pubkey's conversation key.
 * Throws Nip44UnsupportedError if the signer lacks NIP-44.
 */
export async function decryptEntryContent(
  signer: NostrSigner,
  pubkey: string,
  ciphertext: string
): Promise<string> {
  return getNip44(signer).decrypt(pubkey, ciphertext);
}
