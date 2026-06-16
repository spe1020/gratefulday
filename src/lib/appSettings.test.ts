// @vitest-environment node
// Real-crypto round trips: jsdom's TextEncoder produces cross-realm
// Uint8Arrays that @noble/hashes rejects, so this file runs in node (mirrors
// privacyUtils.test.ts). A tiny in-memory localStorage shim covers the cache.

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  SETTINGS_D_TAG,
  SETTINGS_KIND,
  buildSettingsEvent,
  decryptSettings,
  emptySettings,
  encryptSettings,
  needsSeed,
  parseSettings,
  pickLatestEvent,
  readLocalCache,
  reconcile,
  serializeSettings,
  writeLocalCache,
} from './appSettings';
import { pickCelebration } from './streakUtils';

// In-memory localStorage for the cache tests (node has none).
const store = new Map<string, string>();
beforeEach(() => store.clear());
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

function settingsEvent(content: string, created_at: number): NostrEvent {
  return {
    id: `id-${created_at}`,
    pubkey: 'pk',
    created_at,
    kind: SETTINGS_KIND,
    tags: [['d', SETTINGS_D_TAG]],
    content,
    sig: 'sig',
  };
}

describe('serialize / parse', () => {
  it('round-trips settings', () => {
    const s = { privacyDefault: true, celebratedMilestones: [7, 30] };
    expect(parseSettings(serializeSettings(s))).toEqual(s);
  });

  it('stamps a version and sorts/dedupes milestones', () => {
    const json = serializeSettings({ celebratedMilestones: [30, 7, 7] });
    expect(JSON.parse(json).version).toBe(1);
    expect(parseSettings(json).celebratedMilestones).toEqual([7, 30]);
  });

  it('round-trips lastSeenNotifications', () => {
    const s = { celebratedMilestones: [], lastSeenNotifications: 1_700_000_000 };
    expect(parseSettings(serializeSettings(s)).lastSeenNotifications).toBe(1_700_000_000);
    // a non-number is dropped
    expect(parseSettings('{"celebratedMilestones":[],"lastSeenNotifications":"x"}').lastSeenNotifications).toBeUndefined();
  });

  it('round-trips giftDefaultAmount and drops non-positive / non-number values', () => {
    expect(parseSettings(serializeSettings({ celebratedMilestones: [], giftDefaultAmount: 21 })).giftDefaultAmount).toBe(21);
    expect(parseSettings('{"celebratedMilestones":[],"giftDefaultAmount":0}').giftDefaultAmount).toBeUndefined();
    expect(parseSettings('{"celebratedMilestones":[],"giftDefaultAmount":"x"}').giftDefaultAmount).toBeUndefined();
  });

  it('degrades a corrupt or alien payload to empty', () => {
    expect(parseSettings('not json')).toEqual(emptySettings());
    expect(parseSettings('null')).toEqual(emptySettings());
    expect(parseSettings('{"celebratedMilestones":"nope","privacyDefault":3}')).toEqual(
      emptySettings()
    );
  });
});

describe('reconcile — deliberate asymmetry', () => {
  it('privacyDefault is last-write-wins: remote overrides local when present', () => {
    expect(
      reconcile(
        { privacyDefault: true, celebratedMilestones: [] },
        { privacyDefault: false, celebratedMilestones: [] }
      ).privacyDefault
    ).toBe(false);
  });

  it('privacyDefault keeps local when there is no remote event', () => {
    expect(
      reconcile({ privacyDefault: true, celebratedMilestones: [] }, null).privacyDefault
    ).toBe(true);
  });

  it('celebratedMilestones is a UNION — never lost to an older-timestamped event', () => {
    // The non-obvious correctness point: remote omits 30 (recorded only on
    // this device), local omits 7 (recorded only on another). Union keeps both.
    expect(
      reconcile(
        { celebratedMilestones: [30] },
        { celebratedMilestones: [7] }
      ).celebratedMilestones
    ).toEqual([7, 30]);
  });

  it('lastSeenNotifications takes the MAX — read-state never regresses', () => {
    // A slightly-older device sync must not roll back read-state.
    expect(
      reconcile(
        { celebratedMilestones: [], lastSeenNotifications: 500 },
        { celebratedMilestones: [], lastSeenNotifications: 300 }
      ).lastSeenNotifications
    ).toBe(500);
    expect(
      reconcile(
        { celebratedMilestones: [], lastSeenNotifications: 300 },
        { celebratedMilestones: [], lastSeenNotifications: 500 }
      ).lastSeenNotifications
    ).toBe(500);
    expect(
      reconcile({ celebratedMilestones: [] }, null).lastSeenNotifications
    ).toBeUndefined();
  });

  it('giftDefaultAmount is last-write-wins (remote overrides local when present)', () => {
    expect(
      reconcile(
        { celebratedMilestones: [], giftDefaultAmount: 21 },
        { celebratedMilestones: [], giftDefaultAmount: 100 }
      ).giftDefaultAmount
    ).toBe(100);
    // no remote → keep local
    expect(
      reconcile({ celebratedMilestones: [], giftDefaultAmount: 21 }, null).giftDefaultAmount
    ).toBe(21);
  });
});

