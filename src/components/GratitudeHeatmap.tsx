import { useMemo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGratitudeEntries } from '@/hooks/useGratitudeEntries';
import { getEntryDateStrings } from '@/lib/streakUtils';
import { formatDateString } from '@/lib/gratitudeUtils';
import { cn } from '@/lib/utils';

/**
 * GitHub-style contribution grid of days that have a gratitude entry.
 *
 * PRIVACY: this is strictly presence-based — it reads only the public `d`-tag
 * dates (which days were journaled) via getEntryDateStrings and NEVER decrypts
 * or reads entry content. It renders identically for public and private
 * entries. (Note-count intensity is intentionally out of scope; it would
 * require bulk-decrypting private entries.)
 */

const WEEKS = 53; // trailing ~12 months, aligned to whole weeks
const CELL = 11; // px
const GAP = 3; // px
const COL = CELL + GAP;

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface HeatCell {
  key: string;
  date: Date;
  inRange: boolean;
  hasEntry: boolean;
}

/** Local-midnight copy, so the grid aligns to local-tz `d` tags. */
function atMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildWeeks(entryDates: Set<string>, today: Date): HeatCell[][] {
  const end = atMidnight(today);
  // Sunday of the current week, then back (WEEKS - 1) weeks for the first column.
  const lastSunday = new Date(end);
  lastSunday.setDate(end.getDate() - end.getDay());
  const firstSunday = new Date(lastSunday);
  firstSunday.setDate(lastSunday.getDate() - (WEEKS - 1) * 7);

  const weeks: HeatCell[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const column: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(firstSunday);
      date.setDate(firstSunday.getDate() + w * 7 + d);
      const inRange = date.getTime() <= end.getTime();
      const key = formatDateString(date);
      column.push({
        key,
        date,
        inRange,
        hasEntry: inRange && entryDates.has(key),
      });
    }
    weeks.push(column);
  }
  return weeks;
}

/** Month label per column, shown when the column's month differs from the prior one. */
function monthLabels(weeks: HeatCell[][]): { w: number; label: string }[] {
  const labels: { w: number; label: string }[] = [];
  let prevMonth = -1;
  weeks.forEach((column, w) => {
    const month = column[0].date.getMonth();
    if (month !== prevMonth) {
      labels.push({ w, label: MONTH_LABELS[month] });
      prevMonth = month;
    }
  });
  return labels;
}

interface GratitudeHeatmapProps {
  /** Injectable "today" for deterministic tests; defaults to now. */
  today?: Date;
}

export function GratitudeHeatmap({ today }: GratitudeHeatmapProps) {
  const { user } = useCurrentUser();
  const { data: entries, isLoading } = useGratitudeEntries(user?.pubkey);

  const now = today ?? new Date();
  const nowKey = formatDateString(atMidnight(now));

  const { weeks, labels, count } = useMemo(() => {
    const dates = getEntryDateStrings(entries ?? []);
    const builtWeeks = buildWeeks(dates, now);
    return {
      weeks: builtWeeks,
      labels: monthLabels(builtWeeks),
      count: dates.size,
    };
    // nowKey pins the memo to the local day, not every render's clock read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, nowKey]);

  // Mirror StreakBadge: self-hide while logged out, loading, or before any
  // entry exists — so there's no empty-grid layout shift.
  if (!user || isLoading || count === 0) {
    return null;
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 sm:mt-6 animate-in fade-in-50">
      <div className="rounded-xl border border-amber-200/60 dark:border-amber-900/40 bg-white/50 dark:bg-gray-900/40 px-4 py-3 sm:px-5 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Your year of gratitude
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
            Less
            <span className="inline-block rounded-[2px] bg-amber-100 dark:bg-gray-800" style={{ width: CELL, height: CELL }} />
            <span className="inline-block rounded-[2px] bg-amber-500 dark:bg-amber-400" style={{ width: CELL, height: CELL }} />
            More
          </span>
        </div>

        <div
          className="overflow-x-auto pb-1"
          role="img"
          aria-label={`Gratitude heatmap: ${count} ${count === 1 ? 'day' : 'days'} with an entry in the last 12 months`}
        >
          <div className="inline-block min-w-max">
            {/* Month labels, absolutely positioned over their starting column */}
            <div className="relative h-4" aria-hidden="true">
              {labels.map(({ w, label }) => (
                <span
                  key={`${w}-${label}`}
                  className="absolute top-0 text-[10px] text-muted-foreground"
                  style={{ left: w * COL }}
                >
                  {label}
                </span>
              ))}
            </div>

            {/* Week columns */}
            <div className="flex" style={{ gap: GAP }} aria-hidden="true">
              {weeks.map((column, w) => (
                <div key={w} className="flex flex-col" style={{ gap: GAP }}>
                  {column.map((cell) => (
                    <div
                      key={cell.key}
                      title={
                        cell.inRange
                          ? `${cell.date.toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })} — ${cell.hasEntry ? 'reflected' : 'no entry'}`
                          : undefined
                      }
                      style={{ width: CELL, height: CELL }}
                      className={cn(
                        'rounded-[2px]',
                        !cell.inRange
                          ? 'bg-transparent'
                          : cell.hasEntry
                            ? 'bg-amber-500 dark:bg-amber-400'
                            : 'bg-amber-100 dark:bg-gray-800'
                      )}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
