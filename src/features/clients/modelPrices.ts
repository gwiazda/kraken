// Special prices (owner, 2026-11-20; docs/REQUIREMENTS.md section 5): a fixed net price agreed with one client for
// one product and bag size ("Café Nowa pays 38 zł for KENIA 250 g"). Set on the client's page, used on that
// client's offers. Each deal keeps the product's retail price at the time it was set, so a later change of the
// retail price can be pointed out. Pure: no Google, no screen.

import { moneyText, parseMoney } from '../../core/numbers';
import { formatBagSize, isBagSize, type BagSize } from '../../domain/bagSizes';

type Fields = Readonly<Record<string, string>>;

export const SPECIAL_PRICES_TAB = 'Special prices';
export const SPECIAL_PRICE_COLUMNS = ['client_id', 'product_id', 'bag_size_g', 'price_net_pln', 'retail_gross_pln_at_deal'] as const;

export interface SpecialPrice {
  readonly id: string;
  readonly row: number;
  readonly clientId: string;
  readonly productId: string;
  /** null when the cell is not one of the bag sizes. */
  readonly grams: BagSize | null;
  /** The agreed price without VAT, in grosze; null when it cannot be read. */
  readonly netGrosze: number | null;
  /** The product's retail (gross) price for that size when the deal was set; null when unknown. */
  readonly retailAtDeal: number | null;
  /** Cells Kraken could not read, one sentence each. */
  readonly problems: readonly string[];
  readonly deletedAt: string;
  readonly source: Fields;
}

/** What a deal needs to know about a product (the Products feature's Product fits). */
export interface DealProduct {
  readonly id: string;
  readonly name: string;
  readonly prices: Readonly<Partial<Record<BagSize, number>>>;
  readonly deletedAt: string;
}

const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

const money = (cell: string): number | null => {
  const grosze = parseMoney(cell);
  return typeof grosze === 'number' && grosze > 0 ? grosze : null;
};

