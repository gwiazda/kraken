import { describe, expect, it } from 'vitest';
import { screenOf, stateFor } from './history';

describe('screenOf', () => {
  it('reads back the marker Kraken stored', () => {
    for (const screen of ['lots', 'lot-form', 'roasts', 'roast-form', 'sync', 'products', 'product-form', 'offer', 'packaging', 'settings'] as const) expect(screenOf(stateFor(screen))).toBe(screen);
  });

  it.each([null, undefined, {}, { kraken: 'something-else' }, 'lots'])('falls back to the Lots list for %j', (state) => {
    expect(screenOf(state)).toBe('lots');
  });
});
