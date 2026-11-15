import { describe, expect, it } from 'vitest';
import { EXPIRY_MARGIN_MS, RENEW_MARGIN_MS, TokenHolder } from './token';

const NOW = 1_000_000_000_000;

describe('TokenHolder', () => {
  it('has no token at first', () => {
    expect(new TokenHolder().get(NOW)).toBeNull();
  });

  it('returns the token while it is valid', () => {
    const holder = new TokenHolder();
    holder.set('tok', 3599, NOW);
    expect(holder.get(NOW)).toBe('tok');
    expect(holder.get(NOW + 3599_000 - EXPIRY_MARGIN_MS - 1)).toBe('tok');
  });

  it('treats the token as expired one minute before Google does', () => {
    const holder = new TokenHolder();
    holder.set('tok', 3599, NOW);
    expect(holder.get(NOW + 3599_000 - EXPIRY_MARGIN_MS)).toBeNull();
  });

  it('treats a missing or invalid lifetime as already expired', () => {
    for (const bad of [Number.NaN, 0, -5]) {
      const holder = new TokenHolder();
      holder.set('tok', bad, NOW);
      expect(holder.get(NOW)).toBeNull();
    }
  });

  it('forgets the token on clear', () => {
    const holder = new TokenHolder();
    holder.set('tok', 3599, NOW);
    holder.clear();
    expect(holder.get(NOW)).toBeNull();
    expect(holder.status(NOW)).toBe('none');
  });

  it('reports the status: valid, then renew in the last 5 minutes, then none', () => {
    const holder = new TokenHolder();
    expect(holder.status(NOW)).toBe('none');
    holder.set('tok', 3600, NOW);
    expect(holder.status(NOW)).toBe('valid');
    expect(holder.status(NOW + 3600_000 - RENEW_MARGIN_MS - 1)).toBe('valid');
    expect(holder.status(NOW + 3600_000 - RENEW_MARGIN_MS)).toBe('renew');
    expect(holder.status(NOW + 3600_000 - EXPIRY_MARGIN_MS)).toBe('none');
  });

  it('rejects an empty token', () => {
    expect(() => new TokenHolder().set('', 3599, NOW)).toThrow();
  });
});
