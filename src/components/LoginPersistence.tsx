import { useEffect, useRef } from 'react';
import { useNostrLogin } from '@nostrify/react/login';
import type { NLoginType } from '@nostrify/react/login';

/**
 * Keeps the user logged in across storage loss they didn't ask for.
 *
 * The login provider persists to the generic `nostr:login` key with no
 * cross-tab sync and no recovery: mobile browsers evict site data under
 * storage pressure, a tab resumed from memory keeps whatever login state it
 * had when it was backgrounded, and any other nostr app served from the same
 * origin reads and writes that same key. Any of those shows up to the user
 * as "I was logged out for being idle."
 *
 * Defense, all through the provider's public API:
 * - Mirror the logins to an app-namespaced backup key whenever they change.
 * - On boot with no logins, restore them from the backup.
 * - On tab resume, adopt logins that exist in storage but not in memory
 *   (another tab logged in), and rewrite storage if it was wiped while this
 *   tab was alive.
 *
 * An explicit in-app logout flows through React state (logins -> empty), so
 * it clears the backup too — deliberate logout still sticks. Clearing site
 * data in the browser removes both keys, so that also still logs out.
 * The backup holds exactly what `nostr:login` already holds on the same
 * origin, so it adds no new exposure.
 */

/** Must match the NostrLoginProvider storageKey in App.tsx. */
const PRIMARY_KEY = 'nostr:login';
export const LOGIN_BACKUP_KEY = 'gratefulday:login-backup:v1';

function readLogins(key: string): NLoginType[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (login): login is NLoginType =>
        !!login && typeof login === 'object' && typeof login.id === 'string'
    );
  } catch {
    return [];
  }
}

function writeKey(key: string, logins: readonly NLoginType[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(logins));
  } catch {
    // Persistence unavailable — nothing to protect then either.
  }
}

export function LoginPersistence() {
  const { logins, addLogin } = useNostrLogin();
  // True from a restore dispatch until the restored logins land in state, so
  // the mirror effect can't misread the not-yet-updated empty state as an
  // explicit logout and delete the backup it is restoring from.
  const restorePendingRef = useRef(false);
  const didInitRef = useRef(false);

  // Boot restore: no logins but a backup exists -> log back in from it.
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (logins.length > 0) return;
    const backup = readLogins(LOGIN_BACKUP_KEY);
    if (backup.length === 0) return;
    restorePendingRef.current = true;
    backup.forEach((login) => addLogin(login));
    // Mount-only by design; logins/addLogin are stable enough for this check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror: logins present -> keep the backup fresh; logins emptied by an
  // in-app action (logout / remove account) -> the backup goes too.
  useEffect(() => {
    if (logins.length > 0) {
      restorePendingRef.current = false;
      writeKey(LOGIN_BACKUP_KEY, logins);
      return;
    }
    if (!restorePendingRef.current) {
      try {
        localStorage.removeItem(LOGIN_BACKUP_KEY);
      } catch {
        // Nothing stored anywhere — nothing to clear.
      }
    }
  }, [logins]);

  // Resume sync: a tab coming back from the background re-checks storage.
  useEffect(() => {
    const sync = () => {
      const stored = readLogins(PRIMARY_KEY);

      if (logins.length === 0) {
        // This tab predates a login made elsewhere — adopt it.
        stored.forEach((login) => addLogin(login));
        return;
      }

      // Storage was wiped (eviction, another app on the origin) while this
      // tab held a live session: heal it so the next reload doesn't log the
      // user out.
      if (stored.length === 0) {
        writeKey(PRIMARY_KEY, logins);
        writeKey(LOGIN_BACKUP_KEY, logins);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };

    window.addEventListener('pageshow', sync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', sync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [logins, addLogin]);

  return null;
}
