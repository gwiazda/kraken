import { describe, expect, it } from 'vitest';
import { activeDiscounts, discountFields, discountForWeight, discountFromFields, validateDiscount } from './modelDiscounts';

const row = (r: number, percent: string, name: string, deleted = '', from = '') => discountFromFields({ id: `D${r}`, percent, name, from_kg: from, deleted_at: deleted }, r);

describe('activeDiscounts', () => {
  it('uses the template discounts while the tab has no rows', () => {
    const { discounts, usingDefaults } = activeDiscounts([]);
    expect(usingDefaults).toBe(true);
    expect(discounts.map((d) => [d.tenths, d.name, d.row, d.fromGrams])).toEqual([
      [150, 'Do 10 kg', null, 0],
      [250, '10–20 kg', null, 10_000],
      [300, '20+ kg', null, 20_000],
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
      'Nie da się odczytać rabatu „dużo” w wierszu 2 zakładki „Discounts”, więc jest pominięty.',
      'Nie da się odczytać rabatu „0.15” w wierszu 3 zakładki „Discounts”, więc jest pominięty.',
      'Zakładka „Discounts” ma dwa razy 15 % (wiersz 5); Kraken używa pierwszego.',
      'Nazwa rabatu „Stali klienci hurt” w wierszu 6 zakładki „Discounts” ma więcej niż 12 znaków, więc nie zmieści się w ofercie. Kliknij ją tutaj, aby skrócić.',
    ]);
  });
});

describe('validateDiscount', () => {
  it('accepts a percentage with an optional short name', () => {
    expect(validateDiscount({ percent: '20', name: ' Stali  klienci ', from: '5' }, [])).toEqual({ ok: false, errors: { name: 'Najwyżej 12 znaków, żeby zmieściło się przy cenach w ofercie.' } });
    expect(validateDiscount({ percent: '12,5', name: 'Partnerzy', from: ' 12,5 ' }, [{ tenths: 150, fromGrams: 0 }])).toEqual({ ok: true, tenths: 125, name: 'Partnerzy', fromGrams: 12_500, fields: { percent: '12.5', name: 'Partnerzy', from_kg: '12.5' } });
    expect(validateDiscount({ percent: '20', name: '', from: '0' }, [])).toMatchObject({ ok: true, name: '', fromGrams: 0 });
  });

  it('refuses a missing, impossible or repeated percentage', () => {
    for (const bad of ['', '0', '100', 'x', '0.2']) expect(validateDiscount({ percent: bad, name: '', from: '10' }, [])).toEqual({ ok: false, errors: { percent: 'Wpisz rabat od 1 do 99, np. 20.' } });
    expect(validateDiscount({ percent: '15', name: '', from: '10' }, [{ tenths: 150, fromGrams: 0 }])).toEqual({ ok: false, errors: { percent: 'Ten rabat jest już na liście.' } });
  });

  it('stores a discount the same way every time', () => {
    expect(discountFields({ tenths: 150, name: 'Do 10 kg', fromGrams: 10_000 })).toEqual({ percent: '15', name: 'Do 10 kg', from_kg: '10' });
    expect(discountFields({ tenths: 150, name: '', fromGrams: null })).toMatchObject({ from_kg: '' });
  });
});

describe('where a discount starts (owner, 2026-11-27)', () => {
  it('reads the starting weight; empty until the owner types it', () => {
    expect(row(2, '25', '10–20 kg', '', '10').fromGrams).toBe(10_000);
    expect(row(2, '25', '', '', '12,5').fromGrams).toBe(12_500);
    expect(row(2, '25', '', '', '').fromGrams).toBeNull();
  });

  it('reports a starting weight it cannot read, or one used twice (only the first counts)', () => {
    const { discounts, problems } = activeDiscounts([row(2, '15', 'a', '', 'dużo'), row(3, '25', 'b', '', '10'), row(4, '30', 'c', '', '10'), row(5, '20', 'd', '', '2000')]);
    expect(discounts.map((d) => [d.tenths, d.fromGrams])).toEqual([
      [150, null],
      [200, null],
      [250, 10_000],
      [300, null],
    ]);
    expect(problems).toEqual([
      'Nie da się odczytać wagi „dużo” rabatu −15 % (wiersz 2 zakładki „Discounts”). Kliknij rabat tutaj, aby ją poprawić.',
      'Dwa rabaty zaczynają się od 10\u00a0kg (wiersz 4 zakładki „Discounts”); Kraken liczy tylko pierwszy. Kliknij rabat tutaj, aby to poprawić.',
      'Nie da się odczytać wagi „2000” rabatu −20 % (wiersz 5 zakładki „Discounts”). Kliknij rabat tutaj, aby ją poprawić.',
    ]);
  });

  it('asks for the starting weight and refuses one already used', () => {
    for (const bad of ['', 'x', '-5', '1000,5', '0,0001']) {
      expect(validateDiscount({ percent: '20', name: '', from: bad }, [])).toEqual({ ok: false, errors: { from: 'Wpisz, od ilu kg kawy na fakturze obowiązuje rabat, np. 10 (0 dla najmniejszych zamówień).' } });
    }
    expect(validateDiscount({ percent: '20', name: '', from: '10' }, [{ tenths: 250, fromGrams: 10_000 }])).toEqual({ ok: false, errors: { from: 'Inny rabat zaczyna się już od 10\u00a0kg.' } });
  });

  it('picks the discount for an invoice by its weight: 10 kg exactly is already "from 10 kg"', () => {
    const { discounts } = activeDiscounts([]); // 15 % from 0, 25 % from 10 kg, 30 % from 20 kg
    const at = (grams: number) => discountForWeight(discounts, grams)?.tenths ?? null;
    expect([0, 250, 9_999, 10_000, 12_000, 19_999, 20_000, 55_000].map(at)).toEqual([150, 150, 150, 250, 250, 250, 300, 300]);
  });

  it('gives no discount below the lowest starting weight, or while no starting weight is set', () => {
    const { discounts } = activeDiscounts([row(2, '25', '', '', '10'), row(3, '15', '', '', '')]);
    expect(discountForWeight(discounts, 5_000)).toBeNull();
    expect(discountForWeight(discounts, 10_000)?.tenths).toBe(250);
    expect(discountForWeight(activeDiscounts([row(2, '15', '')]).discounts, 50_000)).toBeNull();
  });
});
