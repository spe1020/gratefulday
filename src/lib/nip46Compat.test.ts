import { describe, it, expect, beforeAll } from 'vitest';
import { NSchema } from '@nostrify/nostrify';
import { applyNip46ResponseCompat } from './nip46Compat';

describe('NIP-46 response compatibility', () => {
  beforeAll(() => {
    applyNip46ResponseCompat();
  });

  it('parses a rejection, which carries `error` and no `result`', () => {
    // NIP-46: the presence of `error` indicates a failed request, so a signer
    // that denies a permission replies without `result`. nostrify declares
    // `result` mandatory, which made every rejection throw a Zod error before
    // the signer's own message could be read.
    const parsed = NSchema.connectResponse().parse({
      id: 'req-1',
      error: 'user rejected',
    });

    expect(parsed.error).toBe('user rejected');
    expect(parsed.result).toBeUndefined();
  });

  it('still parses a normal success response', () => {
    const parsed = NSchema.connectResponse().parse({ id: 'req-2', result: 'ack' });
    expect(parsed.result).toBe('ack');
  });

  it('works through the json().pipe() path NConnectSigner actually uses', () => {
    const parsed = NSchema.json()
      .pipe(NSchema.connectResponse())
      .parse(JSON.stringify({ id: 'req-3', error: 'permission denied' }));

    expect(parsed).toMatchObject({ id: 'req-3', error: 'permission denied' });
  });

  it('still rejects a genuinely malformed response', () => {
    expect(() => NSchema.connectResponse().parse({ result: 'no id here' })).toThrow();
  });
});
