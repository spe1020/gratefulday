import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useNostrPublish } from '@/hooks/useNostrPublish';
import { buildNip10ReplyTags } from '@/lib/nip10';

interface PostReplyParams {
  /**
   * The kind-1 note being replied to. May itself be a reply (gratitude-tagged
   * replies now appear in the feed), so buildNip10ReplyTags derives the correct
   * root/reply markers from its shape — it is NOT assumed to be a thread root.
   */
  target: NostrEvent;
  content: string;
}

/**
 * Post a NIP-10 (kind 1) reply to an open-network tagged note, so it threads in
 * other clients (Damus/Primal/Amethyst). Markers (single root vs. root+reply)
 * come from buildNip10ReplyTags based on the target's shape. NEVER use this for
 * 36669 (use the NIP-22 path); this is only reachable from TaggedNoteCard.
 */
export function usePostReply() {
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ target, content }: PostReplyParams) => {
      return publish({ kind: 1, content, tags: buildNip10ReplyTags(target) });
    },
    onSuccess: (_event, { target }) => {
      queryClient.invalidateQueries({ queryKey: ['nip10-replies', target.id] });
    },
  });
}
