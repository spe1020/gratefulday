import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Heart, RefreshCw, Users } from 'lucide-react';
import { useCommunityGratitude } from '@/hooks/useGratitudeEntries';
import { GratitudeNoteCard } from '@/components/GratitudeNoteCard';

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
            <GratitudeNoteCard key={post.id} event={post} />
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
