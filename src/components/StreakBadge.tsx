import { Flame, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useStreaks } from '@/hooks/useStreaks';
import { shouldShowMilestoneHint } from '@/lib/streakUtils';

/**
 * Compact streak strip shown under the TodayHero. Self-hides while logged
 * out, loading, or before the first entry exists.
 */
export function StreakBadge() {
  const { user } = useCurrentUser();
  const { current, total, todayCompleted, nextMilestone, isLoading } = useStreaks();

  if (!user || isLoading || total === 0) {
    return null;
  }

  const showHint =
    todayCompleted && nextMilestone !== null && shouldShowMilestoneHint(current);
  const daysToGo = nextMilestone !== null ? nextMilestone - current : 0;

  const pendingMessage =
    current > 0
      ? 'Write today to keep your streak'
      : 'Write today to start a new streak';

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 sm:mt-6 animate-in fade-in-50">
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border px-4 py-3 sm:px-5 backdrop-blur-sm transition-colors duration-300',
          todayCompleted
            ? 'border-amber-200 dark:border-amber-800 bg-gradient-to-r from-amber-50/80 via-orange-50/80 to-amber-50/80 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-amber-950/30'
            : 'border-amber-200/50 dark:border-amber-900/40 bg-white/50 dark:bg-gray-900/40'
        )}
      >
        <div className="flex items-center gap-2">
          <Flame
            className={cn(
              'h-5 w-5 flex-shrink-0',
              todayCompleted
                ? 'text-orange-500 dark:text-orange-400 fill-orange-400/40 dark:fill-orange-500/30'
                : 'text-muted-foreground'
            )}
            aria-hidden="true"
          />
          <span
            className={cn(
              'text-sm font-semibold',
              todayCompleted
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-muted-foreground'
            )}
          >
            {current} day streak
          </span>
        </div>

        {!todayCompleted && (
          <span className="text-xs text-muted-foreground">{pendingMessage}</span>
        )}

        {showHint && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <Trophy className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            {daysToGo} {daysToGo === 1 ? 'day' : 'days'} to {nextMilestone}
          </span>
        )}
      </div>
    </div>
  );
}
