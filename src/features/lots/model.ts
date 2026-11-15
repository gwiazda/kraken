// Green coffee lots: one lot = one delivery. Pure logic only (no Google, no screen), so all of it is tested directly.
// Columns agreed with the owner on 2026-11-15, see docs/REQUIREMENTS.md section 1.

import { localDate } from '../../core/dates';
import { divideRounded, kgText, moneyText, parseKg, parseMoney } from '../../core/numbers';

/** The Lots columns a feature writes (the safety columns id, created_at, … are handled by the table). */
export const LOT_COLUMNS = [
  'code',
  'name',
  'country',
  'region',
  'altitude',
  'process',
  'variety',
  'supplier',
  'delivery_date',
  'quantity_kg',
  'coffee_price_net_pln',
  'delivery_cost_net_pln',
  'notes',
  'roastime_container_id',
  'roastime_bean_id',
  'roastime_supplier_code',
] as const;

export const LOTS_TAB = 'Lots';

export interface Lot {
  readonly id: string;
  /** Row in the sheet, for messages (0 = not known yet, e.g. just added). */
  readonly row: number;
  readonly code: string;
  readonly name: string;
  readonly country: string;
  readonly region: string;
  readonly altitude: string;
  readonly process: string;
  readonly variety: string;
  readonly supplier: string;
  /** YYYY-MM-DD */
  readonly deliveryDate: string;
  /** Delivered green coffee in grams; null if missing or unreadable. */
  readonly quantityGrams: number | null;
  /** Whole delivery, net, in grosze; null = not entered yet ("Price missing"). */
  readonly coffeePriceGrosze: number | null;
  /** Whole delivery, net, in grosze; null = none. */
  readonly deliveryCostGrosze: number | null;
  readonly notes: string;
  readonly roastime: { readonly containerId: string; readonly beanId: string; readonly supplierCode: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  /** Empty = active. A time = deleted then (soft delete). */
  readonly deletedAt: string;
  /** Cells Kraken could not read (e.g. "abc" typed in the kg column), explained for the user. */
  readonly problems: readonly string[];
  /** The row's fields exactly as loaded, so an edit writes only what changed and spots changes made meanwhile. */
  readonly source: Readonly<Record<string, string>>;
}

type Fields = Readonly<Record<string, string>>;

/** Turns a stored row into a Lot. A broken number never stops the page: the lot is shown with a problem note. */
export function lotFromFields(fields: Fields, row: number): Lot {
  const text = (name: string) => (fields[name] ?? '').trim();
  const problems: string[] = [];
  const number = (name: string, label: string, parse: (t: string) => number | null | undefined): number | null => {
    const value = parse(text(name));
    if (value === undefined) {
      problems.push(`${label} "${text(name)}" in row ${row} is not a number Kraken can read.`);
      return null;
    }
    return value;
  };
  const deliveryDate = text('delivery_date');
  if (deliveryDate !== '' && !isValidDate(deliveryDate)) problems.push(`Delivery date "${deliveryDate}" in row ${row} is not a date (YYYY-MM-DD).`);
  return {
    id: text('id'),
    row,
    code: text('code'),
    name: text('name'),
    country: text('country'),
    region: text('region'),
    altitude: text('altitude'),
    process: text('process'),
    variety: text('variety'),
    supplier: text('supplier'),
    deliveryDate,
    quantityGrams: number('quantity_kg', 'Quantity', parseKg),
    coffeePriceGrosze: number('coffee_price_net_pln', 'Coffee price', parseMoney),
    deliveryCostGrosze: number('delivery_cost_net_pln', 'Delivery cost', parseMoney),
    notes: fields.notes ?? '',
    roastime: { containerId: text('roastime_container_id'), beanId: text('roastime_bean_id'), supplierCode: text('roastime_supplier_code') },
    createdAt: text('created_at'),
    updatedAt: fields.updated_at ?? '',
    createdBy: text('created_by'),
    deletedAt: text('deleted_at'),
    problems,
    source: fields,
  };
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const isDeleted = (lot: Lot) => lot.deletedAt !== '';

/** Where a lot came from: imported from RoasTime (it has RoasTime's delivery ID) or entered by hand in Kraken. */
export const lotSource = (lot: Lot): 'RoasTime' | 'By hand' => (lot.roastime.containerId !== '' ? 'RoasTime' : 'By hand');

/** "Price missing": the coffee price has not been entered yet (it is never imported from RoasTime). */
export const priceMissing = (lot: Lot) => lot.coffeePriceGrosze === null;

/** Green price per kg in grosze = (coffee price + delivery cost) ÷ kg delivered. Null if price or quantity is missing. */
export function greenPricePerKg(lot: Pick<Lot, 'coffeePriceGrosze' | 'deliveryCostGrosze' | 'quantityGrams'>): number | null {
  if (lot.coffeePriceGrosze === null || lot.quantityGrams === null || lot.quantityGrams === 0) return null;
  return divideRounded((lot.coffeePriceGrosze + (lot.deliveryCostGrosze ?? 0)) * 1000, lot.quantityGrams);
}

/** Country name as a code part: "Kenya" → "KENYA", "El Salvador" → "EL-SALVADOR", "Perú" → "PERU". */
export function countryCode(country: string): string {
  return country
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Suggested lot code: COUNTRY-YY-MM from the delivery date, e.g. KENYA-26-11. A second lot in the same month gets
 * -B, then -C… Codes of deleted lots count too, so a restored lot never clashes. Empty if country or date is missing.
 */
export function suggestCode(country: string, deliveryDate: string, existingCodes: readonly string[]): string {
  const base = countryCode(country);
  if (base === '' || !isValidDate(deliveryDate)) return '';
  const code = `${base}-${deliveryDate.slice(2, 4)}-${deliveryDate.slice(5, 7)}`;
  const taken = new Set(existingCodes.map((c) => c.trim().toUpperCase()));
  if (!taken.has(code)) return code;
  for (let i = 1; i < 26; i++) {
    const candidate = `${code}-${String.fromCharCode(65 + i)}`;
    if (!taken.has(candidate)) return candidate;
  }
  for (let n = 2; ; n++) if (!taken.has(`${code}-${n}`)) return `${code}-${n}`;
}

/** What the user typed in the lot form, as text. */
export interface LotForm {
  code: string;
  name: string;
  country: string;
  region: string;
  altitude: string;
  process: string;
  variety: string;
  supplier: string;
  deliveryDate: string;
  quantityKg: string;
  coffeePrice: string;
  deliveryCost: string;
  notes: string;
}

export const emptyLotForm = (today: Date): LotForm => ({
  code: '',
  name: '',
  country: '',
  region: '',
  altitude: '',
  process: '',
  variety: '',
  supplier: '',
  deliveryDate: localDate(today),
  quantityKg: '',
  coffeePrice: '',
  deliveryCost: '',
  notes: '',
});

/** The form for editing an existing lot. */
export function formFromLot(lot: Lot): LotForm {
  // A cell Kraken could not read is shown exactly as typed, so saving never wipes it: the form check then asks
  // the user to correct it.
  const raw = (column: string) => (lot.source[column] ?? '').trim();
  return {
    code: lot.code,
    name: lot.name,
    country: lot.country,
    region: lot.region,
    altitude: lot.altitude,
    process: lot.process,
    variety: lot.variety,
    supplier: lot.supplier,
    deliveryDate: lot.deliveryDate,
    quantityKg: lot.quantityGrams === null ? raw('quantity_kg') : kgText(lot.quantityGrams),
    coffeePrice: lot.coffeePriceGrosze === null ? raw('coffee_price_net_pln') : moneyText(lot.coffeePriceGrosze),
    deliveryCost: lot.deliveryCostGrosze === null ? raw('delivery_cost_net_pln') : moneyText(lot.deliveryCostGrosze),
    notes: lot.notes,
  };
}

export type LotFormErrors = Partial<Record<keyof LotForm, string>>;

const MAX_CODE = 40;
const MAX_TEXT = 200;
const MAX_NOTES = 2000;

/**
 * Checks the form. Returns the fields to store (normalised: code in capitals, numbers as "1234.56"), or the errors
 * per field. `others` are all other lots, deleted ones included (codes must stay unique for a restore).
 */
export function validateLotForm(form: LotForm, others: readonly Lot[]): { ok: true; fields: Record<string, string> } | { ok: false; errors: LotFormErrors } {
  const errors: LotFormErrors = {};
  const f = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, k === 'notes' ? v : v.trim()])) as unknown as LotForm;

