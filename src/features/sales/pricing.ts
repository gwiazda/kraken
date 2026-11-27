// A sale's prices (owner, 2026-11-27; docs/REQUIREMENTS.md section 4, "Prices on an invoice"), worked out when the sale
// is saved and saved with it:
// - a line whose product and size has the client's special price gets that price, final (no discount on top);
// - every other line gets the wholesale price: the main gross price without VAT, minus the discount for the sale's
//   total weight (Packaging & discounts, "od … kg"), rounded to whole złoty, as on a product's page;
// - the weight counts every bag that is not free, special prices included, all sizes; a sale lighter than the lowest
//   discount's start (or with no discounts at all) gets no discount: the main price without VAT, in whole złoty;
// - free (gratis) bags have no price; samples and own use are never priced.
// Once the invoice is issued, the saved prices stay (what was invoiced): only a changed or added line is worked out.
// No Google, no screen.

import { moneyText } from '../../core/numbers';
import { isBagSize } from '../../domain/bagSizes';
import { percentText } from '../../domain/percent';
import { wholesalePrice } from '../../domain/prices';
import { dealKey, offerDeals, type SpecialPrice } from '../clients';
import { discountForWeight, discountsReady } from '../costs';
import { isProductDeleted, type Product } from '../products';
import { typedBags, type LineForm, type PriceKind, type Sale, type SaleKind, type SaleLine } from './model';

export interface PricingData {
  /** The client the prices are for (its special prices; a saved issued sale keeps its prices only for its own client). */
  clientId: string;
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

/** What a saved sale already has: its client, discount and lines, and whether its invoice is issued. */
export interface StoredPrices {
  readonly sale: Pick<Sale, 'discountTenths' | 'status' | 'clientId'>;
  readonly lines: readonly Pick<SaleLine, 'productId' | 'grams' | 'free' | 'unitNetGrosze' | 'priceKind'>[];
}

/**
 * The prices of a sale's lines. `stored`: the sale as saved. Once its invoice is issued (or paid), for the same client,
 * a line with the same product and size as a saved, priced line keeps that saved price (each saved line used once,
 * whatever its place, so removing a line changes no other), and the saved discount stays; a sale issued before
 * prices existed (no saved price at all) is worked out.
 */
export function priceSale(lines: readonly LineToPrice[], data: PricingData, stored: StoredPrices | null = null): SalePricing {
  const weightGrams = lines.reduce((sum, l) => sum + (l.free || l.grams === null || l.bags === null ? 0 : l.grams * l.bags), 0);
  const issued = stored !== null && stored.sale.status !== null && stored.sale.status !== 'to_issue' && stored.sale.clientId === data.clientId;
  const keptLines = issued ? stored.lines.filter((l) => !l.free && l.unitNetGrosze !== null && l.priceKind !== null) : [];
  const discountKept = keptLines.length > 0; // the invoice's discount, even "none"
  const ready = discountsReady(data.discounts);
  const discountTenths = discountKept ? stored!.sale.discountTenths : ready ? (discountForWeight(data.discounts, weightGrams)?.tenths ?? null) : null;
  const used = new Set<number>();
  const priced = lines.map((line): LinePrice => {
    if (line.free) return { kind: 'free' };
    if (line.grams === null || line.bags === null || line.productId === '') return { kind: 'missing', reason: 'brak produktu, wielkości lub liczby torebek' };
    const k = keptLines.findIndex((saved, i) => !used.has(i) && saved.productId === line.productId && saved.grams === line.grams);
    const saved = keptLines[k];
    if (saved && saved.unitNetGrosze !== null && saved.priceKind !== null) {
      used.add(k);
      // The starting price is not shown: today's main price may not be the one the invoice was worked out from.
      return { kind: saved.priceKind, unitNet: saved.unitNetGrosze, totalNet: saved.unitNetGrosze * line.bags, kept: true, retailGross: undefined };
    }
    const retail = data.retail(line.productId, line.grams);
    const special = data.special(line.productId, line.grams);
    if (special !== undefined) return { kind: 'special', unitNet: special, totalNet: special * line.bags, kept: false, retailGross: retail };
    if (retail === undefined) return { kind: 'missing', reason: 'produkt nie ma ceny za tę wielkość (zakładka Produkty)' };
    if (!discountKept && !ready) return { kind: 'missing', reason: 'nie da się dobrać rabatu: ustaw, od ilu kg obowiązuje każdy rabat (Opakowania i rabaty)' };
    const unitNet = wholesalePrice(retail, discountTenths ?? 0, data.vatTenths).net; // no discount: the main price without VAT
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

/**
 * The lines of the form, read for the prices: grams and bags as numbers (null when not a whole number above 0), and a
 * free mark only for a sale (samples and own use are never invoiced).
 */
export function linesToPrice(lines: readonly LineForm[], kind: SaleKind): LineToPrice[] {
  return lines.map((l) => {
    const grams = Number(l.grams);
    return { productId: l.productId, grams: l.grams.trim() !== '' && Number.isInteger(grams) && grams > 0 ? grams : null, bags: typedBags(l.bags), free: kind === 'sale' && l.free };
  });
}

/**
 * What a client's prices are worked out from, as Products, Clients (its usable special prices) and Packaging &
 * discounts have them now. A deleted product, or a size it has no price for, has no main price.
 */
export function pricingDataFrom(
  source: { products: readonly Product[]; deals: readonly SpecialPrice[]; discounts: PricingData['discounts']; vatTenths: number },
  clientId: string,
): PricingData {
  const special = offerDeals(source.deals, clientId, source.products);
  const byId = new Map(source.products.filter((p) => !isProductDeleted(p)).map((p) => [p.id, p]));
  return {
    clientId,
    retail: (productId, grams) => (isBagSize(grams) ? byId.get(productId)?.prices[grams] : undefined),
    special: (productId, grams) => special.get(dealKey(productId, grams)),
    discounts: source.discounts,
    vatTenths: source.vatTenths,
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
