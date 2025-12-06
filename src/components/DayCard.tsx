import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Lock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getQuoteForDay, getPromptForDay } from '@/lib/gratitudeUtils';
import { DayDetailDialog } from './DayDetailDialog';

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
        'flex-shrink-0 w-[280px] h-[360px] cursor-pointer transition-all duration-300 relative overflow-hidden group',
        'animate-in fade-in-50 slide-in-from-bottom-4',
        day.isToday && 'ring-2 ring-primary shadow-xl scale-105',
        day.isFuture && 'opacity-50 cursor-not-allowed',
        !day.isFuture && 'hover:shadow-2xl hover:scale-105 active:scale-100',
        isHovered && !day.isFuture && 'shadow-2xl'
      )}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Background gradient */}
      <div
        className={cn(
          'absolute inset-0 opacity-0 transition-opacity duration-300',
          isHovered && !day.isFuture && 'opacity-10',
          day.isToday && 'opacity-20'
        )}
        style={{
          background: 'linear-gradient(135deg, rgb(251, 191, 36) 0%, rgb(251, 146, 60) 50%, rgb(251, 113, 133) 100%)',
        }}
      />

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
                <div className="p-2 rounded-full bg-primary/20 animate-pulse">
                  <Sparkles className="h-5 w-5 text-primary" />
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
                Today's Reflection
              </p>
              <p className="text-sm text-foreground/80 line-clamp-2 italic">
                "{getPromptForDay(day.dayOfYear)}"
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
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">
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
