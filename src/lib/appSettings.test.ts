// @vitest-environment node
// Real-crypto round trips: jsdom's TextEncoder produces cross-realm
// Uint8Arrays that @noble/hashes rejects, so this file runs in node (mirrors
// privacyUtils.test.ts). A tiny in-memory localStorage shim covers the cache.

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  clearPendingPrivacy,
  effectivePrivacyDefault,
  nextSettingsCreatedAt,
  noteKnownSettingsAt,
  readKnownSettingsAt,
  resolveAgainstKnown,
  readPendingPrivacy,
  setPendingPrivacy,
  withPendingPrivacy,
  SettingsUnreadableError,
  applySettingsPatch,
  mergeForWrite,
  resolveRemoteSettings,
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
import { encryptEntryContent } from './privacyUtils';

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
    expect(parseSettings(json)?.celebratedMilestones).toEqual([7, 30]);
  });

  it('round-trips lastSeenNotifications', () => {
    const s = { celebratedMilestones: [], lastSeenNotifications: 1_700_000_000 };
    expect(parseSettings(serializeSettings(s))?.lastSeenNotifications).toBe(1_700_000_000);
    // a non-number is dropped
    expect(parseSettings('{"celebratedMilestones":[],"lastSeenNotifications":"x"}')?.lastSeenNotifications).toBeUndefined();
  });

  it('returns null (unreadable, not empty) when the content is not a JSON object', () => {
    for (const content of ['not json', '', 'null', '42', '"text"', 'true', '[]', '[7, 30]']) {
      expect(parseSettings(content), content).toBeNull();
    }
  });

  it('drops wrongly-typed fields inside a JSON object, one by one', () => {
    expect(parseSettings('{"celebratedMilestones":"nope","privacyDefault":3}')).toEqual(
      emptySettings()
    );
    expect(parseSettings('{"privacyDefault":true,"celebratedMilestones":"nope"}')).toEqual({
      privacyDefault: true,
      celebratedMilestones: [],
    });
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

describe('read → merge → write helpers', () => {
  it('applySettingsPatch: privacy overwrites, milestones union, lastSeen max', () => {
    const base = { privacyDefault: true, celebratedMilestones: [7], lastSeenNotifications: 500 };
    expect(
      applySettingsPatch(base, { privacyDefault: false, celebratedMilestones: [30], lastSeenNotifications: 400 })
    ).toEqual({ privacyDefault: false, celebratedMilestones: [7, 30], lastSeenNotifications: 500 });
    expect(applySettingsPatch(base, {})).toEqual(base);
  });

  it('mergeForWrite keeps what another device wrote and still applies this change', () => {
    const local = { privacyDefault: true, celebratedMilestones: [7], lastSeenNotifications: 100 };
    // Another device since: celebrated 30, read notifications later, chose public.
    const remote = { privacyDefault: false, celebratedMilestones: [30], lastSeenNotifications: 900 };
    // This device is recording milestone 14 only.
    expect(mergeForWrite(local, remote, { celebratedMilestones: [14] })).toEqual({
      privacyDefault: false, // remote wins: this change didn't touch it
      celebratedMilestones: [7, 14, 30],
      lastSeenNotifications: 900,
    });
    // This device is choosing private now: the change wins.
    expect(mergeForWrite(local, remote, { privacyDefault: true }).privacyDefault).toBe(true);
  });

  it('mergeForWrite with no remote event keeps local', () => {
    const local = { privacyDefault: true, celebratedMilestones: [7] };
    expect(mergeForWrite(local, null, {})).toEqual({ ...local, lastSeenNotifications: undefined });
  });
});

describe('resolveRemoteSettings', () => {
  it('returns null only when no event exists', async () => {
    const sk = generateSecretKey();
    const signer = new NSecSigner(sk);
    expect(await resolveRemoteSettings(signer, getPublicKey(sk), [])).toBeNull();
  });

  it('decrypts the newest event', async () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const signer = new NSecSigner(sk);
    const older = settingsEvent(await encryptSettings(signer, pubkey, { celebratedMilestones: [7] }), 1);
    const newer = settingsEvent(await encryptSettings(signer, pubkey, { celebratedMilestones: [30] }), 2);
    const result = await resolveRemoteSettings(signer, pubkey, [older, newer]);
    expect(result?.celebratedMilestones).toEqual([30]);
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['JSON null', 'null'],
    ['a JSON primitive', '42'],
    ['a JSON array', '[7, 30]'],
  ])(
    'throws SettingsUnreadableError when the newest event decrypts to %s (never "empty settings")',
    async (_label, plaintext) => {
      const sk = generateSecretKey();
      const pubkey = getPublicKey(sk);
      const signer = new NSecSigner(sk);
      const readable = settingsEvent(await encryptSettings(signer, pubkey, { celebratedMilestones: [7] }), 1);
      const malformed = settingsEvent(await encryptEntryContent(signer, pubkey, plaintext), 2);
      expect(await decryptSettings(signer, pubkey, malformed)).toBeNull();
      await expect(resolveRemoteSettings(signer, pubkey, [readable, malformed])).rejects.toBeInstanceOf(
        SettingsUnreadableError
      );
    }
  );

  it('throws SettingsUnreadableError when the newest event cannot be decrypted (never "no settings")', async () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const signer = new NSecSigner(sk);
    const readable = settingsEvent(await encryptSettings(signer, pubkey, { celebratedMilestones: [7] }), 1);
    const corrupt = settingsEvent('not-a-nip44-payload', 2);
    await expect(resolveRemoteSettings(signer, pubkey, [readable, corrupt])).rejects.toBeInstanceOf(
      SettingsUnreadableError
    );
  });
});