export function specialPriceFromFields(fields: Fields, row: number): SpecialPrice {
  const problems: string[] = [];
  const gramsCell = text(fields, 'bag_size_g');
  const grams = Number(gramsCell);
  if (!isBagSize(grams)) problems.push(`Row ${row} of the Special prices tab has the bag size "${gramsCell}", which is not 250, 500 or 1000 g.`);
  const priceCell = text(fields, 'price_net_pln');
  const netGrosze = money(priceCell);
  if (netGrosze === null) problems.push(`Row ${row} of the Special prices tab has the price "${priceCell}", which cannot be read, so that deal is not used.`);
  return {
    id: text(fields, 'id'),
    row,
    clientId: text(fields, 'client_id'),
    productId: text(fields, 'product_id'),
    grams: isBagSize(grams) ? grams : null,
    netGrosze,
    retailAtDeal: money(text(fields, 'retail_gross_pln_at_deal')),
    problems,
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

export const isDealDeleted = (deal: SpecialPrice) => deal.deletedAt !== '';

/** A client's deals that are not deleted. */
export const dealsOf = (deals: readonly SpecialPrice[], clientId: string) => deals.filter((d) => !isDealDeleted(d) && d.clientId === clientId);

/**
 * Why a deal is not used on offers ('' when it is): its product is gone, deleted, or has no price for that size any
 * more, or a cell cannot be read. It comes back into use when the product (or the size's price) comes back.
 */
export function dealUnusable(deal: SpecialPrice, product: DealProduct | undefined): string {
  if (deal.netGrosze === null || deal.grams === null) return 'a cell cannot be read';
  if (!product) return 'the product is not in the list any more';
  if (product.deletedAt !== '') return 'the product is deleted';
  if (product.prices[deal.grams] === undefined) return `the product has no ${formatBagSize(deal.grams)} price now`;
  return '';
}

/** The deals a client's offer uses: product id and size → the agreed net price (grosze). Unusable ones are left out. */
export function offerDeals(deals: readonly SpecialPrice[], clientId: string, products: readonly DealProduct[]): Map<string, number> {
  const byId = new Map(products.map((p) => [p.id, p]));
  const used = new Map<string, number>();
  for (const deal of dealsOf(deals, clientId)) {
    if (dealUnusable(deal, byId.get(deal.productId)) !== '' || deal.grams === null || deal.netGrosze === null) continue;
    used.set(dealKey(deal.productId, deal.grams), deal.netGrosze);
  }
  return used;
}

/** The key of a product and size in offerDeals. */
export const dealKey = (productId: string, grams: number) => `${productId}|${grams}`;

// ---- Adding or changing a deal ----

export interface DealForm {
  productId: string;
  /** "250", "500", "1000" or '' */
  grams: string;
  /** The net price as typed: "38", "38,50". */
  price: string;
}

export type DealErrors = Partial<Record<keyof DealForm, string>>;

/**
 * Checks a deal before it is saved; on success gives every column to store (the product's retail price for that
 * size today is kept with it). `others`: the client's other deals (not deleted): one deal per product and size.
 */
export function validateDeal(
  form: DealForm,
  clientId: string,
  products: readonly DealProduct[],
  others: readonly SpecialPrice[],
): { ok: true; fields: Record<string, string> } | { ok: false; errors: DealErrors } {
  const errors: DealErrors = {};
  const product = products.find((p) => p.id === form.productId && p.deletedAt === '');
  if (!product) errors.productId = 'Choose a product.';
  const grams = Number(form.grams);
  const size = isBagSize(grams) ? grams : null;
  if (size === null) errors.grams = 'Choose a bag size.';
  else if (product && product.prices[size] === undefined) errors.grams = `${product.name} has no ${formatBagSize(size)} price yet: set it on the Products page first.`;
  const price = parseMoney(form.price.trim());
  if (typeof price !== 'number' || price <= 0) errors.price = 'Enter the price without VAT, e.g. 38 or 38,50.';
  if (product && size !== null && others.some((d) => d.productId === product.id && d.grams === size)) {
    errors.productId = `There is already a price for ${product.name} ${formatBagSize(size)}: change that one.`;
  }
  if (Object.keys(errors).length > 0 || !product || size === null || typeof price !== 'number') return { ok: false, errors };
  return {
    ok: true,
    fields: {
      client_id: clientId,
      product_id: product.id,
      bag_size_g: String(size),
      price_net_pln: moneyText(price),
      retail_gross_pln_at_deal: moneyText(product.prices[size] ?? 0),
    },
  };
}

/**
 * A new price for an existing deal: only the price is checked, so a deal whose product was deleted or has no price
 * for that size any more can still be changed. The retail price of today becomes its new starting point when there
 * is one (otherwise the old one is kept).
 */
export function dealPriceChange(deal: SpecialPrice, price: string, product: DealProduct | undefined): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  const grosze = parseMoney(price.trim());
  if (typeof grosze !== 'number' || grosze <= 0) return { ok: false, error: 'Enter the price without VAT, e.g. 38 or 38,50.' };
  const retail = product && product.deletedAt === '' && deal.grams !== null ? product.prices[deal.grams] : undefined;
  return { ok: true, fields: { price_net_pln: moneyText(grosze), ...(retail === undefined ? {} : { retail_gross_pln_at_deal: moneyText(retail) }) } };
}

/** A deleted deal can come back only when the client has no other deal for that product and size. */
export function canRestoreDeal(deal: SpecialPrice, deals: readonly SpecialPrice[]): boolean {
  return !dealsOf(deals, deal.clientId).some((d) => d.id !== deal.id && d.productId === deal.productId && d.grams === deal.grams);
}

/** Only the columns whose value differs from the deal as loaded (an edit writes only what changed). */
export function changedDealFields(deal: SpecialPrice, fields: Readonly<Record<string, string>>): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [column, value] of Object.entries(fields)) if (text(deal.source, column) !== value) changed[column] = value;
  return changed;
}
