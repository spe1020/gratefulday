import { describe, it, expect, beforeEach } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  ACCOUNT_RELAYS_KEY,
  latestRelayList,
  readAccountRelays,
  relaysFromNip65,
  writeAccountRelays,
} from './accountRelays';

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function list(pubkey: string, created_at: number, tags: string[][]): NostrEvent {
  return { id: `${pubkey}-${created_at}`, kind: 10002, pubkey, created_at, content: '', sig: '', tags };
}

describe('relaysFromNip65', () => {
  it('reads markers: none is read and write', () => {
    expect(
      relaysFromNip65(
        list(ME, 1, [['r', 'wss://rw'], ['r', 'wss://r', 'read'], ['r', 'wss://w', 'write'], ['p', 'x'], ['r', '']])
      )
    ).toEqual([
      { url: 'wss://rw', read: true, write: true },
      { url: 'wss://r', read: true, write: false },
      { url: 'wss://w', read: false, write: true },
    ]);
  });
});

describe('latestRelayList', () => {
  it("takes the newest list by that account and ignores anyone else's", () => {
    const mine = list(ME, 100, [['r', 'wss://mine']]);
    const newerOther = list(OTHER, 200, [['r', 'wss://other']]);
    const empty = list(ME, 300, []);
    expect(latestRelayList([mine, newerOther, empty], ME)).toBe(mine);
    expect(latestRelayList([newerOther], ME)).toBeNull();
  });
});

describe('account relay storage', () => {
  beforeEach(() => localStorage.removeItem(ACCOUNT_RELAYS_KEY));

  it('round-trips and drops malformed slots', () => {
    writeAccountRelays({ [ME]: { relays: [{ url: 'wss://x', read: true, write: true }], updatedAt: 5 } });
    expect(readAccountRelays()[ME].updatedAt).toBe(5);
    localStorage.setItem(ACCOUNT_RELAYS_KEY, JSON.stringify({ [ME]: { relays: 'no' }, [OTHER]: { relays: [], updatedAt: 1 } }));
    expect(readAccountRelays()).toEqual({ [OTHER]: { relays: [], updatedAt: 1 } });
    localStorage.setItem(ACCOUNT_RELAYS_KEY, 'not json');
    expect(readAccountRelays()).toEqual({});
  });
});
