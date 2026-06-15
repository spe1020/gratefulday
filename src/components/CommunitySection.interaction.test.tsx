import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TestApp } from '@/test/TestApp';
import { CommunitySection } from './CommunitySection';

// Mirror of Index.tsx's two-tab wiring: an outer Tabs (Calendar/Community)
// driven by the `tab` search param, with CommunitySection inside the community
// content. Reproduces the real interaction between the two tab systems.
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
  it('clicking Tagged from the feed shows the tagged feed, staying in Community', () => {
    renderAt('/?tab=community');
    expect(screen.getByText('Community Reflections')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Tagged'));

    expect(screen.getByText('Tagged Gratitude')).toBeInTheDocument();
    expect(screen.queryByText('DAILY CALENDAR')).not.toBeInTheDocument();
  });

  it('clicking Feed from the tagged view shows the community feed, not the daily calendar', () => {
    renderAt('/?tab=community&view=tagged');
    expect(screen.getByText('Tagged Gratitude')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Feed'));

    expect(screen.getByText('Community Reflections')).toBeInTheDocument();
    expect(screen.queryByText('DAILY CALENDAR')).not.toBeInTheDocument();
  });
});
