import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { CommunitySection } from './CommunitySection';

// Stable, unambiguous heading strings per view.
const FEED_SUBTITLE = 'Journal entries & tagged notes from across Nostr';
const CALENDAR_HEADING = 'Community Calendar';
const GALAXY_HEADING = 'Gratitude Galaxy';

function renderAt(url: string) {
  window.history.pushState({}, '', url);
  return render(
    <TestApp>
      <CommunitySection />
    </TestApp>
  );
}

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('CommunitySection URL routing', () => {
  it('mounts the merged feed by default (no view param)', () => {
    renderAt('/?tab=community');

    expect(screen.getByText(FEED_SUBTITLE)).toBeInTheDocument();
    expect(screen.queryByText(CALENDAR_HEADING)).not.toBeInTheDocument();
  });

  it('mounts the calendar for view=calendar', () => {
    renderAt('/?tab=community&view=calendar');

    expect(screen.getByText(CALENDAR_HEADING)).toBeInTheDocument();
    expect(screen.queryByText(FEED_SUBTITLE)).not.toBeInTheDocument();
  });

  it('mounts the galaxy for view=galaxy', () => {
    renderAt('/?tab=community&view=galaxy');

    expect(screen.getByText(GALAXY_HEADING)).toBeInTheDocument();
    expect(screen.queryByText(FEED_SUBTITLE)).not.toBeInTheDocument();
  });

  it('falls back to the feed for a retired/unknown view (e.g. the old "tagged")', () => {
    renderAt('/?tab=community&view=tagged');

    expect(screen.getByText(FEED_SUBTITLE)).toBeInTheDocument();
    expect(screen.queryByText(CALENDAR_HEADING)).not.toBeInTheDocument();
  });
});
