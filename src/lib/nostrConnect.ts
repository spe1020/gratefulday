import { NConnectSigner, NSecSigner } from '@nostrify/nostrify';
import { NLogin } from '@nostrify/react/login';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

import type { NPool } from '@nostrify/nostrify';
import type { NLoginType } from '@nostrify/react/login';

/**
 * Relays used to carry the NIP-46 handshake and subsequent signing traffic for
 * client-initiated (nostrconnect://) connections. Several candidates so a
 * single dead relay can't break Amber login; callers can override via
 * `opts.relays`. relay.nsec.app is Amber's built-in default.
 */
export const NOSTR_CONNECT_RELAYS = [
  'wss://relay.nsec.app',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

/**
 * Every permission the app may ever need, requested up front so the signer
 * prompts the user once with the full list. Piecemeal grants are how users end
 * up with stale per-method denials that make later features fail silently.
 * Kinds: 0 profile, 1 notes, 3 follows, 5 deletions, 6 reposts, 7 reactions,
 * 1111 comments, 9734 zap requests, 30078 app settings, 36669 gratitude
 * entries.
 */
const REQUESTED_PERMS = [
  'get_public_key',
  'sign_event:0',
  'sign_event:1',
  'sign_event:3',
  'sign_event:5',
  'sign_event:6',
  'sign_event:7',
  'sign_event:1111',
  'sign_event:9734',
  'sign_event:30078',
  'sign_event:36669',
  'nip44_encrypt',
  'nip44_decrypt',
  'nip04_encrypt',
  'nip04_decrypt',
].join(',');

export interface NostrConnectSession {
  /** The nostrconnect:// URI to open in the signer app (or copy/scan). */
  uri: string;
  /** Resolves with a ready-to-use login once the signer approves. */
  established: Promise<NLoginType>;
  /** Stop listening (dialog closed, user backed out). */
  cancel: () => void;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Start a client-initiated NIP-46 connection (`nostrconnect://`), the flow
 * signer apps like Amber understand natively: we mint a client keypair and a
 * one-time secret, the user opens the URI in the signer, and the signer sends
 * a `connect` response back over the relay. The response author is the
 * remote-signer pubkey; we verify the echoed secret, then ask for the user
 * pubkey and hand back a standard bunker-type login.
 */
export function startNostrConnect(
  pool: NPool,
  opts: { name: string; url?: string; relays?: string[] } = { name: 'gratefulday.space' },
): NostrConnectSession {
  const relays = opts.relays ?? NOSTR_CONNECT_RELAYS;
  const sk = generateSecretKey();
  const clientPubkey = getPublicKey(sk);
  const clientSigner = new NSecSigner(sk);
  const secret = randomSecret();

  const params = new URLSearchParams();
  for (const relay of relays) params.append('relay', relay);
  params.set('secret', secret);
  params.set('perms', REQUESTED_PERMS);
  params.set('name', opts.name);
  if (opts.url) params.set('url', opts.url);

  const uri = `nostrconnect://${clientPubkey}?${params.toString()}`;

  const controller = new AbortController();
  const group = pool.group(relays);

  const established = (async (): Promise<NLoginType> => {
    let remoteSignerPubkey: string | undefined;

    for await (const msg of group.req(
      [{ kinds: [24133], '#p': [clientPubkey] }],
      { signal: controller.signal },
    )) {
      if (msg[0] !== 'EVENT') continue;
      const event = msg[2];

      let plaintext: string;
      try {
        plaintext = await clientSigner.nip44.decrypt(event.pubkey, event.content);
      } catch {
        try {
          plaintext = await clientSigner.nip04.decrypt(event.pubkey, event.content);
        } catch {
          continue; // not for us / garbled
        }
      }

      try {
        const response = JSON.parse(plaintext) as { result?: string };
        // The secret in the response is what proves this author is the signer
        // the user actually approved in, not a bystander who saw the URI.
        if (response.result === secret) {
          remoteSignerPubkey = event.pubkey;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!remoteSignerPubkey) {
      throw new Error('Connection cancelled');
    }

    const signer = new NConnectSigner({
      relay: group,
      pubkey: remoteSignerPubkey,
      signer: clientSigner,
      timeout: 60_000,
    });
    const userPubkey = await signer.getPublicKey();

    return new NLogin('bunker', userPubkey, {
      bunkerPubkey: remoteSignerPubkey,
      clientNsec: nip19.nsecEncode(sk),
      relays,
    }) as NLoginType;
  })();

  return {
    uri,
    established,
    cancel: () => controller.abort(),
  };
}
