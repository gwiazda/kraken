import { describe, expect, it } from 'vitest';
import { HOME_SCREEN, screenOf, stateFor } from './history';

describe('screenOf', () => {
  it('reads back the marker Kraken stored', () => {
    for (const screen of ['lots', 'lot-form', 'roasts', 'roast-form', 'sync', 'products', 'product-form', 'planner', 'offer', 'sales', 'sale-form', 'clients', 'client-form', 'packaging', 'settings'] as const) expect(screenOf(stateFor(screen))).toBe(screen);
  });

  it.each([null, undefined, {}, { kraken: 'something-else' }, 'lots'])('falls back to the home screen, Sales, for %j', (state) => {
    expect(HOME_SCREEN).toBe('sales'); // owner, 2026-11-20: Kraken opens on Sales
    expect(screenOf(state)).toBe('sales');
  });
});
