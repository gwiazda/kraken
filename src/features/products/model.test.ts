import { describe, expect, it } from 'vitest';
import { BAG_SIZES_G } from '../../domain/bagSizes';
import { PRODUCT_COLUMNS, changedProductFields, emptyProductForm, formFromProduct, movedOrder, positionChanges, productFromFields, withOrder, sortProducts, validateProductForm } from './model';

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
      'Nie da się odczytać ceny za 250 g „about 45” (Gwatemala), więc ta wielkość nie ma ceny. Popraw ją w produkcie.',
      'Nie da się odczytać ceny za 1 kg „0” (Gwatemala), więc ta wielkość nie ma ceny. Popraw ją w produkcie.',
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

  it('moves an id to another place in the order', () => {
    expect(movedOrder(['A', 'B', 'C'], 'C', 0)).toEqual(['C', 'A', 'B']); // dragged from last to first
    expect(movedOrder(['A', 'B', 'C'], 'A', 1)).toEqual(['B', 'A', 'C']);
    expect(movedOrder(['A', 'B', 'C'], 'A', 0)).toEqual(['A', 'B', 'C']); // stays where it is
    expect(movedOrder(['A', 'B', 'C'], 'A', -1)).toEqual(['A', 'B', 'C']); // above the first
    expect(movedOrder(['A', 'B', 'C'], 'C', 3)).toEqual(['A', 'B', 'C']); // below the last
    expect(movedOrder(['A', 'B', 'C'], 'X', 1)).toEqual(['A', 'B', 'C']);
  });

  it('writes positions 1 to n in the new order, only those that change; the first move numbers every product', () => {
    const stored = [product(2, { name: 'A', position: '1' }), product(3, { name: 'B', position: '2' }), product(4, { name: 'C', position: '3' })];
    expect(positionChanges(stored, ['P2', 'P4', 'P3']).map((c) => [c.product.name, c.position])).toEqual([
      ['C', 2],
      ['B', 3],
    ]);
    expect(positionChanges(stored, ['P2', 'P3', 'P4'])).toEqual([]);
    expect(positionChanges(stored, ['P9', 'P2'])).toEqual([{ product: stored[0], position: 2 }]); // P9 is gone
    const fresh = [product(2, { name: 'A' }), product(3, { name: 'B' })];
    expect(positionChanges(fresh, ['P3', 'P2']).map((c) => [c.product.name, c.position])).toEqual([
      ['B', 1],
      ['A', 2],
    ]);
  });

  it('shows the new order at once, before it is saved', () => {
    const list = [product(2, { name: 'A', position: '1' }), product(3, { name: 'B', position: '2' }), product(4, { name: 'Gone', deleted_at: '2026-11-17T10:00:00.000Z' })];
    const shown = withOrder(list, ['P3', 'P2']);
    expect(sortProducts(shown).map((p) => [p.name, p.position])).toEqual([
      ['B', 1],
      ['A', 2],
      ['Gone', null],
    ]);
    expect(shown[0]?.source).toBe(list[0]?.source); // the stored copy is unchanged until saved
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
        name: 'Wpisz nazwę widoczną w ofercie, np. Gwatemala.',
        region: 'Najwyżej 200 znaków.',
        price250: 'Wpisz cenę brutto w zł, np. 45, albo zostaw puste.',
        price500: 'Wpisz cenę brutto w zł, np. 45, albo zostaw puste.',
        price1000: 'To ponad 10 000 zł za torebkę; sprawdź, proszę.',
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
