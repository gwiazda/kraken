import { describe, expect, it } from 'vitest';
import { productFromFields } from './model';
import { discountHeader, parseDiscount, priceRows, productDetails, suggestedLot } from './present';

const kenia = productFromFields(
  { id: 'K', name: 'Kenia', country: 'Kenia', region: 'Kirinyaga', flavour_profile: 'Jagoda', brew_method: 'Filtr', price_250_gross_pln: '59', price_1000_gross_pln: '221' },
  2,
);

describe('priceRows', () => {
  it('shows the main gross price with its net, and the wholesale net (whole złoty) with its gross, per size', () => {
    const rows = priceRows(kenia, [150, 250, 300], 230);
    expect(rows.map((r) => r.size)).toEqual(['250 g', '500 g', '1 kg']);
    expect(rows[0]).toEqual({
      size: '250 g',
      retail: { main: '59 zł', other: '47,97 zł net' },
      wholesale: [
        { main: '41 zł', other: '50,43 zł gross' },
        { main: '36 zł', other: '44,28 zł gross' },
        { main: '34 zł', other: '41,82 zł gross' },
      ],
    });
    // The same numbers as the owner's offer template (Kenia 1 kg: 153 / 135 / 126 zł).
    expect(rows[2]?.wholesale.map((c) => c.main)).toEqual(['153 zł', '135 zł', '126 zł']);
  });

  it('shows a dash where the product has no price for a size', () => {
    expect(priceRows(kenia, [150], 230)[1]).toEqual({ size: '500 g', retail: { main: '—', other: '' }, wholesale: [{ main: '—', other: '' }] });
  });

  it('reads a discount typed by the owner', () => {
    expect(['20', '12,5', ' 7.5 '].map(parseDiscount)).toEqual([200, 125, 75]);
    expect(['', '0', '100', 'dużo', '-5', '1,25'].map(parseDiscount)).toEqual([null, null, null, null, null, null]);
  });

  it('writes the discount headers the Polish way', () => {
    expect([150, 125].map(discountHeader)).toEqual(['−15 %', '−12,5 %']);
  });
});

describe('productDetails', () => {
  it('lists only the details that are filled in', () => {
    expect(productDetails(kenia)).toEqual([
      { label: 'Country (Kraj)', value: 'Kenia' },
      { label: 'Region', value: 'Kirinyaga' },
      { label: 'Flavour profile (Profil smakowy)', value: 'Jagoda' },
    ]);
  });
});

describe('suggestedLot', () => {
  const lots = [
    { lotId: 'ETH', label: 'ETHIOPIA-26-10 · Guji', country: 'Ethiopia' },
    { lotId: 'KEN-NEW', label: 'KENYA-26-09 · Kegwa', country: 'Kenya' },
    { lotId: 'KEN-OLD', label: 'KENYA-26-03 · Kegwa', country: 'Kenya' },
    { lotId: 'BUR', label: 'BURUNDI-26-08 · Burunga', country: 'Burundi' },
  ];

  it('picks the newest lot whose coffee name or country is in the product name or country', () => {
    expect(suggestedLot({ name: 'Kenia Kegwa', country: '' }, lots)).toBe('KEN-NEW'); // by coffee name
    expect(suggestedLot({ name: 'Burundi', country: 'Burundi' }, lots)).toBe('BUR'); // by country
    expect(suggestedLot({ name: 'Etiopia', country: 'Etiopia' }, lots)).toBe(''); // Polish spelling: no guess
  });

  it('never guesses: no match (or no lots) means the owner chooses', () => {
    expect(suggestedLot({ name: 'Gwatemala', country: 'Gwatemala' }, lots)).toBe('');
    expect(suggestedLot({ name: 'Kenia Kegwa', country: '' }, [])).toBe('');
  });
});
