import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';
import type { AppSettings } from '@/lib/appSettings';

// Display reads go through queryForDisplay (tolerant) and every read that
// protects a write through queryForWrite (strict); the pool's own query() is
// a spy that must never be called.
const nostr = { query: vi.fn(), req: vi.fn() };
const queryForWrite = vi.fn<(...args: unknown[]) => Promise<NostrEvent[]>>();
const queryForDisplay = vi.fn<(...args: unknown[]) => Promise<NostrEvent[]>>();
// The logged-in account; tests switch it to simulate an account change.
let currentUser = { pubkey: 'pk-self', method: 'extension', signer: {} };
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
  useCurrentUser: () => ({ user: currentUser }),
}));
vi.mock('@/hooks/useNip44Support', () => ({
  useNip44Support: () => ({ supported: true }),
  cacheNip44Support: vi.fn(),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutateAsync: publish }),
}));
vi.mock('@/lib/relayQuery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/relayQuery')>();
  return {
    ...actual,
    queryForWrite: (...args: unknown[]) => queryForWrite(...args),
    queryForDisplay: (...args: unknown[]) => queryForDisplay(...args),
  };
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
import { resetSettingsSync } from '@/lib/settingsSync';
import {
  SettingsUnreadableError,
  writeLocalCache,
  readLocalCache,
  readPendingPrivacy,
  readKnownSettingsAt,
  noteKnownSettingsAt,
} from '@/lib/appSettings';

const KEYS = [
  'gratefulday:privacy-default:v1',
  'gratefulday:last-seen-notifications:v1',
  'gratefulday:milestones:v1',
  'gratefulday:privacy-default-pending:v1',
  'gratefulday:settings-known-at:v1',
];

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A promise the test settles by hand, to hold a read or publish open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let publishedAt = 1000;
/** What the publish hook resolves with: the signed event. */
function signedEvent(): NostrEvent {
  return { pubkey: currentUser.pubkey, created_at: ++publishedAt } as NostrEvent;
}

/**
 * A settings event as relays would return it. The (mocked) decrypt step reads
 * the settings straight off it, so tests can script which copy each read sees.
 */
function remoteEvent(created_at: number, settings: AppSettings): NostrEvent {
  return { id: `ev-${created_at}`, created_at, settings } as unknown as NostrEvent;
}
/** Make the decrypt step return the settings of the newest event read. */
function decryptFromEvents() {
  resolveRemoteSettings.mockImplementation(async (...args: unknown[]) => {
    const events = args[2] as (NostrEvent & { settings?: AppSettings })[];
    const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
    return latest?.settings ?? null;
  });
}

