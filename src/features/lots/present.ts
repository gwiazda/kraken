// What the Lots screen shows, as plain text. Pure (no screen, no Google), so it is tested directly.

import { formatDate, localDate } from '../../core/dates';
import { formatKg, formatPln, toDecimalText } from '../../core/numbers';
import { greenPricePerKg, isDeleted, lotSource, sortLots, suggestCode, type Lot, type LotForm } from './model';

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
  /** What 1 kg of green coffee cost: "77,00 zł"; '' when the price or the quantity is missing. */
  readonly pricePerKg: string;
  /** The roast loss in use: "16 %"; '' when not known (deleted lots). */
  readonly loss: string;
  /** Where it comes from: "average of 23 roasts", "your own", … */
  readonly lossNote: string;
  /** True when the loss is the owner's own number for this lot (not the average of its roasts). */
  readonly lossOwn: boolean;
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

/** Roast loss per lot ID (from Packaging & discounts' calculation, given through LotsPageDeps). */
export type LossByLot = ReadonlyMap<string, { readonly lossTenths: number; readonly source: string; readonly own: string }>;

/** "16 %", "14,2 %" */
export const formatLoss = (tenths: number) => `${toDecimalText(tenths, 1).replace('.', ',')} %`;

/** "21,5 kg", "−2,4 kg" */
export function formatSignedKg(grams: number): string {
  return grams < 0 ? `−${formatKg(-grams)}` : formatKg(grams);
}

/** The lots to show, newest delivery first: active ones, plus deleted ones when `showDeleted` is on. */
export function lotListRows(lots: readonly Lot[], showDeleted = false, stock: StockByLot = new Map(), losses: LossByLot = new Map()): LotListRow[] {
  return sortLots(lots.filter((lot) => showDeleted || !isDeleted(lot))).map((lot) => {
    const perKg = greenPricePerKg(lot);
    const loss = losses.get(lot.id);
    return {
      lot,
      code: lot.code || DASH,
      name: lot.name || DASH,
      country: lot.country || DASH,
      delivered: formatDate(lot.deliveryDate) || DASH,
      quantity: lot.quantityGrams === null ? DASH : formatKg(lot.quantityGrams),
      supplier: lot.supplier || DASH,
      source: lotSource(lot),
      ...stockOf(lot, stock),
      pricePerKg: perKg === null ? '' : formatPln(perKg),
      loss: loss ? formatLoss(loss.lossTenths) : '',
      lossNote: loss?.source ?? '',
      lossOwn: loss !== undefined && loss.own !== '',
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
  return Number.isNaN(time.getTime()) ? 'Usunięta' : `Usunięta ${formatDate(localDate(time))}`;
}

function stockOf(lot: Lot, stock: StockByLot): Pick<LotListRow, 'stockLeft' | 'overdrawn' | 'stockNote'> {
  const entry = stock.get(lot.id);
  const left = entry ? entry.leftGrams : lot.quantityGrams; // deleted lots have no entry: nothing is counted on them
  if (left === null) return { stockLeft: DASH, overdrawn: false, stockNote: '' };
  if (left >= 0) return { stockLeft: formatKg(left), overdrawn: false, stockNote: '' };
  return {
    stockLeft: formatSignedKg(left),
    overdrawn: true,
    stockNote: `${lot.code}: wypalono o ${formatKg(-left)} więcej, niż dostarczono. Sprawdź dostawy albo kawę wybraną w RoasTime.`,
  };
}
