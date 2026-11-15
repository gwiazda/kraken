// What the Lots screen shows, as plain text. Pure (no screen, no Google), so it is tested directly.

import { localDate } from '../../core/dates';
import { formatKg } from '../../core/numbers';
import { isDeleted, lotSource, sortLots, suggestCode, type Lot, type LotForm } from './model';

export interface LotListRow {
  readonly lot: Lot;
  readonly code: string;
  readonly name: string;
  readonly country: string;
  readonly delivered: string;
  readonly quantity: string;
  readonly supplier: string;
  /** "RoasTime" (imported) or "By hand". */
  readonly source: string;
  /** Green coffee left, e.g. "21,5 kg" or "−2,4 kg"; "—" if unknown. */
  readonly stockLeft: string;
  /** More was roasted than delivered (stock below zero). */
  readonly overdrawn: boolean;
  /** e.g. "2,4 kg more roasted than delivered: check the lots or the coffee chosen in RoasTime." */
  readonly stockNote: string;
  /** Problems with this lot's cells, one sentence each. */
  readonly problems: readonly string[];
  /** Deleted lots are only listed with "Show deleted", greyed out, with Restore. */
  readonly deleted: boolean;
  /** "Deleted 2026-11-16" for deleted lots, else ''. */
  readonly deletedNote: string;
}

const DASH = '—';

/** Green stock per lot ID, counted from the roasts (see features/roasts allocation). */
export type StockByLot = ReadonlyMap<string, { readonly usedGrams: number; readonly leftGrams: number | null }>;

/** "21,5 kg", "−2,4 kg" */
export function formatSignedKg(grams: number): string {
  return grams < 0 ? `−${formatKg(-grams)}` : formatKg(grams);
}

/** The lots to show, newest delivery first: active ones, plus deleted ones when `showDeleted` is on. */
export function lotListRows(lots: readonly Lot[], showDeleted = false, stock: StockByLot = new Map()): LotListRow[] {
  return sortLots(lots.filter((lot) => showDeleted || !isDeleted(lot))).map((lot) => {
    return {
      lot,
      code: lot.code || DASH,
      name: lot.name || DASH,
      country: lot.country || DASH,
      delivered: lot.deliveryDate || DASH,
      quantity: lot.quantityGrams === null ? DASH : formatKg(lot.quantityGrams),
      supplier: lot.supplier || DASH,
      source: lotSource(lot),
      ...stockOf(lot, stock),
      problems: lot.problems,
      deleted: isDeleted(lot),
      deletedNote: isDeleted(lot) ? deletedNote(lot.deletedAt) : '',
    };
  });
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

function stockOf(lot: Lot, stock: StockByLot): Pick<LotListRow, 'stockLeft' | 'overdrawn' | 'stockNote'> {
  const entry = stock.get(lot.id);
  const left = entry ? entry.leftGrams : lot.quantityGrams; // deleted lots have no entry: nothing is counted on them
  if (left === null) return { stockLeft: DASH, overdrawn: false, stockNote: '' };
  if (left >= 0) return { stockLeft: formatKg(left), overdrawn: false, stockNote: '' };
  return {
    stockLeft: formatSignedKg(left),
    overdrawn: true,
    stockNote: `${lot.code}: ${formatKg(-left)} more roasted than delivered. Check the lots, or the coffee chosen in RoasTime.`,
  };
}
