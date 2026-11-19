// Products: what the roastery sells and offers, named however the owner likes (e.g. "Kenia", "Gwatemala Espresso").
// Not linked to lots (owner, 2026-11-17): each product has its own offer details and its own main (retail) gross
// prices per bag size. Pure: no Google, no screen. Rules: docs/REQUIREMENTS.md section 5.

import { moneyText, parseMoney } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize, type BagSize } from '../../domain/bagSizes';

type Fields = Readonly<Record<string, string>>;

export const PRODUCTS_TAB = 'Products';

const priceColumn = (grams: number) => `price_${grams}_gross_pln`;

export const PRODUCT_COLUMNS = [
  'name',
  'country',
  'region',
  'altitude',
  'processing',
  'variety',
  'flavour_profile',
  'brew_method',
  // Written out, as in migration 006: a new bag size needs a new migration before it gets a column.
  'price_250_gross_pln',
  'price_500_gross_pln',
  'price_1000_gross_pln',
  // Migration 011: the order set with ↑ ↓ on the Products page (owner, 2026-11-19); empty until the first move.
  'position',
] as const;

/** Suggestions for the brew method field (any text is allowed). */
export const BREW_METHODS = ['Espresso', 'Filtr'] as const;

export interface Product {
  readonly id: string;
  readonly row: number;
  readonly name: string;
  readonly country: string;
  readonly region: string;
  readonly altitude: string;
  readonly processing: string;
  readonly variety: string;
  readonly flavourProfile: string;
  readonly brewMethod: string;
  /** Main gross price per bag size, in grosze; a size without a (readable) price is missing. */
  readonly prices: Readonly<Partial<Record<BagSize, number>>>;
  /** Place in the owner's order (1 first); null until set (a new product, or before the first move). */
  readonly position: number | null;
  /** Cells Kraken could not read, one sentence each. */
  readonly problems: readonly string[];
  readonly deletedAt: string;
  readonly source: Fields;
}

const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

