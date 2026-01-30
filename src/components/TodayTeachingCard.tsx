import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, BookMarked } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getTeachingForDay } from '@/lib/teachingUtils';
import { cn } from '@/lib/utils';

interface TodayTeachingCardProps {
  dayOfYear: number;
  defaultOpen?: boolean;
}

export function TodayTeachingCard({ dayOfYear, defaultOpen = false }: TodayTeachingCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const teaching = useMemo(() => getTeachingForDay(dayOfYear), [dayOfYear]);

  if (!teaching) return null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 sm:mt-6">
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card
          className={cn(
            'border border-amber-200/70 dark:border-amber-800/50',
            'bg-white/70 dark:bg-gray-900/50 backdrop-blur-sm',
            'shadow-sm'
          )}
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                'w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-left',
                'hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors rounded-lg'
              )}
              aria-expanded={open}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-amber-600 dark:text-amber-400 shrink-0">
                  {open ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </span>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Today's Teaching
                </span>
                <span className="text-sm font-medium text-foreground truncate">
                  — {teaching.title}
                </span>
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 px-4 sm:px-5 pb-4 sm:pb-5">
              <div className="space-y-4 pl-7">
                <span
                  className="inline-block text-[10px] font-medium uppercase tracking-wider text-muted-foreground border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5"
                  aria-label="Tradition"
                >
                  {teaching.tradition}
                </span>
                <p className="text-sm sm:text-base text-foreground/90 leading-relaxed">
                  {teaching.body}
                </p>
                <div className="space-y-1 text-sm font-medium text-amber-700 dark:text-amber-300">
                  {teaching.scriptureQuote && (
                    <p className="italic leading-relaxed">
                      "{teaching.scriptureQuote}"
                    </p>
                  )}
                  <p>{teaching.scripture}</p>
                </div>
                <Link to="/library">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30',
                      'gap-1.5 -ml-1.5'
                    )}
                  >
                    <BookMarked className="h-4 w-4" />
                    View in Library
                  </Button>
                </Link>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
