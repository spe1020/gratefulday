import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TestApp } from '@/test/TestApp';
import { CommunitySection } from './CommunitySection';

// Mirror of Index.tsx's two-tab wiring: an outer Tabs (Calendar/Community)
// driven by the `tab` search param, with CommunitySection inside the community
// content. Guards that the inner sub-tabs switch views without escaping to the
// daily calendar (the header-logo overlap that once ate these clicks).
function Harness() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'calendar';
  return (
    <Tabs value={activeTab} onValueChange={(tab) => setSearchParams({ tab })}>
      <TabsList>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
        <TabsTrigger value="community">Community</TabsTrigger>
      </TabsList>
      <TabsContent value="calendar">DAILY CALENDAR</TabsContent>
      <TabsContent value="community">
        <CommunitySection />
      </TabsContent>
    </Tabs>
  );
}

const FEED_SUBTITLE = 'Journal entries & tagged notes from across Nostr';

function renderAt(url: string) {
  window.history.pushState({}, '', url);
  return render(
    <TestApp>
      <Harness />
    </TestApp>
  );
}

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('CommunitySection sub-tab navigation (inside the outer Tabs)', () => {
  it('clicking Galaxy from the feed switches view, staying in Community', () => {
    renderAt('/?tab=community');
    expect(screen.getByText(FEED_SUBTITLE)).toBeInTheDocument();

    // "Galaxy" is unique to the inner sub-tabs (outer tabs are Calendar/Community).
    fireEvent.click(screen.getByText('Galaxy'));

    expect(screen.getByText('Gratitude Galaxy')).toBeInTheDocument();
    expect(screen.queryByText('DAILY CALENDAR')).not.toBeInTheDocument();
  });

  it('clicking Feed from the galaxy view returns to the merged feed, not the daily calendar', () => {
    renderAt('/?tab=community&view=galaxy');
    expect(screen.getByText('Gratitude Galaxy')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Feed'));

    expect(screen.getByText(FEED_SUBTITLE)).toBeInTheDocument();
    expect(screen.queryByText('DAILY CALENDAR')).not.toBeInTheDocument();
  });
});
