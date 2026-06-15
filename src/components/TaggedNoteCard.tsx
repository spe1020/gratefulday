import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Copy, Check, EllipsisVertical, EyeOff, UserX } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthor } from '@/hooks/useAuthor';
import { useToast } from '@/hooks/useToast';
import { genUserName } from '@/lib/genUserName';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { NoteContent } from '@/components/NoteContent';
import { ReactionBar } from '@/components/ReactionBar';
import { ZapButton } from '@/components/ZapButton';

/** Compact relative timestamp, e.g. "3h", "2d", or a date past a week. */
function timeAgo(createdAt: number): string {
  const seconds = Math.floor(Date.now() / 1000) - createdAt;
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(createdAt * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
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
        <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
          <NoteContent event={event} />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <ReactionBar target={event} />
          <ZapButton target={event} />
        </div>
      </CardContent>
    </Card>
  );
}
