import { useMemo, useState, useEffect } from 'react';
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
} from '@/lib/gratitudeUtils';
import { Logo } from '@/components/Logo';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import { GratitudeGiftModal } from '@/components/GratitudeGiftModal';
import { LibraryComingSoonModal } from '@/components/LibraryComingSoonModal';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';

export default function Index() {
  useHead({
    title: 'Grateful Day - Daily Reflection Calendar',
    meta: [
      {
        name: 'description',
        content:
          'A Nostr-based daily reflection calendar for personal growth and community sharing. Track your daily journey of gratitude through the year on gratefulday.space.',
      },
    ],
  });

  const { user } = useCurrentUser();
  const { data: gratitudeEntries, isLoading } = useGratitudeEntries(user?.pubkey);
  const [activeTab, setActiveTab] = useState('calendar');
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [libraryModalOpen, setLibraryModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useIsMobile();

  const today = new Date();
  const currentYear = today.getFullYear();

  // Handle header shadow on scroll
  useEffect(() => {
    const handleScroll = () => {
      setHeaderScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
        {/* Header */}
        <header
          className={cn(
            'border-b border-amber-200 dark:border-gray-800 bg-white dark:bg-gray-950 backdrop-blur-md sticky top-0 z-[100] transition-shadow duration-200',
            headerScrolled && 'shadow-[0_2px_8px_rgba(0,0,0,0.08)]'
          )}
        >
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-[88px] sm:h-[96px] md:h-[104px]">
              {/* Left: Brand Block - Logo (Dominant) */}
              <div className="brand flex items-center py-6 sm:py-7 md:py-8">
                <Logo 
                  showText={false} 
                  size="header" 
                  className="flex-shrink-0"
                />
              </div>

              {/* Right: Navigation + Login */}
              <div className="flex items-center gap-2 sm:gap-3">
                {!isMobile && (
                  <div className="flex items-center gap-1">
                    <TabsList className="bg-transparent border-0 shadow-none h-auto p-0 gap-0">
                      <TabsTrigger
                        value="calendar"
                        className="text-sm px-3 py-2 rounded-md data-[state=active]:bg-amber-100 dark:data-[state=active]:bg-amber-900/30 data-[state=active]:text-amber-700 dark:data-[state=active]:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors"
                      >
                        Calendar
                      </TabsTrigger>
                      <TabsTrigger
                        value="community"
                        className="text-sm px-3 py-2 rounded-md data-[state=active]:bg-amber-100 dark:data-[state=active]:bg-amber-900/30 data-[state=active]:text-amber-700 dark:data-[state=active]:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors"
                      >
                        Community
                      </TabsTrigger>
                    </TabsList>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLibraryModalOpen(true)}
                      className="text-sm px-3 py-2 h-auto rounded-md hover:bg-amber-50 dark:hover:bg-amber-950/20 data-[state=active]:bg-amber-100 dark:data-[state=active]:bg-amber-900/30"
                    >
                      Library
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setGiftModalOpen(true)}
                      className="text-sm px-3 py-2 h-auto rounded-md hover:bg-amber-50 dark:hover:bg-amber-950/20"
                    >
                      Gift
                    </Button>
                  </div>
                )}
                {isMobile && (
                  <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                    <SheetTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0"
                        aria-label="Open menu"
                      >
                        <Menu className="h-5 w-5" />
                      </Button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-[280px] sm:w-[320px]">
                      <div className="flex flex-col gap-4 pt-24 sm:pt-28">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setActiveTab('calendar');
                            setMobileMenuOpen(false);
                          }}
                          className={cn(
                            "justify-start text-base h-12",
                            activeTab === 'calendar' 
                              ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" 
                              : ""
                          )}
                        >
                          Calendar
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setActiveTab('community');
                            setMobileMenuOpen(false);
                          }}
                          className={cn(
                            "justify-start text-base h-12",
                            activeTab === 'community' 
                              ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" 
                              : ""
                          )}
                        >
                          Community
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setLibraryModalOpen(true);
                            setMobileMenuOpen(false);
                          }}
                          className="justify-start text-base h-12"
                        >
                          Library
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setGiftModalOpen(true);
                            setMobileMenuOpen(false);
                          }}
                          className="justify-start text-base h-12"
                        >
                          Gift
                        </Button>
                      </div>
                    </SheetContent>
                  </Sheet>
                )}
                <LoginArea className="max-w-48 sm:max-w-60" />
              </div>
            </div>
          </div>
        </header>


        {/* Main Content Section */}
        <section className="w-full">
          <TabsContent value="calendar" className="mt-0">
            {isLoading ? (
              <div className="w-full max-w-4xl mx-auto px-4 py-12">
                <div className="space-y-4">
                  <Skeleton className="w-full h-[600px] rounded-lg" />
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {[...Array(10)].map((_, i) => (
                      <Skeleton key={i} className="h-24 rounded-lg" />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <CalendarView days={allDays} entriesByDate={entriesByDate} />
            )}
          </TabsContent>

          <TabsContent value="community" className="mt-0">
            <div className="container mx-auto px-4 pt-4 pb-16">
              <CommunityFeed />
            </div>
          </TabsContent>
        </section>

        {/* Footer */}
        <footer className="border-t border-amber-200 dark:border-gray-800 bg-white/60 dark:bg-gray-950/60 backdrop-blur-sm">
          <div className="container mx-auto px-4 py-8">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Made with gratitude. Powered by Nostr 💜
              </p>
            </div>
          </div>
        </footer>
      </div>

      {/* Gratitude Gift Modal */}
      <GratitudeGiftModal
        open={giftModalOpen}
        onOpenChange={setGiftModalOpen}
      />

      {/* Library Coming Soon Modal */}
      <LibraryComingSoonModal
        open={libraryModalOpen}
        onOpenChange={setLibraryModalOpen}
      />
    </Tabs>
  );
}
