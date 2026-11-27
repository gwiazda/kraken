// A sale's prices (owner, 2026-11-27; docs/REQUIREMENTS.md section 4, "Prices on an invoice"), worked out when the sale
// is saved and saved with it:
// - a line whose product and size has the client's special price gets that price, final (no discount on top);
// - every other line gets the wholesale price: the main gross price without VAT, minus the discount for the sale's
//   total weight (Packaging & discounts, "od … kg"), rounded to whole złoty, as on a product's page;
// - the weight counts every bag that is not free, special prices included, all sizes;
// - free (gratis) bags have no price; samples and own use are never priced.
// Once the invoice is issued, the saved prices stay (what was invoiced): only a changed or added line is worked out.
// Pure: no Google, no screen.

import { moneyText } from '../../core/numbers';
import { percentText } from '../../domain/percent';
import { wholesalePrice } from '../../domain/prices';
import { discountForWeight } from '../costs';
import type { PriceKind, Sale, SaleKind, SaleLine } from './model';

export interface PricingData {
  /** The main gross price of a product's size (grosze); undefined when it has none (or the product is gone). */
  retail(productId: string, grams: number): number | undefined;
  /** The client's special net price for a product's size (grosze); undefined when there is none. */
  special(productId: string, grams: number): number | undefined;
  /** The discounts of Packaging & discounts, lowest first. */
  discounts: readonly { tenths: number; name: string; fromGrams: number | null }[];
  vatTenths: number;
}

/** A line as in the form, already checked (grams and bags read). */
export interface LineToPrice {
  readonly productId: string;
  readonly grams: number | null;
  readonly bags: number | null;
  readonly free: boolean;
}

export type LinePrice =
  | {
      readonly kind: PriceKind;
      readonly unitNet: number;
      readonly totalNet: number;
      readonly kept: boolean;
      /** The product's main gross price for this size now, the starting point (grosze); undefined when it has none. */
      readonly retailGross: number | undefined;
    }
  | { readonly kind: 'free' }
  | { readonly kind: 'missing'; readonly reason: string };

export interface SalePricing {
  /** Coffee on the sale that counts for the discount (not free), in grams. */
  readonly weightGrams: number;
  /** The discount the weight gets (tenths); null when none applies or the discounts are not set up. */
  readonly discountTenths: number | null;
  /** True when the discount is the one saved with the issued invoice (not worked out from the weight now). */
  readonly discountKept: boolean;
  readonly lines: readonly LinePrice[];
  /** The net total of the priced lines (grosze). */
  readonly totalNet: number;
  /** True when every line that is not free has a price. */
  readonly complete: boolean;
}

/** What a saved sale already has: its discount and lines (in order), and whether its invoice is issued. */
export interface StoredPrices {
  readonly sale: Pick<Sale, 'discountTenths' | 'status'>;
  readonly lines: readonly Pick<SaleLine, 'productId' | 'grams' | 'free' | 'unitNetGrosze' | 'priceKind'>[];
}

/**
 * The prices of a sale's lines. `stored`: the sale as saved; once its invoice is issued (or paid) a line with the same
 * product, size and free mark as the saved line in its place keeps the saved price, and the saved discount stays.
 */
export function priceSale(lines: readonly LineToPrice[], data: PricingData, stored: StoredPrices | null = null): SalePricing {
  const weightGrams = lines.reduce((sum, l) => sum + (l.free || l.grams === null || l.bags === null ? 0 : l.grams * l.bags), 0);
  const issued = stored !== null && stored.sale.status !== null && stored.sale.status !== 'to_issue';
  // An issued sale keeps its saved discount (one saved before prices existed has none: then it is worked out).
  const discountKept = issued && stored.sale.discountTenths !== null;
  const discountTenths = (issued ? stored.sale.discountTenths : null) ?? discountForWeight(data.discounts, weightGrams)?.tenths ?? null;
  const priced = lines.map((line, i): LinePrice => {
    if (line.free) return { kind: 'free' };
    if (line.grams === null || line.bags === null || line.productId === '') return { kind: 'missing', reason: 'brak produktu, wielkości lub liczby torebek' };
    const retail = data.retail(line.productId, line.grams);
    const saved = issued ? stored.lines[i] : undefined;
    if (saved && saved.productId === line.productId && saved.grams === line.grams && !saved.free && saved.unitNetGrosze !== null && saved.priceKind !== null) {
      return { kind: saved.priceKind, unitNet: saved.unitNetGrosze, totalNet: saved.unitNetGrosze * line.bags, kept: true, retailGross: retail };
    }
    const special = data.special(line.productId, line.grams);
    if (special !== undefined) return { kind: 'special', unitNet: special, totalNet: special * line.bags, kept: false, retailGross: retail };
    if (retail === undefined) return { kind: 'missing', reason: 'produkt nie ma ceny za tę wielkość (zakładka Produkty)' };
    if (discountTenths === null) return { kind: 'missing', reason: 'nie da się dobrać rabatu: ustaw, od ilu kg obowiązuje każdy rabat (Opakowania i rabaty)' };
    const unitNet = wholesalePrice(retail, discountTenths, data.vatTenths).net;
    return { kind: 'discount', unitNet, totalNet: unitNet * line.bags, kept: false, retailGross: retail };
  });
  return {
    weightGrams,
    discountTenths,
    discountKept,
    lines: priced,
    totalNet: priced.reduce((sum, p) => sum + ('totalNet' in p ? p.totalNet : 0), 0),
    complete: priced.every((p) => p.kind !== 'missing'),
  };
}

/** No prices: samples and own use are never priced. */
export const NO_PRICES = (count: number): SalePricing => ({ weightGrams: 0, discountTenths: null, discountKept: false, lines: Array.from({ length: count }, () => ({ kind: 'free' }) as const), totalNet: 0, complete: true });

/** The prices of an entry: a sale is priced; a sample or own use is not. */
export const priceEntry = (kind: SaleKind, lines: readonly LineToPrice[], data: PricingData, stored: StoredPrices | null = null): SalePricing =>
  kind === 'sale' ? priceSale(lines, data, stored) : NO_PRICES(lines.length);

/**
 * The cells to save with a sale (owner, 2026-11-27): the sale's discount, and each line's net price and how it was
 * reached ('' where there is none: a free bag, a line that cannot be priced, a sample or own use).
 */
export function priceCells(pricing: SalePricing): { sale: Record<string, string>; lines: Record<string, string>[] } {
  return {
    sale: { discount_percent: pricing.discountTenths === null ? '' : percentText(pricing.discountTenths) },
    lines: pricing.lines.map((p) => (p.kind === 'special' || p.kind === 'discount' ? { unit_price_net_pln: moneyText(p.unitNet), price_kind: p.kind } : { unit_price_net_pln: '', price_kind: '' })),
  };
}
