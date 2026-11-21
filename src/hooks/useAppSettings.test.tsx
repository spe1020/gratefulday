import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import type { AppSettings } from '@/lib/appSettings';

// Every relay read in the hook must go through queryForWrite; the pool's own
// query() is a spy that must never be called.
const nostr = { query: vi.fn(), req: vi.fn() };
const queryForWrite = vi.fn<(...args: unknown[]) => Promise<NostrEvent[]>>();
const resolveRemoteSettings = vi.fn<(...args: unknown[]) => Promise<AppSettings | null>>();
const encryptSettings = vi.fn<(signer: unknown, pubkey: string, s: AppSettings) => Promise<string>>();
const publish = vi.fn();
const toast = vi.fn();
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast }) }));

vi.mock('@nostrify/react', () => ({ useNostr: () => ({ nostr }) }));
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      relayMetadata: {
        relays: [
          { url: 'wss://a', read: true, write: true },
          { url: 'wss://b', read: true, write: true },
          { url: 'wss://c', read: true, write: true },
        ],
      },
    },
  }),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'pk-self', method: 'extension', signer: {} } }),
}));
vi.mock('@/hooks/useNip44Support', () => ({
  useNip44Support: () => ({ supported: true }),
  cacheNip44Support: vi.fn(),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutate: publish }),
}));
vi.mock('@/lib/relayQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/relayQuery')>();
  return { ...actual, queryForWrite: (...args: unknown[]) => queryForWrite(...args) };
});
vi.mock('@/lib/appSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/appSettings')>();
  return {
    ...actual,
    resolveRemoteSettings: (...args: unknown[]) => resolveRemoteSettings(...args),
    encryptSettings: (signer: unknown, pubkey: string, s: AppSettings) => encryptSettings(signer, pubkey, s),
  };
});

import { useAppSettings } from './useAppSettings';
import { IncompleteRelayReadError } from '@/lib/relayQuery';
import {
  SettingsUnreadableError,
  writeLocalCache,
  readLocalCache,
  readPendingPrivacy,
} from '@/lib/appSettings';

const KEYS = [
  'gratefulday:privacy-default:v1',
  'gratefulday:last-seen-notifications:v1',
  'gratefulday:milestones:v1',
  'gratefulday:privacy-default-pending:v1',
];

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Let pending promises and effects settle. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  for (const k of KEYS) localStorage.removeItem(k);
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryForWrite.mockResolvedValue([]);
  resolveRemoteSettings.mockResolvedValue(null);
  encryptSettings.mockResolvedValue('ciphertext');
});

describe('useAppSettings — read, merge, then write', () => {
  it('reads only through queryForWrite against the configured read relays', async () => {
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(queryForWrite).toHaveBeenCalled());
    expect(queryForWrite.mock.calls[0][1]).toEqual(['wss://a', 'wss://b', 'wss://c']);
    expect(nostr.query).not.toHaveBeenCalled();
  });

  it('never seeds after a timed-out read', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    queryForWrite.mockRejectedValue(new IncompleteRelayReadError(1, 3));
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(queryForWrite).toHaveBeenCalled());
    await flush();
    expect(encryptSettings).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('never seeds after a failed decrypt of the newest event, even with a quorum', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    queryForWrite.mockResolvedValue([{ id: 'x' } as NostrEvent]);
    resolveRemoteSettings.mockRejectedValue(new SettingsUnreadableError());
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(resolveRemoteSettings).toHaveBeenCalled());
    await flush();
    expect(publish).not.toHaveBeenCalled();
  });

  it('seeds when a complete read found nothing, re-reading first', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    // Initial query + the fresh read inside the write.
    expect(queryForWrite).toHaveBeenCalledTimes(2);
    expect(encryptSettings.mock.calls[0][2]).toMatchObject({ privacyDefault: true, celebratedMilestones: [7] });
  });

  it('skips the seed when the fresh read finds an event that appeared meanwhile', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    resolveRemoteSettings
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ privacyDefault: false, celebratedMilestones: [30] });
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(queryForWrite).toHaveBeenCalledTimes(2));
    await flush();
    expect(publish).not.toHaveBeenCalled();
  });

  it('an update merges with the freshly read remote before publishing', async () => {
    writeLocalCache('pk-self', { celebratedMilestones: [7] });
    // Initial read: another device's state.
    resolveRemoteSettings.mockResolvedValue({ privacyDefault: false, celebratedMilestones: [7] });
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Meanwhile another device celebrated 30 and read notifications.
    resolveRemoteSettings.mockResolvedValue({
      privacyDefault: false,
      celebratedMilestones: [7, 30],
      lastSeenNotifications: 900,
    });
    act(() => result.current.updateSettings({ privacyDefault: true }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(encryptSettings.mock.calls.at(-1)![2]).toEqual({
      privacyDefault: true,
      celebratedMilestones: [7, 30],
      lastSeenNotifications: 900,
    });
    // The merged state is also cached locally.
    expect(readLocalCache('pk-self').celebratedMilestones).toEqual([7, 30]);
  });

  it('an update after a timed-out fresh read publishes nothing but keeps the change locally', async () => {
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    queryForWrite.mockRejectedValue(new IncompleteRelayReadError(1, 3));
    act(() => result.current.updateSettings({ celebratedMilestones: [14] }));
    await flush();
    expect(publish).not.toHaveBeenCalled();
    expect(readLocalCache('pk-self').celebratedMilestones).toEqual([14]);
    expect(result.current.settings.celebratedMilestones).toEqual([14]);
  });

  it('an update after a failed decrypt publishes nothing', async () => {
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    resolveRemoteSettings.mockRejectedValue(new SettingsUnreadableError());
    act(() => result.current.updateSettings({ privacyDefault: true }));
    await flush();
    expect(publish).not.toHaveBeenCalled();
    expect(readLocalCache('pk-self').privacyDefault).toBe(true);
  });
});

