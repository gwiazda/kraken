import { describe, expect, it } from 'vitest';
import { grossOf, netOf, roundGrosze, roundToZloty, wholesalePrice, grossMarginPercent } from './prices';

describe('VAT and rounding', () => {
  it('adds VAT and rounds half up to the grosz', () => {
    expect(grossOf(10000, 230)).toBe(12300);
    expect(roundGrosze(2414.5)).toBe(2415);
    expect(roundGrosze(2414.4999)).toBe(2414);
  });

  it('rounds to whole złoty half up, and takes VAT out of a gross price', () => {
    expect(roundToZloty(7450)).toBe(7500); // 74,50 → 75 zł (owner's example)
    expect(roundToZloty(7449)).toBe(7400);
    expect(roundToZloty(7449.6)).toBe(7500); // shown as 74,50 zł before rounding, so it becomes 75 zł
    expect(roundToZloty(7449.4)).toBe(7400); // shown as 74,49 zł
    expect(roundToZloty(7400)).toBe(7400);
    expect(roundToZloty(49)).toBe(0);
    expect(netOf(12300, 230)).toBe(10000);
    expect(netOf(grossOf(4829, 230), 230)).toBeCloseTo(4829, 9);
  });
});

describe('wholesalePrice', () => {
  it('takes VAT out, applies the discount and rounds the net to whole złoty (owner example)', () => {
    // 74 zł gross → 60,16 zł net → −15 % = 51,14 zł → 51 zł net; gross for the invoice 51 × 1,23 = 62,73 zł.
    expect(wholesalePrice(7400, 150, 230)).toEqual({ net: 5100, gross: 6273 });
  });

  it('rounds half up', () => {
    // 123 zł gross → 100 zł net; −24,5 % = 75,50 zł → 76 zł; −24,6 % = 75,40 zł → 75 zł.
    expect(wholesalePrice(12300, 245, 230).net).toBe(7600);
    expect(wholesalePrice(12300, 246, 230).net).toBe(7500);
  });

  it('rounds once, from the exact net (no double rounding just below x,50)', () => {
    // 73,07 zł gross → 59,4065 net; −15 % = 50,4955 zł → 50 zł (rounding to 50,50 first would give 51).
    expect(wholesalePrice(7307, 150, 230).net).toBe(5000);
  });

  it('works for the standard discounts', () => {
    expect([150, 250, 300].map((d) => wholesalePrice(12300, d, 230).net)).toEqual([8500, 7500, 7000]);
  });
});

describe('grossMarginPercent', () => {
  it('is the part of the price without VAT left after the cost, in whole percent', () => {
    expect(grossMarginPercent(4797, 2115)).toBe(56); // 26,82 of 47,97 zł is 55,9 %
    expect(grossMarginPercent(10000, 5000)).toBe(50);
    expect(grossMarginPercent(10000, 0)).toBe(100);
  });

  it('is below 0 when the price does not cover the cost, never "−0", and unknown for a price of 0', () => {
    expect(grossMarginPercent(4000, 4200)).toBe(-5);
    expect(grossMarginPercent(10000, 10040)).toBe(0);
    expect(grossMarginPercent(0, 100)).toBeNull();
  });

  it('rounds halves away from zero, the same for a profit and a loss', () => {
    expect(grossMarginPercent(10000, 5750)).toBe(43); // 42,5 %
    expect(grossMarginPercent(10000, 14250)).toBe(-43); // −42,5 %
  });
});
