import { useCurrentUser } from '@/hooks/useCurrentUser';

/**
 * NIP-44 capability of the current user's signer.
 *
 * - nsec: NSecSigner implements nip44 locally — always true.
 * - extension: NBrowserSigner's nip44 getter mirrors window.nostr.nip44 —
 *   property presence is accurate. The getter throws if the extension is
 *   gone entirely, hence the try/catch.
 * - bunker: NConnectSigner.nip44 is a blind RPC proxy that always exists;
 *   support is only discoverable by attempting a call. Reported as 'unknown'
 *   until a first definitive encrypt success/failure is cached per pubkey.
 */
export type Nip44Support = boolean | 'unknown';

const STORAGE_KEY = 'gratefulday:nip44-support:v1';

type SupportCache = Record<string, boolean>;

function readCache(): SupportCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Cached capability from a previous definitive encrypt attempt (bunker). */
export function getCachedNip44Support(pubkey: string): boolean | undefined {
  return readCache()[pubkey];
}

/**
 * Record a definitive NIP-44 capability result for a pubkey, resolving
 * 'unknown' permanently. Called by the write path after a bunker's first
 * encrypt succeeds or definitively fails.
 */
export function cacheNip44Support(pubkey: string, supported: boolean): void {
  try {
    const cache = readCache();
    cache[pubkey] = supported;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Cache unavailable — bunker support stays 'unknown' next session.
  }
}

export function useNip44Support(): { supported: Nip44Support } {
  const { user } = useCurrentUser();

  if (!user) {
    return { supported: false };
  }

  if (user.method === 'bunker') {
    const cached = getCachedNip44Support(user.pubkey);
    return { supported: cached ?? 'unknown' };
  }

  try {
    return { supported: user.signer.nip44 != null };
  } catch {
    return { supported: false };
  }
}
