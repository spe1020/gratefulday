import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Hash, RefreshCw, Sparkles } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useTaggedGratitude, type TaggedFilter } from '@/hooks/useTaggedGratitude';
import { TaggedNoteCard } from '@/components/TaggedNoteCard';
import { cn } from '@/lib/utils';

const FILTERS: { value: TaggedFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'grateful', label: '#grateful' },
  { value: 'gratefulchain', label: '#gratefulchain' },
];

export function TaggedFeed() {
  const [filter, setFilter] = useState<TaggedFilter>('all');
  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTaggedGratitude(filter);

  // Flatten pages and dedup by id (relays can resend across page boundaries).
  const notes = useMemo(() => {
    const seen = new Set<string>();
    const flat: NostrEvent[] = [];
    for (const page of data?.pages ?? []) {
      for (const event of page) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        flat.push(event);
      }
    }
    return flat;
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-rose-500 shrink-0">
            <Hash className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold truncate">Tagged Gratitude</h2>
            <p className="text-sm text-muted-foreground truncate">
              Notes from across Nostr tagged #grateful & #gratefulchain
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="gap-2 shrink-0"
        >
          <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {/* Tag filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => (
          <Button
            key={value}
            variant={filter === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(value)}
            className={cn(
              'rounded-full',
              filter === value &&
                'bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700'
            )}
          >
            {label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-4 max-w-2xl mx-auto">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1 flex-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-4">
              <p className="font-medium">Couldn't load tagged notes</p>
              <p className="text-sm text-muted-foreground">
                There was a problem reaching the relays.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : notes.length > 0 ? (
        <div className="space-y-4 max-w-2xl mx-auto">
          {notes.map((event) => (
            <TaggedNoteCard key={event.id} event={event} />
          ))}
          <div className="flex justify-center pt-2">
            {hasNextPage ? (
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="gap-2"
              >
                {isFetchingNextPage && <RefreshCw className="h-4 w-4 animate-spin" />}
                Load earlier
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">You've reached the beginning.</p>
            )}
          </div>
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="max-w-sm mx-auto space-y-4">
              <div className="p-4 rounded-full bg-muted inline-flex">
                <Sparkles className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <p className="font-medium">No tagged notes yet</p>
                <p className="text-sm text-muted-foreground">
                  Share a reflection tagged #grateful to start the conversation.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
