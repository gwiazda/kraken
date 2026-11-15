// Which lot each roast used, and how much green coffee is left per lot. Calculated, never stored, so changing a rule
// or a lot needs no data migration. Rules agreed with the owner on 2026-11-15 (docs/REQUIREMENTS.md section 3):
// - a roast the owner gave a lot uses that lot (checked first, so those kilograms are reserved);
// - other roasts use the lots of their RoasTime coffee, oldest delivery first; a roast is split when a lot runs out;
//   if all lots of the coffee run out, the rest goes on the newest lot, whose stock then shows below zero;
// - deleted lots are skipped (a deleted lot is a mistake); lots entered by hand are only used when chosen;
// - a roast without a coffee and without a chosen lot is not counted (samples too);
// - a roast dated before the delivery of a lot it uses is flagged (often the wrong coffee was chosen in RoasTime).

import { localDate } from '../../core/dates';
import type { Lot } from '../lots';
import { isRoastDeleted, sortRoastsOldestFirst, type Roast } from './model';

export interface LotStock {
  /** Green coffee used by roasts, in grams. */
  readonly usedGrams: number;
  /** Delivered − used, in grams (below zero when more was roasted than delivered); null if the delivered kg is unknown. */
  readonly leftGrams: number | null;
}

export type RoastAllocation =
  | { readonly status: 'chosen' | 'automatic'; readonly parts: readonly { lotId: string; grams: number }[]; readonly beforeDelivery: boolean }
  | { readonly status: 'not-counted'; readonly reason: 'no-coffee' | 'no-lot-for-coffee' | 'no-green-weight' };

export interface Allocation {
  readonly lots: ReadonlyMap<string, LotStock>;
  readonly roasts: ReadonlyMap<string, RoastAllocation>;
}

const byDelivery = (a: Lot, b: Lot) => a.deliveryDate.localeCompare(b.deliveryDate) || a.code.localeCompare(b.code);

export function allocate(lots: readonly Lot[], roasts: readonly Roast[]): Allocation {
  const active = lots.filter((lot) => lot.deletedAt === '');
  const lotById = new Map(active.map((lot) => [lot.id, lot]));
  const remaining = new Map(active.map((lot) => [lot.id, lot.quantityGrams ?? 0]));
  const result = new Map<string, RoastAllocation>();
  const ordered = sortRoastsOldestFirst(roasts.filter((roast) => !isRoastDeleted(roast)));

  const take = (lotId: string, grams: number) => remaining.set(lotId, (remaining.get(lotId) ?? 0) - grams);
  const before = (roast: Roast, lotIds: readonly string[]) => {
    const at = roast.roastedAt;
    if (!at) return false;
    return lotIds.some((id) => {
      const lot = lotById.get(id);
      return lot !== undefined && lot.deliveryDate !== '' && localDate(at) < lot.deliveryDate;
    });
  };

  // 1. Roasts with a lot chosen by the owner.
  for (const roast of ordered) {
    if (roast.greenGrams === null || roast.greenGrams <= 0) {
      result.set(roast.id, { status: 'not-counted', reason: 'no-green-weight' });
      continue;
    }
    if (roast.lotId !== '' && lotById.has(roast.lotId)) {
      take(roast.lotId, roast.greenGrams);
      result.set(roast.id, { status: 'chosen', parts: [{ lotId: roast.lotId, grams: roast.greenGrams }], beforeDelivery: before(roast, [roast.lotId]) });
    }
  }

  // 2. The others: the lots of their RoasTime coffee, oldest delivery first.
  for (const roast of ordered) {
    if (result.has(roast.id) || roast.greenGrams === null) continue;
    if (roast.roastime.beanId === '') {
      result.set(roast.id, { status: 'not-counted', reason: 'no-coffee' });
      continue;
    }
    const candidates = active.filter((lot) => lot.roastime.beanId === roast.roastime.beanId).sort(byDelivery);
    const newest = candidates[candidates.length - 1];
    if (!newest) {
      result.set(roast.id, { status: 'not-counted', reason: 'no-lot-for-coffee' });
      continue;
    }
    let need = roast.greenGrams;
    const parts: { lotId: string; grams: number }[] = [];
    for (const lot of candidates) {
      const available = Math.max(0, remaining.get(lot.id) ?? 0);
      const used = Math.min(available, need);
      if (used > 0) {
        take(lot.id, used);
        parts.push({ lotId: lot.id, grams: used });
        need -= used;
      }
      if (need === 0) break;
    }
    if (need > 0) {
      // More roasted than delivered: the rest goes on the newest lot, which then shows below zero.
      take(newest.id, need);
      const last = parts[parts.length - 1];
      if (last && last.lotId === newest.id) last.grams += need;
      else parts.push({ lotId: newest.id, grams: need });
    }
    result.set(roast.id, { status: 'automatic', parts, beforeDelivery: before(roast, parts.map((p) => p.lotId)) });
  }

  const stock = new Map<string, LotStock>();
  for (const lot of lots) {
    if (!lotById.has(lot.id)) continue;
    const left = remaining.get(lot.id) ?? 0;
    const delivered = lot.quantityGrams;
    stock.set(lot.id, { usedGrams: (delivered ?? 0) - left, leftGrams: delivered === null ? null : left });
  }
  return { lots: stock, roasts: result };
}

