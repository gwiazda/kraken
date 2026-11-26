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
  // Migration 011: the order set by dragging on the Products page (owner, 2026-11-19); empty until the first move.
  'position',
  // Migration 014: on sale (empty), trial or withdrawn (owner, 2026-11-26).
  'status',
] as const;

/**
 * Where a product is (owner, 2026-11-26): on sale ("W sprzedaży"), a trial ("Próbne") or withdrawn ("Wycofane").
 * Only products on sale go on an offer. Stored in the "status" column: empty for on sale (so the products from before
 * the column stay on sale), "trial", "retired".
 */
export type ProductStatus = 'on_sale' | 'trial' | 'retired';
export const PRODUCT_STATUSES: readonly ProductStatus[] = ['on_sale', 'trial', 'retired'];
export const STATUS_LABELS: Readonly<Record<ProductStatus, string>> = { on_sale: 'W sprzedaży', trial: 'Próbne', retired: 'Wycofane' };
const STATUS_CELLS: Readonly<Record<ProductStatus, string>> = { on_sale: '', trial: 'trial', retired: 'retired' };

/** The status in a cell; null when it cannot be read. "on_sale" typed by hand is read too. */
function statusOf(cell: string): ProductStatus | null {
  if (cell === '' || cell === 'on_sale') return 'on_sale';
  return cell === 'trial' || cell === 'retired' ? cell : null;
}

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
  /** null when the cell cannot be read (then it shows with the products on sale, but never goes on an offer). */
  readonly status: ProductStatus | null;
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
    else problems.push(`Nie da się odczytać ceny za ${formatBagSize(grams)} „${cell}” (${name || `wiersz ${row}`}), więc ta wielkość nie ma ceny. Popraw ją w produkcie.`);
  }
  const statusCell = text(fields, 'status');
  const status = statusOf(statusCell);
  if (status === null) problems.push(`Nie da się odczytać statusu „${statusCell}” (${name || `wiersz ${row}`}), więc produkt nie trafia do oferty. Wybierz status w produkcie.`);
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
    status,
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
 * The owner's order (owner, 2026-11-19: dragged on the Products page, used by the Offer and everywhere products are
 * listed): active products by position, then those without one (new products) by name, Polish alphabetical order;
 * deleted ones last.
 */
export function sortProducts(products: readonly Product[]): Product[] {
  const place = (p: Product) => p.position ?? Number.POSITIVE_INFINITY;
  return [...products].sort(
    (a, b) => Number(isDeleted(a)) - Number(isDeleted(b)) || place(a) - place(b) || a.name.localeCompare(b.name, 'pl') || a.row - b.row,
  );
}

/** True for a product that can go on an offer: on sale (owner, 2026-11-26), not deleted. */
export const isOnSale = (product: Product) => product.status === 'on_sale' && !isDeleted(product);

/**
 * The Products list in sections (owner, 2026-11-26): on sale (with those whose status cannot be read), trial,
 * withdrawn; each in the owner's order, without deleted products.
 */
export function productSections(products: readonly Product[]): { status: ProductStatus; products: Product[] }[] {
  const active = sortProducts(products).filter((p) => !isDeleted(p));
  return PRODUCT_STATUSES.map((status) => ({ status, products: active.filter((p) => (p.status ?? 'on_sale') === status) }));
}

/**
 * The whole order after a product is moved inside its section (`section`: that section's ids, in order) to place
 * `to` of the section: the section's products take the same places in the whole order as before, so the other
 * sections never move.
 */
export function movedWithin(order: readonly string[], section: readonly string[], id: string, to: number): string[] {
  const moved = movedOrder(section, id, to);
  const inSection = new Set(section);
  let next = 0;
  return order.map((other) => (inSection.has(other) ? (moved[next++] ?? other) : other));
}

/** The ids in a new order: `id` moved to place `to` (0 = first). The same order when it cannot move there. */
export function movedOrder(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || to < 0 || to >= ids.length || to === from) return [...ids];
  const order = ids.filter((other) => other !== id);
  order.splice(to, 0, id);
  return order;
}

/**
 * The positions to write so the products (as last saved) follow `order` (ids, first first): 1 to n, only where the
 * stored position differs (the first move also numbers every product). Ids no longer there are skipped.
 */
export function positionChanges(products: readonly Product[], order: readonly string[]): { product: Product; position: number }[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return order.flatMap((id, i) => {
    const product = byId.get(id);
    return product && product.position !== i + 1 ? [{ product, position: i + 1 }] : [];
  });
}

/** The products as shown right after a move, before it is saved: each in `order` gets its new position. */
export function withOrder(products: readonly Product[], order: readonly string[]): Product[] {
  const place = new Map(order.map((id, i) => [id, i + 1]));
  return products.map((p) => (place.has(p.id) ? { ...p, position: place.get(p.id) ?? null } : p));
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
  /** A ProductStatus, or KEEP_STATUS: leave a stored status Kraken cannot read as it is. */
  status: string;
}

/** The form's value for "keep the status cell as it is" (it cannot be read; the owner corrects it on purpose). */
export const KEEP_STATUS = 'keep';

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
  status: 'on_sale',
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
    status: product.status ?? KEEP_STATUS,
  };
}

/** Checks the form; on success gives every column to store. */
export function validateProductForm(form: ProductForm): { ok: true; fields: Record<string, string> } | { ok: false; errors: ProductFormErrors } {
  const errors: ProductFormErrors = {};
  const fields: Record<string, string> = {};
  for (const [key, column] of Object.entries(TEXT_KEYS) as [keyof typeof TEXT_KEYS, string][]) {
    const value = form[key].trim().replace(/\s+/g, ' ');
    const max = key === 'name' ? 60 : 200;
    if (value.length > max) errors[key] = `Najwyżej ${max} znaków.`;
    fields[column] = value;
  }
  if (fields['name'] === '') errors.name = 'Wpisz nazwę widoczną w ofercie, np. Gwatemala.';
  for (const [key, grams] of Object.entries(PRICE_KEYS) as [keyof typeof PRICE_KEYS, BagSize][]) {
    const typed = form[key].trim();
    if (typed === '') {
      fields[priceColumn(grams)] = '';
      continue;
    }
    const grosze = parseMoney(typed);
    if (typeof grosze !== 'number' || grosze <= 0) errors[key] = 'Wpisz cenę brutto w zł, np. 45, albo zostaw puste.';
    else if (grosze > 1000000) errors[key] = 'To ponad 10 000 zł za torebkę; sprawdź, proszę.';
    else fields[priceColumn(grams)] = moneyText(grosze);
  }
  if ((PRODUCT_STATUSES as readonly string[]).includes(form.status)) fields['status'] = STATUS_CELLS[form.status as ProductStatus];
  else if (form.status !== KEEP_STATUS) errors.status = 'Wybierz status.'; // KEEP_STATUS: the cell is not written
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
