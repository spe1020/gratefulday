import { useMemo, useState } from 'react';
import { useHead } from '@unhead/react';
import { CalendarView } from '@/components/CalendarView';
import { CommunityFeed } from '@/components/CommunityFeed';
import { LoginArea } from '@/components/auth/LoginArea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGratitudeEntries } from '@/hooks/useGratitudeEntries';
import {
  getAllDaysInYear,
  getDayOfYear,
  getTotalDaysInYear,
} from '@/lib/gratitudeUtils';
import { Sparkles, Calendar, Heart, Users } from 'lucide-react';

export default function Index() {
  useHead({
    title: 'Daily Gratitude Calendar - Reflect & Share',
    meta: [
      {
        name: 'description',
        content:
          'A Nostr-based daily gratitude calendar for personal reflection and community sharing. Track your daily gratitude journey through the year.',
      },
    ],
  });

  const { user } = useCurrentUser();
  const { data: gratitudeEntries, isLoading } = useGratitudeEntries(user?.pubkey);
  const [activeTab, setActiveTab] = useState('calendar');

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentDayOfYear = getDayOfYear(today);
  const totalDays = getTotalDaysInYear(currentYear);

  // Get all days in the current year
  const allDays = useMemo(() => getAllDaysInYear(currentYear), [currentYear]);

  // Create a map of dates with entries for quick lookup
  const entriesByDate = useMemo(() => {
    const map = new Map<string, boolean>();
    if (gratitudeEntries) {
      gratitudeEntries.forEach((entry) => {
        const dTag = entry.tags.find(([name]) => name === 'd')?.[1];
        if (dTag) {
          map.set(dTag, true);
        }
      });
    }
    return map;
  }, [gratitudeEntries]);

  const progress = Math.round((currentDayOfYear / totalDays) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
      {/* Header */}
      <header className="border-b border-amber-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">
                  Daily Gratitude
                </h1>
                <p className="text-xs text-muted-foreground">
                  Reflect, record, and share your gratitude
                </p>
              </div>
            </div>
            <LoginArea className="max-w-60" />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto text-center space-y-6">
          {/* Year Progress */}
          <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-amber-200 dark:border-gray-800 shadow-lg">
            <Calendar className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">
                Day <span className="text-xl font-bold text-amber-600 dark:text-amber-400">{currentDayOfYear}</span> of {totalDays}
              </p>
              <p className="text-xs text-muted-foreground">
                {today.toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="max-w-md mx-auto">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
              <span>Year Progress</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">{progress}%</span>
            </div>
            <div className="h-3 rounded-full bg-white/60 dark:bg-gray-800/60 overflow-hidden shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 rounded-full transition-all duration-1000 ease-out shadow-lg"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Description */}
          <div className="max-w-2xl mx-auto pt-4">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Heart className="h-5 w-5 text-rose-500" />
              <p className="text-lg font-semibold text-foreground">
                Your Journey of Gratitude
              </p>
            </div>
            <p className="text-muted-foreground">
              Each day brings a new opportunity to reflect on what matters most.
              Scroll through the calendar, unlock daily wisdom, and record your gratitude.
              {!user && ' Log in to save your reflections and share them with the Nostr community.'}
            </p>
          </div>
        </div>
      </section>

      {/* Main Content Section */}
      <section className="container mx-auto px-4 pb-16">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex justify-center">
            <TabsList className="inline-flex bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-amber-200 dark:border-gray-800 shadow-lg">
              <TabsTrigger value="calendar" className="gap-2">
                <Calendar className="h-4 w-4" />
                My Calendar
              </TabsTrigger>
              <TabsTrigger value="community" className="gap-2">
                <Users className="h-4 w-4" />
                Community
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="calendar" className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-foreground mb-2">
                {currentYear} Calendar
              </h2>
              <p className="text-sm text-muted-foreground">
                Swipe or scroll to explore • Tap a card to reflect
              </p>
            </div>

            {isLoading ? (
              <div className="flex gap-4 overflow-x-hidden pb-8 px-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="flex-shrink-0 w-[280px] h-[360px] rounded-lg" />
                ))}
              </div>
            ) : (
              <CalendarView days={allDays} entriesByDate={entriesByDate} />
            )}
          </TabsContent>

          <TabsContent value="community" className="space-y-6">
            <CommunityFeed />
          </TabsContent>
        </Tabs>
      </section>

      {/* Footer */}
      <footer className="border-t border-amber-200 dark:border-gray-800 bg-white/60 dark:bg-gray-950/60 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Built with love on Nostr
            </p>
            <p className="text-xs text-muted-foreground">
              Vibed with{' '}
              <a
                href="https://shakespeare.diy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 dark:text-amber-400 hover:underline font-medium"
              >
                Shakespeare
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
