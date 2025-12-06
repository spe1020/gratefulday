import { useRef, useEffect, useState, TouchEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DayCard } from './DayCard';
import { DayDetailDialog } from './DayDetailDialog';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';

interface CalendarViewProps {
  days: DayInfo[];
  entriesByDate: Map<string, boolean>;
}

export function CalendarView({ days, entriesByDate }: CalendarViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [selectedDay, setSelectedDay] = useState<DayInfo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [showSwipeHint, setShowSwipeHint] = useState(true);
  const isMobile = useIsMobile();

  const todayIndex = days.findIndex((day) => day.isToday);

  // Minimum swipe distance (in px)
  const minSwipeDistance = 50;

  // Auto-scroll to today on mount
  useEffect(() => {
    if (scrollContainerRef.current && todayIndex !== -1) {
      const container = scrollContainerRef.current;
      const cardWidth = 280; // Width of each card
      const gap = 16; // Gap between cards
      const scrollPosition = (cardWidth + gap) * todayIndex - container.clientWidth / 2 + cardWidth / 2;

      setTimeout(() => {
        container.scrollTo({
          left: Math.max(0, scrollPosition),
          behavior: 'smooth',
        });
      }, 100);
    }
  }, [todayIndex]);

  // Hide swipe hint after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSwipeHint(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // Update scroll button states
  const updateScrollButtons = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', updateScrollButtons);
      updateScrollButtons();
      return () => container.removeEventListener('scroll', updateScrollButtons);
    }
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 600;
      const newPosition =
        scrollContainerRef.current.scrollLeft +
        (direction === 'left' ? -scrollAmount : scrollAmount);

      scrollContainerRef.current.scrollTo({
        left: newPosition,
        behavior: 'smooth',
      });
    }
  };

  const handleOpenDetail = (day: DayInfo) => {
    setSelectedDay(day);
    setDialogOpen(true);
  };

  const handleCloseDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setTimeout(() => setSelectedDay(null), 150);
    }
  };

  // Touch handlers for swipe gestures
  const onTouchStart = (e: TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && canScrollRight) {
      scroll('right');
    }
    if (isRightSwipe && canScrollLeft) {
      scroll('left');
    }
  };

  return (
    <>
      <div className="relative">
        {/* Mobile swipe hint - shows briefly on first load */}
        {isMobile && showSwipeHint && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none animate-in fade-in-50 slide-in-from-top-4">
            <div className="px-4 py-2 rounded-full bg-primary/90 text-primary-foreground text-xs font-medium shadow-lg animate-pulse">
              ← Swipe to explore →
            </div>
          </div>
        )}
        {/* Scroll buttons - hidden on mobile, visible on desktop */}
        {!isMobile && (
          <>
            <Button
              variant="outline"
              size="icon"
              className={cn(
                'absolute left-2 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full shadow-lg bg-background/95 backdrop-blur-sm transition-opacity',
                !canScrollLeft && 'opacity-0 pointer-events-none'
              )}
              onClick={() => scroll('left')}
            >
              <ChevronLeft className="h-6 w-6" />
            </Button>

            <Button
              variant="outline"
              size="icon"
              className={cn(
                'absolute right-2 top-1/2 -translate-y-1/2 z-10 h-12 w-12 rounded-full shadow-lg bg-background/95 backdrop-blur-sm transition-opacity',
                !canScrollRight && 'opacity-0 pointer-events-none'
              )}
              onClick={() => scroll('right')}
            >
              <ChevronRight className="h-6 w-6" />
            </Button>
          </>
        )}

        {/* Scrollable calendar */}
        <div
          ref={scrollContainerRef}
          className="flex gap-4 overflow-x-auto pb-8 px-4 snap-x snap-mandatory scroll-smooth hide-scrollbar"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {days.map((day) => (
            <div key={day.dayOfYear} className="snap-center">
              <DayCard
                day={day}
                hasEntry={entriesByDate.get(day.dateString) || false}
                onOpenDetail={handleOpenDetail}
              />
            </div>
          ))}
        </div>
      </div>

      <DayDetailDialog
        day={selectedDay}
        open={dialogOpen}
        onOpenChange={handleCloseDialog}
      />

      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </>
  );
}
