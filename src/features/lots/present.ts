// What the Lots screen shows, as plain text. Pure (no screen, no Google), so it is tested directly.

import { localDate } from '../../core/dates';
import { formatKg, formatPln, parseKg, parseMoney } from '../../core/numbers';
import { greenPricePerKg, isDeleted, lotSource, priceMissing, sortLots, suggestCode, type Lot, type LotForm } from './model';

export interface LotListRow {
  readonly lot: Lot;
  readonly code: string;
  readonly name: string;
  readonly country: string;
  readonly delivered: string;
  readonly quantity: string;
  /** "77,01 zł", or null when the price (or quantity) is missing. */
  readonly pricePerKg: string | null;
  readonly priceMissing: boolean;
  readonly supplier: string;
  /** "RoasTime" (imported) or "By hand". */
  readonly source: string;
  /** Problems with this lot's cells, one sentence each. */
  readonly problems: readonly string[];
  /** Deleted lots are only listed with "Show deleted", greyed out, with Restore. */
  readonly deleted: boolean;
  /** "Deleted 2026-11-16" for deleted lots, else ''. */
  readonly deletedNote: string;
}

const DASH = '—';

/** The lots to show, newest delivery first: active ones, plus deleted ones when `showDeleted` is on. */
export function lotListRows(lots: readonly Lot[], showDeleted = false): LotListRow[] {
  return sortLots(lots.filter((lot) => showDeleted || !isDeleted(lot))).map((lot) => {
    const perKg = greenPricePerKg(lot);
    return {
      lot,
      code: lot.code || DASH,
      name: lot.name || DASH,
      country: lot.country || DASH,
      delivered: lot.deliveryDate || DASH,
      quantity: lot.quantityGrams === null ? DASH : formatKg(lot.quantityGrams),
      pricePerKg: perKg === null ? null : formatPln(perKg),
      priceMissing: priceMissing(lot),
      supplier: lot.supplier || DASH,
      source: lotSource(lot),
      problems: lot.problems,
      deleted: isDeleted(lot),
      deletedNote: isDeleted(lot) ? deletedNote(lot.deletedAt) : '',
    };
  });
}

/** The live "Green price per kg" line under the form, or null until price and quantity are readable. */
export function formPricePerKg(form: Pick<LotForm, 'coffeePrice' | 'deliveryCost' | 'quantityKg'>): string | null {
  const price = parseMoney(form.coffeePrice);
  const delivery = parseMoney(form.deliveryCost);
  const grams = parseKg(form.quantityKg);
  if (typeof price !== 'number' || delivery === undefined || typeof grams !== 'number') return null;
  const perKg = greenPricePerKg({ coffeePriceGrosze: price, deliveryCostGrosze: delivery, quantityGrams: grams });
  return perKg === null ? null : formatPln(perKg);
}

/**
 * The code field after the country or date changed: Kraken keeps suggesting a code until the user types one
 * themselves (`codeTyped`). `otherCodes` are the codes of all other lots, deleted ones included.
 */
export function codeAfterChange(form: LotForm, codeTyped: boolean, otherCodes: readonly string[]): string {
  return codeTyped ? form.code : suggestCode(form.country, form.deliveryDate, otherCodes);
}

/** How many lots are deleted (for the "Show deleted (2)" switch). */
export const deletedCount = (lots: readonly Lot[]) => lots.filter(isDeleted).length;

/** "Deleted 2026-11-16", on the local calendar (a lot deleted just after midnight shows the right day). */
export function deletedNote(deletedAt: string): string {
  const time = new Date(deletedAt);
  return Number.isNaN(time.getTime()) ? 'Deleted' : `Deleted ${localDate(time)}`;
}