  const code = f.code.toUpperCase().replace(/\s+/g, '-');
  if (code === '') errors.code = 'Enter a code, e.g. KENYA-26-11.';
  else if (!/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(code)) errors.code = 'Use only letters A–Z, digits and dashes.';
  else if (code.length > MAX_CODE) errors.code = `Use at most ${MAX_CODE} characters.`;
  else if (others.some((lot) => lot.code.toUpperCase() === code)) errors.code = `Another lot already has the code ${code}.`;

  if (f.name === '') errors.name = 'Enter the coffee name.';
  if (f.country === '') errors.country = 'Enter the country.';
  if (f.deliveryDate === '') errors.deliveryDate = 'Enter the delivery date.';
  else if (!isValidDate(f.deliveryDate)) errors.deliveryDate = 'Use a real date, e.g. 2026-11-03.';

  const grams = parseKg(f.quantityKg);
  if (grams === null) errors.quantityKg = 'Enter how many kg were delivered.';
  else if (grams === undefined) errors.quantityKg = 'Enter a number, e.g. 60 or 59,5 (up to 3 decimals).';
  else if (grams === 0) errors.quantityKg = 'The quantity must be more than 0.';

  const price = parseMoney(f.coffeePrice);
  if (price === undefined) errors.coffeePrice = 'Enter an amount, e.g. 4500 or 4500,50 — or leave it empty for now.';
  const delivery = parseMoney(f.deliveryCost);
  if (delivery === undefined) errors.deliveryCost = 'Enter an amount, e.g. 120 — or leave it empty if there was none.';

