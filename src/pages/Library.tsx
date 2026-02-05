import { useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useHead } from '@unhead/react';
import { Search, Check, BookOpen } from 'lucide-react';
import { Footer } from '@/components/Footer';
import {
  getTeachings,
  TEACHING_CATEGORIES,
  TEACHING_TRADITIONS,
  type Teaching,
} from '@/lib/teachingUtils';
import { Logo } from '@/components/Logo';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SEEN_STORAGE_KEY = 'gratefulday-teachings-seen';
const PREVIEW_LENGTH = 65;

function getSeenIds(): Set<number> {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as number[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function markSeen(id: number) {
  const seen = getSeenIds();
  seen.add(id);
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // ignore
  }
}

/** Truncate at word boundary; aim for 50–70 chars. */
function getBodyPreview(body: string, maxLength: number = PREVIEW_LENGTH): string {
  const trimmed = body.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const truncated = trimmed.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  const end = lastSpace > maxLength / 2 ? lastSpace : maxLength;
  return trimmed.slice(0, end).trim() + '...';
}

/** Title-case source references (e.g. "Jewish liturgy" → "Jewish Liturgy"); leave scripture refs as-is. */
function formatScripture(scripture: string): string {
  if (/\d/.test(scripture)) return scripture; // e.g. "Exodus 20:8"
  return scripture
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export default function Library() {
  useHead({
    title: 'Library - Grateful Day',
    meta: [
      {
        name: 'description',
        content:
          'Browse teachings from Christian, Jewish, Islamic, Buddhist, Taoist, and Stoic traditions. Daily wisdom for your gratitude practice.',
      },
    ],
  });

  const [search, setSearch] = useState('');
  const [tradition, setTradition] = useState<string>('all');
  const [category, setCategory] = useState<string>('all');
  const [selectedTeaching, setSelectedTeaching] = useState<Teaching | null>(null);
  const [seenIds, setSeenIds] = useState<Set<number>>(getSeenIds);

  const teachings = useMemo(() => getTeachings(), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teachings.filter((t) => {
      const matchCategory = category === 'all' || t.category === category;
      const matchTradition = tradition === 'all' || t.tradition === tradition;
      const matchSearch =
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.scripture.toLowerCase().includes(q) ||
        (t.scriptureQuote && t.scriptureQuote.toLowerCase().includes(q)) ||
        t.category.toLowerCase().includes(q) ||
        t.tradition.toLowerCase().includes(q);
      return matchCategory && matchTradition && matchSearch;
    });
  }, [teachings, search, category, tradition]);

  const openDetail = useCallback((t: Teaching) => {
    setSelectedTeaching(t);
    markSeen(t.id);
    setSeenIds(getSeenIds());
  }, []);

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent, t: Teaching) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(t);
      }
    },
    [openDetail]
  );

  const showTraditionOnCard = tradition === 'all';

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
      {/* Header */}
      <header className="border-b border-amber-200 dark:border-gray-800 bg-white dark:bg-gray-950 backdrop-blur-md sticky top-0 z-[100]">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-[72px] sm:h-[80px] min-h-[44px]">
            <Link to="/" className="flex items-center gap-3 min-h-[44px] items-center">
              <Logo showText={false} size="sm" className="flex-shrink-0" />
              <span className="text-lg font-medium text-foreground">Library</span>
            </Link>
            <Link to="/">
              <Button
                variant="ghost"
                size="sm"
                className="text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 min-h-[44px] min-w-[44px]"
              >
                Back to Calendar
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-4xl">
        <p className="text-sm text-muted-foreground mb-4">
          Teachings from various wisdom traditions. Filter by tradition or category.
        </p>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden />
          <Input
            type="search"
            placeholder="Search teachings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-white dark:bg-gray-900 border-amber-200 dark:border-gray-700 min-h-[44px]"
            aria-label="Search teachings by title, body, scripture, or tags"
          />
        </div>

        {/* Tradition tabs - horizontal, scrollable on mobile */}
        <Tabs value={tradition} onValueChange={setTradition} className="mb-6">
          <div className="relative">
            <TabsList
              role="tablist"
              aria-label="Tradition tabs"
              className="w-full sm:w-auto h-auto p-0 bg-transparent border-0 shadow-none flex flex-nowrap overflow-x-auto overflow-y-hidden gap-0 border-b border-amber-200 dark:border-gray-700 pb-px -mb-px min-w-0 scroll-smooth"
            >
              <TabsTrigger
                value="all"
                role="tab"
                aria-selected={tradition === 'all'}
                aria-label="All traditions"
                className={cn(
                  'rounded-none border-b-4 border-transparent bg-transparent px-4 py-2.5 min-h-[44px] text-sm font-normal text-muted-foreground whitespace-nowrap flex-shrink-0 transition-all duration-200 ease-in-out',
                  'data-[state=active]:text-amber-700 dark:data-[state=active]:text-amber-300',
                  'data-[state=active]:border-amber-600 dark:data-[state=active]:border-amber-400',
                  'data-[state=active]:bg-amber-100/50 dark:data-[state=active]:bg-amber-900/20 data-[state=active]:font-semibold',
                  'hover:text-foreground hover:bg-amber-50/50 dark:hover:bg-amber-900/10',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                )}
              >
                All
              </TabsTrigger>
              {TEACHING_TRADITIONS.map((t) => (
                <TabsTrigger
                  key={t}
                  value={t}
                  role="tab"
                  aria-selected={tradition === t}
                  aria-label={`${t} tradition`}
                  className={cn(
                    'rounded-none border-b-4 border-transparent bg-transparent px-4 py-2.5 min-h-[44px] text-sm font-normal text-muted-foreground whitespace-nowrap flex-shrink-0 transition-all duration-200 ease-in-out',
                    'data-[state=active]:text-amber-700 dark:data-[state=active]:text-amber-300',
                    'data-[state=active]:border-amber-600 dark:data-[state=active]:border-amber-400',
                    'data-[state=active]:bg-amber-100/50 dark:data-[state=active]:bg-amber-900/20 data-[state=active]:font-semibold',
                    'hover:text-foreground hover:bg-amber-50/50 dark:hover:bg-amber-900/10',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                  )}
                >
                  {t}
                </TabsTrigger>
              ))}
            </TabsList>
            {/* Mobile scroll fade indicators */}
            <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-amber-50 dark:from-gray-900 to-transparent z-10 sm:hidden" aria-hidden />
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-amber-50 dark:from-gray-900 to-transparent z-10 sm:hidden" aria-hidden />
          </div>
        </Tabs>

        {/* Category pills */}
        <div className="flex flex-wrap gap-2 mb-8">
          <button
            type="button"
            onClick={() => setCategory('all')}
            aria-pressed={category === 'all'}
            aria-label="All categories"
            className={cn(
              'rounded-full px-3.5 py-2 min-h-[44px] text-sm font-medium transition-all duration-200 ease-in-out',
              category === 'all'
                ? 'bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100'
                : 'border border-amber-300 dark:border-amber-700 bg-transparent text-amber-800 dark:text-amber-200 hover:bg-amber-100/50 dark:hover:bg-amber-900/20',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
            )}
          >
            All categories
          </button>
          {TEACHING_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              aria-label={`Filter by ${c}`}
              className={cn(
                'rounded-full px-3.5 py-2 min-h-[44px] text-sm font-medium transition-all duration-200 ease-in-out',
                category === c
                  ? 'bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100'
                  : 'border border-amber-300 dark:border-amber-700 bg-transparent text-amber-800 dark:text-amber-200 hover:bg-amber-100/50 dark:hover:bg-amber-900/20',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Result count for screen readers */}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {filtered.length === 0
            ? 'No teachings found.'
            : `Showing ${filtered.length} teaching${filtered.length === 1 ? '' : 's'}.`}
        </p>

        {/* Card list */}
        <div className="grid gap-6">
          {filtered.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 px-4 text-center"
              role="status"
              aria-label="No teachings found"
            >
              <BookOpen className="h-12 w-12 text-muted-foreground/60 mb-4" aria-hidden />
              <p className="text-base font-medium text-foreground mb-1">No teachings found</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Try selecting &quot;All categories&quot; or choose a different tradition.
              </p>
            </div>
          ) : (
            filtered.map((t) => (
              <Card
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetail(t)}
                onKeyDown={(e) => handleCardKeyDown(e, t)}
                className={cn(
                  'cursor-pointer transition-all duration-200 ease-in-out border border-amber-200/70 dark:border-amber-800/50',
                  'bg-white/80 dark:bg-gray-900/50',
                  'hover:bg-amber-50/80 dark:hover:bg-amber-950/20 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:scale-[1.01]',
                  'active:scale-[0.99] active:shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  'min-h-[44px]'
                )}
                aria-label={`Open teaching: ${t.title}`}
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start gap-2 mb-1">
                    <h3 className="text-lg font-bold text-foreground leading-tight flex-1 min-w-0">
                      {t.title}
                    </h3>
                    {seenIds.has(t.id) && (
                      <span
                        className="flex items-center gap-1 shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300"
                        title="Read"
                        aria-label="Read"
                      >
                        <Check className="h-4 w-4" aria-hidden />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    {formatScripture(t.scripture)}
                  </p>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {getBodyPreview(t.body)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {showTraditionOnCard && (
                      <Badge
                        variant="outline"
                        className="text-xs border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200"
                      >
                        {t.tradition}
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200"
                    >
                      {t.category}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>

      <Footer />

      {/* Detail dialog */}
      <Dialog
        open={!!selectedTeaching}
        onOpenChange={(open) => !open && setSelectedTeaching(null)}
      >
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedTeaching && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl pr-8">
                  {selectedTeaching.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant="outline"
                    className="border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200"
                  >
                    {selectedTeaching.tradition}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200"
                  >
                    {selectedTeaching.category}
                  </Badge>
                </div>
                <p className="text-sm sm:text-base text-foreground/90 leading-relaxed">
                  {selectedTeaching.body}
                </p>
                <div className="space-y-1 text-sm font-medium text-amber-700 dark:text-amber-300">
                  {selectedTeaching.scriptureQuote && (
                    <p className="italic leading-relaxed">
                      "{selectedTeaching.scriptureQuote}"
                    </p>
                  )}
                  <p>{formatScripture(selectedTeaching.scripture)}</p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
