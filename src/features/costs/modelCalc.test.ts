import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './model';
import { roundGrosze } from '../../domain/prices';
import { averageLoss, calculateLot, chooseLoss } from './modelCalc';

// Example checked by hand: 4 500 zł + 120 zł delivery for 60 kg, 15 % loss, 250 g bag with items 1,20 + 0,30 zł.
const bag250 = { id: 'S250', grams: 250, itemsGrosze: [120, 30] };
const bag1kg = { id: 'S1000', grams: 1000, itemsGrosze: [] };

describe('calculateLot', () => {
  const calc = calculateLot(462000, 60000, 0.15, [bag250, bag1kg], DEFAULT_SETTINGS);

  it('follows the columns of the brief, step by step', () => {
    if (!calc) throw new Error('expected a calculation');
    expect(roundGrosze(calc.greenPerKg)).toBe(7700); // 77,00 zł / kg green
    expect(calc.roastedFromKg).toBeCloseTo(0.85, 10);
    expect(roundGrosze(calc.roastedPerKg)).toBe(9059); // 90,59 zł / kg roasted
    const [small] = calc.bags;
    expect(small && roundGrosze(small.coffee)).toBe(2265); // 22,65 zł of coffee in 250 g
    expect(small?.items).toBe(150);
    expect(small && small.total !== null && roundGrosze(small.total)).toBe(2415); // 24,15 zł per bag
    expect(small?.prices.map((p) => [p.markupHundredths, roundGrosze(p.net), roundGrosze(p.gross)])).toEqual([
      [200, 4829, 5940],
      [250, 6037, 7425],
      [300, 7244, 8910],
    ]);
  });

  it('suggests the gross price rounded to whole złoty, and works out its net from that rounded gross', () => {
    const small = calc?.bags[0];
    // 59,40 → 59 zł; 74,25 → 74 zł; 89,10 → 89 zł. Net = gross ÷ 1,23.
    expect(small?.prices.map((p) => [p.suggestedGross, roundGrosze(p.suggestedNet)])).toEqual([
      [5900, 4797],
      [7400, 6016],
      [8900, 7236],
    ]);
  });

  it('rounds only at the end (the bag total is not the sum of rounded parts)', () => {
    const small = calc?.bags[0];
    expect(small?.total).toBeCloseTo(2414.7059, 4);
  });

  it('shows a bag size without cost items as missing, not as a cheaper bag', () => {
    const big = calc?.bags[1];
    expect(big).toMatchObject({ items: null, total: null, prices: [] });
    expect(big && roundGrosze(big.coffee)).toBe(9059);
  });

  it('cannot calculate without a price or quantity, or with a loss of 100 % or more', () => {
    expect(calculateLot(null, 60000, 0.15, [bag250], DEFAULT_SETTINGS)).toBeNull();
    expect(calculateLot(462000, null, 0.15, [bag250], DEFAULT_SETTINGS)).toBeNull();
    expect(calculateLot(462000, 0, 0.15, [bag250], DEFAULT_SETTINGS)).toBeNull();
    expect(calculateLot(462000, 60000, 1, [bag250], DEFAULT_SETTINGS)).toBeNull();
  });

  it('uses the markups and VAT from the settings', () => {
    const own = { ...DEFAULT_SETTINGS, vatTenths: 80, markupHundredths: [150] };
    const result = calculateLot(100000, 10000, 0, [{ id: 'S', grams: 1000, itemsGrosze: [0] }], own);
    expect(result?.bags[0]?.prices).toEqual([{ markupHundredths: 150, net: 15000, gross: 16200, suggestedGross: 16200, suggestedNet: 15000 }]);
  });
});

describe('roast loss', () => {
  it('averages the lot roasts, weighted by the green coffee each took from the lot', () => {
    expect(
      averageLoss([
        { partGrams: 1000, greenGrams: 1000, roastedDecigrams: 8500 }, // 15 %
        { partGrams: 1000, greenGrams: 1000, roastedDecigrams: 8300 }, // 17 %
      ]),
    ).toEqual({ loss: expect.closeTo(0.16, 10) as number, roasts: 2 });
  });

  it('counts a split roast with its part only (the loss of the whole roast applies)', () => {
    const result = averageLoss([{ partGrams: 400, greenGrams: 1000, roastedDecigrams: 8000 }]);
    expect(result?.loss).toBeCloseTo(0.2, 10);
  });

  it('skips roasts without a roasted weight, and gives nothing when no roast has both weights', () => {
    expect(averageLoss([{ partGrams: 1000, greenGrams: 1000, roastedDecigrams: null }])).toBeNull();
    expect(averageLoss([])).toBeNull();
    expect(averageLoss([{ partGrams: 1000, greenGrams: 1000, roastedDecigrams: 12000 }])).toBeNull(); // heavier after roasting: nonsense
  });

  it('uses the owner value first, then the average, then the default', () => {
    expect(chooseLoss(142, { loss: 0.16, roasts: 3 }, DEFAULT_SETTINGS)).toEqual({ loss: 0.142, source: { kind: 'own' } });
    expect(chooseLoss(null, { loss: 0.16, roasts: 3 }, DEFAULT_SETTINGS)).toEqual({ loss: 0.16, source: { kind: 'average', roasts: 3 } });
    expect(chooseLoss(null, null, DEFAULT_SETTINGS)).toEqual({ loss: 0.15, source: { kind: 'default' } });
    expect(chooseLoss(0, null, DEFAULT_SETTINGS).loss).toBe(0); // 0 % typed is a value, not "empty"
  });
});
