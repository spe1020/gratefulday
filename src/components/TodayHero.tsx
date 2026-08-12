import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getQuoteForDay, getAffirmationForDay } from '@/lib/gratitudeUtils';

interface TodayHeroProps {
  day: DayInfo;
  totalDays: number;
}

/**
 * Today's context card: the date, year progress, daily quote and affirmation.
 * Purely informational — composing happens in the GratitudeComposer that sits
 * above it on the journal page, so this card no longer carries a CTA.
 */
export function TodayHero({ day, totalDays }: TodayHeroProps) {
  const quote = getQuoteForDay(day.dayOfYear);
  const affirmation = getAffirmationForDay(day.dayOfYear);

  // Calculate progress for text display
  const progress = (day.dayOfYear / totalDays) * 100;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <Card
        className={cn(
          'w-full transition-all duration-300 relative overflow-hidden',
          'border-2 border-amber-200 dark:border-amber-800',
          'bg-gradient-to-br from-amber-50/50 via-orange-50/50 to-rose-50/50 dark:from-amber-950/20 dark:via-orange-950/20 dark:to-rose-950/20',
          'shadow-2xl',
          'animate-in fade-in-50 slide-in-from-bottom-4'
        )}
      >
        {/* Subtle glow effect */}
        <div
          className="absolute inset-0 opacity-20 blur-3xl pointer-events-none transition-opacity duration-300"
          style={{
            background: 'radial-gradient(circle at center, rgba(251, 191, 36, 0.4) 0%, transparent 70%)',
          }}
        />

        <CardContent className="p-6 sm:p-8 lg:p-10 relative z-10">
          {/* Hero Section - Left-aligned with reduced top spacing */}
          <div className="mb-6 sm:mb-8 space-y-2 pt-4 sm:pt-6">
            {/* TODAY label */}
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              TODAY
            </p>

            {/* Day Number - Main Hero (reduced visual dominance) */}
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-medium text-foreground">
              Day {day.dayOfYear}
            </h1>

            {/* Full Date */}
            <p className="text-base sm:text-lg font-semibold text-foreground">
              {day.date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              })}
            </p>

            {/* "A year shaped by gratitude" with minimal progress ring */}
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                A year shaped by gratitude
              </p>
              {/* Minimal progress ring - symbolic accent */}
              <div className="relative flex-shrink-0">
                <svg
                  className="transform -rotate-90"
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                >
                  {/* Background circle */}
                  <circle
                    cx="10"
                    cy="10"
                    r="8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-amber-200/30 dark:text-amber-900/30"
                  />
                  {/* Progress circle */}
                  <circle
                    cx="10"
                    cy="10"
                    r="8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    className="text-amber-600 dark:text-amber-400 transition-all duration-1000 ease-out"
                    strokeDasharray={2 * Math.PI * 8}
                    strokeDashoffset={2 * Math.PI * 8 - (progress / 100) * 2 * Math.PI * 8}
                  />
                </svg>
              </div>
            </div>
          </div>

          {/* Today's Reflection Section */}
          <div>
            {/* Section Header */}
            <div className="mb-3">
              <h2 className="text-base sm:text-lg font-semibold text-foreground mb-0.5">
                Today's Reflection
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground">
                A moment to pause and appreciate your life.
              </p>
            </div>

            <div className="space-y-3">
              {/* Quote Section - Consistent padding and spacing */}
              <div className="p-4 sm:p-5 rounded-xl bg-white/60 dark:bg-gray-900/60 backdrop-blur-sm border border-amber-200/50 dark:border-amber-800/50 shadow-sm">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wider">
                    Daily Wisdom
                  </p>
                  <p className="text-base sm:text-lg italic text-foreground leading-relaxed">
                    "{quote.text}"
                  </p>
                  <p className="text-sm text-muted-foreground">
                    — {quote.author}
                  </p>
                </div>
              </div>

              {/* Affirmation Section - Enhanced prominence */}
              <div className="p-4 sm:p-5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 backdrop-blur-sm border-2 border-rose-300/60 dark:border-rose-700/60 shadow-md">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-rose-700 dark:text-rose-300 uppercase tracking-wider">
                    Daily Affirmation
                  </p>
                  <p className="text-sm sm:text-base italic text-foreground leading-relaxed font-medium">
                    "{affirmation}"
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
