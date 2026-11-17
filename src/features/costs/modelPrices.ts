// The Price list: the main (retail) price of each coffee and bag size, and the wholesale prices from it
// (docs/REQUIREMENTS.md section 5, owner's answers of 2026-11-16). Pure, so every step is tested.
//
//   main price          = gross, chosen by the owner (a suggested price, or typed); retail customers pay it
//   a coffee            = its country + coffee name on the Lots tab, so a new delivery keeps the price
//   price in use        = the newest price whose "valid from" date has come; old ones stay as history
//   wholesale net       = main gross ÷ (1 + VAT) × (1 − discount), rounded to whole złoty (half up)
//   wholesale gross     = wholesale net × (1 + VAT) (for the invoice)

import { isValidDate } from '../../core/dates';
import { moneyText, parseMoney } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize } from '../../domain/bagSizes';
import { grossOf, netOf, roundGrosze } from './modelCalc';

type Fields = Readonly<Record<string, string>>;

export const PRICE_LIST_TAB = 'Price list';
export const PRICE_COLUMNS = ['country', 'coffee_name', 'bag_size_g', 'price_gross_pln', 'valid_from'] as const;

const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

/**
 * Which coffee a lot or price belongs to: country and coffee name, ignoring capitals and extra spaces
 * ("Kenya" + "Kegwa" and "kenya" + " Kegwa " are the same coffee).
 */
export const coffeeKey = (country: string, name: string) =>
  [country, name].map((part) => part.trim().replace(/\s+/g, ' ').toLowerCase()).join('|');

export interface PriceEntry {
  readonly id: string;
  readonly row: number;
  readonly country: string;
  readonly coffeeName: string;
  readonly key: string;
  /** The bag size in grams; null if the cell cannot be read. */
  readonly grams: number | null;
  /** Gross price in grosze; null if the cell cannot be read. */
  readonly grossGrosze: number | null;
  readonly grossText: string;
  /** YYYY-MM-DD, as stored. */
  readonly validFrom: string;
  readonly deletedAt: string;
  readonly source: Fields;
}

export function priceFromFields(fields: Fields, row: number): PriceEntry {
  const gross = parseMoney(text(fields, 'price_gross_pln'));
  const grams = Number(text(fields, 'bag_size_g'));
  const country = text(fields, 'country');
  const coffeeName = text(fields, 'coffee_name');
  return {
    id: text(fields, 'id'),
    row,
    country,
    coffeeName,
    key: coffeeKey(country, coffeeName),
    grams: Number.isInteger(grams) && grams > 0 ? grams : null,
    grossGrosze: typeof gross === 'number' && gross > 0 ? gross : null,
    grossText: text(fields, 'price_gross_pln'),
    validFrom: text(fields, 'valid_from'),
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

/** A row Kraken cannot use, in one sentence; null if the row is fine. Deleted rows are never a problem. */
export function priceProblem(entry: PriceEntry): string | null {
  if (entry.deletedAt !== '') return null;
  const what = `Row ${entry.row} of the Price list tab`;
  if (entry.grossGrosze === null) return `${what} has the price "${entry.grossText}", which Kraken cannot read, so it is left out.`;
  if (entry.grams === null || !(BAG_SIZES_G as readonly number[]).includes(entry.grams)) {
    return `${what} has the bag size "${entry.source['bag_size_g'] ?? ''}", which is not ${BAG_SIZES_G.map(formatBagSize).join(', ')} (in grams: ${BAG_SIZES_G.join(', ')}), so it is left out.`;
  }
  if (!isValidDate(entry.validFrom)) return `${what} has the date "${entry.validFrom}", which is not a date (YYYY-MM-DD), so it is left out.`;
  return null;
}

/**
 * The price in use for a coffee and bag size on `today` (YYYY-MM-DD): the active, readable row with the latest
 * "valid from" date that has come. If two rows have the same date, the lower one in the tab (added later) wins, so
 * a price changed twice on one day shows the last one.
 */
export function currentPrice(entries: readonly PriceEntry[], key: string, grams: number, today: string): PriceEntry | null {
  let best: PriceEntry | null = null;
  for (const entry of entries) {
    if (entry.key !== key || entry.grams !== grams || entry.deletedAt !== '' || priceProblem(entry) !== null) continue;
    if (entry.validFrom > today) continue;
    if (!best || entry.validFrom > best.validFrom || (entry.validFrom === best.validFrom && entry.row > best.row)) best = entry;
  }
  return best;
}

/** Checks a gross price typed by the owner ("74", "74,90"); gives grosze. */
export function validatePrice(value: string): { ok: true; grosze: number } | { ok: false; error: string } {
  const grosze = parseMoney(value);
  if (typeof grosze !== 'number' || grosze <= 0) return { ok: false, error: 'Enter the gross price in zł, e.g. 74.' };
  if (grosze > 1000000) return { ok: false, error: 'That is more than 10 000 zł per bag; please check.' };
  return { ok: true, grosze };
}

/** The cells of a new price row. */
export const priceFields = (country: string, coffeeName: string, grams: number, grosze: number, today: string): Record<string, string> => ({
  country,
  coffee_name: coffeeName,
  bag_size_g: String(grams),
  price_gross_pln: moneyText(grosze),
  valid_from: today,
});

/** A wholesale price: net rounded to whole złoty (what the customer is offered), and its gross for the invoice. */
export interface WholesalePrice {
  /** Grosze, a multiple of 100. */
  readonly net: number;
  /** Grosze, not rounded. */
  readonly gross: number;
}

export function wholesalePrice(mainGrossGrosze: number, discountTenths: number, vatTenths: number): WholesalePrice {
  // Rounded once, from the exact amount (no amount before rounding is shown here, so none to agree with).
  const net = roundGrosze((netOf(mainGrossGrosze, vatTenths) * (1000 - discountTenths)) / 100000) * 100;
  return { net, gross: grossOf(net, vatTenths) };
}
