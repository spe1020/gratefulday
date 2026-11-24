import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

// The pool is replaced by a stub that keeps the routers NostrProvider gave
// it, so the tests can ask "where would a read or a publish go right now?"
// without opening a socket.
interface PoolOptions {
  reqRouter(filters: NostrFilter[]): Map<string, NostrFilter[]> | Promise<Map<string, NostrFilter[]>>;
  eventRouter(event: NostrEvent): string[] | Promise<string[]>;
}
const pools: PoolOptions[] = [];
/** What each stub relay holds. A query returns only what its routed relays hold. */
const relayEvents = new Map<string, NostrEvent[]>();

vi.mock('@nostrify/nostrify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nostrify/nostrify')>();
  return {
    ...actual,
    NPool: class {
      constructor(private opts: PoolOptions) {
        pools.push(opts);
      }

      async query(filters: NostrFilter[]): Promise<NostrEvent[]> {
        const found = new Map<string, NostrEvent>();
        for (const [url, routed] of await this.opts.reqRouter(filters)) {
          for (const event of relayEvents.get(url) ?? []) {
            const wanted = routed.some(
              (f) =>
                (!f.kinds || f.kinds.includes(event.kind)) &&
                (!f.authors || f.authors.includes(event.pubkey))
            );
            if (wanted) found.set(event.id, event);
          }
        }
        return [...found.values()];
      }
    },
  };
});

let currentUser: { pubkey: string } | undefined;
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: currentUser }),
}));

import NostrProvider from './NostrProvider';
import { AppProvider } from './AppProvider';
import { NostrSync } from './NostrSync';
import { useGratitudeEntries } from '@/hooks/useGratitudeEntries';
import { useAppContext } from '@/hooks/useAppContext';
import type { AppConfig, AppContextType } from '@/contexts/AppContext';

const STORAGE_KEY = 'test:nostr-provider-config';
const ME = 'a'.repeat(64);

const DEFAULT_RELAY = 'wss://default.example';
const ACCOUNT_READ_WRITE = 'wss://account-rw.example';
const ACCOUNT_WRITE_ONLY = 'wss://account-write.example';
const ACCOUNT_READ_ONLY = 'wss://account-read.example';

const defaultConfig: AppConfig = {
  theme: 'light',
  relayMetadata: {
    relays: [{ url: DEFAULT_RELAY, read: true, write: true }],
    updatedAt: 0,
  },
  defaultWalletApp: 'none',
  teachingPreferences: {},
};

const FILTERS: NostrFilter[] = [{ kinds: [36669], authors: [ME] }];
const EVENT = { kind: 36669, pubkey: ME } as NostrEvent;

let updateConfig: AppContextType['updateConfig'];

function Capture() {
  updateConfig = useAppContext().updateConfig;
  return null;
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AppProvider storageKey={STORAGE_KEY} defaultConfig={defaultConfig}>
      <QueryClientProvider client={queryClient}>
        <NostrProvider>
          <Capture />
        </NostrProvider>
      </QueryClientProvider>
    </AppProvider>
  );
  return { queryClient, pool: pools[pools.length - 1] };
}

/** What NostrSync does when it finds the account's NIP-65 list after login. */
function applyAccountRelayList() {
  act(() => {
    updateConfig((current) => ({
      ...current,
      relayMetadata: {
        relays: [
          { url: ACCOUNT_READ_WRITE, read: true, write: true },
          { url: ACCOUNT_WRITE_ONLY, read: false, write: true },
          { url: ACCOUNT_READ_ONLY, read: true, write: false },
        ],
        updatedAt: 100,
      },
    }));
  });
}

async function readRoutes(pool: PoolOptions): Promise<string[]> {
  return [...(await pool.reqRouter(FILTERS)).keys()].sort();
}

async function writeRoutes(pool: PoolOptions): Promise<string[]> {
  return [...(await pool.eventRouter(EVENT))].sort();
}