/** Let pending promises and effects settle. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  for (const k of KEYS) localStorage.removeItem(k);
  vi.resetAllMocks();
  resetSettingsSync();
  currentUser = { pubkey: 'pk-self', method: 'extension', signer: {} };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryForWrite.mockResolvedValue([]);
  queryForDisplay.mockResolvedValue([]);
  resolveRemoteSettings.mockResolvedValue(null);
  encryptSettings.mockResolvedValue('ciphertext');
  publish.mockImplementation(async () => signedEvent());
});

describe('useAppSettings — read, merge, then write', () => {
  it('shows settings through the tolerant read, against the configured read relays', async () => {
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(queryForDisplay).toHaveBeenCalled());
    expect(queryForDisplay.mock.calls[0][1]).toEqual(['wss://a', 'wss://b', 'wss://c']);
    expect(queryForWrite).not.toHaveBeenCalled();
    expect(nostr.query).not.toHaveBeenCalled();
  });

  it('never seeds when the display read saw nothing but the strict read times out', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    // Too few relays answered: display shows "nothing seen", a write must not trust it.
    queryForWrite.mockRejectedValue(new IncompleteRelayReadError(1, 3));
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(queryForWrite).toHaveBeenCalled());
    await flush();
    expect(encryptSettings).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('never seeds when no relay answered the display read at all', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    queryForDisplay.mockRejectedValue(new IncompleteRelayReadError(0, 3));
    queryForWrite.mockRejectedValue(new IncompleteRelayReadError(0, 3));
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(queryForDisplay).toHaveBeenCalled());
    await flush();
    expect(publish).not.toHaveBeenCalled();
    // Local values still show.
    expect(result.current.settings).toMatchObject({ privacyDefault: true, celebratedMilestones: [7] });
  });

  it('never seeds after a failed decrypt of the newest event, even with a quorum', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    queryForDisplay.mockResolvedValue([{ id: 'x' } as NostrEvent]);
    queryForWrite.mockResolvedValue([{ id: 'x' } as NostrEvent]);
    resolveRemoteSettings.mockRejectedValue(new SettingsUnreadableError());
    renderHook(() => useAppSettings(), { wrapper });
    // Once for display (shows nothing remote), once for the strict seed read.
    await waitFor(() => expect(resolveRemoteSettings).toHaveBeenCalledTimes(2));
    await flush();
    expect(publish).not.toHaveBeenCalled();
  });

  it('seeds when a complete read found nothing, re-reading first', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    // The write did its own strict read (the display read alone never seeds).
    expect(queryForWrite).toHaveBeenCalledTimes(1);
    expect(encryptSettings.mock.calls[0][2]).toMatchObject({ privacyDefault: true, celebratedMilestones: [7] });
  });

  it('skips the seed when the fresh read finds an event that appeared meanwhile', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    resolveRemoteSettings
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ privacyDefault: false, celebratedMilestones: [30] });
    renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(queryForWrite).toHaveBeenCalledTimes(1));
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
    expect(toast.mock.calls[0][0]).toMatchObject({ title: expect.stringMatching(/privacy default saved on this device/i) });
    expect(toast.mock.calls[0][0].variant).toBeUndefined();
    // Another blocked write (e.g. the next entry save re-sending it) doesn't repeat it.
    act(() => result.current.updateSettings({ privacyDefault: true }));
    await flush();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('a refetch of the older remote value does not flip it back', async () => {
    const { result, rerender } = await blockedPrivateChoice();
    expect(readPendingPrivacy('pk-self')).toBe(true);
    // Relays answer again, still holding the older Public value.
    queryForWrite.mockResolvedValue([]);
    resolveRemoteSettings.mockResolvedValue({ privacyDefault: false, celebratedMilestones: [] });
    await act(async () => {
      await client.refetchQueries({ queryKey: ['app-settings', 'pk-self'] });
    });
    expect(client.getQueryData(['app-settings', 'pk-self'])).toMatchObject({ privacyDefault: false });
    // Re-render so the hook recomputes from the refetched cache before asserting.
    rerender();
    await flush();
    expect(result.current.settings.privacyDefault).toBe(true);
  });

  it('the next milestone write publishes the choice instead of overwriting it, then clears the marker', async () => {
    const { result } = await blockedPrivateChoice();
    queryForWrite.mockResolvedValue([]);
    resolveRemoteSettings.mockResolvedValue({ privacyDefault: false, celebratedMilestones: [] });
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
    publish.mockRejectedValue(new Error('no relay accepted'));
    act(() => result.current.updateSettings({ privacyDefault: true }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(readPendingPrivacy('pk-self')).toBe(true);
  });
});

describe('useAppSettings — display reads do not need a quorum', () => {
  it('shows remote settings from a partial read while a write stays blocked', async () => {
    // One relay of three answered: enough to show, not enough to write.
    queryForDisplay.mockResolvedValue([{ id: 'x', created_at: 5 } as NostrEvent]);
    resolveRemoteSettings.mockResolvedValue({ privacyDefault: true, celebratedMilestones: [7, 30] });
    queryForWrite.mockRejectedValue(new IncompleteRelayReadError(1, 3));
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() =>
      expect(result.current.settings).toMatchObject({ privacyDefault: true, celebratedMilestones: [7, 30] })
    );
    act(() => result.current.updateSettings({ celebratedMilestones: [100] }));
    await flush();
    expect(publish).not.toHaveBeenCalled();
    expect(result.current.settings.celebratedMilestones).toEqual([7, 30, 100]);
  });

  it('shows local values when the remote event cannot be decrypted', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7] });
    queryForDisplay.mockResolvedValue([{ id: 'x', created_at: 5 } as NostrEvent]);
    queryForWrite.mockResolvedValue([{ id: 'x', created_at: 5 } as NostrEvent]);
    resolveRemoteSettings.mockRejectedValue(new SettingsUnreadableError());
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toMatchObject({ privacyDefault: true, celebratedMilestones: [7] });
  });
});

describe('useAppSettings — writes from different components are serialized app-wide', () => {
  const STALE_REMOTE: AppSettings = { privacyDefault: false, celebratedMilestones: [] };

  /** Two mounted instances, as the day editor and the milestone dialog are. */
  async function twoComponents() {
    resolveRemoteSettings.mockResolvedValue(STALE_REMOTE);
    const editor = renderHook(() => useAppSettings(), { wrapper });
    const milestones = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(editor.result.current.isLoading).toBe(false));
    await waitFor(() => expect(milestones.result.current.isLoading).toBe(false));
    return { editor, milestones };
  }

  it('an overlapping milestone write does not revert a just-changed privacy default', async () => {
    const { editor, milestones } = await twoComponents();
    // Every strict read keeps returning the copy from before either write,
    // as relays do when both reads start before the first publish lands (or
    // when the relays that answer haven't stored it yet).
    const firstPublish = deferred<NostrEvent>();
    publish.mockImplementationOnce(() => firstPublish.promise);

    // One save: the editor switches the default to Private, and the save
    // reaches a streak milestone a moment later.
    act(() => editor.result.current.updateSettings({ privacyDefault: true }));
    act(() => milestones.result.current.updateSettings({ celebratedMilestones: [7] }));

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await flush();
    // The second write has not even read yet: it waits for the first publish.
    expect(queryForWrite).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstPublish.resolve(signedEvent());
    });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    await flush();

    // The last event on relays carries both changes.
    expect(encryptSettings.mock.calls.at(-1)![2]).toEqual({
      privacyDefault: true,
      celebratedMilestones: [7],
      lastSeenNotifications: undefined,
    });
    // And the choice survives on this device, in both components.
    expect(readLocalCache('pk-self')).toMatchObject({ privacyDefault: true, celebratedMilestones: [7] });
    expect(readPendingPrivacy('pk-self')).toBeUndefined();
    editor.rerender();
    milestones.rerender();
    expect(editor.result.current.settings.privacyDefault).toBe(true);
    expect(milestones.result.current.settings.privacyDefault).toBe(true);
  });

  it('the privacy write publishing second does not drop the milestone', async () => {
    const { editor, milestones } = await twoComponents();
    act(() => milestones.result.current.updateSettings({ celebratedMilestones: [7] }));
    act(() => editor.result.current.updateSettings({ privacyDefault: true }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    await flush();
    expect(encryptSettings.mock.calls.at(-1)![2]).toMatchObject({
      privacyDefault: true,
      celebratedMilestones: [7],
    });
  });

  it('the latest of two quick privacy choices wins, even from a queued older write', async () => {
    const { editor, milestones } = await twoComponents();
    const firstRead = deferred<NostrEvent[]>();
    queryForWrite.mockImplementationOnce(() => firstRead.promise);
    act(() => editor.result.current.updateSettings({ privacyDefault: true }));
    await flush();
    // The user changes their mind before the first write has read the relays.
    act(() => milestones.result.current.updateSettings({ privacyDefault: false }));
    await act(async () => {
      firstRead.resolve([]);
    });
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    await flush();
    for (const call of encryptSettings.mock.calls) {
      expect(call[2].privacyDefault).toBe(false);
    }
    expect(readLocalCache('pk-self').privacyDefault).toBe(false);
  });

  it('a failed write does not block the next one', async () => {
    const { editor, milestones } = await twoComponents();
    publish.mockRejectedValueOnce(new Error('no relay accepted'));
    act(() => editor.result.current.updateSettings({ privacyDefault: true }));
    act(() => milestones.result.current.updateSettings({ celebratedMilestones: [7] }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    await flush();
    expect(encryptSettings.mock.calls.at(-1)![2]).toMatchObject({
      privacyDefault: true,
      celebratedMilestones: [7],
    });
    expect(readPendingPrivacy('pk-self')).toBeUndefined();
  });
});

describe('useAppSettings — an account switch during a write', () => {
  const SELF_REMOTE: AppSettings = { privacyDefault: false, celebratedMilestones: [] };

  beforeEach(() => {
    // pk-self has remote settings; pk-other has none anywhere.
    resolveRemoteSettings.mockImplementation(async (...args: unknown[]) =>
      args[1] === 'pk-self' ? SELF_REMOTE : null
    );
  });

  function switchAccount(view: { rerender: () => void }) {
    currentUser = { pubkey: 'pk-other', method: 'extension', signer: {} };
    view.rerender();
  }

  function expectOtherAccountUntouched(view: { result: { current: { settings: AppSettings } } }) {
    expect(readLocalCache('pk-other')).toEqual({
      privacyDefault: undefined,
      celebratedMilestones: [],
      lastSeenNotifications: undefined,
    });
    expect(readPendingPrivacy('pk-other')).toBeUndefined();
    expect(client.getQueryData(['app-settings', 'pk-other']) ?? null).toBeNull();
    expect(view.result.current.settings).toEqual({
      privacyDefault: undefined,
      celebratedMilestones: [],
      lastSeenNotifications: undefined,
    });
  }

  it('while the write is reading relays: nothing reaches the new account, nothing is published', async () => {
    const view = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    const read = deferred<NostrEvent[]>();
    queryForWrite.mockImplementationOnce(() => read.promise);
    act(() =>
      view.result.current.updateSettings({
        privacyDefault: true,
        celebratedMilestones: [7, 30],
        lastSeenNotifications: 500,
      })
    );
    await flush();

    switchAccount(view);
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    await act(async () => {
      read.resolve([]);
    });
    await flush();
    view.rerender();

    // Nothing was signed or published as the new account.
    expect(encryptSettings).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expectOtherAccountUntouched(view);
    // The first account keeps its change, still marked for its next write.
    expect(readLocalCache('pk-self')).toEqual({
      privacyDefault: true,
      celebratedMilestones: [7, 30],
      lastSeenNotifications: 500,
    });
    expect(readPendingPrivacy('pk-self')).toBe(true);
  });

  it('while the write is encrypting: it is not published under the new account', async () => {
    const view = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    const encryption = deferred<string>();
    encryptSettings.mockImplementationOnce(() => encryption.promise);
    act(() => view.result.current.updateSettings({ privacyDefault: true, celebratedMilestones: [7] }));
    await waitFor(() => expect(encryptSettings).toHaveBeenCalledTimes(1));

    switchAccount(view);
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    await act(async () => {
      encryption.resolve('ciphertext-for-pk-self');
    });
    await flush();
    view.rerender();

    expect(publish).not.toHaveBeenCalled();
    expectOtherAccountUntouched(view);
    expect(readPendingPrivacy('pk-self')).toBe(true);
  });

  it("the new account's own writes are not held up by the old account's write", async () => {
    const view = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    const read = deferred<NostrEvent[]>();
    queryForWrite.mockImplementationOnce(() => read.promise);
    act(() => view.result.current.updateSettings({ celebratedMilestones: [7] }));
    await flush();

    switchAccount(view);
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    act(() => view.result.current.updateSettings({ celebratedMilestones: [14] }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(encryptSettings.mock.calls[0][1]).toBe('pk-other');
    expect(encryptSettings.mock.calls[0][2].celebratedMilestones).toEqual([14]);

    await act(async () => {
      read.resolve([]);
    });
    await flush();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(readLocalCache('pk-other').celebratedMilestones).toEqual([14]);
    expect(readLocalCache('pk-self').celebratedMilestones).toEqual([7]);
  });
});

describe('useAppSettings — an older copy from a lagging relay cannot revert the privacy default', () => {
  const OLD = remoteEvent(100, { privacyDefault: false, celebratedMilestones: [] });

  beforeEach(() => decryptFromEvents());

  it('a display read answered only by a stale relay does not flip the default, and a save does not publish it', async () => {
    // This device already applied/published a newer event choosing Private.
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [] });
    noteKnownSettingsAt('pk-self', 200);
    queryForDisplay.mockResolvedValue([OLD]);
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await flush();
    expect(result.current.settings.privacyDefault).toBe(true);
    expect(readLocalCache('pk-self').privacyDefault).toBe(true);

    // An entry save re-sends the default the editor showed. The strict read
    // also only reaches relays with the older copy.
    queryForWrite.mockResolvedValue([OLD]);
    act(() => result.current.updateSettings({ privacyDefault: result.current.settings.privacyDefault }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(encryptSettings.mock.calls.at(-1)![2].privacyDefault).toBe(true);
    expect(readLocalCache('pk-self').privacyDefault).toBe(true);
  });

  it('after our publish reached only some relays, a later milestone write does not bring the old default back', async () => {
    queryForDisplay.mockResolvedValue([OLD]);
    queryForWrite.mockResolvedValue([OLD]);
    const editor = renderHook(() => useAppSettings(), { wrapper });
    const milestones = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(editor.result.current.isLoading).toBe(false));

    // W1: the user chooses Private. One relay accepts it.
    const published: NostrEvent[] = [];
    publish.mockImplementation(async (template: { created_at: number }) => {
      const event = remoteEvent(template.created_at, encryptSettings.mock.calls.at(-1)![2]);
      published.push(event);
      return { ...event, pubkey: 'pk-self' };
    });
    // The display refetch after it is answered by that one relay (our own event).
    queryForDisplay.mockImplementation(async () => (published.length ? [published.at(-1)!] : [OLD]));
    act(() => editor.result.current.updateSettings({ privacyDefault: true }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await flush();
    expect(readPendingPrivacy('pk-self')).toBeUndefined();

    // W2: a milestone write whose strict read reaches only the lagging majority.
    act(() => milestones.result.current.updateSettings({ celebratedMilestones: [7] }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    await flush();
    expect(encryptSettings.mock.calls.at(-1)![2]).toMatchObject({
      privacyDefault: true,
      celebratedMilestones: [7],
    });
    expect(readLocalCache('pk-self').privacyDefault).toBe(true);
  });

  it('the protection survives a reload (it is persisted, not in memory)', async () => {
    queryForDisplay.mockResolvedValue([OLD]);
    queryForWrite.mockResolvedValue([OLD]);
    const first = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    act(() => first.result.current.updateSettings({ privacyDefault: true }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await flush();
    first.unmount();

    // Reload: all in-memory state is gone; relays still answer with the old copy.
    resetSettingsSync();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const second = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    await flush();
    expect(second.result.current.settings.privacyDefault).toBe(true);
    act(() => second.result.current.updateSettings({ celebratedMilestones: [7] }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    expect(encryptSettings.mock.calls.at(-1)![2].privacyDefault).toBe(true);
  });

  it("a newer event from another device IS applied, and then protected too", async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [] });
    noteKnownSettingsAt('pk-self', 200);
    const NEWER = remoteEvent(300, { privacyDefault: false, celebratedMilestones: [30] });
    queryForDisplay.mockResolvedValue([OLD, NEWER]);
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.settings.privacyDefault).toBe(false));
    expect(result.current.settings.celebratedMilestones).toEqual([30]);
    expect(readLocalCache('pk-self').privacyDefault).toBe(false);
    expect(readKnownSettingsAt('pk-self')).toBe(300);
  });

  it('each settings event is stamped after the newest one this device knows of', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    noteKnownSettingsAt('pk-self', future);
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.updateSettings({ celebratedMilestones: [7] }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0][0].created_at).toBe(future + 1);
  });
});

describe('useAppSettings — components share one view of local settings', () => {
  it("another component keeps showing a change whose write is blocked, even after a refetch of the older remote", async () => {
    resolveRemoteSettings.mockResolvedValue({ celebratedMilestones: [7], lastSeenNotifications: 100 });
    const a = renderHook(() => useAppSettings(), { wrapper });
    const b = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(b.result.current.isLoading).toBe(false));
    queryForWrite.mockRejectedValue(new IncompleteRelayReadError(1, 3));
    act(() => a.result.current.updateSettings({ lastSeenNotifications: 900, celebratedMilestones: [30] }));
    await flush();
    await act(async () => {
      await client.refetchQueries({ queryKey: ['app-settings', 'pk-self'] });
    });
    expect(b.result.current.settings).toMatchObject({
      celebratedMilestones: [7, 30],
      lastSeenNotifications: 900,
    });
  });

  it('the first render after an account switch already shows the new account, not the old one', async () => {
    writeLocalCache('pk-self', { privacyDefault: true, celebratedMilestones: [7, 30] });
    const seen: AppSettings[] = [];
    const view = renderHook(() => {
      const value = useAppSettings();
      seen.push(value.settings);
      return value;
    }, { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    seen.length = 0;
    currentUser = { pubkey: 'pk-other', method: 'extension', signer: {} };
    view.rerender();
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s.privacyDefault).toBeUndefined();
      expect(s.celebratedMilestones).toEqual([]);
    }
  });
});
