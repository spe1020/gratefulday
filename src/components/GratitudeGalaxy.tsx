import { useMemo, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCommunityGratitude } from '@/hooks/useGratitudeEntries';
import { groupEntriesByDay } from '@/lib/communityUtils';
import { GratitudeNoteCard } from '@/components/GratitudeNoteCard';
import { cn } from '@/lib/utils';

// Trailing window: a year of public reflections, capped so the SVG never janks.
const GALAXY_LIMIT = 500;
const WINDOW_MONTHS = 12;
// Above this many individual entries, collapse to one star per day so node
// count stays bounded (see Phase 0).
const AGGREGATION_THRESHOLD = 150;
const SECONDS_PER_DAY = 24 * 60 * 60;

// SVG geometry (viewBox units).
const VIEW = 640;
const CENTER = VIEW / 2;
const INNER_RADIUS = 58;
const RING_STEP = 22;

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface GalaxyNode {
  key: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  label: string;
  events: NostrEvent[];
}

function hashPubkey(pubkey: string): number {
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = (hash * 31 + pubkey.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Consistent warm hue per author (red→amber band) for the warm aesthetic. */
function authorColor(pubkey: string): string {
  const hue = (hashPubkey(pubkey) % 50) + 5; // 5–55
  return `hsl(${hue} 85% 58%)`;
}

/** Entry-count-in-window proxy radius. NOTE: approximation, not a true streak. */
function radiusForCount(count: number): number {
  if (count >= 30) return 6;
  if (count >= 7) return 4.5;
  return 3;
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

export function GratitudeGalaxy() {
  // Stable trailing window computed once per mount.
  const { since, until } = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return { since: now - (WINDOW_MONTHS * 31 + 5) * SECONDS_PER_DAY, until: now };
  }, []);

  const { data: events, isLoading, refetch, isRefetching } =
    useCommunityGratitude({ limit: GALAXY_LIMIT, since, until });

  const [selected, setSelected] = useState<GalaxyNode | null>(null);

  // Grouping keys off the `d` tag and defensively drops encrypted entries.
  const buckets = useMemo(() => groupEntriesByDay(events ?? []), [events]);

  const { nodes, aggregated, totalEntries, rings } = useMemo(() => {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth(); // 0-indexed

    // Per-author entry counts across the whole fetched window (size proxy).
    const authorCounts = new Map<string, number>();
    let total = 0;
    for (const bucket of buckets.values()) {
      total += bucket.noteCount;
      for (const event of bucket.events) {
        authorCounts.set(event.pubkey, (authorCounts.get(event.pubkey) ?? 0) + 1);
      }
    }

    const aggregate = total > AGGREGATION_THRESHOLD;

    // Concentric month rings: recent month outermost ("expanding universe").
    const ringMeta = Array.from({ length: WINDOW_MONTHS }, (_, monthsAgo) => {
      const d = new Date(curYear, curMonth - monthsAgo, 1);
      return {
        radius: INNER_RADIUS + (WINDOW_MONTHS - 1 - monthsAgo) * RING_STEP,
        label: MONTH_ABBR[d.getMonth()],
      };
    });

    const built: GalaxyNode[] = [];

    const placeAngle = (year: number, month1: number, day: number) => {
      const fraction = (day - 1) / daysInMonth(year, month1);
      return -Math.PI / 2 + fraction * Math.PI * 2; // day 1 at top, clockwise
    };

    for (const bucket of buckets.values()) {
      const [yStr, mStr, dStr] = bucket.dateString.split('-');
      const year = Number(yStr);
      const month1 = Number(mStr); // 1-indexed
      const day = Number(dStr);

      const monthsAgo = (curYear - year) * 12 + (curMonth - (month1 - 1));
      if (monthsAgo < 0 || monthsAgo >= WINDOW_MONTHS) continue;

      const radius = INNER_RADIUS + (WINDOW_MONTHS - 1 - monthsAgo) * RING_STEP;
      const angle = placeAngle(year, month1, day);
      const baseX = CENTER + radius * Math.cos(angle);
      const baseY = CENTER + radius * Math.sin(angle);

      if (aggregate) {
        const multiAuthor = bucket.authorPubkeys.length > 1;
        built.push({
          key: bucket.dateString,
          cx: baseX,
          cy: baseY,
          r: Math.min(3 + bucket.noteCount * 0.8, 9),
          color: multiAuthor
            ? 'hsl(35 90% 55%)'
            : authorColor(bucket.authorPubkeys[0]),
          label: bucket.dateString,
          events: bucket.events,
        });
      } else {
        // Spread same-day entries slightly around the ring point so they don't
        // perfectly overlap.
        bucket.events.forEach((event, idx) => {
          const spread = bucket.events.length > 1 ? (idx - (bucket.events.length - 1) / 2) * 0.04 : 0;
          const a = angle + spread;
          built.push({
            key: event.id,
            cx: CENTER + radius * Math.cos(a),
            cy: CENTER + radius * Math.sin(a),
            r: radiusForCount(authorCounts.get(event.pubkey) ?? 1),
            color: authorColor(event.pubkey),
            label: bucket.dateString,
            events: [event],
          });
        });
      }
    }

    return { nodes: built, aggregated: aggregate, totalEntries: total, rings: ringMeta };
  }, [buckets]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shrink-0">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold truncate">Gratitude Galaxy</h2>
            <p className="text-sm text-muted-foreground truncate">
              A living map of public gratitude over the past year
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

      <Card className="overflow-hidden bg-gradient-to-b from-amber-50/60 to-orange-50/40 dark:from-gray-950 dark:to-gray-900">
        <CardContent className="p-2 sm:p-4">
          {isLoading ? (
            <Skeleton className="w-full aspect-square max-w-2xl mx-auto rounded-full" />
          ) : nodes.length === 0 ? (
            <div className="text-center py-16 px-4">
              <p className="text-sm text-muted-foreground">
                No public reflections in the last year yet. Be the first star.
              </p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${VIEW} ${VIEW}`}
                className="w-full h-auto min-w-[340px] max-w-2xl mx-auto block"
                role="img"
                aria-label={`Galaxy of ${totalEntries} public reflections`}
              >
                {/* Central glow ("now") */}
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={INNER_RADIUS - 18}
                  fill="hsl(35 95% 60%)"
                  opacity={0.12}
                />
                <circle cx={CENTER} cy={CENTER} r={4} fill="hsl(35 95% 55%)" />

                {/* Month rings */}
                {rings.map((ring, i) => (
                  <g key={`ring-${i}`}>
                    <circle
                      cx={CENTER}
                      cy={CENTER}
                      r={ring.radius}
                      fill="none"
                      className="stroke-amber-300/30 dark:stroke-amber-700/30"
                      strokeWidth={1}
                    />
                    <text
                      x={CENTER}
                      y={CENTER - ring.radius - 3}
                      textAnchor="middle"
                      className="fill-muted-foreground"
                      fontSize={8}
                      opacity={0.7}
                    >
                      {ring.label}
                    </text>
                  </g>
                ))}

                {/* Stars */}
                {nodes.map((node, i) => (
                  <g
                    key={node.key}
                    onClick={() => setSelected(node)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(node);
                      }
                    }}
                    tabIndex={0}
                    className="cursor-pointer focus:outline-none focus-visible:outline-2 focus-visible:outline-amber-500"
                    role="button"
                    aria-label={`${node.events.length} reflection${
                      node.events.length === 1 ? '' : 's'
                    } on ${node.label}`}
                  >
                    {/* Glow halo */}
                    <circle
                      cx={node.cx}
                      cy={node.cy}
                      r={node.r * 2.3}
                      fill={node.color}
                      opacity={0.18}
                      className="galaxy-glow"
                      style={{ animationDelay: `${(i % 12) * 0.25}s` }}
                    />
                    {/* Core */}
                    <circle cx={node.cx} cy={node.cy} r={node.r} fill={node.color} />
                    {/* Touch target */}
                    <circle
                      cx={node.cx}
                      cy={node.cy}
                      r={Math.max(node.r + 7, 12)}
                      fill="transparent"
                    />
                  </g>
                ))}
              </svg>
            </div>
          )}

          {/* Legend */}
          {!isLoading && nodes.length > 0 && (
            <div className="mt-4 space-y-1 text-center text-xs text-muted-foreground max-w-xl mx-auto">
              <p>
                Each star is a public reflection, placed by the day it was journaled.
                Rings are months — recent on the outside.
              </p>
              <p>
                Star size ≈ how many days that person journaled this year
                <span className="italic"> (an approximation, not a verified streak)</span>;
                color is per author.
              </p>
              {aggregated && (
                <p className="text-amber-600 dark:text-amber-400">
                  Busy window — showing one star per day ({totalEntries} reflections).
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Star detail */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selected &&
                new Date(`${selected.label}T00:00:00`).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selected?.events.map((event) => (
              <GratitudeNoteCard key={event.id} event={event} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
