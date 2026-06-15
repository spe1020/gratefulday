import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Copy, Check, EllipsisVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { NoteContent } from '@/components/NoteContent';
import { ReactionBar } from '@/components/ReactionBar';
import { ZapButton } from '@/components/ZapButton';

interface GratitudeNoteCardProps {
  event: NostrEvent;
}

export function GratitudeNoteCard({ event }: GratitudeNoteCardProps) {
  const author = useAuthor(event.pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;
  const displayName = metadata?.name || genUserName(event.pubkey);
  const avatarUrl = metadata?.picture;
  const [showId, setShowId] = useState(false);
  const [copied, setCopied] = useState(false);

  const dayTag = event.tags.find(([name]) => name === 'day')?.[1];
  const dateTag = event.tags.find(([name]) => name === 'd')?.[1];

  // The `d` tag is a local-tz date string; parse at local midnight so negative
  // timezones don't render the previous day (bare `new Date('YYYY-MM-DD')` is UTC).
  const formattedDate = dateTag
    ? new Date(`${dateTag}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : '';

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
              <p className="text-xs text-muted-foreground">
                Day {dayTag} • {formattedDate}
              </p>
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
              <DropdownMenuItem onClick={() => setShowId((prev) => !prev)} className="gap-2">
                {showId ? 'Hide Event ID' : 'Show Event ID'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <div className="text-sm text-foreground/90 break-all sm:break-words sm:line-clamp-4">
          <NoteContent event={event} />
        </div>
        {showId && (
          <div className="p-2 rounded-md bg-muted text-xs break-all border border-muted-foreground/10">
            {event.id}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <ReactionBar target={event} />
          <ZapButton target={event} />
        </div>
      </CardContent>
    </Card>
  );
}