export function productFromFields(fields: Fields, row: number): Product {
  const name = text(fields, 'name');
  const problems: string[] = [];
  const prices: Partial<Record<BagSize, number>> = {};
  for (const grams of BAG_SIZES_G) {
    const cell = text(fields, priceColumn(grams));
    if (cell === '') continue;
    const grosze = parseMoney(cell);
    if (typeof grosze === 'number' && grosze > 0) prices[grams] = grosze;
    else problems.push(`The ${formatBagSize(grams)} price "${cell}" of ${name || `row ${row}`} cannot be read, so that size has no price. Edit the product to correct it.`);
  }
  return {
    id: text(fields, 'id'),
    row,
    name,
    country: text(fields, 'country'),
    region: text(fields, 'region'),
    altitude: text(fields, 'altitude'),
    processing: text(fields, 'processing'),
    variety: text(fields, 'variety'),
    flavourProfile: text(fields, 'flavour_profile'),
    brewMethod: text(fields, 'brew_method'),
    prices,
    position: positionOf(text(fields, 'position')),
    problems,
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

/** A whole number from 1; anything else (empty, typed by hand wrongly) is no position. */
function positionOf(cell: string): number | null {
  const n = Number(cell);
  return cell !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

export const isDeleted = (product: Product) => product.deletedAt !== '';

/**
 * The owner's order (owner, 2026-11-19: ↑ ↓ on the Products page, used by the Offer and everywhere products are
 * listed): active products by position, then those without one (new products) by name, Polish alphabetical order;
 * deleted ones last.
 */
export function sortProducts(products: readonly Product[]): Product[] {
  const place = (p: Product) => p.position ?? Number.POSITIVE_INFINITY;
  return [...products].sort(
    (a, b) => Number(isDeleted(a)) - Number(isDeleted(b)) || place(a) - place(b) || a.name.localeCompare(b.name, 'pl') || a.row - b.row,
  );
}

/**
 * Moving one product up (-1) or down (+1) in the order of the active products (`active`, as sortProducts gives
 * them): the positions to write, 1 to n in the new order, only where the stored one differs (the first move also
 * numbers every product). Nothing when it cannot move further.
 */
export function moveProduct(active: readonly Product[], id: string, by: -1 | 1): { product: Product; position: number }[] {
  const from = active.findIndex((p) => p.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= active.length) return [];
  const order = [...active];
  const [moved] = order.splice(from, 1);
  if (!moved) return [];
  order.splice(to, 0, moved);
  return order.flatMap((product, i) => (product.position === i + 1 ? [] : [{ product, position: i + 1 }]));
}

// ---- The form ----

export interface ProductForm {
  name: string;
  country: string;
  region: string;
  altitude: string;
  processing: string;
  variety: string;
  flavourProfile: string;
  brewMethod: string;
  price250: string;
  price500: string;
  price1000: string;
}

export type ProductFormErrors = Partial<Record<keyof ProductForm, string>>;

const TEXT_KEYS = {
  name: 'name',
  country: 'country',
  region: 'region',
  altitude: 'altitude',
  processing: 'processing',
  variety: 'variety',
  flavourProfile: 'flavour_profile',
  brewMethod: 'brew_method',
} as const satisfies Partial<Record<keyof ProductForm, string>>;

/** The form field of each size's price. */
export const PRICE_FIELDS = { 250: 'price250', 500: 'price500', 1000: 'price1000' } as const satisfies Readonly<Record<BagSize, keyof ProductForm>>;

const PRICE_KEYS = { price250: 250, price500: 500, price1000: 1000 } as const satisfies Partial<Record<keyof ProductForm, BagSize>>;

export const emptyProductForm = (): ProductForm => ({
  name: '',
  country: '',
  region: '',
  altitude: '',
  processing: '',
  variety: '',
  flavourProfile: '',
  brewMethod: '',
  price250: '',
  price500: '',
  price1000: '',
});

/** The form as the owner sees it: prices "45" or "45,90" (a price Kraken cannot read is shown as typed). */
export function formFromProduct(product: Product): ProductForm {
  const price = (grams: BagSize) => {
    const grosze = product.prices[grams];
    if (grosze === undefined) return text(product.source, priceColumn(grams));
    return moneyText(grosze).replace('.', ',');
  };
  return {
    name: product.name,
    country: product.country,
    region: product.region,
    altitude: product.altitude,
    processing: product.processing,
    variety: product.variety,
    flavourProfile: product.flavourProfile,
    brewMethod: product.brewMethod,
    price250: price(250),
    price500: price(500),
    price1000: price(1000),
  };
}

/** Checks the form; on success gives every column to store. */
export function validateProductForm(form: ProductForm): { ok: true; fields: Record<string, string> } | { ok: false; errors: ProductFormErrors } {
  const errors: ProductFormErrors = {};
  const fields: Record<string, string> = {};
  for (const [key, column] of Object.entries(TEXT_KEYS) as [keyof typeof TEXT_KEYS, string][]) {
    const value = form[key].trim().replace(/\s+/g, ' ');
    const max = key === 'name' ? 60 : 200;
    if (value.length > max) errors[key] = `At most ${max} characters.`;
    fields[column] = value;
  }
  if (fields['name'] === '') errors.name = 'Enter the name shown on the offer, e.g. Gwatemala.';
  for (const [key, grams] of Object.entries(PRICE_KEYS) as [keyof typeof PRICE_KEYS, BagSize][]) {
    const typed = form[key].trim();
    if (typed === '') {
      fields[priceColumn(grams)] = '';
      continue;
    }
    const grosze = parseMoney(typed);
    if (typeof grosze !== 'number' || grosze <= 0) errors[key] = 'Enter the gross price in zł, e.g. 45, or leave it empty.';
    else if (grosze > 1000000) errors[key] = 'That is more than 10 000 zł per bag; please check.';
    else fields[priceColumn(grams)] = moneyText(grosze);
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, fields };
}

/** Only the columns whose value differs from the product as loaded (an edit writes only what changed). */
export function changedProductFields(product: Product, fields: Readonly<Record<string, string>>): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [column, value] of Object.entries(fields)) {
    if (text(product.source, column) !== value) changed[column] = value;
  }
  return changed;
}
