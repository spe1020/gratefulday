import { useQuery } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { decryptEntryContent, isEncryptedEntry } from '@/lib/privacyUtils';

export interface DecryptedEntry {
  /** Plaintext to render. Empty while decrypting, on error, or with no event. */
  content: string;
  isEncrypted: boolean;
  isDecrypting: boolean;
  decryptError: Error | null;
}

/**
 * Readable content for a gratitude entry. Plaintext entries pass through;
 * encrypted ones are decrypted via the user's signer, with the plaintext
 * cached per event id so re-renders never re-prompt a bunker or extension.
 *
 * Callers must never render `event.content` directly for encrypted entries —
 * on any failure this returns empty content plus `decryptError`, and the UI
 * shows a lock fallback instead of ciphertext.
 */
export function useDecryptedEntry(event: NostrEvent | null | undefined): DecryptedEntry {
  const { user } = useCurrentUser();

  const isEncrypted = !!event && isEncryptedEntry(event);
  const canAttempt =
    isEncrypted && !!user && !!event && user.pubkey === event.pubkey;

  const query = useQuery({
    queryKey: ['decrypted-entry', event?.id],
    queryFn: async () => {
      if (!event || !user) throw new Error('Not ready');
      return decryptEntryContent(user.signer, user.pubkey, event.content);
    },
    enabled: canAttempt,
    // The plaintext of an immutable event never goes stale, and failures
    // shouldn't auto-retry into repeated signer prompts.
    staleTime: Infinity,
    retry: false,
  });

  if (!event) {
    return { content: '', isEncrypted: false, isDecrypting: false, decryptError: null };
  }

  if (!isEncrypted) {
    return { content: event.content, isEncrypted: false, isDecrypting: false, decryptError: null };
  }

  if (!canAttempt) {
    // Encrypted but no signer able to try (logged out or not the author).
    return {
      content: '',
      isEncrypted: true,
      isDecrypting: false,
      decryptError: new Error('No signer available to decrypt this entry'),
    };
  }

  return {
    content: query.data ?? '',
    isEncrypted: true,
    isDecrypting: query.isLoading,
    decryptError: query.error instanceof Error ? query.error : null,
  };
}
