import { useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
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
import {
  groupEntriesByDay,
  getMonthUnixBounds,
  getMonthGrid,
} from '@/lib/communityUtils';
import { formatDateString } from '@/lib/gratitudeUtils';
import { GratitudeNoteCard } from '@/components/GratitudeNoteCard';
import { DayAuthorAvatars } from '@/components/DayAuthorAvatars';
import { cn } from '@/lib/utils';

// Wider than the feed so a whole month renders; the hook over-fetches and caps.
const CALENDAR_LIMIT = 300;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function CommunityCalendar() {
  const today = useMemo(() => new Date(), []);
  const todayString = useMemo(() => formatDateString(today), [today]);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { since, until } = useMemo(
    () => getMonthUnixBounds(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const { data: events, isLoading, refetch, isRefetching } =
    useCommunityGratitude({ limit: CALENDAR_LIMIT, since, until });

  // Day attribution is always by the `d` tag (see communityUtils); since/until
  // above only bound what we fetch.
  const buckets = useMemo(() => groupEntriesByDay(events ?? []), [events]);
  const cells = useMemo(() => getMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const selectedBucket = selectedDate ? buckets.get(selectedDate) : undefined;

  const goToPrevMonth = () => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  };

  const goToNextMonth = () => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  };

  const monthHasEntries = buckets.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shrink-0">
            <CalendarDays className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold truncate">Community Calendar</h2>
            <p className="text-sm text-muted-foreground truncate">
              Public reflections by the day they were journaled
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

      <Card>
        <CardContent className="p-3 sm:p-5">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrevMonth}
              aria-label="Previous month"
              className="h-9 w-9"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h3 className="text-base sm:text-lg font-semibold">
              {MONTH_LABELS[viewMonth]} {viewYear}
            </h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNextMonth}
              aria-label="Next month"
              className="h-9 w-9"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1 sm:mb-2">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="text-center text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider py-1"
              >
                <span className="sm:hidden">{label.slice(0, 1)}</span>
                <span className="hidden sm:inline">{label}</span>
              </div>
            ))}
          </div>

          {/* Day grid */}
          {isLoading ? (
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {[...Array(35)].map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-md" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {cells.map((cell, i) => {
                if (!cell) {
                  return <div key={`pad-${i}`} className="aspect-square" />;
                }

                const bucket = buckets.get(cell.dateString);
                const hasEntries = !!bucket && bucket.noteCount > 0;
                const isToday = cell.dateString === todayString;

                return (
                  <button
                    key={cell.dateString}
                    type="button"
                    disabled={!hasEntries}
                    onClick={() => hasEntries && setSelectedDate(cell.dateString)}
                    aria-label={
                      hasEntries
                        ? `${cell.dateString}: ${bucket!.noteCount} reflection${
                            bucket!.noteCount === 1 ? '' : 's'
                          }`
                        : `${cell.dateString}: no reflections`
                    }
                    className={cn(
                      'aspect-square rounded-md border p-1 sm:p-1.5 flex flex-col items-center justify-start gap-0.5 text-left transition-colors',
                      'overflow-hidden',
                      hasEntries
                        ? 'border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 cursor-pointer'
                        : 'border-transparent text-muted-foreground/70 cursor-default',
                      isToday &&
                        'ring-2 ring-amber-500 dark:ring-amber-400 ring-offset-1 ring-offset-background'
                    )}
                  >
                    <span
                      className={cn(
                        'text-[11px] sm:text-sm font-medium leading-none mt-0.5',
                        isToday && 'text-amber-700 dark:text-amber-300 font-semibold'
                      )}
                    >
                      {cell.day}
                    </span>
                    {hasEntries && (
                      <>
                        <span className="hidden sm:flex mt-auto">
                          <DayAuthorAvatars
                            pubkeys={bucket!.authorPubkeys}
                            max={3}
                            sizeClassName="h-4 w-4"
                          />
                        </span>
                        <span className="text-[9px] sm:text-[10px] font-medium text-amber-600 dark:text-amber-400 mt-auto sm:mt-0">
                          {bucket!.noteCount}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {!isLoading && !monthHasEntries && (
            <div className="text-center py-8 px-4">
              <p className="text-sm text-muted-foreground">
                No public reflections this month yet.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Day detail */}
      <Dialog
        open={!!selectedDate}
        onOpenChange={(open) => !open && setSelectedDate(null)}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedDate &&
                new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedBucket?.events.map((event) => (
              <GratitudeNoteCard key={event.id} event={event} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
