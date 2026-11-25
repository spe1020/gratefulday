import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

// Stub pool: keeps NostrProvider's routers so a test can ask where a read or
// a publish would go, and answers per-relay reads from `relayEvents`.
interface PoolOptions {
  reqRouter(filters: NostrFilter[]): Map<string, NostrFilter[]> | Promise<Map<string, NostrFilter[]>>;
  eventRouter(event: NostrEvent): string[] | Promise<string[]>;
}
const pools: PoolOptions[] = [];
const relayEvents = new Map<string, NostrEvent[]>();
/** Relays that fail every read (down, or never answer). */
const deadRelays = new Set<string>();
/** Every relay a per-relay read was sent to. */
const asked: string[] = [];

vi.mock('@nostrify/nostrify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nostrify/nostrify')>();
  return {
    ...actual,
    NPool: class {
      constructor(private opts: PoolOptions) {
        pools.push(opts);
      }
      async query(): Promise<NostrEvent[]> {
        return [];
      }
      async *req(filters: NostrFilter[], opts?: { relays?: string[] }) {
        for (const url of opts?.relays ?? []) {
          asked.push(url);
          if (deadRelays.has(url)) throw new Error('relay down');
          for (const event of relayEvents.get(url) ?? []) {
            const wanted = filters.some(
              (f) =>
                (!f.kinds || f.kinds.includes(event.kind)) &&
                (!f.authors || f.authors.includes(event.pubkey))
            );
            if (wanted) yield ['EVENT', 'sub', event] as const;
          }
        }
        yield ['EOSE', 'sub'] as const;
      }
    },
  };
});

let logins: { pubkey: string }[] = [];
vi.mock('@nostrify/react/login', () => ({
  useNostrLogin: () => ({ logins }),
}));

import NostrProvider from './NostrProvider';
import { AppProvider } from './AppProvider';
import { AccountRelayProvider } from './AccountRelayProvider';
import { NostrSync } from './NostrSync';
import { useAppContext } from '@/hooks/useAppContext';
import { RelayListContext, type RelayListContextType } from '@/contexts/RelayListContext';
import type { AppConfig, AppContextType } from '@/contexts/AppContext';
import {
  ACCOUNT_RELAYS_KEY,
  RelayAccountChangedError,
  RelayListUnresolvedError,
} from '@/lib/accountRelays';

const STORAGE_KEY = 'test:account-relays-config';
const C = 'c'.repeat(64);
const B = 'b'.repeat(64);

const DEFAULT_A = 'wss://default-a.example/';
const DEFAULT_B = 'wss://default-b.example/';
const DEFAULT_C = 'wss://default-c.example/';
const C_RELAY = 'wss://c-own.example/';
const B_RELAY = 'wss://b-own.example/';

const defaultRelays = {
  relays: [DEFAULT_A, DEFAULT_B, DEFAULT_C].map((url) => ({ url, read: true, write: true })),
  updatedAt: 0,
};

const defaultConfig: AppConfig = {
  theme: 'light',
  relayMetadata: defaultRelays,
  defaultWalletApp: 'none',
  teachingPreferences: {},
};

function relayList(pubkey: string, url: string, created_at: number): NostrEvent {
  return {
    id: `10002-${pubkey.slice(0, 4)}-${created_at}`,
    kind: 10002,
    pubkey,
    created_at,
    content: '',
    sig: '',
    tags: [['r', url]],
  };
}

let app: AppContextType;
let gate: RelayListContextType;

function Capture() {
  app = useAppContext();
  gate = useContext(RelayListContext)!;
  return null;
}

function Tree() {
  return (
    <AppProvider storageKey={STORAGE_KEY} defaultConfig={defaultConfig}>
      <QueryClientProvider client={new QueryClient()}>
        <AccountRelayProvider defaultRelays={defaultRelays}>
          <NostrProvider>
            <NostrSync defaultRelays={defaultRelays} />
            <Capture />
          </NostrProvider>
        </AccountRelayProvider>
      </QueryClientProvider>
    </AppProvider>
  );
}

const EVENT = { kind: 36669, pubkey: C } as NostrEvent;
const pool = () => pools[pools.length - 1];
const readRoutes = async () => [...(await pool().reqRouter([{ kinds: [36669] }])).keys()].sort();
const writeRoutes = async () => [...(await pool().eventRouter(EVENT))].sort();
const allDefaults = [DEFAULT_A, DEFAULT_B, DEFAULT_C].sort();

function signIn(pubkey: string | undefined, rerender: (ui: React.ReactElement) => void) {
  logins = pubkey ? [{ pubkey }] : [];
  rerender(<Tree />);
}

beforeEach(() => {
  pools.length = 0;
  relayEvents.clear();
  deadRelays.clear();
  asked.length = 0;
  logins = [];
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(ACCOUNT_RELAYS_KEY);
});