  for (const key of ['name', 'country', 'region', 'altitude', 'process', 'variety', 'supplier'] as const) {
    if (f[key].length > MAX_TEXT) errors[key] = `Use at most ${MAX_TEXT} characters.`;
  }
  if (f.notes.length > MAX_NOTES) errors.notes = `Use at most ${MAX_NOTES} characters.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      code,
      name: f.name,
      country: f.country,
      region: f.region,
      altitude: f.altitude,
      process: f.process,
      variety: f.variety,
      supplier: f.supplier,
      delivery_date: f.deliveryDate,
      quantity_kg: kgText(grams ?? 0),
      coffee_price_net_pln: price == null ? '' : moneyText(price),
      delivery_cost_net_pln: delivery == null ? '' : moneyText(delivery),
      notes: f.notes,
    },
  };
}

/**
 * Checks the lot form of the Lots page, which has no price fields (owner, 2026-11-16: prices are edited under
 * Costs & prices). The prices are left out of the check and of the fields to store, so they are never touched here.
 */
export function validateLotDetails(form: LotForm, others: readonly Lot[]): ReturnType<typeof validateLotForm> {
  const result = validateLotForm({ ...form, coffeePrice: '', deliveryCost: '' }, others);
  if (!result.ok) return result;
  const { coffee_price_net_pln: _price, delivery_cost_net_pln: _delivery, ...fields } = result.fields;
  return { ok: true, fields };
}

/** Newest delivery first; same day by code. */
export function sortLots(lots: readonly Lot[]): Lot[] {
  return [...lots].sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate) || a.code.localeCompare(b.code));
}

/** Which column each form field is stored in. */
export const FORM_COLUMNS: Readonly<Record<keyof LotForm, string>> = {
  code: 'code',
  name: 'name',
  country: 'country',
  region: 'region',
  altitude: 'altitude',
  process: 'process',
  variety: 'variety',
  supplier: 'supplier',
  deliveryDate: 'delivery_date',
  quantityKg: 'quantity_kg',
  coffeePrice: 'coffee_price_net_pln',
  deliveryCost: 'delivery_cost_net_pln',
  notes: 'notes',
};

/**
 * For an edit: only the stored values of fields the user actually changed in the form. Untouched fields are not
 * rewritten (not even tidied up, e.g. a code typed in small letters in the sheet stays as it is).
 */
export function changedFields(initial: LotForm, form: LotForm, fields: Readonly<Record<string, string>>): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const key of Object.keys(FORM_COLUMNS) as (keyof LotForm)[]) {
    const column = FORM_COLUMNS[key];
    if (form[key] !== initial[key] && column in fields) changed[column] = fields[column] ?? '';
  }
  return changed;
}
