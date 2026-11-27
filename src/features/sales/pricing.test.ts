import { describe, expect, it } from 'vitest';
import { priceCells, priceEntry, priceSale, type LineToPrice, type PricingData } from './pricing';

// Made-up products and prices. VAT 23 %. KENIA 250 g 59 zł gross (47,97 net), 1 kg 220 zł (178,86 net).
const retail: Record<string, number> = { 'K|250': 5900, 'K|1000': 22000, 'G|250': 4900 };
const data = (special: Record<string, number> = {}, discounts: PricingData['discounts'] = [
  { tenths: 150, name: 'Do 10 kg', fromGrams: 0 },
  { tenths: 250, name: '10–20 kg', fromGrams: 10_000 },
  { tenths: 300, name: '20+ kg', fromGrams: 20_000 },
]): PricingData => ({
  retail: (p, g) => retail[`${p}|${g}`],
  special: (p, g) => special[`${p}|${g}`],
  discounts,
  vatTenths: 230,
});
const line = (productId: string, grams: number, bags: number, free = false): LineToPrice => ({ productId, grams, bags, free });

describe('priceSale (owner, 2026-11-27)', () => {
  it('prices every line at the discount for the total weight: 4 kg is −15 %', () => {
    const p = priceSale([line('K', 1000, 2), line('K', 250, 8)], data());
    expect(p.weightGrams).toBe(4_000);
    expect(p.discountTenths).toBe(150);
    // 178,86 × 0,85 = 152,03 → 152 zł; 47,97 × 0,85 = 40,77 → 41 zł (whole złoty, as on a product's page).
    expect(p.lines).toEqual([
      { kind: 'discount', unitNet: 15200, totalNet: 30400, kept: false },
      { kind: 'discount', unitNet: 4100, totalNet: 32800, kept: false },
    ]);
    expect(p.totalNet).toBe(63200);
    expect(p.complete).toBe(true);
  });

  it('10 kg exactly is already −25 %, 20 kg −30 %', () => {
    expect(priceSale([line('K', 1000, 10)], data()).discountTenths).toBe(250);
    expect(priceSale([line('K', 1000, 9), line('K', 250, 3)], data()).discountTenths).toBe(150); // 9,75 kg
    expect(priceSale([line('K', 1000, 20)], data()).discountTenths).toBe(300);
  });

  it('a special price is final, and its bags still count for the weight of the rest', () => {
    // 8 kg at a special price + 4 kg = 12 kg: the others get −25 %.
    const p = priceSale([line('K', 1000, 8), line('G', 250, 16)], data({ 'K|1000': 11200 }));
    expect(p.weightGrams).toBe(12_000);
    expect(p.discountTenths).toBe(250);
    // 39,84 net × 0,75 = 29,88 → 30 zł
    expect(p.lines).toEqual([
      { kind: 'special', unitNet: 11200, totalNet: 89600, kept: false },
      { kind: 'discount', unitNet: 3000, totalNet: 48000, kept: false },
    ]);
  });

  it('free bags have no price and do not count for the weight', () => {
    const p = priceSale([line('K', 1000, 9), line('K', 1000, 3, true)], data());
    expect(p.weightGrams).toBe(9_000);
    expect(p.discountTenths).toBe(150);
    expect(p.lines[1]).toEqual({ kind: 'free' });
  });

  it('says why a line cannot be priced, and the rest still is', () => {
    const p = priceSale([line('K', 500, 1), line('K', 250, 1)], data());
    expect(p.lines[0]).toEqual({ kind: 'missing', reason: 'produkt nie ma ceny za tę wielkość (zakładka Produkty)' });
    expect(p.lines[1]).toMatchObject({ kind: 'discount', unitNet: 4100 });
    expect(p.complete).toBe(false);
    expect(p.totalNet).toBe(4100);
    // Discounts not set up (a start missing): no discounted price is guessed; a special price still works.
    const noStart = data({ 'G|250': 3500 }, [{ tenths: 150, name: '', fromGrams: null }]);
    const q = priceSale([line('K', 250, 1), line('G', 250, 1)], noStart);
    expect(q.lines[0]).toEqual({ kind: 'missing', reason: 'nie da się dobrać rabatu: ustaw, od ilu kg obowiązuje każdy rabat (Opakowania i rabaty)' });
    expect(q.lines[1]).toMatchObject({ kind: 'special', unitNet: 3500 });
  });

  it('once the invoice is issued, saved prices and the saved discount stay; a changed or added line is worked out', () => {
    const stored = {
      sale: { discountTenths: 150, status: 'issued' as const },
      lines: [
        { productId: 'K', grams: 1000, free: false, unitNetGrosze: 14000, priceKind: 'discount' as const },
        { productId: 'K', grams: 250, free: false, unitNetGrosze: 4000, priceKind: 'discount' as const },
      ],
    };
    // Bags changed on line 1 (same product and size: kept), line 2 changed to GWATEMALA (worked out at the saved −15 %).
    const p = priceSale([line('K', 1000, 12), line('G', 250, 1)], data(), stored);
    expect(p.discountTenths).toBe(150); // not −25 % for 12,25 kg: the invoice is issued
    expect(p.discountKept).toBe(true);
    expect(p.lines).toEqual([
      { kind: 'discount', unitNet: 14000, totalNet: 168000, kept: true },
      { kind: 'discount', unitNet: 3400, totalNet: 3400, kept: false }, // 39,84 × 0,85 = 33,86 → 34 zł
    ]);
    // Still to be issued: everything is worked out again.
    const again = priceSale([line('K', 1000, 12)], data(), { ...stored, sale: { discountTenths: 150, status: 'to_issue' } });
    expect(again.discountTenths).toBe(250);
    expect(again.discountKept).toBe(false);
    expect(again.lines[0]).toMatchObject({ unitNet: 13400, kept: false }); // 178,86 × 0,75 = 134,15 → 134 zł
  });

  it('an issued sale saved before prices existed is worked out', () => {
    const old = { sale: { discountTenths: null, status: 'paid' as const }, lines: [{ productId: 'K', grams: 1000, free: false, unitNetGrosze: null, priceKind: null }] };
    expect(priceSale([line('K', 1000, 2)], data(), old)).toMatchObject({ discountTenths: 150, lines: [{ kind: 'discount', unitNet: 15200, kept: false }] });
  });
});

describe('priceEntry and priceCells', () => {
  it('samples and own use are never priced', () => {
    for (const kind of ['sample', 'own_use'] as const) {
      const p = priceEntry(kind, [line('K', 150, 2)], data());
      expect(p).toMatchObject({ totalNet: 0, discountTenths: null, complete: true });
      expect(priceCells(p)).toEqual({ sale: { discount_percent: '' }, lines: [{ unit_price_net_pln: '', price_kind: '' }] });
    }
  });

  it('saves the discount and each line price the same way every time', () => {
    const p = priceEntry('sale', [line('K', 1000, 8), line('G', 250, 16), line('K', 250, 1, true)], data({ 'K|1000': 11250 }));
    expect(priceCells(p)).toEqual({
      sale: { discount_percent: '25' },
      lines: [
        { unit_price_net_pln: '112.5', price_kind: 'special' },
        { unit_price_net_pln: '30', price_kind: 'discount' },
        { unit_price_net_pln: '', price_kind: '' },
      ],
    });
  });
});
