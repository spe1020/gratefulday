import { useState, useCallback, useEffect, useRef } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { encryptEntryContent, decryptEntryContent } from '@/lib/privacyUtils';
import { LN } from '@getalby/sdk';

export interface NWCConnection {
  connectionString: string;
  alias?: string;
  isConnected: boolean;
  client?: LN;
}

export interface NWCInfo {
  alias?: string;
  color?: string;
  pubkey?: string;
  network?: string;
  methods?: string[];
  notifications?: string[];
}

const CONNECTIONS_KEY = 'nwc-connections';
const ACTIVE_KEY = 'nwc-active-connection';

/**
 * At-rest storage entry. NWC connection strings embed a spending secret, so
 * they are NIP-44 encrypted to the user's own pubkey; `connectionString` only
 * appears in legacy plaintext entries, which are migrated on read.
 */
interface StoredConnection {
  encrypted?: string;
  connectionString?: string;
  alias?: string;
}

/**
 * Non-secret identifier for a connection: the wallet service pubkey from the
 * URI. Used for the persisted "active connection" pointer so no secret is
 * needed (or stored) to remember which wallet was active.
 */
function connectionId(uri: string): string {
  const match = uri.match(/walletconnect:\/\/([^?/]+)/i);
  return match ? match[1].toLowerCase() : uri;
}

function readStoredConnections(): StoredConnection[] {
  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredActiveId(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      // Pre-JSON raw string — use as-is
    }
    if (typeof value !== 'string' || !value) return null;
    // Legacy entries stored the full (secret) connection string — reduce to id
    return value.includes('://') ? connectionId(value) : value;
  } catch {
    return null;
  }
}

/**
 * Probe the wallet with a real getInfo call. A connection is only reported
 * as connected once an actual NWC round-trip has succeeded.
 */
async function probeConnection(connectionString: string, timeoutMs = 10000): Promise<NWCInfo | null> {
  let client: LN | null = null;
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    client = new LN(connectionString);
    const info = await Promise.race([
      client.nwcClient.getInfo(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Connection test timeout')), timeoutMs);
      }),
    ]);
    return {
      alias: info.alias,
      color: info.color,
      pubkey: info.pubkey,
      network: info.network,
      methods: info.methods,
      notifications: info.notifications ?? undefined,
    };
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    try {
      client?.close();
    } catch {
      // Socket already closed
    }
  }
}