describe('useAppSettings — a blocked privacy-default change is kept (Audit M1)', () => {
  /** Remote says Public; the user picks Private while relays don't answer. */
  async function blockedPrivateChoice() {
    resolveRemoteSettings.mockResolvedValue({ privacyDefault: false, celebratedMilestones: [] });
    const view = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    queryForWrite.mockRejectedValue(new IncompleteRelayReadError(1, 3));
    act(() => view.result.current.updateSettings({ privacyDefault: true }));
    await flush();
    expect(publish).not.toHaveBeenCalled();
    return view;
  }

  it('tells the user once that the choice has not synced', async () => {
    const { result } = await blockedPrivateChoice();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ title: expect.stringMatching(/privacy choice saved on this device/i) });
    expect(toast.mock.calls[0][0].variant).toBeUndefined();
    // Another blocked write (e.g. the next entry save re-sending it) doesn't repeat it.
    act(() => result.current.updateSettings({ privacyDefault: true }));
    await flush();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('a refetch of the older remote value does not flip it back', async () => {
    const { result } = await blockedPrivateChoice();
    expect(readPendingPrivacy('pk-self')).toBe(true);
    // Relays answer again, still holding the older Public value.
    queryForWrite.mockResolvedValue([]);
    resolveRemoteSettings.mockResolvedValue({ privacyDefault: false, celebratedMilestones: [] });
    await act(async () => {
      await client.refetchQueries({ queryKey: ['app-settings', 'pk-self'] });
    });
    expect(client.getQueryData(['app-settings', 'pk-self'])).toMatchObject({ privacyDefault: false });
    expect(result.current.settings.privacyDefault).toBe(true);
  });

  it('the next milestone write publishes the choice instead of overwriting it, then clears the marker', async () => {
    const { result } = await blockedPrivateChoice();
    queryForWrite.mockResolvedValue([]);
    resolveRemoteSettings.mockResolvedValue({ privacyDefault: false, celebratedMilestones: [] });
    publish.mockImplementation((_event, opts) => opts?.onSuccess?.());
    act(() => result.current.updateSettings({ celebratedMilestones: [7] }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(encryptSettings.mock.calls.at(-1)![2]).toMatchObject({
      privacyDefault: true,
      celebratedMilestones: [7],
    });
    expect(readLocalCache('pk-self').privacyDefault).toBe(true);
    expect(readPendingPrivacy('pk-self')).toBeUndefined();
  });

  it('re-sending the current value is not a change: nothing pending, no notice', async () => {
    resolveRemoteSettings.mockResolvedValue({ privacyDefault: true, celebratedMilestones: [] });
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    queryForWrite.mockRejectedValue(new IncompleteRelayReadError(1, 3));
    act(() => result.current.updateSettings({ privacyDefault: true }));
    await flush();
    expect(readPendingPrivacy('pk-self')).toBeUndefined();
    expect(toast).not.toHaveBeenCalled();
  });

  it('a rejected publish also keeps the choice pending and notifies', async () => {
    resolveRemoteSettings.mockResolvedValue({ privacyDefault: false, celebratedMilestones: [] });
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    publish.mockImplementation((_event, opts) => opts?.onError?.(new Error('no relay accepted')));
    act(() => result.current.updateSettings({ privacyDefault: true }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(readPendingPrivacy('pk-self')).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
