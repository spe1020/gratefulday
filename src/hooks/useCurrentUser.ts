import { type NLoginType, NUser, useNostrLogin } from '@nostrify/react/login';
import { useNostr } from '@nostrify/react';
import { NConnectSigner, NSecSigner, type NPool } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { useCallback, useMemo } from 'react';

import { useAuthor } from './useAuthor.ts';

type BunkerLogin = Extract<NLoginType, { type: 'bunker' }>;

/**
 * Rebuild a NIP-46 user from a stored bunker login.
 *
 * Not NUser.fromBunkerLogin: that helper addresses requests to `login.pubkey`
 * (the USER key), but NIP-46 requests must go to the REMOTE SIGNER key, and
 * signers like Amber answer nostrconnect sessions from a dedicated key that is
 * not the user's. Requests sent to the user key never reach the signer — and
 * can be answered "Not authorized" by an unrelated bunker service (nsec.app)
 * that happens to hold that key.
 */
function userFromBunkerLogin(login: BunkerLogin, pool: NPool): NUser {
  const clientSk = nip19.decode(login.data.clientNsec);
  if (clientSk.type !== 'nsec') {
    throw new Error('Invalid client nsec in bunker login');
  }
  const signer = new NConnectSigner({
    relay: pool.group(login.data.relays),
    // Logins stored before bunkerPubkey existed fall back to the legacy
    // behavior, where the remote signer key IS the user key.
    pubkey: login.data.bunkerPubkey || login.pubkey,
    signer: new NSecSigner(clientSk.data),
    timeout: 60_000,
  });
  return new NUser(login.type, login.pubkey, signer);
}

export function useCurrentUser() {
  const { nostr } = useNostr();
  const { logins } = useNostrLogin();

  const loginToUser = useCallback((login: NLoginType): NUser  => {
    switch (login.type) {
      case 'nsec': // Nostr login with secret key
        return NUser.fromNsecLogin(login);
      case 'bunker': // Nostr login over NIP-46 (bunker:// or nostrconnect://)
        return userFromBunkerLogin(login, nostr);
      case 'extension': // Nostr login with NIP-07 browser extension
        return NUser.fromExtensionLogin(login);
      // Other login types can be defined here
      default:
        throw new Error(`Unsupported login type: ${login.type}`);
    }
  }, [nostr]);

  const users = useMemo(() => {
    const users: NUser[] = [];

    for (const login of logins) {
      try {
        const user = loginToUser(login);
        users.push(user);
      } catch (error) {
        console.warn('Skipped invalid login', login.id, error);
      }
    }

    return users;
  }, [logins, loginToUser]);

  const user = users[0] as NUser | undefined;
  const author = useAuthor(user?.pubkey);

  return {
    user,
    users,
    ...author.data,
  };
}
