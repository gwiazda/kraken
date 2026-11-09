import { describe, expect, it } from 'vitest';
import { EXPIRY_MARGIN_MS, TokenHolder } from './token';

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

  it('forgets the token on clear, but peek still sees it until then (for revoking)', () => {
    const holder = new TokenHolder();
    holder.set('tok', 3599, NOW);
    expect(holder.peek()).toBe('tok');
    holder.clear();
    expect(holder.get(NOW)).toBeNull();
    expect(holder.peek()).toBeNull();
  });

  it('rejects an empty token', () => {
    expect(() => new TokenHolder().set('', 3599, NOW)).toThrow();
  });
});
