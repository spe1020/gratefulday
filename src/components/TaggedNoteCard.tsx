import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Copy,
  Check,
  EllipsisVertical,
  EyeOff,
  UserX,
  MessageSquare,
  CornerUpLeft,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthor } from '@/hooks/useAuthor';
import { useEmbeddedEvent } from '@/hooks/useEmbeddedEvent';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import { timeAgo } from '@/lib/timeUtils';
import { resolveThreadRoot } from '@/lib/nip10';
import type { EmbedRef } from '@/lib/embedRef';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { NoteContent } from '@/components/NoteContent';
import { ReactionBar } from '@/components/ReactionBar';
import { ZapButton } from '@/components/ZapButton';
// kind 1 → NIP-10 replies. Tagged-note cards import ONLY this reply stack; the
// NIP-22 (1111) comment stack is never imported here. This structural split is
// what makes the invisible-comment trap (1111 on a kind-1 note) unreachable.
import { Nip10ReplySection } from '@/components/Nip10ReplySection';

/**
 * "replying to @rootAuthor →" affordance shown when the feed note is itself a
 * reply (gratitude in conversation). Resolves the thread root, fetches it via
 * the shared embed hook to name its author, and links to the root's nevent
 * page. Renders nothing for a non-reply note; degrades to a generic "a thread"
 * link (never a dead click) when the root can't be fetched.
 */
function ReplyingToLink({ note }: { note: NostrEvent }) {
  const root = useMemo(() => resolveThreadRoot(note), [note]);
  const ref = useMemo<EmbedRef | null>(
    () =>
      root
        ? { kind: 'event', id: root.id, relays: root.relayHint ? [root.relayHint] : undefined }
        : null,
    [root]
  );
  const { data: rootEvent, isLoading } = useEmbeddedEvent(ref, !!root);
  const author = useAuthor(rootEvent?.pubkey ?? '');

  if (!root) return null;

  let nevent: string | null = null;
  try {
    nevent = nip19.neventEncode({
      id: root.id,
      relays: root.relayHint ? [root.relayHint] : [],
      author: rootEvent?.pubkey,
    });
  } catch {
    nevent = null;
  }

  const name = rootEvent ? metadataName(author.data?.metadata, rootEvent.pubkey) : null;
  const who = isLoading ? '…' : name ? `@${name}` : 'a thread';

  const inner = (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CornerUpLeft className="h-3 w-3 shrink-0" />
      replying to {who}
    </span>
  );

  return nevent ? (
    <Link to={`/${nevent}`} className="inline-flex w-fit hover:text-foreground/80">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function metadataName(metadata: NostrMetadata | undefined, pubkey: string): string {
  return metadata?.name || genUserName(pubkey);
}

interface TaggedNoteCardProps {
  event: NostrEvent;
  /** Hide this single note locally. */
  onHide?: (id: string) => void;
  /** Mute this author locally (hides all their notes from the feed). */
  onMute?: (pubkey: string) => void;
}

export function TaggedNoteCard({ event, onHide, onMute }: TaggedNoteCardProps) {
  const author = useAuthor(event.pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;
  const displayName = metadata?.name || genUserName(event.pubkey);
  const avatarUrl = metadata?.picture;
  const [copied, setCopied] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const { toast } = useToast();

  return (
    <Card className="transition-all hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar className="h-10 w-10">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="bg-gradient-to-br from-amber-400 to-orange-500 text-white text-sm">
                {displayName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground">{timeAgo(event.created_at)}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
                <EllipsisVertical className="h-4 w-4" />
                <span className="sr-only">Open options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(event.id);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch (err) {
                    console.error('Failed to copy event id', err);
                  }
                }}
                className="gap-2"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied Event ID' : 'Copy Event ID'}
              </DropdownMenuItem>
              {(onHide || onMute) && <DropdownMenuSeparator />}
              {onHide && (
                <DropdownMenuItem
                  onClick={() => {
                    onHide(event.id);
                    toast({ title: 'Note hidden' });
                  }}
                  className="gap-2"
                >
                  <EyeOff className="h-4 w-4" />
                  Hide this note
                </DropdownMenuItem>
              )}
              {onMute && (
                <DropdownMenuItem
                  onClick={() => {
                    onMute(event.pubkey);
                    toast({
                      title: 'Author muted',
                      description: `You won't see notes from ${displayName} in this feed.`,
                    });
                  }}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <UserX className="h-4 w-4" />
                  Mute author
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <ReplyingToLink note={event} />
        <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
          <NoteContent event={event} />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1">
            <ReactionBar target={event} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowReplies((prev) => !prev)}
              aria-expanded={showReplies}
              className="h-7 gap-1 px-2 text-muted-foreground"
            >
              <MessageSquare className="h-4 w-4" />
              <span className="text-xs">Reply</span>
            </Button>
          </div>
          <ZapButton target={event} />
        </div>
        {/* Lazy: the NIP-10 thread loads only when expanded. */}
        {showReplies && <Nip10ReplySection root={event} />}
      </CardContent>
    </Card>
  );
}
