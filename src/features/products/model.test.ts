import { describe, expect, it } from 'vitest';
import { BAG_SIZES_G } from '../../domain/bagSizes';
import { PRODUCT_COLUMNS, changedProductFields, emptyProductForm, formFromProduct, productFromFields, reorderProducts, sortProducts, validateProductForm } from './model';

const product = (row: number, o: Record<string, string> = {}) =>
  productFromFields(
    {
      id: `P${row}`,
      name: 'Gwatemala',
      country: 'Gwatemala',
      region: 'Santa Barbara',
      altitude: '1900-2200 m n.p.m.',
      processing: 'Washed',
      variety: 'Caturra, Bourbon',
      flavour_profile: 'Migdał, biała czekolada',
      brew_method: 'Espresso',
      price_250_gross_pln: '45',
      price_500_gross_pln: '',
      price_1000_gross_pln: '165.9',
      ...o,
    },
    row,
  );

describe('the Products tab', () => {
  it('has a price column for every bag size (a new size needs a migration that adds its column)', () => {
    for (const grams of BAG_SIZES_G) expect(PRODUCT_COLUMNS).toContain(`price_${grams}_gross_pln`);
  });
});

describe('reading a product', () => {
  it('reads the details and the prices per size; an empty price means no price for that size', () => {
    expect(product(2)).toMatchObject({ name: 'Gwatemala', brewMethod: 'Espresso', flavourProfile: 'Migdał, biała czekolada', prices: { 250: 4500, 1000: 16590 }, problems: [] });
  });

  it('says which price it cannot read, and leaves that size without a price', () => {
    const odd = product(3, { price_250_gross_pln: 'about 45', price_1000_gross_pln: '0' });
    expect(odd.prices).toEqual({});
    expect(odd.problems).toEqual([
      'The 250 g price "about 45" of Gwatemala cannot be read, so that size has no price. Edit the product to correct it.',
      'The 1 kg price "0" of Gwatemala cannot be read, so that size has no price. Edit the product to correct it.',
    ]);
  });

  it('sorts by name the Polish way, deleted ones last', () => {
    const list = [product(2, { name: 'Kenia' }), product(3, { name: 'Ćwiczebna', deleted_at: '2026-11-17T10:00:00.000Z' }), product(4, { name: 'Burundi' }), product(5, { name: 'Ćma' })];
    expect(sortProducts(list).map((p) => p.name)).toEqual(['Burundi', 'Ćma', 'Kenia', 'Ćwiczebna']);
  });

  it("follows the owner's order: by position, then products without one by name, deleted ones last", () => {
    const list = [
      product(2, { name: 'Kenia', position: '2' }),
      product(3, { name: 'Burundi' }),
      product(4, { name: 'Peru', position: '1' }),
      product(5, { name: 'Ćma', position: 'first' }), // cannot be read: no position
      product(6, { name: 'Andy', position: '1', deleted_at: '2026-11-17T10:00:00.000Z' }),
    ];
    expect(sortProducts(list).map((p) => p.name)).toEqual(['Peru', 'Kenia', 'Burundi', 'Ćma', 'Andy']);
    expect(list.map((p) => p.position)).toEqual([2, null, 1, null, 1]);
  });

  it('moves a product to another place: positions 1 to n in the new order, only those that change', () => {
    const active = sortProducts([product(2, { name: 'A', position: '1' }), product(3, { name: 'B', position: '2' }), product(4, { name: 'C', position: '3' })]);
    expect(reorderProducts(active, 'P4', 1).map((c) => [c.product.name, c.position])).toEqual([
      ['C', 2],
      ['B', 3],
    ]);
    // dragged from last to first: everyone moves
    expect(reorderProducts(active, 'P4', 0).map((c) => [c.product.name, c.position])).toEqual([
      ['C', 1],
      ['A', 2],
      ['B', 3],
    ]);
    expect(reorderProducts(active, 'P2', 0)).toEqual([]); // stays where it is
    expect(reorderProducts(active, 'P2', -1)).toEqual([]); // above the first
    expect(reorderProducts(active, 'P4', 3)).toEqual([]); // below the last
    expect(reorderProducts(active, 'P9', 1)).toEqual([]);
    // before the first move nobody has a position: every product gets one
    const fresh = sortProducts([product(2, { name: 'A' }), product(3, { name: 'B' })]);
    expect(reorderProducts(fresh, 'P2', 1).map((c) => [c.product.name, c.position])).toEqual([
      ['B', 1],
      ['A', 2],
    ]);
  });
});

describe('the product form', () => {
  it('fills the form the Polish way, keeping a price it cannot read as typed', () => {
    expect(formFromProduct(product(2))).toMatchObject({ name: 'Gwatemala', price250: '45', price500: '', price1000: '165,9' });
    expect(formFromProduct(product(2, { price_250_gross_pln: 'about 45' })).price250).toBe('about 45');
  });

  it('gives every column to store, prices the same way every time', () => {
    const form = { ...emptyProductForm(), name: '  Kenia  Filtr ', brewMethod: 'Filtr', price250: '59', price1000: '220,50' };
    expect(validateProductForm(form)).toEqual({
      ok: true,
      fields: {
        name: 'Kenia Filtr',
        country: '',
        region: '',
        altitude: '',
        processing: '',
        variety: '',
        flavour_profile: '',
        brew_method: 'Filtr',
        price_250_gross_pln: '59',
        price_500_gross_pln: '',
        price_1000_gross_pln: '220.5',
      },
    });
  });

  it('explains what is wrong', () => {
    const form = { ...emptyProductForm(), region: 'x'.repeat(201), price250: 'cheap', price500: '0', price1000: '10000,01' };
    expect(validateProductForm(form)).toEqual({
      ok: false,
      errors: {
        name: 'Enter the name shown on the offer, e.g. Gwatemala.',
        region: 'At most 200 characters.',
        price250: 'Enter the gross price in zł, e.g. 45, or leave it empty.',
        price500: 'Enter the gross price in zł, e.g. 45, or leave it empty.',
        price1000: 'That is more than 10 000 zł per bag; please check.',
      },
    });
  });

  it('an edit writes only the columns that changed', () => {
    const p = product(2);
    const result = validateProductForm({ ...formFromProduct(p), price250: '47', flavourProfile: 'Migdał' });
    if (!result.ok) throw new Error('expected valid');
    expect(changedProductFields(p, result.fields)).toEqual({ price_250_gross_pln: '47', flavour_profile: 'Migdał' });
  });
});