describe('needsSeed (migration)', () => {
  it('seeds when no remote event and local has values', () => {
    expect(needsSeed(false, { privacyDefault: true, celebratedMilestones: [] })).toBe(true);
    expect(needsSeed(false, { celebratedMilestones: [7] })).toBe(true);
  });

  it('does not seed when a remote event already exists', () => {
    expect(needsSeed(true, { privacyDefault: true, celebratedMilestones: [7] })).toBe(false);
  });

  it('does not seed when local is empty', () => {
    expect(needsSeed(false, emptySettings())).toBe(false);
  });
});

describe('pickLatestEvent', () => {
  it('returns the highest created_at, or null', () => {
    expect(pickLatestEvent([])).toBeNull();
    const a = settingsEvent('a', 100);
    const b = settingsEvent('b', 200);
    expect(pickLatestEvent([a, b])).toBe(b);
    expect(pickLatestEvent([b, a])).toBe(b);
  });
});

describe('encrypt / decrypt round trip (real NSecSigner crypto)', () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer = new NSecSigner(sk);

  it('encrypts to self and reads back the same settings', async () => {
    const s = { privacyDefault: false, celebratedMilestones: [7, 14, 30] };
    const ciphertext = await encryptSettings(signer, pubkey, s);
    expect(ciphertext).not.toContain('celebratedMilestones'); // genuinely encrypted

    const event = { ...buildSettingsEvent(ciphertext), pubkey, created_at: 1, id: 'x', sig: 'y' };
    expect(await decryptSettings(signer, pubkey, event as NostrEvent)).toEqual(s);
  });

  it('buildSettingsEvent uses kind 30078, the d tag, and generic tags only', () => {
    const tmpl = buildSettingsEvent('cipher');
    expect(tmpl.kind).toBe(30078);
    expect(tmpl.tags).toContainEqual(['d', SETTINGS_D_TAG]);
    expect(tmpl.tags).toContainEqual(['encrypted', 'nip44']);
    // No tag value should leak a preference.
    expect(JSON.stringify(tmpl.tags)).not.toContain('privacy');
    expect(JSON.stringify(tmpl.tags)).not.toContain('milestone');
  });

  it('returns null for an undecryptable event (fail-soft)', async () => {
    const event = settingsEvent('garbage-not-ciphertext', 1);
    expect(await decryptSettings(signer, pubkey, event)).toBeNull();
  });
});

describe('localStorage cache', () => {
  const PK = 'cache-pubkey';

  it('round-trips through the shared legacy keys', () => {
    writeLocalCache(PK, { privacyDefault: true, celebratedMilestones: [7, 30] });
    expect(readLocalCache(PK)).toEqual({ privacyDefault: true, celebratedMilestones: [7, 30] });
  });

  it('filters day-1 (milestone 1) out of the cache — never stored', () => {
    writeLocalCache(PK, { celebratedMilestones: [1, 7] });
    expect(readLocalCache(PK).celebratedMilestones).toEqual([7]);
  });

  it('preserves other pubkeys when writing', () => {
    writeLocalCache('other', { privacyDefault: false, celebratedMilestones: [14] });
    writeLocalCache(PK, { privacyDefault: true, celebratedMilestones: [7] });
    expect(readLocalCache('other')).toEqual({ privacyDefault: false, celebratedMilestones: [14] });
    expect(readLocalCache(PK)).toEqual({ privacyDefault: true, celebratedMilestones: [7] });
  });

  it('reads existing local values for migration seeding', () => {
    // Simulate a current user's pre-existing localStorage (the migration source).
    localStorage.setItem('gratefulday:privacy-default:v1', JSON.stringify({ [PK]: true }));
    localStorage.setItem('gratefulday:milestones:v1', JSON.stringify({ [PK]: [1, 7, 14] }));
    const local = readLocalCache(PK);
    expect(local).toEqual({ privacyDefault: true, celebratedMilestones: [7, 14] });
    expect(needsSeed(false, local)).toBe(true);
  });
});

describe('durability across a cache wipe (Phase 3)', () => {
  const PK = 'wipe-pubkey';

  it('privacy default hydrates from the relay event after a cache wipe', () => {
    // Cache wiped: nothing local for this pubkey.
    expect(readLocalCache(PK).privacyDefault).toBeUndefined();
    // The user's decrypted settings event carries privacyDefault = true; the
    // relay value wins, restoring the preference on the wiped device.
    const restored = reconcile(readLocalCache(PK), {
      privacyDefault: true,
      celebratedMilestones: [],
    });
    expect(restored.privacyDefault).toBe(true);
  });

  it('a milestone celebrated on the relay does not re-fire after a cache wipe', () => {
    // Cache wiped, but the relay event still records the streak milestones.
    const settings = reconcile(readLocalCache(PK), { celebratedMilestones: [7, 14, 30] });
    // MilestoneCelebrationDialog gates on this reconciled set — 30 is present,
    // so a long-streak account on a fresh device fires nothing.
    expect(
      pickCelebration({
        total: 50,
        current: 30,
        isCelebrated: (m) => settings.celebratedMilestones.includes(m),
      })
    ).toBeNull();
  });
});
