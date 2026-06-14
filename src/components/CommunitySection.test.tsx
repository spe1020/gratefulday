import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { CommunitySection } from './CommunitySection';

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
  it('mounts the tagged feed for ?tab=community&view=tagged (not the calendar)', () => {
    renderAt('/?tab=community&view=tagged');

    expect(screen.getByText('Tagged Gratitude')).toBeInTheDocument();
    expect(screen.queryByText('Community Calendar')).not.toBeInTheDocument();
    expect(screen.queryByText('Community Reflections')).not.toBeInTheDocument();
  });

  it('mounts the community feed by default when no view param is present', () => {
    renderAt('/?tab=community');

    expect(screen.getByText('Community Reflections')).toBeInTheDocument();
    expect(screen.queryByText('Tagged Gratitude')).not.toBeInTheDocument();
  });

  it('mounts the calendar for view=calendar', () => {
    renderAt('/?tab=community&view=calendar');

    expect(screen.getByText('Community Calendar')).toBeInTheDocument();
    expect(screen.queryByText('Tagged Gratitude')).not.toBeInTheDocument();
  });

  it('falls back to the feed for an unknown view param', () => {
    renderAt('/?tab=community&view=bogus');

    expect(screen.getByText('Community Reflections')).toBeInTheDocument();
    expect(screen.queryByText('Tagged Gratitude')).not.toBeInTheDocument();
  });
});
