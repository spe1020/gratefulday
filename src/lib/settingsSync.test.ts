import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueueSettingsWrite, resetSettingsSync } from './settingsSync';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetSettingsSync());
afterEach(() => vi.unstubAllGlobals());

describe('enqueueSettingsWrite', () => {
  it('runs writes for one account strictly one after another', async () => {
    const order: string[] = [];
    let finishFirst!: () => void;
    const first = enqueueSettingsWrite('pk', async () => {
      order.push('first start');
      await new Promise<void>((r) => (finishFirst = r));
      order.push('first end');
    });
    const second = enqueueSettingsWrite('pk', async () => {
      order.push('second start');
    });
    await tick();
    expect(order).toEqual(['first start']);
    finishFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first start', 'first end', 'second start']);
  });

  it('a write that throws does not block the next one', async () => {
    const ran: string[] = [];
    void enqueueSettingsWrite('pk', async () => {
      throw new Error('boom');
    });
    await enqueueSettingsWrite('pk', async () => {
      ran.push('second');
    });
    expect(ran).toEqual(['second']);
  });

  it("does not make one account wait for another's write", async () => {
    const ran: string[] = [];
    void enqueueSettingsWrite('pk-a', () => new Promise<void>(() => {}));
    await enqueueSettingsWrite('pk-b', async () => {
      ran.push('b');
    });
    expect(ran).toEqual(['b']);
  });

  it('holds a per-account Web Lock for the whole write, and releases it when the write fails', async () => {
    // A minimal Web Locks stand-in: one holder per name at a time.
    const tails = new Map<string, Promise<unknown>>();
    const held: string[] = [];
    const request = vi.fn((name: string, task: () => Promise<void>) => {
      const run = (tails.get(name) ?? Promise.resolve()).then(async () => {
        held.push(name);
        try {
          await task();
        } finally {
          held.pop();
        }
      });
      tails.set(name, run.catch(() => {}));
      return run;
    });
    vi.stubGlobal('navigator', { locks: { request } });

    let heldDuringTask: string[] = [];
    void enqueueSettingsWrite('pk', async () => {
      heldDuringTask = [...held];
      throw new Error('boom');
    });
    const ran: string[] = [];
    await enqueueSettingsWrite('pk', async () => {
      ran.push('second');
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe('gratefulday:settings-write:pk');
    expect(heldDuringTask).toEqual(['gratefulday:settings-write:pk']);
    expect(ran).toEqual(['second']);
    expect(held).toEqual([]);
  });

  it('still serializes within the tab when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const order: string[] = [];
    void enqueueSettingsWrite('pk', async () => {
      await tick();
      order.push('first');
    });
    await enqueueSettingsWrite('pk', async () => {
      order.push('second');
    });
    expect(order).toEqual(['first', 'second']);
  });
});
