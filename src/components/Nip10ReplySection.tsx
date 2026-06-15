import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquare } from 'lucide-react';
import { useNip10Replies } from '@/hooks/useNip10Replies';
import { usePostReply } from '@/hooks/usePostReply';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { NoteContent } from '@/components/NoteContent';

/** One reply in the flat NIP-10 thread. */
function ReplyItem({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name || genUserName(event.pubkey);

  return (
    <div className="flex gap-2">
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarImage src={metadata?.picture} alt={displayName} />
        <AvatarFallback className="bg-gradient-to-br from-amber-400 to-orange-500 text-white text-xs">
          {displayName.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold truncate">{displayName}</p>
        <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
          <NoteContent event={event} />
        </div>
      </div>
    </div>
  );
}

/**
 * NIP-10 reply thread + composer for a kind-1 tagged note. Replies post as
 * real kind-1 NIP-10 replies so they appear in other clients' threads. Mounted
 * only by TaggedNoteCard (on expand) — never used for 36669 journal entries.
 */
export function Nip10ReplySection({ root }: { root: NostrEvent }) {
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { data: replies, isLoading } = useNip10Replies(root);
  const { mutate: postReply, isPending } = usePostReply();
  const [text, setText] = useState('');

  const submit = () => {
    const content = text.trim();
    if (!content) return;
    postReply(
      { target: root, content },
      {
        onSuccess: () => {
          setText('');
          toast({ title: 'Reply posted', description: 'Your reply is on Nostr.' });
        },
        onError: () => {
          toast({
            title: 'Reply failed',
            description: 'Could not publish to relays. Try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : replies && replies.length > 0 ? (
        <div className="space-y-3">
          {replies.map((reply) => (
            <ReplyItem key={reply.id} event={reply} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />
          No replies yet.
        </p>
      )}

      {user ? (
        <div className="space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply…"
            rows={2}
            className="text-sm"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={isPending || !text.trim()}>
              {isPending ? 'Posting…' : 'Reply'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Log in to reply.</p>
      )}
    </div>
  );
}
