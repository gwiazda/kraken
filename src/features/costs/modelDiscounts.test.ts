import { describe, expect, it } from 'vitest';
import { activeDiscounts, discountFields, discountFromFields, validateDiscount } from './modelDiscounts';

const row = (r: number, percent: string, name: string, deleted = '') => discountFromFields({ id: `D${r}`, percent, name, deleted_at: deleted }, r);

describe('activeDiscounts', () => {
  it('uses the template discounts while the tab has no rows', () => {
    const { discounts, usingDefaults } = activeDiscounts([]);
    expect(usingDefaults).toBe(true);
    expect(discounts.map((d) => [d.tenths, d.name, d.row])).toEqual([
      [150, 'Do 10 kg', null],
      [250, '10–20 kg', null],
      [300, '20+ kg', null],
    ]);
  });

  it("uses exactly the owner's active rows once there are any, lowest first", () => {
    const rows = [row(2, '25', '10–20 kg'), row(3, '15', 'Do 10 kg'), row(4, '30', '20+ kg', '2026-11-18T10:00:00.000Z'), row(5, '20', '')];
    expect(activeDiscounts(rows).discounts.map((d) => [d.tenths, d.name])).toEqual([
      [150, 'Do 10 kg'],
      [200, ''],
      [250, '10–20 kg'],
    ]);
    // All deleted: really none (not the defaults again).
    expect(activeDiscounts([row(2, '15', 'x', '2026-11-18T10:00:00.000Z')])).toEqual({ discounts: [], usingDefaults: false, problems: [] });
  });

  it('reports rows it cannot use', () => {
    const { discounts, problems } = activeDiscounts([row(2, 'dużo', 'x'), row(3, '0.15', 'y'), row(4, '15', 'a'), row(5, '15', 'b'), row(6, '20', 'Stali klienci hurt')]);
    expect(discounts.map((d) => d.name)).toEqual(['a', 'Stali klienci hurt']);
    expect(problems).toEqual([
      'The discount "dużo" in row 2 of the Discounts tab cannot be read, so it is left out.',
      'The discount "0.15" in row 3 of the Discounts tab cannot be read, so it is left out.',
      'The Discounts tab has 15 % twice (row 5); Kraken uses the first.',
      'The discount name "Stali klienci hurt" in row 6 of the Discounts tab is longer than 12 characters, so it will not fit on the offer. Click it here to shorten it.',
    ]);
  });
});

describe('validateDiscount', () => {
  it('accepts a percentage with an optional short name', () => {
    expect(validateDiscount({ percent: '20', name: ' Stali  klienci ' }, [])).toEqual({ ok: false, errors: { name: 'At most 12 characters, so it fits next to the prices on the offer.' } });
    expect(validateDiscount({ percent: '12,5', name: 'Partnerzy' }, [{ tenths: 150 }])).toEqual({ ok: true, tenths: 125, name: 'Partnerzy', fields: { percent: '12.5', name: 'Partnerzy' } });
    expect(validateDiscount({ percent: '20', name: '' }, [])).toMatchObject({ ok: true, name: '' });
  });

  it('refuses a missing, impossible or repeated percentage', () => {
    for (const bad of ['', '0', '100', 'x', '0.2']) expect(validateDiscount({ percent: bad, name: '' }, [])).toEqual({ ok: false, errors: { percent: 'Enter a discount from 1 to 99, e.g. 20.' } });
    expect(validateDiscount({ percent: '15', name: '' }, [{ tenths: 150 }])).toEqual({ ok: false, errors: { percent: 'This discount is already in the list.' } });
  });

  it('stores a discount the same way every time', () => {
    expect(discountFields({ tenths: 150, name: 'Do 10 kg' })).toEqual({ percent: '15', name: 'Do 10 kg' });
  });
});
