/**
 * Decode a NIP-19 reference into a fetch target for an embedded note. Pure and
 * testable; the fetch hook and card build on it.
 *
 * - note / nevent → an event id (nevent also carries relay hints)
 * - naddr        → an addressable coordinate (kind:pubkey:identifier) + hints
 *
 * npub/nprofile are NOT embeds — they render as profile chips, handled in
 * NoteContent, not here.
 */

import { nip19 } from 'nostr-tools';

export type EmbedRef =
  | { kind: 'event'; id: string; relays?: string[] }
  | { kind: 'addr'; eventKind: number; pubkey: string; identifier: string; relays?: string[] };

export function decodeEmbedRef(nostrId: string): EmbedRef | null {
  try {
    const decoded = nip19.decode(nostrId);
    switch (decoded.type) {
      case 'note':
        return { kind: 'event', id: decoded.data };
      case 'nevent':
        return { kind: 'event', id: decoded.data.id, relays: decoded.data.relays };
      case 'naddr':
        return {
          kind: 'addr',
          eventKind: decoded.data.kind,
          pubkey: decoded.data.pubkey,
          identifier: decoded.data.identifier,
          relays: decoded.data.relays,
        };
      default:
        return null; // npub/nprofile/etc. are not embeds
    }
  } catch {
    return null;
  }
}

/** Stable cache key for an embed ref (event id, or the addressable coordinate). */
export function embedRefKey(ref: EmbedRef): string {
  return ref.kind === 'event'
    ? ref.id
    : `${ref.eventKind}:${ref.pubkey}:${ref.identifier}`;
}
