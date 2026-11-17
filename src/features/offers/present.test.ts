import { describe, expect, it } from 'vitest';
import { productFromFields } from '../products';
import { DEFAULT_TIER_LABELS } from './model';
import { buildOffer } from './present';

const TIERS = [150, 250, 300].map((tenths) => ({ tenths, label: DEFAULT_TIER_LABELS[tenths] ?? '' }));
const form = (o: Partial<Parameters<typeof buildOffer>[1]> = {}) => ({ customer: 'Kawiarnia Pod Lipą', date: '2026-11-16', productIds: ['G', 'K', 'B'], sizes: [1000, 250], tiers: TIERS, ...o });

const productFromFieldsForTest = (id: string, fields: Record<string, string>) => productFromFields({ id, ...fields }, 2);

const products = [
  productFromFieldsForTest('K', { name: 'Kenia', country: 'Kenia', region: 'Kirinyaga', brew_method: 'Filtr', price_250_gross_pln: '59', price_1000_gross_pln: '221' }),
  productFromFieldsForTest('G', {
    name: 'Gwatemala',
    country: 'Gwatemala',
    region: 'Santa Barbara',
    altitude: '1900-2200 m.n.p.m',
    processing: 'Washed',
    variety: 'Caturra, Bourbon',
    flavour_profile: 'Migdał, biała czekolada, zielone jabłko',
    brew_method: 'Espresso',
    price_250_gross_pln: '45',
    price_1000_gross_pln: '165',
  }),
  productFromFieldsForTest('B', { name: 'Burundi', brew_method: 'Filtr', price_250_gross_pln: '65', price_1000_gross_pln: '245' }),
  productFromFieldsForTest('X', { name: 'Old', price_250_gross_pln: '50', deleted_at: '2026-11-01T00:00:00.000Z' }),
];

describe('buildOffer', () => {
  it("gives the owner's template prices from the main prices (VAT 23 %, net rounded to whole złoty)", () => {
    const offer = buildOffer(products, form(), 230, 14);
    const prices = offer.cards.map((c) => [c.name, ...c.blocks.map((b) => [b.size, ...b.rows.map((r) => r.price.replace(' ', ' '))])]);
    // The same numbers as the owner's offer template (Gwatemala, Kenia, Burundi; 250 g and 1 kg).
    expect(prices).toEqual([
      ['Burundi', ['250 g', '45 zł', '40 zł', '37 zł'], ['1 kg', '169 zł', '149 zł', '139 zł']],
      ['Gwatemala', ['250 g', '31 zł', '27 zł', '26 zł'], ['1 kg', '114 zł', '101 zł', '94 zł']],
      ['Kenia', ['250 g', '41 zł', '36 zł', '34 zł'], ['1 kg', '153 zł', '135 zł', '126 zł']],
    ]);
  });

  it('shows the tier names, the retail price under 250 g only, and only the details that are filled in', () => {
    const gwatemala = buildOffer(products, form(), 230, 14).cards[1];
    expect(gwatemala?.blocks[0]).toEqual({
      size: '250 g',
      rows: [
        { label: 'Do 10 kg (-15%):', price: '31 zł' },
        { label: '10–20 kg (-25%):', price: '27 zł' },
        { label: '20+ kg (-30%):', price: '26 zł' },
      ],
      retail: 'Sugerowana cena detaliczna brutto: 45 zł',
    });
    expect(gwatemala?.blocks[1]?.retail).toBe('');
    expect(gwatemala?.brewMethod).toBe('Espresso');
    expect(gwatemala?.details.map((d) => d.label)).toEqual(['Kraj:', 'Region:', 'Wysokość uprawy:', 'Obróbka:', 'Odmiana:', 'Profil smakowy:']);
    expect(buildOffer(products, form(), 230, 14).cards[2]?.details).toEqual([
      { label: 'Kraj:', value: 'Kenia' },
      { label: 'Region:', value: 'Kirinyaga' },
    ]);
  });

  it('fills in the customer, the dates, the file name and the banner', () => {
    const offer = buildOffer(products, form({ customer: '  Kawiarnia   Pod Lipą ' }), 230, 14);
    expect(offer).toMatchObject({
      fileName: 'Oferta dla Kawiarnia Pod Lipą 16.11.2026',
      customer: 'Kawiarnia Pod Lipą',
      date: '16.11.2026',
      validUntil: '30.11.2026',
      year: '2026',
      warnings: [],
    });
    expect(offer.banner.note).toContain('gramatur 250 g i 1 kg');
  });

  it('leaves out a size a product has no price for, and says so; never shows deleted or unticked products', () => {
    const offer = buildOffer(products, form({ productIds: ['B', 'X', 'K'], sizes: [250, 500] }), 230, 14);
    expect(offer.cards.map((c) => [c.name, c.blocks.map((b) => b.size)])).toEqual([
      ['Burundi', ['250 g']],
      ['Kenia', ['250 g']],
    ]);
    expect(offer.warnings).toEqual(['Burundi has no price for 500 g, so that size is left out for it.', 'Kenia has no price for 500 g, so that size is left out for it.']);
    const none = buildOffer(products, form({ productIds: ['K'], sizes: [500] }), 230, 14);
    expect(none.cards[0]?.blocks).toEqual([]);
    expect(none.warnings).toEqual(['Kenia has no price for 500 g, so it is shown without prices. Add them on the Products page.']);
  });
});
