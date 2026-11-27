import { describe, expect, it } from 'vitest';
import { specialPriceFromFields, type DealProduct } from './modelPrices';
import { dealRows } from './presentPrices';

// Made-up deals and products.
const deal = (row: number, o: Record<string, string> = {}) =>
  specialPriceFromFields({ id: `D${row}`, client_id: 'C1', product_id: 'P1', bag_size_g: '250', price_net_pln: '38', retail_gross_pln_at_deal: '59', deleted_at: '', ...o }, row);
const kenia: DealProduct = { id: 'P1', name: 'KENIA', prices: { 250: 5900, 1000: 22000 }, deletedAt: '' };
const burundi: DealProduct = { id: 'P2', name: 'BURUNDI', prices: { 250: 4500 }, deletedAt: '' };
const costs = new Map([['P1', { 250: 2415 }]]);

describe('dealRows', () => {
  it('shows the deal next to what they would pay at each discount, and what one bag earns with the margin', () => {
    // 59 zł is 47,97 zł without VAT; −15 % = 40,77 → 41 zł. At 38 zł a 24,15 zł bag earns 13,85 zł: 36,4 % → 36 %.
    expect(dealRows([deal(2)], 'C1', [kenia], [250, 150, 300], 230, costs)).toMatchObject([
      { product: 'KENIA', size: '250 g', price: '38 zł', insteadOf: 'zamiast 41 zł / 36 zł / 34 zł (rabat −15 % / −25 % / −30 %)', earn: 'zarabiasz 13,85 zł · marża 36 %', losing: false, retailChanged: '', unusable: '' },
    ]);
  });

  it('compares with the retail price without VAT when no discounts are set, and shows a loss', () => {
    // 20 zł on a 24,15 zł bag: loses 4,15 zł, −20,75 % → −21 %
    expect(dealRows([deal(2, { price_net_pln: '20' })], 'C1', [kenia], [], 230, costs)[0]).toMatchObject({
      insteadOf: 'zamiast 47,97 zł (cena detaliczna netto)',
      earn: 'strata 4,15 zł · marża −21 %',
      losing: true,
    });
  });

  it('points out a retail price changed since the deal was set, and a deal that is not used', () => {
    const rows = dealRows(
      [deal(2, { retail_gross_pln_at_deal: '55' }), deal(3, { product_id: 'P2', bag_size_g: '1000', price_net_pln: '120.5' })],
      'C1',
      [kenia, burundi],
      [150],
      230,
      costs,
    );
    expect(rows.map((r) => [r.product, r.size, r.price, r.retailChanged, r.unusable, r.earn, r.insteadOf])).toEqual([
      ['BURUNDI', '1 kg', '120,50 zł', '', 'produkt nie ma teraz ceny za 1 kg', '', ''],
      ['KENIA', '250 g', '38 zł', 'Cena detaliczna przy ustalaniu tej ceny: 55 zł, teraz 59 zł.', '', 'zarabiasz 13,85 zł · marża 36 %', 'zamiast 41 zł (rabat −15 %)'],
    ]);
  });
});
