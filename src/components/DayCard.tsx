import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Check, Lock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getAffirmationForDay } from '@/lib/gratitudeUtils';

interface DayCardProps {
  day: DayInfo;
  hasEntry: boolean;
  onOpenDetail: (day: DayInfo) => void;
}

export function DayCard({ day, hasEntry, onOpenDetail }: DayCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (day.isUnlocked) {
      onOpenDetail(day);
    }
  };

  return (
    <Card
      className={cn(
        'w-full h-[360px] cursor-pointer transition-all duration-300 relative overflow-hidden group',
        'animate-in fade-in-50 slide-in-from-bottom-4',
        day.isToday && [
          'ring-4 ring-amber-500 dark:ring-amber-400 shadow-2xl',
          'animate-pulse-once', // Custom animation for page load
        ],
        day.isFuture && 'opacity-50 cursor-not-allowed',
        !day.isFuture && !day.isToday && 'hover:shadow-2xl hover:scale-[1.02] active:scale-100',
        isHovered && !day.isFuture && !day.isToday && 'shadow-2xl'
      )}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Background gradient */}
      <div
        className={cn(
          'absolute inset-0 opacity-0 transition-opacity duration-300',
          isHovered && !day.isFuture && !day.isToday && 'opacity-10',
          day.isToday && 'opacity-30'
        )}
        style={{
          background: 'linear-gradient(135deg, rgb(251, 191, 36) 0%, rgb(251, 146, 60) 50%, rgb(251, 113, 133) 100%)',
        }}
      />
      
      {/* Glow effect for today */}
      {day.isToday && (
        <div 
          className="absolute inset-0 opacity-40 blur-xl pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(251, 191, 36, 0.6) 0%, transparent 70%)',
          }}
        />
      )}

      <CardContent className="p-6 h-full flex flex-col justify-between relative z-10">
        {/* Top section - Day number and status */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground font-medium">Day</span>
              <span className="text-4xl font-bold text-foreground">{day.dayOfYear}</span>
            </div>
            <div className="flex items-center gap-2">
              {day.isFuture && (
                <div className="p-2 rounded-full bg-muted">
                  <Lock className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              {hasEntry && !day.isFuture && (
                <div className="p-2 rounded-full bg-primary/10">
                  <Check className="h-5 w-5 text-primary" />
                </div>
              )}
              {day.isToday && (
                <div className="p-2 rounded-full bg-amber-500/30 dark:bg-amber-400/30 animate-pulse shadow-lg">
                  <Sparkles className="h-6 w-6 text-amber-600 dark:text-amber-400 drop-shadow-sm" />
                </div>
              )}
            </div>
          </div>

          {/* Date display */}
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              {day.date.toLocaleDateString('en-US', { weekday: 'short' })}
            </p>
            <p className="text-lg font-semibold text-foreground">
              {day.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Middle section - Preview content */}
        {day.isUnlocked && (
          <div className="space-y-3 flex-grow flex flex-col justify-center">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                Daily Affirmation
              </p>
              <p className="text-sm text-foreground/80 line-clamp-3 italic">
                "{getAffirmationForDay(day.dayOfYear)}"
              </p>
            </div>
          </div>
        )}

        {day.isFuture && (
          <div className="flex-grow flex items-center justify-center">
            <p className="text-sm text-muted-foreground text-center italic">
              Available at midnight
            </p>
          </div>
        )}

        {/* Bottom section - Status badge */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          {day.isToday && (
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              Today
            </span>
          )}
          {day.isPast && !hasEntry && (
            <span className="text-xs text-muted-foreground">
              No entry yet
            </span>
          )}
          {hasEntry && (
            <span className="text-xs font-medium text-primary">
              Entry saved
            </span>
          )}
          {day.isFuture && (
            <span className="text-xs text-muted-foreground">
              Locked
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
