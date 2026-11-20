import { describe, expect, it } from 'vitest';
import {
  canRestoreDeal,
  changedDealFields,
  dealPriceChange,
  dealKey,
  dealUnusable,
  dealsOf,
  offerDeals,
  specialPriceFromFields,
  validateDeal,
  type DealProduct,
} from './modelPrices';

// Made-up clients, products and prices.
const deal = (row: number, o: Record<string, string> = {}) =>
  specialPriceFromFields({ id: `D${row}`, client_id: 'C1', product_id: 'P1', bag_size_g: '250', price_net_pln: '38', retail_gross_pln_at_deal: '59', deleted_at: '', ...o }, row);
const kenia: DealProduct = { id: 'P1', name: 'KENIA', prices: { 250: 5900, 1000: 22000 }, deletedAt: '' };
const peru: DealProduct = { id: 'P2', name: 'PERU', prices: { 250: 4500 }, deletedAt: '' };

describe('reading special prices', () => {
  it('reads a deal: net price and the retail price when it was set, in grosze', () => {
    expect(deal(2)).toMatchObject({ clientId: 'C1', productId: 'P1', grams: 250, netGrosze: 3800, retailAtDeal: 5900, problems: [] });
    expect(deal(3, { price_net_pln: '38.50' }).netGrosze).toBe(3850);
  });

  it('says which cells cannot be read', () => {
    expect(deal(4, { bag_size_g: '300', price_net_pln: 'cheap' }).problems).toEqual([
      'Row 4 of the Special prices tab has the bag size "300", which is not 250, 500 or 1000 g.',
      'Row 4 of the Special prices tab has the price "cheap", which cannot be read, so that deal is not used.',
    ]);
  });

  it("lists a client's deals without the deleted ones", () => {
    const list = [deal(2), deal(3, { client_id: 'C2' }), deal(4, { deleted_at: '2026-11-20T10:00:00.000Z' })];
    expect(dealsOf(list, 'C1').map((d) => d.id)).toEqual(['D2']);
  });
});

describe('using deals on an offer', () => {
  it('uses a deal only while its product is there, not deleted, and has a price for that size', () => {
    expect(dealUnusable(deal(2), kenia)).toBe('');
    expect(dealUnusable(deal(2), undefined)).toBe('the product is not in the list any more');
    expect(dealUnusable(deal(2), { ...kenia, deletedAt: '2026-11-20T10:00:00.000Z' })).toBe('the product is deleted');
    expect(dealUnusable(deal(2, { bag_size_g: '500' }), kenia)).toBe('the product has no 500 g price now');
    expect(dealUnusable(deal(2, { price_net_pln: '' }), kenia)).toBe('a cell cannot be read');
  });

  it("gives the client's usable deals by product and size", () => {
    const list = [deal(2), deal(3, { bag_size_g: '1000', price_net_pln: '150' }), deal(4, { bag_size_g: '500' }), deal(5, { client_id: 'C2', product_id: 'P2' })];
    const used = offerDeals(list, 'C1', [kenia, peru]);
    expect([...used.entries()]).toEqual([
      [dealKey('P1', 250), 3800],
      [dealKey('P1', 1000), 15000],
    ]);
  });
});

describe('adding a deal', () => {
  const form = (o: Partial<{ productId: string; grams: string; price: string }> = {}) => ({ productId: 'P1', grams: '250', price: '38', ...o });

  it("stores the net price and the product's retail price today", () => {
    expect(validateDeal(form({ price: '38,50' }), 'C1', [kenia, peru], [])).toEqual({
      ok: true,
      fields: { client_id: 'C1', product_id: 'P1', bag_size_g: '250', price_net_pln: '38.5', retail_gross_pln_at_deal: '59' },
    });
  });

  it('asks for a product, a size the product has a price for, and a price', () => {
    expect(validateDeal(form({ productId: '', grams: '', price: '' }), 'C1', [kenia], [])).toEqual({
      ok: false,
      errors: { productId: 'Choose a product.', grams: 'Choose a bag size.', price: 'Enter the price without VAT, e.g. 38 or 38,50.' },
    });
    expect(validateDeal(form({ grams: '500' }), 'C1', [kenia], [])).toMatchObject({ ok: false, errors: { grams: 'KENIA has no 500 g price yet: set it on the Products page first.' } });
    expect(validateDeal(form({ price: '-5' }), 'C1', [kenia], [])).toMatchObject({ ok: false, errors: { price: 'Enter the price without VAT, e.g. 38 or 38,50.' } });
    expect(validateDeal(form(), 'C1', [{ ...kenia, deletedAt: '2026-11-20T10:00:00.000Z' }], [])).toMatchObject({ ok: false, errors: { productId: 'Choose a product.' } });
  });

  it('allows one deal per client, product and size', () => {
    expect(validateDeal(form(), 'C1', [kenia], [deal(2)])).toMatchObject({ ok: false, errors: { productId: 'There is already a price for KENIA 250 g: change that one.' } });
    expect(validateDeal(form({ grams: '1000' }), 'C1', [kenia], [deal(2)])).toMatchObject({ ok: true });
  });

  it('restores a deleted deal only when there is no other one for that product and size', () => {
    const old = deal(2, { deleted_at: '2026-11-20T10:00:00.000Z' });
    expect(canRestoreDeal(old, [old])).toBe(true);
    expect(canRestoreDeal(old, [old, deal(3)])).toBe(false);
    expect(canRestoreDeal(old, [old, deal(3, { bag_size_g: '1000' })])).toBe(true);
  });

  it("changes only the price; today's retail price becomes the new starting point when there is one", () => {
    expect(dealPriceChange(deal(2, { retail_gross_pln_at_deal: '55' }), '36,50', kenia)).toEqual({ ok: true, fields: { price_net_pln: '36.5', retail_gross_pln_at_deal: '59' } });
    // a product that is deleted, or has no price for that size now: the price can still be changed
    expect(dealPriceChange(deal(2), '36', { ...kenia, deletedAt: '2026-11-20T10:00:00.000Z' })).toEqual({ ok: true, fields: { price_net_pln: '36' } });
    expect(dealPriceChange(deal(2, { bag_size_g: '500' }), '36', kenia)).toEqual({ ok: true, fields: { price_net_pln: '36' } });
    expect(dealPriceChange(deal(2), 'free', kenia)).toEqual({ ok: false, error: 'Enter the price without VAT, e.g. 38 or 38,50.' });
  });

  it('an edit writes only what changed', () => {
    expect(changedDealFields(deal(2), { client_id: 'C1', product_id: 'P1', bag_size_g: '250', price_net_pln: '36', retail_gross_pln_at_deal: '59' })).toEqual({ price_net_pln: '36' });
  });
});
