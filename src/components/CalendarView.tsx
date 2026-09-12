import { useState, useEffect } from 'react';
import { TodayHero } from './TodayHero';
import { StreakBadge } from './StreakBadge';
import { GratitudeVine } from './GratitudeVine';
import { TodayTeachingCard } from './TodayTeachingCard';
import { PastDaysList } from './PastDaysList';
import { DayDetailDialog } from './DayDetailDialog';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getTotalDaysInYear } from '@/lib/gratitudeUtils';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface CalendarViewProps {
  days: DayInfo[];
  entriesByDate: Map<string, boolean>;
}

export function CalendarView({ days, entriesByDate }: CalendarViewProps) {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const [scope, setScope] = useState({ pubkey, revision: 0 });
  if (scope.pubkey !== pubkey) {
    // Signing in continues the guest draft. Leaving a signed-in account must
    // discard its mounted editor so another account cannot inherit its text.
    setScope({ pubkey, revision: scope.revision + (scope.pubkey ? 1 : 0) });
  }
  return <CalendarContent key={scope.revision} days={days} entriesByDate={entriesByDate} />;
}

function CalendarContent({ days, entriesByDate }: CalendarViewProps) {
  const [selectedDay, setSelectedDay] = useState<DayInfo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [focusWisdom, setFocusWisdom] = useState(false);

  // Find today
  const today = days.find((day) => day.isToday);
  const totalDays = today ? getTotalDaysInYear(today.date.getFullYear()) : 365;

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleOpenDetail = (day: DayInfo) => {
    setFocusWisdom(false);
    setSelectedDay(day);
    setDialogOpen(true);
  };

  const handleCloseDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setTimeout(() => setSelectedDay(null), 150);
    }
  };

  if (!today) {
    return null;
  }

  return (
    <>
      <div className="min-h-screen py-4 sm:py-6 lg:py-8">
        {/* Today Hero - Large, centered, prominent */}
        <TodayHero
          day={today}
          onOpenDetail={handleOpenDetail}
          totalDays={totalDays}
          onAddWisdom={() => {
            setSelectedDay(today);
            setFocusWisdom(true);
            setDialogOpen(true);
          }}
        />

        {/* Streak strip - hidden when logged out or no entries yet */}
        <StreakBadge />

        {/* Gratitude vine year-view - same self-hide as the streak strip */}
        <GratitudeVine />

        {/* Today's Teaching - Open by default when page loads */}
        <TodayTeachingCard
          dayOfYear={today.dayOfYear}
          year={today.date.getFullYear()}
          defaultOpen={true}
        />

        {/* Past Days - Quiet, accessible, but visually subdued */}
        <PastDaysList
          days={days}
          entriesByDate={entriesByDate}
          onDayClick={handleOpenDetail}
        />
      </div>

      <DayDetailDialog
        day={selectedDay}
        open={dialogOpen}
        onOpenChange={handleCloseDialog}
        focusWisdom={focusWisdom}
      />
    </>
  );
}
