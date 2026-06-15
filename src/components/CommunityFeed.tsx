import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Heart, RefreshCw, Users } from 'lucide-react';
import { useCommunityGratitude } from '@/hooks/useGratitudeEntries';
import { useTaggedGratitude } from '@/hooks/useTaggedGratitude';
import { useFeedModeration } from '@/hooks/useFeedModeration';
import { GratitudeNoteCard } from '@/components/GratitudeNoteCard';
import { TaggedNoteCard } from '@/components/TaggedNoteCard';
import { mergeFeedEvents } from '@/lib/communityFeedUtils';
import { cn } from '@/lib/utils';

// "Load earlier" widens the journal window by re-querying a larger limit (the
// 36669 hook isn't infinite). Bounded by a ceiling so the growing-window
// re-query can't silently degrade at volume — a known v1 simplification; a
// proper `until`-cursor for 36669 is the follow-up.
const JOURNAL_PAGE = 20;
const JOURNAL_MAX = 200;

export function CommunityFeed() {
  const [journalLimit, setJournalLimit] = useState(JOURNAL_PAGE);

  const journal = useCommunityGratitude(journalLimit);
  const tagged = useTaggedGratitude('all');
  const { hiddenIds, mutedPubkeys, hideNote, mutePubkey } = useFeedModeration();

  // Interleave both sources newest-first; kind-1 moderation applied, journal
  // entries left untouched (first-party). Each card routes by event.kind.
  const events = useMemo(
    () =>
      mergeFeedEvents(journal.data ?? [], (tagged.data?.pages ?? []).flat(), {
        hiddenIds,
        mutedPubkeys,
      }),
    [journal.data, tagged.data, hiddenIds, mutedPubkeys]
  );

  const isLoading = journal.isLoading || tagged.isLoading;
  const isError = journal.isError && tagged.isError;
  const isRefetching = journal.isRefetching || tagged.isRefetching;

  const canWidenJournal = journalLimit < JOURNAL_MAX;
  const hasMore = canWidenJournal || tagged.hasNextPage;
  const isLoadingMore = tagged.isFetchingNextPage;

  const refresh = () => {
    journal.refetch();
    tagged.refetch();
  };

  const loadEarlier = () => {
    if (canWidenJournal) setJournalLimit((n) => Math.min(n + JOURNAL_PAGE, JOURNAL_MAX));
    if (tagged.hasNextPage) tagged.fetchNextPage();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 shrink-0">
            <Users className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold truncate">Community</h2>
            <p className="text-sm text-muted-foreground truncate">
              Journal entries & tagged notes from across Nostr
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isRefetching}
          className="gap-2 shrink-0"
        >
          <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
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
              <p className="font-medium">Couldn't load the community feed</p>
              <p className="text-sm text-muted-foreground">
                There was a problem reaching the relays.
              </p>
              <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : events.length > 0 ? (
        <div className="space-y-4 max-w-2xl mx-auto">
          {events.map((event) =>
            event.kind === 36669 ? (
              <GratitudeNoteCard key={event.id} event={event} />
            ) : (
              <TaggedNoteCard
                key={event.id}
                event={event}
                onHide={hideNote}
                onMute={mutePubkey}
              />
            )
          )}
          <div className="flex justify-center pt-2">
            {hasMore ? (
              <Button
                variant="outline"
                onClick={loadEarlier}
                disabled={isLoadingMore}
                className="gap-2"
              >
                {isLoadingMore && <RefreshCw className="h-4 w-4 animate-spin" />}
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
                <Heart className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <p className="font-medium">No reflections yet</p>
                <p className="text-sm text-muted-foreground">
                  Share a reflection or post a note tagged #grateful to start the conversation.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