export function useNWCInternal() {
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const [connections, setConnections] = useState<NWCConnection[]>([]);
  const [activeConnection, setActiveConnectionState] = useState<string | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<Record<string, NWCInfo>>({});

  const pubkey = user?.pubkey;
  const signer = user?.signer;

  /**
   * Stored entries this session could not decrypt — another account's
   * connections, or ours when the signer is momentarily unavailable. They are
   * carried through every write verbatim: this store is shared across
   * accounts, so overwriting with only what we can read would destroy the
   * other account's wallet credentials.
   */
  const foreignEntriesRef = useRef<StoredConnection[]>([]);

  /**
   * Persist connections NIP-44 encrypted to self.
   *
   * NEVER deletes on failure. A connection string embeds a spending secret
   * that exists nowhere else, and `Nip44UnsupportedError` is also thrown when
   * the signer is merely *momentarily* unreachable (a not-yet-injected
   * extension, a sleeping bunker) — so treating it as "scrub the store" would
   * destroy live credentials over a transient hiccup. Encryption is per entry
   * so one bad entry can't void the whole write.
   */
  const persistConnections = useCallback(async (conns: NWCConnection[]) => {
    if (!signer || !pubkey) return;

    const encrypted = await Promise.all(
      conns.map(async (c): Promise<StoredConnection | null> => {
        try {
          return {
            encrypted: await encryptEntryContent(signer, pubkey, c.connectionString),
            alias: c.alias,
          };
        } catch {
          return null;
        }
      })
    );

    const usable = encrypted.filter((e): e is StoredConnection => e !== null);
    const failed = encrypted.length - usable.length;

    // Nothing encrypted and we had something to write: leave storage exactly
    // as it was rather than replacing it with an empty list.
    if (usable.length === 0 && conns.length > 0) {
      toast({
        title: 'Wallet not saved',
        description:
          "Your signer couldn't encrypt the wallet connection, so it is only active for this session.",
        variant: 'destructive',
      });
      return;
    }

    try {
      localStorage.setItem(
        CONNECTIONS_KEY,
        JSON.stringify([...usable, ...foreignEntriesRef.current])
      );
    } catch {
      // localStorage unavailable — connections stay in memory for the session
      return;
    }

    if (failed > 0) {
      toast({
        title: 'Some wallets not saved',
        description: `${failed} wallet connection${failed === 1 ? '' : 's'} could not be encrypted and will be gone after a reload.`,
        variant: 'destructive',
      });
    }
  }, [signer, pubkey, toast]);

  const setActiveConnection = useCallback((connectionString: string | null) => {
    setActiveConnectionState(connectionString);
    try {
      if (connectionString) {
        localStorage.setItem(ACTIVE_KEY, JSON.stringify(connectionId(connectionString)));
      } else {
        localStorage.removeItem(ACTIVE_KEY);
      }
    } catch {
      // localStorage unavailable — active choice lives in memory only
    }
  }, []);

  // Load stored connections: decrypt encrypted entries, tolerate legacy
  // plaintext ones (migrating them to encrypted-at-rest when possible).
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const stored = readStoredConnections();
      const loaded: NWCConnection[] = [];
      const foreign: StoredConnection[] = [];
      let hadPlaintext = false;

      for (const entry of stored) {
        if (typeof entry?.connectionString === 'string' && entry.connectionString) {
          // Legacy plaintext entry
          hadPlaintext = true;
          loaded.push({
            connectionString: entry.connectionString,
            alias: entry.alias,
            isConnected: false,
          });
        } else if (typeof entry?.encrypted === 'string') {
          if (!signer || !pubkey) {
            // No signer yet — keep the entry so a later write can't drop it.
            foreign.push(entry);
            continue;
          }
          try {
            const connectionString = await decryptEntryContent(signer, pubkey, entry.encrypted);
            loaded.push({ connectionString, alias: entry.alias, isConnected: false });
          } catch {
            // Another account's connection (or a signer hiccup): preserve it
            // verbatim so our next write doesn't destroy it.
            foreign.push(entry);
          }
        }
      }

      foreignEntriesRef.current = foreign;

      if (cancelled) return;

      setConnections(loaded);

      const activeId = readStoredActiveId();
      const active =
        loaded.find((c) => connectionId(c.connectionString) === activeId) ?? loaded[0] ?? null;
      setActiveConnectionState(active ? active.connectionString : null);

      // Migrate legacy plaintext entries to encrypted-at-rest
      if (hadPlaintext && signer && pubkey) {
        void persistConnections(loaded);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [signer, pubkey, persistConnections]);

  // Add new connection
  const addConnection = async (uri: string, alias?: string): Promise<boolean> => {
    const parseNWCUri = (uri: string): { connectionString: string } | null => {
      try {
        if (!uri.startsWith('nostr+walletconnect://') && !uri.startsWith('nostrwalletconnect://')) {
          console.error('Invalid NWC URI protocol:', { protocol: uri.split('://')[0] });
          return null;
        }
        return { connectionString: uri };
      } catch (error) {
        console.error('Failed to parse NWC URI:', error);
        return null;
      }
    };

    const parsed = parseNWCUri(uri);
    if (!parsed) {
      toast({
        title: 'Invalid NWC URI',
        description: 'Please check the connection string and try again.',
        variant: 'destructive',
      });
      return false;
    }

    const existingConnection = connections.find(c => c.connectionString === parsed.connectionString);
    if (existingConnection) {
      toast({
        title: 'Connection already exists',
        description: 'This wallet is already connected.',
        variant: 'destructive',
      });
      return false;
    }

    // Real probe: only report connected after a successful getInfo round-trip
    const info = await probeConnection(parsed.connectionString);

    const connection: NWCConnection = {
      connectionString: parsed.connectionString,
      alias: alias || info?.alias || 'NWC Wallet',
      isConnected: info !== null,
    };

    setConnectionInfo(prev => ({
      ...prev,
      [parsed.connectionString]: info ?? { alias: connection.alias },
    }));

    const newConnections = [...connections, connection];
    setConnections(newConnections);
    void persistConnections(newConnections);

    if (connections.length === 0 || !activeConnection)
      setActiveConnection(parsed.connectionString);

    if (info) {
      toast({
        title: 'Wallet connected',
        description: `Successfully connected to ${connection.alias}.`,
      });
    } else {
      toast({
        title: 'Wallet added, but not reachable',
        description: 'The connection test failed. Payments will retry this wallet, but it may not work.',
        variant: 'destructive',
      });
    }

    return true;
  };

  // Remove connection
  const removeConnection = (connectionString: string) => {
    const filtered = connections.filter(c => c.connectionString !== connectionString);
    setConnections(filtered);
    void persistConnections(filtered);

    if (activeConnection === connectionString) {
      const newActive = filtered.length > 0 ? filtered[0].connectionString : null;
      setActiveConnection(newActive);
    }

    setConnectionInfo(prev => {
      const newInfo = { ...prev };
      delete newInfo[connectionString];
      return newInfo;
    });

    toast({
      title: 'Wallet disconnected',
      description: 'The wallet connection has been removed.',
    });
  };

  // Get active connection — pure (callable during render); the stored active
  // pointer is healed by the effect below, never from here.
  const getActiveConnection = useCallback((): NWCConnection | null => {
    if (!activeConnection) return connections[0] ?? null;
    // A dangling pointer must NOT silently fall back to another wallet — this
    // is a spending path, and paying from a wallet the user didn't choose is
    // worse than not paying. The healing effect below repoints it.
    return connections.find(c => c.connectionString === activeConnection) ?? null;
  }, [activeConnection, connections]);

  // Heal a missing/dangling active pointer once state settles
  useEffect(() => {
    if (connections.length === 0) return;
    const valid = activeConnection && connections.some(c => c.connectionString === activeConnection);
    if (!valid) {
      setActiveConnection(connections[0].connectionString);
    }
  }, [activeConnection, connections, setActiveConnection]);

  // Send payment using the SDK
  const sendPayment = useCallback(async (
    connection: NWCConnection,
    invoice: string
  ): Promise<{ preimage: string }> => {
    if (!connection.connectionString) {
      throw new Error('Invalid connection: missing connection string');
    }

    let client: LN;
    try {
      client = new LN(connection.connectionString);
    } catch (error) {
      console.error('Failed to create NWC client:', error);
      throw new Error(`Failed to create NWC client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Payment timeout after 15 seconds')), 15000);
      });

      const paymentPromise = client.pay(invoice);

      try {
        const response = await Promise.race([paymentPromise, timeoutPromise]) as { preimage: string };
        if (timeoutId) clearTimeout(timeoutId);
        // A real call succeeded — the connection is demonstrably working
        setConnections(prev =>
          prev.map(c =>
            c.connectionString === connection.connectionString && !c.isConnected
              ? { ...c, isConnected: true }
              : c
          )
        );
        return response;
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      console.error('NWC payment failed:', error);

      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          throw new Error('Payment timed out. Please try again.');
        } else if (error.message.includes('insufficient')) {
          throw new Error('Insufficient balance in connected wallet.');
        } else if (error.message.includes('invalid')) {
          throw new Error('Invalid invoice or connection. Please check your wallet.');
        } else {
          throw new Error(`Payment failed: ${error.message}`);
        }
      }

      throw new Error('Payment failed with unknown error');
    }
  }, []);

  return {
    connections,
    activeConnection,
    connectionInfo,
    addConnection,
    removeConnection,
    setActiveConnection,
    getActiveConnection,
    sendPayment,
  };
}
