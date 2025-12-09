import { useState, useEffect } from 'react';
import { TodayHero } from './TodayHero';
import { PastDaysList } from './PastDaysList';
import { DayDetailDialog } from './DayDetailDialog';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getTotalDaysInYear } from '@/lib/gratitudeUtils';

interface CalendarViewProps {
  days: DayInfo[];
  entriesByDate: Map<string, boolean>;
}

export function CalendarView({ days, entriesByDate }: CalendarViewProps) {
  const [selectedDay, setSelectedDay] = useState<DayInfo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Find today
  const today = days.find((day) => day.isToday);
  const totalDays = today ? getTotalDaysInYear(today.date.getFullYear()) : 365;

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

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
      />
    </>
  );
}
