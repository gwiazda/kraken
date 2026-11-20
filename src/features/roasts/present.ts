// What the Roasts screen shows, as plain text. Pure, so it is tested directly.

import { localDate } from '../../core/dates';
import { formatKg } from '../../core/numbers';
import type { Lot } from '../lots';
import type { Allocation, RoastAllocation } from './allocation';
import { fromRoastime, isRoastDeleted, roastLossPermille, roastTimeText, sortRoastsOldestFirst, type Roast } from './model';

export interface RoastListRow {
  readonly roast: Roast;
  readonly when: string;
  readonly name: string;
  /** The coffee: the name of a lot of the same RoasTime coffee, or of the chosen lot. */
  readonly coffee: string;
  readonly green: string;
  readonly roasted: string;
  /** "14,5 %" or "—". */
  readonly loss: string;
  /** "KENYA-26-09" or "KENYA-26-09 0,5 kg + KENYA-26-11 0,7 kg", or why it is not counted. */
  readonly lots: string;
  /** For the Lot filter: the codes of the lots it is counted in, or why it is not counted ("Not counted: …"). */
  readonly lotCodes: readonly string[];
  /** For the filters, the same values as shown: the day roasted (YYYY-MM-DD, '' if unknown), the green and the
   * roasted weight in grams (roasted rounded to the gram, as shown), the loss in tenths of a percent. */
  readonly day: string;
  readonly greenGrams: number | null;
  readonly roastedGrams: number | null;
  readonly lossTenths: number | null;
  /** The badges shown in the row ("Needs a lot", "Sample", …), so the search finds them too. */
  readonly marks: readonly string[];
  readonly counted: boolean;
  /** No coffee and no lot, and not marked as a sample: the owner should choose a lot (or mark it as a sample). */
  readonly needsLot: boolean;
  readonly chosen: boolean;
  readonly beforeDelivery: boolean;
  readonly sample: boolean;
  readonly source: 'RoasTime' | 'By hand';
  readonly deleted: boolean;
  readonly problems: readonly string[];
}

const DASH = '—';

const NOT_COUNTED: Record<Extract<RoastAllocation, { status: 'not-counted' }>['reason'], string> = {
  'no-coffee': 'Not counted: no coffee chosen',
  'no-lot-for-coffee': 'Not counted: no lot of this coffee in Kraken',
  'no-green-weight': 'Not counted: no green weight',
};

/** "14,5 %" */
export function formatLoss(permille: number | null): string {
  if (permille === null) return DASH;
  const sign = permille < 0 ? '−' : '';
  const value = Math.abs(permille);
  return `${sign}${Math.floor(value / 10)},${value % 10} %`;
}

/** Newest roast first; deleted ones only when `showDeleted`. */
export function roastListRows(roasts: readonly Roast[], lots: readonly Lot[], allocation: Allocation, showDeleted = false): RoastListRow[] {
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const coffeeByBean = new Map<string, string>();
  for (const lot of lots) if (lot.roastime.beanId !== '' && !coffeeByBean.has(lot.roastime.beanId)) coffeeByBean.set(lot.roastime.beanId, lot.name);
  return sortRoastsOldestFirst(roasts.filter((roast) => showDeleted || !isRoastDeleted(roast)))
    .reverse()
    .map((roast) => {
      const allocated = allocation.roasts.get(roast.id);
      const counted = allocated !== undefined && allocated.status !== 'not-counted';
      const chosenLot = roast.lotId !== '' ? lotById.get(roast.lotId) : undefined;
      let lotsText = DASH;
      let lotCodes: string[] = [];
      if (allocated && allocated.status !== 'not-counted') {
        lotCodes = allocated.parts.map((p) => lotById.get(p.lotId)?.code ?? '?');
        lotsText =
          allocated.parts.length === 1
            ? (lotById.get(allocated.parts[0]?.lotId ?? '')?.code ?? '?')
            : allocated.parts.map((p) => `${lotById.get(p.lotId)?.code ?? '?'} ${formatKg(p.grams)}`).join(' + ');
      } else if (allocated) {
        lotsText = NOT_COUNTED[allocated.reason];
        lotCodes = [lotsText];
      }
      const needsLot = allocated?.status === 'not-counted' && allocated.reason !== 'no-green-weight' && !roast.sample;
      const chosen = allocated?.status === 'chosen';
      const beforeDelivery = allocated !== undefined && allocated.status !== 'not-counted' && allocated.beforeDelivery;
      const roastedGrams = roast.roastedDecigrams === null ? null : Math.round(roast.roastedDecigrams / 10);
      return {
        roast,
        when: roastTimeText(roast.roastedAt) || DASH,
        day: roast.roastedAt ? localDate(roast.roastedAt) : '',
        greenGrams: roast.greenGrams,
        roastedGrams,
        lossTenths: roastLossPermille(roast),
        marks: [
          ...(roast.sample ? ['Sample'] : []),
          ...(needsLot ? ['Needs a lot'] : []),
          ...(beforeDelivery ? ['Before delivery'] : []),
          ...(chosen ? ['Chosen'] : []),
          ...(roast.problems.length > 0 ? ['Check'] : []),
        ],
        name: roast.name || DASH,
        coffee: chosenLot?.name || coffeeByBean.get(roast.roastime.beanId) || (roast.roastime.beanId === '' ? 'No coffee chosen' : 'Coffee not in Kraken'),
        green: roast.greenGrams === null ? DASH : formatKg(roast.greenGrams),
        roasted: roastedGrams === null ? DASH : formatKg(roastedGrams),
        loss: formatLoss(roastLossPermille(roast)),
        lots: lotsText,
        lotCodes,
        counted,
        needsLot,
        chosen,
        beforeDelivery,
        sample: roast.sample,
        source: fromRoastime(roast) ? 'RoasTime' : 'By hand',
        deleted: isRoastDeleted(roast),
        problems: roast.problems,
      };
    });
}
