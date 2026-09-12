import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Index from './Index';

let pubkey: string | undefined;
let isLoading = false;
vi.mock('@unhead/react', () => ({ useHead: () => {} }));
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: pubkey ? { pubkey } : undefined }) }));
vi.mock('@/hooks/useGratitudeEntries', () => ({ useGratitudeEntries: () => ({ data: [], isLoading }) }));
vi.mock('@/components/auth/LoginArea', () => ({ LoginArea: () => null }));
vi.mock('@/components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('@/components/CommunitySection', () => ({ CommunitySection: () => null }));
vi.mock('@/components/GratitudeGiftModal', () => ({ GratitudeGiftModal: () => null }));
vi.mock('@/components/MilestoneCelebrationDialog', () => ({ MilestoneCelebrationDialog: () => null }));
vi.mock('@/components/StreakBadge', () => ({ StreakBadge: () => null }));
vi.mock('@/components/GratitudeVine', () => ({ GratitudeVine: () => null }));
vi.mock('@/components/TodayTeachingCard', () => ({ TodayTeachingCard: () => null }));
vi.mock('@/components/PastDaysList', () => ({ PastDaysList: () => null }));
vi.mock('@/components/TodayHero', () => ({ TodayHero: ({ onAddWisdom }: { onAddWisdom: () => void }) => <button onClick={onAddWisdom}>Add wisdom</button> }));
vi.mock('@/components/DayDetailDialog', () => ({
  DayDetailDialog: function Draft({ open }: { open: boolean }) {
    const [value, setValue] = useState('');
    return open ? <input aria-label="Daily draft" value={value} onChange={(event) => setValue(event.target.value)} /> : null;
  },
}));

describe('calendar draft ownership', () => {
  beforeEach(() => { pubkey = undefined; isLoading = false; });

  it('preserves the open guest draft through sign-in and the entries loading state', () => {
    const view = render(<MemoryRouter><Index /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Add wisdom' }));
    fireEvent.change(screen.getByLabelText('Daily draft'), { target: { value: 'A moment worth keeping' } });
    pubkey = 'alice';
    isLoading = true;
    view.rerender(<MemoryRouter><Index /></MemoryRouter>);
    expect(screen.getByLabelText('Daily draft')).toHaveValue('A moment worth keeping');
    isLoading = false;
    view.rerender(<MemoryRouter><Index /></MemoryRouter>);
    expect(screen.getByLabelText('Daily draft')).toHaveValue('A moment worth keeping');
  });

  it('clears the mounted draft when switching signed-in accounts or logging out', () => {
    pubkey = 'alice';
    const view = render(<MemoryRouter><Index /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Add wisdom' }));
    fireEvent.change(screen.getByLabelText('Daily draft'), { target: { value: 'Alice private draft' } });
    pubkey = 'bob';
    isLoading = true;
    view.rerender(<MemoryRouter><Index /></MemoryRouter>);
    expect(screen.queryByLabelText('Daily draft')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add wisdom' }));
    expect(screen.getByLabelText('Daily draft')).toHaveValue('');
    pubkey = undefined;
    view.rerender(<MemoryRouter><Index /></MemoryRouter>);
    expect(screen.queryByLabelText('Daily draft')).not.toBeInTheDocument();
  });
});
