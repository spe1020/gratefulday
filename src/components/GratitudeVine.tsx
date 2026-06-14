import { useMemo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGratitudeEntries } from '@/hooks/useGratitudeEntries';
import { getEntryDateStrings } from '@/lib/streakUtils';
import { getWeeklyBuckets, type WeekBucket } from '@/lib/vineUtils';
import { formatDateString } from '@/lib/gratitudeUtils';

/**
 * A growing vine of the year's gratitude — one sprig per week, with a leaflet
 * for each day journaled that week (0–7). Zero weeks are quiet bare nubs; a
 * full 7/7 week earns a bloom.
 *
 * PRIVACY: strictly presence-based. Derived only from public `d`-tag dates via
 * getEntryDateStrings / getWeeklyBuckets — it NEVER decrypts or reads entry
 * content, and renders identically for public and private days. (Per-note
 * intensity is intentionally out of scope; it would require decryption.)
 */

const WEEKS = 53; // trailing ~12 months

// SVG geometry (px). Colors come from Tailwind palette classes with dark:
// variants so the vine stays legible on both light and dark app surfaces.
const STEP = 18; // horizontal px per week
const PAD_X = 14;
const MID_Y = 56; // stem midline
const AMP = 7; // stem meander amplitude
const LEAF_BASE = 7; // first leaflet distance from stem
const LEAF_TIER = 6.5; // extra distance per stacked pair
const HEIGHT = 150;
const DOTS_Y = 122; // "precise everyday glance" strip
const MONTH_Y = 142;

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface Pt {
  x: number;
  y: number;
}

const weekX = (w: number) => PAD_X + w * STEP;
const stemY = (w: number) => MID_Y + AMP * Math.sin(w * 0.55);

/** Smooth meandering stem path through the per-week points. */
function stemPath(points: Pt[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const midX = (prev.x + cur.x) / 2;
    const midY = (prev.y + cur.y) / 2;
    d += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

/** Month label per week-column when the month changes (parsed local-tz). */
function monthTicks(buckets: WeekBucket[]): { w: number; label: string }[] {
  const ticks: { w: number; label: string }[] = [];
  let prevMonth = -1;
  buckets.forEach((b, w) => {
    const month = Number(b.weekStart.slice(5, 7)) - 1;
    if (month !== prevMonth) {
      ticks.push({ w, label: MONTH_LABELS[month] });
      prevMonth = month;
    }
  });
  return ticks;
}

/** Human label for a week's hover tooltip, e.g. "Week of Jun 8 — 5 days". */
function weekTitle(weekStart: string, count: number): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `Week of ${label} — ${count} ${count === 1 ? 'day' : 'days'}`;
}

interface GratitudeVineProps {
  /** Injectable "today" for deterministic tests; defaults to now. */
  today?: Date;
}

export function GratitudeVine({ today }: GratitudeVineProps) {
  const { user } = useCurrentUser();
  const { data: entries, isLoading } = useGratitudeEntries(user?.pubkey);

  const now = today ?? new Date();
  const nowKey = formatDateString(
    new Date(now.getFullYear(), now.getMonth(), now.getDate())
  );

  const { buckets, ticks, count } = useMemo(() => {
    const dates = getEntryDateStrings(entries ?? []);
    const wk = getWeeklyBuckets(dates, now, WEEKS);
    return { buckets: wk, ticks: monthTicks(wk), count: dates.size };
    // nowKey pins the memo to the local day, not every render's clock read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, nowKey]);

  // Mirror StreakBadge: self-hide while logged out, loading, or before any
  // entry exists — so there's no empty layout shift.
  if (!user || isLoading || count === 0) {
    return null;
  }

  const width = PAD_X * 2 + (WEEKS - 1) * STEP;
  const stem = stemPath(buckets.map((_, w) => ({ x: weekX(w), y: stemY(w) })));

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 sm:mt-6 animate-in fade-in-50">
      <div className="rounded-xl border border-amber-200/60 dark:border-amber-900/40 bg-amber-50/60 dark:bg-gray-900/40 px-4 py-3 sm:px-5 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Your year of gratitude
          </span>
          <span className="text-xs text-muted-foreground">
            {count} {count === 1 ? 'day' : 'days'}
          </span>
        </div>

        <div className="overflow-x-auto pb-1">
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            className="block"
            role="img"
            aria-label={`Gratitude vine: ${count} ${count === 1 ? 'day' : 'days'} journaled over the past year`}
          >
            {/* Main stem */}
            <path
              d={stem}
              className="fill-none stroke-amber-800 dark:stroke-amber-600"
              strokeWidth={2}
              strokeLinecap="round"
            />

            {buckets.map((bucket, w) => {
              const x = weekX(w);
              const y = stemY(w);
              return (
                <g key={bucket.weekStart}>
                  <title>{weekTitle(bucket.weekStart, bucket.count)}</title>

                  {bucket.count === 0 ? (
                    // Bare nub — deliberately tiny, subordinate to a leaflet,
                    // so a zero week reads as a quiet gap, not a near-leaf.
                    <circle
                      cx={x}
                      cy={y}
                      r={1.6}
                      className="fill-amber-300/70 dark:fill-amber-800/70"
                    />
                  ) : (
                    Array.from({ length: bucket.count }).map((_, i) => {
                      const up = i % 2 === 0;
                      const tier = Math.floor(i / 2);
                      const dir = up ? -1 : 1;
                      const dist = LEAF_BASE + tier * LEAF_TIER;
                      const ly = y + dir * dist;
                      const angle = dir * -32;
                      return (
                        <ellipse
                          key={i}
                          cx={x}
                          cy={ly}
                          rx={5}
                          ry={2.6}
                          transform={`rotate(${angle} ${x} ${ly})`}
                          className="fill-emerald-500 dark:fill-emerald-400"
                        />
                      );
                    })
                  )}

                  {/* Bloom for a full 7/7 week, at the top of the sprig */}
                  {bucket.count === 7 &&
                    (() => {
                      const by = y - (LEAF_BASE + 3 * LEAF_TIER) - 3;
                      return (
                        <g>
                          {[0, 1, 2, 3, 4].map((p) => {
                            const a = (p / 5) * 2 * Math.PI;
                            return (
                              <circle
                                key={p}
                                cx={x + Math.cos(a) * 3.2}
                                cy={by + Math.sin(a) * 3.2}
                                r={2.2}
                                className="fill-amber-400 dark:fill-amber-300"
                              />
                            );
                          })}
                          <circle cx={x} cy={by} r={2} className="fill-amber-600 dark:fill-amber-500" />
                        </g>
                      );
                    })()}

                  {/* Everyday glance: one warm dot per week beneath the vine */}
                  <circle
                    cx={x}
                    cy={DOTS_Y}
                    r={2}
                    className={
                      bucket.count > 0
                        ? 'fill-amber-500 dark:fill-amber-400'
                        : 'fill-amber-200/70 dark:fill-gray-700'
                    }
                  />
                </g>
              );
            })}

            {/* Month labels */}
            {ticks.map(({ w, label }) => (
              <text
                key={`${w}-${label}`}
                x={weekX(w)}
                y={MONTH_Y}
                className="fill-current text-muted-foreground"
                fontSize={10}
                textAnchor="middle"
              >
                {label}
              </text>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
