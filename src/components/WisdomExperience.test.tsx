import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import { DAILY_WISDOM } from '@/lib/data/dailyWisdom';
import { getWisdomHistory, linkWisdomReflection, recordWisdomInteraction } from '@/lib/wisdomStore';
import { TodayHero } from './TodayHero';
import { WisdomReflectionSheet } from './WisdomReflectionSheet';
import { YourWisdom } from './YourWisdom';

let pubkey: string | undefined = 'alice';
const mockEntry = vi.fn();
const mockDecrypt = vi.fn();
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: pubkey ? { pubkey } : undefined }) }));
vi.mock('@/hooks/useGratitudeEntries', () => ({ useGratitudeEntry: (...args: unknown[]) => mockEntry(...args) }));
vi.mock('@/hooks/useDecryptedEntry', () => ({ useDecryptedEntry: (...args: unknown[]) => mockDecrypt(...args) }));

const wisdom = DAILY_WISDOM[0];
const day = { dayOfYear: 255, date: new Date(2026, 8, 12), dateString: '2026-09-12', isToday: true, isFuture: false, isPast: false, isUnlocked: true };

describe('Daily Wisdom experience', () => {
  beforeEach(() => {
    localStorage.clear();
    pubkey = 'alice';
    vi.clearAllMocks();
    mockEntry.mockReturnValue({ data: null, isLoading: false });
    mockDecrypt.mockReturnValue({ content: '', isDecrypting: false, decryptError: null });
  });

  it('preserves the card, records no impressions, and opens/closes without triggering gratitude', async () => {
    const onOpenDetail = vi.fn();
    render(<TodayHero day={day} totalDays={365} onOpenDetail={onOpenDetail} />);
    expect(screen.getByText(`"${wisdom.text}"`)).toBeVisible();
    expect(screen.getByText("Today's Reflection")).toBeVisible();
    expect(getWisdomHistory(pubkey)).toEqual([]);
    const trigger = screen.getByRole('button', { name: /reflect on this/i });
    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Daily Wisdom' });
    expect(within(sheet).getByText(wisdom.interpretation!)).toBeVisible();
    expect(within(sheet).getByText(wisdom.prompt!)).toBeVisible();
    expect(within(sheet).getByRole('link')).toHaveAttribute('href', wisdom.provenance!.url);
    expect(onOpenDetail).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(getWisdomHistory(pubkey)[0].addedAt).toBeUndefined();
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('adds once and returns to the normal daily editor', async () => {
    const onOpenDetail = vi.fn();
    render(<TodayHero day={day} totalDays={365} onOpenDetail={onOpenDetail} />);
    fireEvent.click(screen.getByRole('button', { name: /reflect on this/i }));
    fireEvent.click(screen.getByRole('button', { name: "Add to today's reflection" }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith(day);
    expect(getWisdomHistory(pubkey)[0].addedAt).toBeDefined();
    expect(getWisdomHistory(pubkey)[0].reflection).toBeUndefined();
  });

  it('supports escape, missing metadata, and a bounded mobile sheet', async () => {
    function Minimal() {
      const [open, setOpen] = useState(true);
      return <WisdomReflectionSheet wisdom={{ id: 'minimal', text: 'A thought', author: 'Writer' }} open={open} onOpenChange={setOpen} />;
    }
    render(<Minimal />);
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(/source wording not yet verified/i)).toBeVisible();
    expect(within(sheet).getByText(/your life today/i)).toBeVisible();
    expect(sheet).toHaveClass('max-h-[85dvh]', 'overflow-y-auto', 'w-full', 'max-w-xl');
    expect(within(sheet).queryByRole('link')).not.toBeInTheDocument();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows only deliberate history, restores it after remount, and isolates account changes', async () => {
    recordWisdomInteraction('alice', wisdom, day.dateString, 'opened');
    const view = render(<YourWisdom />);
    fireEvent.click(screen.getByRole('button', { name: /your wisdom/i }));
    expect(screen.getByText(wisdom.text)).toBeVisible();
    expect(screen.queryByText(DAILY_WISDOM[1].text)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Wait\./ }));
    expect(screen.getByText(wisdom.prompt!)).toBeVisible();
    expect(screen.getByText(/No reflection was added/)).toBeVisible();
    view.unmount();
    const restored = render(<YourWisdom />);
    fireEvent.click(screen.getByRole('button', { name: /your wisdom/i }));
    expect(screen.getByText(wisdom.text)).toBeVisible();
    pubkey = 'bob';
    restored.rerender(<YourWisdom />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /your wisdom/i }));
    expect(screen.getByText(/When a daily thought catches/)).toBeVisible();
  });

  it('reads linked writing through the existing decryption hook and hides unreadable private content', () => {
    recordWisdomInteraction('alice', wisdom, day.dateString, 'added');
    linkWisdomReflection('alice', day.dateString, 'entry-id', [wisdom.id], true);
    const event: NostrEvent = { id: 'entry-id', kind: 36669, pubkey: 'alice', content: 'SECRET-CIPHERTEXT', created_at: 1, sig: '', tags: [['d', day.dateString], ['encrypted', 'nip44']] };
    mockEntry.mockReturnValue({ data: event });
    mockDecrypt.mockReturnValue({ content: '', isDecrypting: false, decryptError: new Error('locked') });
    render(<QueryClientProvider client={new QueryClient()}><YourWisdom /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: /your wisdom/i }));
    fireEvent.click(screen.getByRole('button', { name: /Wait\./ }));
    expect(mockEntry).toHaveBeenCalledWith('alice', day.dateString);
    expect(mockDecrypt).toHaveBeenCalledWith(event);
    expect(screen.queryByText('SECRET-CIPHERTEXT')).not.toBeInTheDocument();
    expect(screen.getByText(/This reflection is private/)).toBeVisible();
  });
});
