import { describe, expect, it } from 'vitest';
import { bagCost, blendPerKg, earningsAt, evenShares, moveShare, roastedPerKg, sharesComplete, suggestionsFor } from './blend';
import { roundGrosze } from './prices';

describe('roasted price per kg', () => {
  it('makes the green price dearer by the roast loss (the hand-checked Kenya example)', () => {
    // 77,00 zł per kg green, 15 % loss → 90,59 zł per kg roasted
    expect(roundGrosze(roastedPerKg(7700, 0.15) ?? 0)).toBe(9059);
    expect(roastedPerKg(7700, 0)).toBe(7700);
  });

  it('cannot work it out without a price, or with a loss of 100 % or more', () => {
    expect(roastedPerKg(null, 0.15)).toBeNull();
    expect(roastedPerKg(7700, 1)).toBeNull();
    expect(roastedPerKg(7700, -0.1)).toBeNull();
  });
});

describe('blendPerKg', () => {
  it('is the single bean when there is one', () => {
    expect(roundGrosze(blendPerKg([{ greenPerKg: 7700, loss: 0.15, sharePercent: 100 }]) ?? 0)).toBe(9059);
  });

  it('weights each bean by its share of the bag', () => {
    // 60 % Kenya at 90,59 zł/kg roasted + 40 % Burundi at 50 zł green, 20 % loss = 62,50 zł/kg roasted
    // → 0,6 × 90,588 + 0,4 × 62,50 = 79,35 zł per kg
    const blend = blendPerKg([
      { greenPerKg: 7700, loss: 0.15, sharePercent: 60 },
      { greenPerKg: 5000, loss: 0.2, sharePercent: 40 },
    ]);
    expect(roundGrosze(blend ?? 0)).toBe(7935);
  });

  it('gives nothing when a bean has no price or the shares do not add up to 100 %', () => {
    expect(blendPerKg([{ greenPerKg: 7700, loss: 0.15, sharePercent: 60 }, { greenPerKg: null, loss: 0.15, sharePercent: 40 }])).toBeNull();
    expect(blendPerKg([{ greenPerKg: 7700, loss: 0.15, sharePercent: 60 }, { greenPerKg: 5000, loss: 0.15, sharePercent: 30 }])).toBeNull();
    expect(blendPerKg([])).toBeNull();
    expect(sharesComplete([{ sharePercent: 100 }, { sharePercent: 0 }])).toBe(false);
  });
});

describe('cost of one bag, suggestions and earnings', () => {
  it('adds the packaging to the coffee in the bag (the hand-checked 250 g example: 24,15 zł)', () => {
    const cost = bagCost(7700 / 0.85, 250, 150);
    expect(roundGrosze(cost.coffee)).toBe(2265);
    expect(cost.total !== null && roundGrosze(cost.total)).toBe(2415);
    expect(bagCost(9059, 1000, null)).toEqual({ coffee: 9059, packaging: null, total: null });
  });

  it('suggests 2×, 2,5× and 3× with VAT in whole złoty, and what each earns per bag', () => {
    const cost = 7700 / 0.85 / 4 + 150; // 24,147 zł
    const s = suggestionsFor(cost, 230);
    expect(s.map((x) => x.gross)).toEqual([5900, 7400, 8900]); // 59, 74, 89 zł
    // 59 zł with VAT is 47,97 zł without; minus 24,15 zł cost = 23,82 zł earned per bag
    expect(s.map((x) => roundGrosze(x.earnings))).toEqual([2382, 3602, 4821]);
  });

  it('works out the earnings for any price, also a loss', () => {
    expect(roundGrosze(earningsAt(12300, 6000, 230))).toBe(4000);
    expect(roundGrosze(earningsAt(6150, 6000, 230))).toBe(-1000);
  });
});

describe('shares', () => {
  it('starts even', () => {
    expect([1, 2, 3].map(evenShares)).toEqual([[100], [50, 50], [33, 33, 34]]);
  });

  it('keeps 100 % when a slider moves: the last bean takes the rest', () => {
    expect(moveShare([50, 50], 0, 70)).toEqual([70, 30]);
    expect(moveShare([33, 33, 34], 0, 60)).toEqual([60, 33, 7]);
    expect(moveShare([60, 33, 7], 1, 20)).toEqual([60, 20, 20]);
  });

  it('never lets a bean drop to 0 % or the total pass 100 %', () => {
    expect(moveShare([50, 50], 0, 100)).toEqual([99, 1]);
    expect(moveShare([50, 50], 0, 0)).toEqual([1, 99]);
    expect(moveShare([60, 33, 7], 0, 100)).toEqual([98, 1, 1]);
    expect(moveShare([90, 5, 5], 1, 50)).toEqual([90, 9, 1]);
    expect(moveShare([100], 0, 30)).toEqual([100]);
  });
});
