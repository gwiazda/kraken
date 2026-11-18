import { describe, expect, it } from 'vitest';
import { productFromFields } from '../products';
import { buildOffer } from './present';

const TIERS = [
  { tenths: 150, label: 'Do 10 kg' },
  { tenths: 250, label: '10–20 kg' },
  { tenths: 300, label: '20+ kg' },
];
const form = (o: Partial<Parameters<typeof buildOffer>[1]> = {}) => ({ customer: 'Kawiarnia Pod Lipą', date: '2026-11-16', productIds: ['G', 'K', 'B'], sizes: [1000, 250], tiers: TIERS, banner: null, ...o });

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
      ['Gwatemala', ['250 g', '31 zł', '27 zł', '26 zł'], ['1 kg', '114 zł', '101 zł', '94 zł']],
      ['Kenia', ['250 g', '41 zł', '36 zł', '34 zł'], ['1 kg', '153 zł', '135 zł', '126 zł']],
      ['Burundi', ['250 g', '45 zł', '40 zł', '37 zł'], ['1 kg', '169 zł', '149 zł', '139 zł']],
    ]);
  });

  it('shows the tier names, the retail price under 250 g only, and only the details that are filled in', () => {
    const gwatemala = buildOffer(products, form(), 230, 14).cards[0];
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
    expect(buildOffer(products, form(), 230, 14).cards[1]?.details).toEqual([
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
    ]); // in the order ticked; the deleted product X is left out
    expect(offer.warnings).toEqual(['Burundi has no price for 500 g, so that size is left out for it.', 'Kenia has no price for 500 g, so that size is left out for it.']);
    const none = buildOffer(products, form({ productIds: ['K'], sizes: [500] }), 230, 14);
    expect(none.cards[0]?.blocks).toEqual([]);
    expect(none.warnings).toEqual(['Kenia has no price for 500 g, so it is shown without prices. Add them on the Products page.']);
    expect(buildOffer(products, form({ sizes: [] }), 230, 14).warnings).toEqual([]); // no size ticked: the form says so instead
  });

  it('shows the products in the order the owner chose', () => {
    expect(buildOffer(products, form({ productIds: ['B', 'G'] }), 230, 14).cards.map((c) => c.name)).toEqual(['Burundi', 'Gwatemala']);
    expect(buildOffer(products, form({ productIds: ['G', 'B'] }), 230, 14).cards.map((c) => c.name)).toEqual(['Gwatemala', 'Burundi']);
  });

  it("uses the owner's own banner text when there is one, otherwise the text made from the discounts", () => {
    const own = { title: 'Ceny netto dla partnerów:', line: 'Rabat stały -20%', note: '' };
    expect(buildOffer(products, form({ banner: own }), 230, 14).banner).toEqual(own);
    expect(buildOffer(products, form(), 230, 14).banner.line).toBe('Do 10 kg / mies.: -15% | 10–20 kg / mies.: -25% | 20+ kg / mies.: -30%');
  });
});
