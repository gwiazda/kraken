import { describe, expect, it } from 'vitest';
import { productFromFields } from './model';
import { costing, discountHeader, priceRows, productDetails } from './present';
import type { BeanForm } from './modelBeans';

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

describe('costing (what a bag costs and earns)', () => {
  const lots = [
    { lotId: 'KEN', label: 'KENYA-26-09 · Kegwa', greenPerKg: 7700, lossTenths: 150, lossSource: 'average of 23 roasts' },
    { lotId: 'NOPRICE', label: 'PERU-26-10 · Cajamarca', greenPerKg: null, lossTenths: 150, lossSource: '' },
  ];
  const packaging = new Map([
    [250, 150],
    [500, null],
    [1000, 250],
  ]);
  const lotBean = (lotId: string, share: number): BeanForm => ({ kind: 'lot', lotId, plannedName: '', plannedPrice: '', plannedLoss: '', sharePercent: share });

  it('works out the hand-checked example for one bean: 24,15 zł a bag, suggestions 59 / 74 / 89 zł and their earnings', () => {
    const result = costing([lotBean('KEN', 100)], lots, packaging, 230, 150, { 250: 5900 });
    expect(result.madeOf).toBe('Made of 100 % KENYA-26-09 · Kegwa');
    expect(result.perKg).toBe('90,59\u00a0zł per kg of roasted coffee');
    expect(result.rows[0]).toMatchObject({
      size: '250 g',
      cost: '24,15\u00a0zł',
      parts: 'coffee 22,65\u00a0zł and packaging 1,50\u00a0zł',
      earnings: '23,82\u00a0zł',
      losing: false,
    });
    expect(result.rows[0]?.suggestions.map((s) => [s.text, s.markup, s.earnings])).toEqual([
      ['59\u00a0zł', '2×', '23,82\u00a0zł'],
      ['74\u00a0zł', '2,5×', '36,02\u00a0zł'],
      ['89\u00a0zł', '3×', '48,21\u00a0zł'],
    ]);
    expect(result.rows[1]).toMatchObject({ cost: '', parts: 'coffee 45,29\u00a0zł, packaging not entered' });
    // Explained step by step, in plain sentences with the numbers.
    expect(result.perKgSteps).toEqual([
      'KENYA-26-09 · Kegwa: the green coffee costs 77,00\u00a0zł per kg. Roasting takes away 15 % of the weight (average of 23 roasts), so 1 kg of roasted coffee costs 90,59\u00a0zł.',
    ]);
    expect(result.rows[0]?.steps).toEqual([
      'Coffee: 250 g of roasted coffee at 90,59\u00a0zł per kg costs 22,65\u00a0zł.',
      'Packaging: 1,50\u00a0zł (the bag, label and the rest, from Packaging & discounts).',
      'So one bag costs you 24,15\u00a0zł, without VAT.',
      'Your price 59\u00a0zł includes 23 % VAT; without VAT it is 47,97\u00a0zł. Take away the 24,15\u00a0zł the bag costs: you earn 23,82\u00a0zł per bag.',
      'Twice the cost is 48,29\u00a0zł; with VAT 59,40\u00a0zł, rounded to 59\u00a0zł. At that price you earn 23,82\u00a0zł per bag.',
      'Two and a half times the cost is 60,37\u00a0zł; with VAT 74,25\u00a0zł, rounded to 74\u00a0zł. At that price you earn 36,02\u00a0zł per bag.',
      'Three times the cost is 72,44\u00a0zł; with VAT 89,10\u00a0zł, rounded to 89\u00a0zł. At that price you earn 48,21\u00a0zł per bag.',
    ]);
    expect(result.rows[1]?.steps).toEqual([
      'Coffee: 500 g of roasted coffee at 90,59\u00a0zł per kg costs 45,29\u00a0zł.',
      'Packaging for 500 g is not entered yet: add it under Packaging & discounts to see the full cost.',
    ]);
    expect(result.notes).toEqual(['No packaging entered for 500 g: add it under Packaging & discounts.']);
  });

  it('blends a lot with a planned bean (usual loss when none is typed)', () => {
    const plannedBean: BeanForm = { kind: 'planned', lotId: '', plannedName: 'Etiopia offer', plannedPrice: '50', plannedLoss: '20', sharePercent: 40 };
    const result = costing([lotBean('KEN', 60), plannedBean], lots, packaging, 230, 150, {});
    expect(result.madeOf).toBe('Made of 60 % KENYA-26-09 · Kegwa and 40 % Etiopia offer (planned)');
    expect(result.perKg).toBe('79,35\u00a0zł per kg of roasted coffee');
    expect(result.perKgSteps).toEqual([
      'KENYA-26-09 · Kegwa: the green coffee costs 77,00\u00a0zł per kg. Roasting takes away 15 % of the weight (average of 23 roasts), so 1 kg of roasted coffee costs 90,59\u00a0zł.',
      'Etiopia offer: the green coffee costs 50,00\u00a0zł per kg. Roasting takes away 20 % of the weight (your number), so 1 kg of roasted coffee costs 62,50\u00a0zł.',
      'In the bag: 60 % of 90,59\u00a0zł and 40 % of 62,50\u00a0zł, which comes to 79,35\u00a0zł per kg of roasted coffee.',
    ]);
    const usual = costing([{ ...plannedBean, plannedLoss: '', sharePercent: 100 }], lots, packaging, 230, 150, {});
    expect(usual.perKg).toBe('58,82\u00a0zł per kg of roasted coffee'); // 50 zł ÷ 0,85
  });

  it('shows a loss when the price does not cover the cost', () => {
    const result = costing([lotBean('KEN', 100)], lots, packaging, 230, 150, { 250: 2000 });
    expect(result.rows[0]).toMatchObject({ earnings: '−7,89\u00a0zł', losing: true });
    expect(result.rows[0]?.steps[3]).toBe('Your price 20\u00a0zł includes 23 % VAT; without VAT it is 16,26\u00a0zł. Take away the 24,15\u00a0zł the bag costs: you lose 7,89\u00a0zł per bag.');
  });

  it('says in plain words what is missing', () => {
    expect(costing([lotBean('NOPRICE', 100)], lots, packaging, 230, 150, {}).notes).toEqual(['PERU-26-10 · Cajamarca has no price yet: add it on the Lots page (Edit).']);
    expect(costing([lotBean('', 100)], lots, packaging, 230, 150, {}).notes).toEqual(['Choose a lot for each bean.']);
    expect(costing([lotBean('KEN', 60), lotBean('', 30)], lots, packaging, 230, 150, {}).notes).toEqual(['Choose a lot for each bean.', 'The shares add up to 90 %, not 100 %.']);
    expect(costing([], lots, packaging, 230, 150, {})).toEqual({ madeOf: '', perKg: '', rows: expect.any(Array) as unknown, notes: [], perKgSteps: [] });
  });
});
