import { useSearchParams } from 'react-router-dom';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CommunityFeed } from '@/components/CommunityFeed';
import { CommunityCalendar } from '@/components/CommunityCalendar';
import { GratitudeGalaxy } from '@/components/GratitudeGalaxy';
import { cn } from '@/lib/utils';

const COMMUNITY_VIEWS = ['feed', 'calendar', 'galaxy'] as const;
type CommunityView = (typeof COMMUNITY_VIEWS)[number];

function isCommunityView(value: string | null): value is CommunityView {
  return COMMUNITY_VIEWS.includes(value as CommunityView);
}

export function CommunitySection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const activeView: CommunityView = isCommunityView(viewParam) ? viewParam : 'feed';

  const handleViewChange = (value: string) => {
    if (!isCommunityView(value)) return;
    setSearchParams({ tab: 'community', view: value });
  };

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <ToggleGroup
          type="single"
          value={activeView}
          onValueChange={handleViewChange}
          className="inline-flex min-w-full sm:min-w-0 justify-start sm:justify-center gap-1"
          aria-label="Community view"
        >
          <ToggleGroupItem
            value="feed"
            className={cn(
              'px-4 py-2 text-sm rounded-md',
              'data-[state=on]:bg-amber-100 dark:data-[state=on]:bg-amber-900/30',
              'data-[state=on]:text-amber-700 dark:data-[state=on]:text-amber-300'
            )}
          >
            Feed
          </ToggleGroupItem>
          <ToggleGroupItem
            value="calendar"
            className={cn(
              'px-4 py-2 text-sm rounded-md',
              'data-[state=on]:bg-amber-100 dark:data-[state=on]:bg-amber-900/30',
              'data-[state=on]:text-amber-700 dark:data-[state=on]:text-amber-300'
            )}
          >
            Calendar
          </ToggleGroupItem>
          <ToggleGroupItem
            value="galaxy"
            className={cn(
              'px-4 py-2 text-sm rounded-md',
              'data-[state=on]:bg-amber-100 dark:data-[state=on]:bg-amber-900/30',
              'data-[state=on]:text-amber-700 dark:data-[state=on]:text-amber-300'
            )}
          >
            Galaxy
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {activeView === 'feed' && <CommunityFeed />}
      {activeView === 'calendar' && <CommunityCalendar />}
      {activeView === 'galaxy' && <GratitudeGalaxy />}
    </div>
  );
}
