import { useNostr } from "@nostrify/react";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { useCurrentUser } from "./useCurrentUser";

import type { NostrEvent, NostrSigner } from "@nostrify/nostrify";

const SIGN_TIMEOUT_MS = 20_000;

export class SignerTimeoutError extends Error {
  constructor() {
    super("Your signer did not respond in time");
    this.name = "SignerTimeoutError";
  }
}

/**
 * Sign with a hard timeout. NIP-46 bunker signers round-trip over relays and
 * can hang indefinitely; without a bound the save never settles and the user
 * gets no error at all.
 */
async function signWithTimeout(
  signer: NostrSigner,
  event: Parameters<NostrSigner["signEvent"]>[0]
): Promise<NostrEvent> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      signer.signEvent(event),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SignerTimeoutError()), SIGN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function useNostrPublish(): UseMutationResult<NostrEvent> {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (t: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => {
      if (user) {
        const tags = t.tags ?? [];

        // Add the client tag if it doesn't exist
        if (location.protocol === "https:" && !tags.some(([name]) => name === "client")) {
          tags.push(["client", location.hostname]);
        }

        const event = await signWithTimeout(user.signer, {
          kind: t.kind,
          content: t.content ?? "",
          tags,
          created_at: t.created_at ?? Math.floor(Date.now() / 1000),
        });

        await nostr.event(event, { signal: AbortSignal.timeout(5000) });
        return event;
      } else {
        throw new Error("User is not logged in");
      }
    },
    onError: (error) => {
      // Deliberately not gated behind DEV: a publish failure is diagnostic
      // information, and hiding it in production leaves a user staring at
      // "failed to save" with the reason recorded nowhere.
      console.error("Failed to publish event:", error);
      if (error instanceof AggregateError) {
        // Promise.any collects one reason per relay; without this only the
        // opaque "All promises were rejected" is visible.
        console.error("Relay rejections:", error.errors);
      }
    },
    onSuccess: (data) => {
      console.log("Event published successfully:", data);
    },
  });
}
