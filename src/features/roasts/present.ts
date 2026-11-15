// What the Roasts screen shows, as plain text. Pure, so it is tested directly.

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
      if (allocated && allocated.status !== 'not-counted') {
        lotsText =
          allocated.parts.length === 1
            ? (lotById.get(allocated.parts[0]?.lotId ?? '')?.code ?? DASH)
            : allocated.parts.map((p) => `${lotById.get(p.lotId)?.code ?? '?'} ${formatKg(p.grams)}`).join(' + ');
      } else if (allocated) {
        lotsText = NOT_COUNTED[allocated.reason];
      }
      return {
        roast,
        when: roastTimeText(roast.roastedAt) || DASH,
        name: roast.name || DASH,
        coffee: chosenLot?.name || coffeeByBean.get(roast.roastime.beanId) || (roast.roastime.beanId === '' ? 'No coffee chosen' : 'Coffee not in Kraken'),
        green: roast.greenGrams === null ? DASH : formatKg(roast.greenGrams),
        roasted: roast.roastedDecigrams === null ? DASH : formatKg(Math.round(roast.roastedDecigrams / 10)),
        loss: formatLoss(roastLossPermille(roast)),
        lots: lotsText,
        counted,
        needsLot: allocated?.status === 'not-counted' && allocated.reason !== 'no-green-weight' && !roast.sample,
        chosen: allocated?.status === 'chosen',
        beforeDelivery: allocated !== undefined && allocated.status !== 'not-counted' && allocated.beforeDelivery,
        sample: roast.sample,
        source: fromRoastime(roast) ? 'RoasTime' : 'By hand',
        deleted: isRoastDeleted(roast),
        problems: roast.problems,
      };
    });
}