describe('NostrProvider relay routing', () => {
  beforeEach(() => {
    pools.length = 0;
    relayEvents.clear();
    currentUser = undefined;
    localStorage.removeItem(STORAGE_KEY);
  });

  it('routes to the configured relays at start', async () => {
    const { pool } = setup();

    expect(await readRoutes(pool)).toEqual([DEFAULT_RELAY]);
    expect(await writeRoutes(pool)).toEqual([DEFAULT_RELAY]);
  });

  it("reads from the account's relay list as soon as it is applied, without a reload", async () => {
    const { pool } = setup();

    applyAccountRelayList();

    // Same pool (it is created once); its routes must follow the new list.
    expect(pools).toHaveLength(1);
    expect(await readRoutes(pool)).toEqual([ACCOUNT_READ_ONLY, ACCOUNT_READ_WRITE]);
  });

  it("publishes to the account's write relays as soon as the list is applied", async () => {
    const { pool } = setup();

    applyAccountRelayList();

    expect(await writeRoutes(pool)).toEqual([ACCOUNT_READ_WRITE, ACCOUNT_WRITE_ONLY]);
  });

  it('marks the journal queries stale when the relay list changes', () => {
    const { queryClient } = setup();
    // What the calendar and the day view cached from the previous relays:
    // "no entries", which is only true of those relays.
    const calendarKey = ['gratitude-entries', ME];
    const dayKey = ['gratitude-entry', ME, '2026-11-24'];
    queryClient.setQueryData(calendarKey, []);
    queryClient.setQueryData(dayKey, null);

    applyAccountRelayList();

    expect(queryClient.getQueryState(calendarKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(dayKey)?.isInvalidated).toBe(true);
  });

  it('leaves the journal queries alone when a config change keeps the same relays', () => {
    const { queryClient } = setup();
    const calendarKey = ['gratitude-entries', ME];
    queryClient.setQueryData(calendarKey, []);

    act(() => {
      updateConfig((current) => ({ ...current, theme: 'dark' }));
    });
    // The same list again, as a new object (e.g. re-read from storage).
    act(() => {
      updateConfig((current) => ({
        ...current,
        relayMetadata: {
          relays: [{ url: DEFAULT_RELAY, read: true, write: true }],
          updatedAt: 0,
        },
      }));
    });

    expect(queryClient.getQueryState(calendarKey)?.isInvalidated).toBe(false);
  });

  it("shows an account's private entry right after login when it lives only on the account's own relays", async () => {
    // The account lists its own relays (NIP-65). Its list can be found on the
    // default relay, but its journal entry is only on the relay it lists:
    // where another client (the iOS app) publishes for such an account.
    const relayList = {
      id: 'relay-list',
      kind: 10002,
      pubkey: ME,
      created_at: 100,
      content: '',
      sig: '',
      tags: [['r', ACCOUNT_READ_WRITE]],
    } as NostrEvent;
    const entry = {
      id: 'entry-1',
      kind: 36669,
      pubkey: ME,
      created_at: 200,
      content: 'CIPHERTEXT',
      sig: '',
      tags: [
        ['d', '2026-11-24'],
        ['published_at', '1795496400'],
        ['day', '328'],
        ['encrypted', 'nip44'],
        ['alt', 'Encrypted gratitude journal entry'],
      ],
    } as NostrEvent;
    relayEvents.set(DEFAULT_RELAY, [relayList]);
    relayEvents.set(ACCOUNT_READ_WRITE, [entry]);
    currentUser = { pubkey: ME };

    function Journal() {
      const { data } = useGratitudeEntries(currentUser?.pubkey);
      return <div data-testid="days">{(data ?? []).map((e) => e.id).join(',')}</div>;
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60000 } } });
    render(
      <AppProvider storageKey={STORAGE_KEY} defaultConfig={defaultConfig}>
        <QueryClientProvider client={queryClient}>
          <NostrProvider>
            <NostrSync />
            <Journal />
          </NostrProvider>
        </QueryClientProvider>
      </AppProvider>
    );

    // No reload and no manual refresh: the list is applied and the journal
    // is read again from the account's relays.
    await waitFor(() => expect(screen.getByTestId('days')).toHaveTextContent('entry-1'));
  });
});
