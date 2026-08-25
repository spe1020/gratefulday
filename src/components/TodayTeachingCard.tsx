import { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, BookMarked, RefreshCw, Share2, Settings } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getTeachingForDay, formatTeachingNote } from '@/lib/teachingUtils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { ShareTeachingModal } from '@/components/ShareTeachingModal';
import { SettingsModal } from '@/components/SettingsModal';
import { cn } from '@/lib/utils';

interface TodayTeachingCardProps {
  dayOfYear: number;
  year?: number;
  defaultOpen?: boolean;
}

export function TodayTeachingCard({
  dayOfYear,
  year,
  defaultOpen = true,
}: TodayTeachingCardProps) {
  const isMobile = useIsMobile();
  const { config } = useAppContext();
  const preferences = config.teachingPreferences;
  const { user } = useCurrentUser();

  const [open, setOpen] = useState(() => {
    if (isMobile) return false;
    return defaultOpen;
  });

  const [shuffle, setShuffle] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const teaching = useMemo(
    () => getTeachingForDay(dayOfYear, preferences, shuffle, year),
    [dayOfYear, preferences, shuffle, year],
  );
  const handleRefresh = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShuffle((s) => s + 1);
  }, []);

  const noteContent = useMemo(
    () => teaching ? formatTeachingNote(teaching) : '',
    [teaching],
  );

  if (!teaching) return null;

  return (
    <div
      className={cn(
        'w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-4 sm:mt-6',
        'animate-in fade-in-50 slide-in-from-bottom-2 duration-400 fill-both'
      )}
      style={{ animationDelay: '300ms' }}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card
          className={cn(
            'border border-amber-200/50 dark:border-amber-800/40',
            'bg-amber-50/40 dark:bg-gray-900/30 backdrop-blur-sm',
            'shadow-none'
          )}
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                'w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-left',
                'hover:bg-amber-100/50 dark:hover:bg-amber-950/20',
                'transition-colors duration-200 rounded-t-lg',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              )}
              aria-expanded={open}
              aria-label={open ? 'Collapse teaching' : 'Expand teaching'}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={cn(
                    'text-amber-600 dark:text-amber-400 shrink-0 transition-transform duration-200',
                    !open && '-rotate-90'
                  )}
                  aria-hidden
                >
                  <ChevronDown className="h-5 w-5" />
                </span>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Today's Teaching
                </span>
                <span className="text-sm font-medium text-foreground truncate">
                  — {teaching.title}
                </span>
              </div>
              <div className="flex items-center shrink-0 -mr-1">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); setSettingsOpen(true); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setSettingsOpen(true);
                    }
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
                  aria-label="Teaching preferences"
                >
                  <Settings className="h-4 w-4" />
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={handleRefresh}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRefresh(e as unknown as React.MouseEvent);
                    }
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
                  aria-label="Get another teaching"
                >
                  <RefreshCw className="h-4 w-4" />
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
                <p className="text-sm text-foreground/85 leading-relaxed">
                  {teaching.body}
                </p>
                <div className="space-y-1">
                  {teaching.scriptureQuote && (
                    <p
                      className={cn(
                        'text-[1.05em] italic leading-relaxed',
                        'text-amber-700 dark:text-amber-300',
                        'border-l-4 border-amber-200 dark:border-amber-700 pl-4 my-3'
                      )}
                    >
                      "{teaching.scriptureQuote}"
                    </p>
                  )}
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    {teaching.scripture}
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Link to="/library">
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        'border-amber-300 dark:border-amber-700',
                        'text-amber-700 dark:text-amber-300',
                        'hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:border-amber-400 dark:hover:border-amber-600',
                        'gap-1.5 transition-colors duration-200'
                      )}
                    >
                      <BookMarked className="h-4 w-4" />
                      Library
                    </Button>
                  </Link>
                  {user && (
                    <ShareTeachingModal defaultContent={noteContent}>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          'border-amber-300 dark:border-amber-700',
                          'text-amber-700 dark:text-amber-300',
                          'hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:border-amber-400 dark:hover:border-amber-600',
                          'gap-1.5 transition-colors duration-200'
                        )}
                      >
                        <Share2 className="h-4 w-4" />
                        Share
                      </Button>
                    </ShareTeachingModal>
                  )}
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
