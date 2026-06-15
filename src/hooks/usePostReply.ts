import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useNostrPublish } from '@/hooks/useNostrPublish';
import { buildNip10ReplyTags } from '@/lib/nip10';

interface PostReplyParams {
  /** The kind-1 root note being replied to. */
  root: NostrEvent;
  content: string;
}

/**
 * Post a NIP-10 (kind 1) reply to an open-network tagged note, so it threads in
 * other clients (Damus/Primal/Amethyst). Direct reply → a single root-marked
 * `e` tag + `p` tags via buildNip10ReplyTags. NEVER use this for 36669 (use the
 * NIP-22 path); this is only reachable from TaggedNoteCard.
 */
export function usePostReply() {
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ root, content }: PostReplyParams) => {
      return publish({ kind: 1, content, tags: buildNip10ReplyTags(root) });
    },
    onSuccess: (_event, { root }) => {
      queryClient.invalidateQueries({ queryKey: ['nip10-replies', root.id] });
    },
  });
}
