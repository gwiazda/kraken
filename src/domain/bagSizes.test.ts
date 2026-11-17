import { describe, expect, it } from 'vitest';
import { BAG_SIZES_G, formatBagSize } from './bagSizes';

describe('bag sizes', () => {
  it('are 250 g, 500 g and 1 kg (owner, 2026-11-16)', () => {
    expect(BAG_SIZES_G).toEqual([250, 500, 1000]);
  });

  it('are written the Polish way', () => {
    expect(formatBagSize(250)).toBe('250 g');
    expect(formatBagSize(1000)).toBe('1 kg');
    expect(formatBagSize(1500)).toBe('1,5 kg');
  });
});
