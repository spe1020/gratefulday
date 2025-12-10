import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Heart, RefreshCw, Users, Copy, Check, EllipsisVertical } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCommunityGratitude } from '@/hooks/useGratitudeEntries';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { NoteContent } from '@/components/NoteContent';

import { NoteContentWithMentions } from './NoteContentWithMentions';

function GratitudePost({ event }: { event: NostrEvent }) {
  const author = useAuthor(event.pubkey);
  const metadata: NostrMetadata | undefined = author.data?.metadata;
  const displayName = metadata?.name || genUserName(event.pubkey);
  const avatarUrl = metadata?.picture;
  const [showId, setShowId] = useState(false);
  const [copied, setCopied] = useState(false);

  const dayTag = event.tags.find(([name]) => name === 'day')?.[1];
  const dateTag = event.tags.find(([name]) => name === 'd')?.[1];

  const formattedDate = dateTag
    ? new Date(dateTag).toLocaleDateString('en-US', {
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
      </CardContent>
    </Card>
  );
}

// Blocked event IDs (client-side filtering for specific posts)
const BLOCKED_EVENT_IDS: readonly string[] = [
  '7dc5075c9ed84b5411b5ee2188a510e8359f7d0a22b909157ce2773265a61a70',
];

export function CommunityFeed() {
  const [limit] = useState(20);
  const { data: posts, isLoading, refetch, isRefetching } = useCommunityGratitude(limit);
  const visiblePosts = posts?.filter((p) => !BLOCKED_EVENT_IDS.includes(p.id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600">
            <Users className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Community Reflections</h2>
            <p className="text-sm text-muted-foreground">
              Reflections shared by the gratefulday.space community
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1 flex-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : visiblePosts && visiblePosts.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visiblePosts.map((post) => (
            <GratitudePost key={post.id} event={post} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-4">
              <div className="p-4 rounded-full bg-muted inline-flex">
                <Heart className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <p className="font-medium">No reflections yet</p>
                <p className="text-sm text-muted-foreground">
                  Be the first to share your reflection with the gratefulday.space community!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
