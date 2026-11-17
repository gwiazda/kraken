import { describe, expect, it } from 'vitest';
import { coffeeKey, currentPrice, priceFields, priceFromFields, priceProblem, validatePrice, wholesalePrice } from './modelPrices';

const price = (row: number, o: Record<string, string> = {}) =>
  priceFromFields({ id: `P${row}`, country: 'Kenya', coffee_name: 'Kegwa', bag_size_g: '250', price_gross_pln: '74', valid_from: '2026-11-01', ...o }, row);

describe('coffeeKey', () => {
  it('treats the same country and name as one coffee, ignoring capitals and extra spaces', () => {
    expect(coffeeKey('Kenya', 'Kegwa')).toBe(coffeeKey(' kenya ', 'KEGWA'));
    expect(coffeeKey('Kenya', 'Kegwa  AA')).toBe(coffeeKey('Kenya', 'Kegwa AA'));
    expect(coffeeKey('Kenya', 'Kegwa')).not.toBe(coffeeKey('Ethiopia', 'Kegwa'));
    expect(coffeeKey('Kenya', 'Kegwa')).not.toBe(coffeeKey('Kenya', 'Kegwa AA'));
  });
});

describe('reading price rows', () => {
  it('reads a row', () => {
    expect(price(2)).toMatchObject({ country: 'Kenya', coffeeName: 'Kegwa', grams: 250, grossGrosze: 7400, validFrom: '2026-11-01' });
    expect(priceProblem(price(2))).toBeNull();
  });

  it('says which rows it cannot use, and never complains about deleted ones', () => {
    expect(priceProblem(price(3, { price_gross_pln: 'about 70' }))).toBe('Row 3 of the Price list tab has the price "about 70", which Kraken cannot read, so it is left out.');
    expect(priceProblem(price(4, { price_gross_pln: '0' }))).toBe('Row 4 of the Price list tab has the price "0", which Kraken cannot read, so it is left out.');
    expect(priceProblem(price(5, { bag_size_g: 'big' }))).toBe('Row 5 of the Price list tab has the bag size "big", which is not 250 g, 500 g, 1 kg (in grams: 250, 500, 1000), so it is left out.');
    expect(priceProblem(price(5, { bag_size_g: '300' }))).toBe('Row 5 of the Price list tab has the bag size "300", which is not 250 g, 500 g, 1 kg (in grams: 250, 500, 1000), so it is left out.');
    expect(priceProblem(price(6, { valid_from: '1.11.2026' }))).toBe('Row 6 of the Price list tab has the date "1.11.2026", which is not a date (YYYY-MM-DD), so it is left out.');
    expect(priceProblem(price(6, { valid_from: '2026-13-45' }))).toBe('Row 6 of the Price list tab has the date "2026-13-45", which is not a date (YYYY-MM-DD), so it is left out.');
    expect(priceProblem(price(7, { price_gross_pln: 'x', deleted_at: '2026-11-16T10:00:00.000Z' }))).toBeNull();
  });
});

describe('currentPrice', () => {
  const key = coffeeKey('Kenya', 'Kegwa');

  it('uses the newest price whose date has come; older ones are history, future ones wait', () => {
    const entries = [price(2, { valid_from: '2026-10-01', price_gross_pln: '70' }), price(3, { valid_from: '2026-11-01' }), price(4, { valid_from: '2026-12-01', price_gross_pln: '79' })];
    expect(currentPrice(entries, key, 250, '2026-11-16')?.grossGrosze).toBe(7400);
    expect(currentPrice(entries, key, 250, '2026-12-01')?.grossGrosze).toBe(7900);
    expect(currentPrice(entries, key, 250, '2026-09-30')).toBeNull();
  });

  it('takes the row added later when two have the same date, and skips deleted and unreadable rows', () => {
    const entries = [price(2), price(3, { price_gross_pln: '75' }), price(4, { price_gross_pln: '99', deleted_at: '2026-11-16T10:00:00.000Z' }), price(5, { price_gross_pln: 'x' })];
    expect(currentPrice(entries, key, 250, '2026-11-16')?.id).toBe('P3');
  });

  it('keeps coffees and bag sizes apart', () => {
    const entries = [price(2, { bag_size_g: '500' }), price(3, { country: 'Ethiopia' })];
    expect(currentPrice(entries, key, 250, '2026-11-16')).toBeNull();
    expect(currentPrice(entries, key, 500, '2026-11-16')?.id).toBe('P2');
  });
});

describe('validatePrice and priceFields', () => {
  it('accepts a gross price in zł and stores it the same way every time', () => {
    expect(validatePrice('74')).toEqual({ ok: true, grosze: 7400 });
    expect(validatePrice('74,90')).toEqual({ ok: true, grosze: 7490 });
    expect(priceFields('Kenya', 'Kegwa', 250, 7490, '2026-11-16')).toEqual({
      country: 'Kenya',
      coffee_name: 'Kegwa',
      bag_size_g: '250',
      price_gross_pln: '74.9',
      valid_from: '2026-11-16',
    });
  });

  it('refuses an empty, zero, unreadable or huge price', () => {
    for (const bad of ['', '0', 'a lot', '-5']) expect(validatePrice(bad)).toEqual({ ok: false, error: 'Enter the gross price in zł, e.g. 74.' });
    expect(validatePrice('10000,01')).toEqual({ ok: false, error: 'That is more than 10 000 zł per bag; please check.' });
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