describe('pending privacy marker', () => {
  it('clears only when it still holds the published value', () => {
    setPendingPrivacy('pk', true);
    // A newer choice (false) was made before the publish of `true` succeeded.
    setPendingPrivacy('pk', false);
    clearPendingPrivacy('pk', true);
    expect(readPendingPrivacy('pk')).toBe(false);
    clearPendingPrivacy('pk', false);
    expect(readPendingPrivacy('pk')).toBeUndefined();
  });

  it('is per pubkey', () => {
    setPendingPrivacy('pk-a', true);
    expect(readPendingPrivacy('pk-b')).toBeUndefined();
  });

  it('withPendingPrivacy overlays only when pending', () => {
    const s = { privacyDefault: false, celebratedMilestones: [7] };
    expect(withPendingPrivacy(s, undefined)).toBe(s);
    expect(withPendingPrivacy(s, true)).toEqual({ ...s, privacyDefault: true });
  });
});

describe('resolveAgainstKnown — relay copies older than what this device knows', () => {
  const PK = 'pk-known';
  const KEYS = [
    'gratefulday:privacy-default:v1',
    'gratefulday:privacy-default-pending:v1',
    'gratefulday:settings-known-at:v1',
    'gratefulday:milestones:v1',
    'gratefulday:last-seen-notifications:v1',
  ];
  beforeEach(() => {
    for (const k of KEYS) localStorage.removeItem(k);
  });

  it('returns null for no event', () => {
    expect(resolveAgainstKnown(PK, null, undefined)).toBeNull();
  });

  it('applies the first event a fresh device sees', () => {
    const out = resolveAgainstKnown(PK, { privacyDefault: false, celebratedMilestones: [7] }, 100);
    expect(out).toEqual({ privacyDefault: false, celebratedMilestones: [7] });
    expect(readKnownSettingsAt(PK)).toBe(100);
    expect(readLocalCache(PK).privacyDefault).toBe(false);
  });

  it('keeps the local privacy default over an older copy, but keeps its monotonic fields', () => {
    writeLocalCache(PK, { privacyDefault: true, celebratedMilestones: [] });
    noteKnownSettingsAt(PK, 200);
    const out = resolveAgainstKnown(
      PK,
      { privacyDefault: false, celebratedMilestones: [7], lastSeenNotifications: 50 },
      100
    );
    expect(out).toEqual({ privacyDefault: true, celebratedMilestones: [7], lastSeenNotifications: 50 });
    expect(readKnownSettingsAt(PK)).toBe(200);
    expect(readLocalCache(PK).privacyDefault).toBe(true);
  });

  it('applies a newer event and stores its privacy default', () => {
    writeLocalCache(PK, { privacyDefault: true, celebratedMilestones: [] });
    noteKnownSettingsAt(PK, 200);
    const out = resolveAgainstKnown(PK, { privacyDefault: false, celebratedMilestones: [] }, 300);
    expect(out?.privacyDefault).toBe(false);
    expect(readKnownSettingsAt(PK)).toBe(300);
    expect(readLocalCache(PK).privacyDefault).toBe(false);
  });

  it('does not overwrite an unsynced local choice when applying a newer event', () => {
    writeLocalCache(PK, { privacyDefault: true, celebratedMilestones: [] });
    setPendingPrivacy(PK, true);
    resolveAgainstKnown(PK, { privacyDefault: false, celebratedMilestones: [] }, 300);
    expect(readLocalCache(PK).privacyDefault).toBe(true);
    expect(readKnownSettingsAt(PK)).toBe(300);
  });

  it('at exactly the known time the local privacy default stands (same-second tie from elsewhere)', () => {
    writeLocalCache(PK, { privacyDefault: true, celebratedMilestones: [] });
    noteKnownSettingsAt(PK, 200);
    const out = resolveAgainstKnown(PK, { privacyDefault: false, celebratedMilestones: [7] }, 200);
    expect(out).toEqual({ privacyDefault: true, celebratedMilestones: [7] });
    expect(readLocalCache(PK).privacyDefault).toBe(true);
  });

  it('effectivePrivacyDefault: pending, then local, then (only if nothing local) remote', () => {
    const local = (privacyDefault?: boolean) => ({ privacyDefault, celebratedMilestones: [] });
    expect(effectivePrivacyDefault(local(true), local(false), undefined)).toBe(true);
    expect(effectivePrivacyDefault(local(true), local(true), false)).toBe(false);
    expect(effectivePrivacyDefault(local(undefined), local(false), undefined)).toBe(false);
    expect(effectivePrivacyDefault(local(undefined), null, undefined)).toBeUndefined();
  });

  it('never moves the known time backwards, and keeps accounts separate', () => {
    noteKnownSettingsAt(PK, 200);
    noteKnownSettingsAt(PK, 150);
    expect(readKnownSettingsAt(PK)).toBe(200);
    expect(readKnownSettingsAt('pk-someone-else')).toBe(0);
  });

  it('stamps the next event after the newest known one', () => {
    noteKnownSettingsAt(PK, 500);
    expect(nextSettingsCreatedAt(PK, 400)).toBe(501);
    expect(nextSettingsCreatedAt(PK, 500)).toBe(501);
    expect(nextSettingsCreatedAt(PK, 900)).toBe(900);
  });
});