describe('relay list per account', () => {
  it("C → logout → B with no list: B uses the defaults and nothing goes to C's relays", async () => {
    relayEvents.set(DEFAULT_A, [relayList(C, C_RELAY, 100)]);
    logins = [{ pubkey: C }];
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(gate.status).toBe('resolved'));
    expect(await writeRoutes()).toEqual([C_RELAY]);

    signIn(undefined, rerender);
    expect(app.config.relayMetadata).toEqual(defaultRelays);

    signIn(B, rerender);
    // Immediately, before B's lookup: C's list is gone from reads and writes.
    expect(await readRoutes()).toEqual(allDefaults);
    await waitFor(() => expect(gate.status).toBe('resolved'));
    expect(await readRoutes()).toEqual(allDefaults);
    expect(await writeRoutes()).toEqual(allDefaults);
    expect(app.config.relayMetadata.relays.map((r) => r.url)).not.toContain(C_RELAY);
  });

  it("switching straight from C to B drops C's list at once", async () => {
    relayEvents.set(DEFAULT_A, [relayList(C, C_RELAY, 100)]);
    logins = [{ pubkey: C }];
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(gate.status).toBe('resolved'));

    deadRelays.add(DEFAULT_A).add(DEFAULT_B); // B's lookup can't finish
    signIn(B, rerender);
    expect(await readRoutes()).toEqual(allDefaults);
    expect(gate.status).toBe('unresolved');
  });

  it("applies B's own list even when it is older than C's", async () => {
    relayEvents.set(DEFAULT_A, [relayList(C, C_RELAY, 200), relayList(B, B_RELAY, 100)]);
    logins = [{ pubkey: C }];
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(gate.status).toBe('resolved'));

    signIn(B, rerender);
    await waitFor(() => expect(gate.status).toBe('resolved'));
    expect(await writeRoutes()).toEqual([B_RELAY]);
  });

  it('publishes nothing before the lookup resolves, and waiting writes go on after it', async () => {
    deadRelays.add(DEFAULT_A).add(DEFAULT_B);
    logins = [{ pubkey: B }];
    render(<Tree />);
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(gate.status).toBe('unresolved');
    await expect(writeRoutes()).rejects.toBeInstanceOf(RelayListUnresolvedError);

    let settled = false;
    const waiting = gate.waitForRelayList(B).finally(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    // A majority confirms B has no list.
    act(() => gate.resolveRelayList(B, null));
    await expect(waiting).resolves.toEqual(defaultRelays);
    expect(await writeRoutes()).toEqual(allDefaults);
  });

  it('a write waiting under C is refused if B signs in first', async () => {
    deadRelays.add(DEFAULT_A).add(DEFAULT_B);
    logins = [{ pubkey: C }];
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));

    const waiting = gate.waitForRelayList(C);
    signIn(B, rerender);
    await expect(waiting).rejects.toBeInstanceOf(RelayAccountChangedError);
  });

  it("an incomplete lookup is not 'no list': writes stay blocked", async () => {
    deadRelays.add(DEFAULT_A).add(DEFAULT_B); // 1 of 3 answers: no majority
    logins = [{ pubkey: B }];
    render(<Tree />);
    await waitFor(() => expect(asked).toEqual(expect.arrayContaining(allDefaults)));
    await new Promise((r) => setTimeout(r, 20));
    expect(gate.status).toBe('unresolved');
  });

  it("a manual edit under C belongs to C: B never sees it, and C gets it back", async () => {
    logins = [{ pubkey: C }];
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(gate.status).toBe('resolved'));

    const edited = { relays: [{ url: C_RELAY, read: true, write: true }], updatedAt: 300 };
    act(() => app.updateConfig((current) => ({ ...current, relayMetadata: edited })));
    expect(await writeRoutes()).toEqual([C_RELAY]);

    signIn(B, rerender);
    await waitFor(() => expect(gate.status).toBe('resolved'));
    expect(app.config.relayMetadata).toEqual(defaultRelays);

    // Saving relays as B stores B's list, built from B's view: no C relay.
    act(() =>
      app.updateConfig((current) => ({
        ...current,
        relayMetadata: {
          relays: [...current.relayMetadata!.relays, { url: B_RELAY, read: true, write: true }],
          updatedAt: 400,
        },
      }))
    );
    expect(app.config.relayMetadata.relays.map((r) => r.url).sort()).toEqual([...allDefaults, B_RELAY].sort());

    signIn(C, rerender);
    expect(app.config.relayMetadata).toEqual(edited);
  });

  it('ignores a relay edit made before the account’s list is known', async () => {
    deadRelays.add(DEFAULT_A).add(DEFAULT_B);
    logins = [{ pubkey: B }];
    render(<Tree />);
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    act(() =>
      app.updateConfig((current) => ({
        ...current,
        relayMetadata: { relays: [{ url: B_RELAY, read: true, write: true }], updatedAt: 1 },
      }))
    );
    expect(app.config.relayMetadata).toEqual(defaultRelays);
    expect(localStorage.getItem(ACCOUNT_RELAYS_KEY)).toBeNull();
    warn.mockRestore();
  });

  it('drops the old browser-wide relay list instead of giving it to the next account', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        theme: 'dark',
        relayMetadata: { relays: [{ url: C_RELAY, read: true, write: true }], updatedAt: 999 },
      })
    );
    logins = [{ pubkey: B }];
    render(<Tree />);
    expect(app.config.relayMetadata).toEqual(defaultRelays);
    expect(app.config.theme).toBe('dark');
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ theme: 'dark' }));
    await waitFor(() => expect(gate.status).toBe('resolved'));
    expect(await writeRoutes()).toEqual(allDefaults);
  });
});
