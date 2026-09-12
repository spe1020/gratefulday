import { Card, CardContent } from '@/components/ui/card';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { YourWisdom } from './YourWisdom';

interface PastDaysListProps {
  days: DayInfo[];
  entriesByDate: Map<string, boolean>;
  onDayClick: (day: DayInfo) => void;
}

export function PastDaysList({ days, entriesByDate, onDayClick }: PastDaysListProps) {
  // Filter to only past days (not today, not future)
  const pastDays = days.filter((day) => day.isPast);

  return (
    <>
      {/* Subtle divider/gradient fade */}
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-16 sm:mt-20 mb-8">
        <div className="relative h-px">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-200/50 dark:via-amber-800/50 to-transparent" />
        </div>
      </div>

      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-2">Past Reflections</h2>
            <p className="text-sm text-muted-foreground">
              Browse your journey of thankfulness
            </p>
          </div>
          <YourWisdom />
        </div>

      {/* Horizontal Carousel */}
      <div className="overflow-x-auto pb-4 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
        <div className="flex gap-3 min-w-max">
          {pastDays.reverse().map((day) => {
            const hasEntry = entriesByDate.get(day.dateString) || false;
            
            return (
              <Card
                key={day.dayOfYear}
                className={cn(
                  'flex-shrink-0 w-[140px] cursor-pointer transition-all duration-200 relative overflow-hidden',
                  'border border-border/50 hover:border-amber-300 dark:hover:border-amber-700',
                  'bg-card/50 hover:bg-card',
                  'hover:shadow-md',
                  hasEntry && 'ring-1 ring-amber-200 dark:ring-amber-800'
                )}
                onClick={() => onDayClick(day)}
              >
                <CardContent className="p-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Day {day.dayOfYear}
                      </span>
                      {hasEntry && (
                        <Check className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                      )}
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        {day.date.toLocaleDateString('en-US', { weekday: 'short' })}
                      </p>
                      <p className="text-xs font-medium text-foreground">
                        {day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <style>{`
        .overflow-x-auto::-webkit-scrollbar {
          height: 6px;
        }
        .overflow-x-auto::-webkit-scrollbar-track {
          background: transparent;
        }
        .overflow-x-auto::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.1);
          border-radius: 3px;
        }
        .overflow-x-auto::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.2);
        }
        .dark .overflow-x-auto::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
        }
        .dark .overflow-x-auto::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
      </div>
    </>
  );
}
