// What a bag of a product costs when it is made of up to 3 beans, and what it earns (owner, 2026-11-18: "when I
// think about buying some beans I need to know what price to put on my product"). Pure: no Google, no screen.
// Amounts in grosze, exact until a rule rounds them; shares in whole percent of the coffee in the bag.
//
//   roasted price per kg of a bean = its green price per kg, made dearer by the roast loss: green ÷ (1 − loss)
//   roasted price per kg of the blend = each bean's roasted price per kg, weighted by its share of the bag
//   coffee in one bag = blend price per kg × bag size; cost of one bag = coffee + packaging
//   suggested price = cost of one bag × 2 / 2,5 / 3, plus VAT, rounded to whole złoty (domain/prices.ts)
//   earnings per bag = the price without VAT − the cost of one bag

import { grossOf, netOf, roundToZloty } from './prices';

/** At most this many beans in one product (owner, 2026-11-18). */
export const MAX_BEANS = 3;

/** The price multipliers, fixed (owner, 2026-11-18): 2×, 2,5× and 3× the cost of one bag. In hundredths. */
export const MARKUPS: readonly number[] = [200, 250, 300];

export interface BeanCost {
  /** Green price per kg (grosze), without VAT; null when not known (e.g. a lot without a price). */
  readonly greenPerKg: number | null;
  /** Roast loss, 0 to just under 1 (0,15 = 15 %). */
  readonly loss: number;
  /** Share of the coffee in the bag, in whole percent. */
  readonly sharePercent: number;
}

/** A bean's roasted price per kg (grosze): green ÷ (1 − loss). Null when unknown or the loss makes no sense. */
export function roastedPerKg(greenPerKg: number | null, loss: number): number | null {
  if (greenPerKg === null || loss < 0 || loss >= 1) return null;
  return greenPerKg / (1 - loss);
}

/** True when the shares add up to exactly 100 % and each bean has some. */
export const sharesComplete = (beans: readonly { sharePercent: number }[]) =>
  beans.length > 0 && beans.every((b) => b.sharePercent > 0) && beans.reduce((sum, b) => sum + b.sharePercent, 0) === 100;

/** The blend's roasted price per kg (grosze); null if any bean has no price, or the shares do not add up to 100 %. */
export function blendPerKg(beans: readonly BeanCost[]): number | null {
  if (!sharesComplete(beans)) return null;
  let total = 0;
  for (const bean of beans) {
    const perKg = roastedPerKg(bean.greenPerKg, bean.loss);
    if (perKg === null) return null;
    total += (perKg * bean.sharePercent) / 100;
  }
  return total;
}

export interface BagCost {
  /** The coffee in one bag (grosze, not rounded). */
  readonly coffee: number;
  /** Packaging (grosze); null when not entered for this size. */
  readonly packaging: number | null;
  /** Cost of one bag (grosze, not rounded); null without packaging. */
  readonly total: number | null;
}

export function bagCost(blendPerKgGrosze: number, grams: number, packagingGrosze: number | null): BagCost {
  const coffee = (blendPerKgGrosze * grams) / 1000;
  return { coffee, packaging: packagingGrosze, total: packagingGrosze === null ? null : coffee + packagingGrosze };
}

/** Earnings per bag at a gross price: the price without VAT, minus the cost of the bag (grosze, may be negative). */
export const earningsAt = (grossGrosze: number, costGrosze: number, vatTenths: number) => netOf(grossGrosze, vatTenths) - costGrosze;

export interface Suggestion {
  readonly markupHundredths: number;
  /** Gross, whole złoty (grosze). */
  readonly gross: number;
  /** Earnings per bag at that price (grosze, not rounded). */
  readonly earnings: number;
}

/** The suggested gross prices at each fixed multiplier, with what each one earns per bag. */
export function suggestionsFor(costGrosze: number, vatTenths: number): Suggestion[] {
  return MARKUPS.map((m) => {
    const gross = roundToZloty(grossOf((costGrosze * m) / 100, vatTenths));
    return { markupHundredths: m, gross, earnings: earningsAt(gross, costGrosze, vatTenths) };
  });
}

/**
 * New shares after one slider moved (whole percent). The last bean always takes what is left, so the total stays
 * 100 %; a slider cannot take more than what the beans before it leave.
 */
export function moveShare(shares: readonly number[], index: number, value: number): number[] {
  const next = [...shares];
  if (next.length <= 1) return next.map(() => 100);
  const last = next.length - 1;
  if (index >= last) return next; // the last bean has no slider of its own
  const before = next.slice(0, index).reduce((sum, s) => sum + s, 0);
  const others = next.slice(index + 1, last).length; // beans between this one and the last keep at least 1 %
  next[index] = Math.max(1, Math.min(Math.round(value), 100 - before - others - 1));
  for (let i = index + 1; i < last; i++) {
    const used = next.slice(0, i).reduce((sum, s) => sum + s, 0);
    next[i] = Math.max(1, Math.min(next[i] ?? 1, 100 - used - (last - i)));
  }
  next[last] = 100 - next.slice(0, last).reduce((sum, s) => sum + s, 0);
  return next;
}

/** Even shares for n beans (the last one gets the rounding): 1 → 100; 2 → 50/50; 3 → 33/33/34. */
export function evenShares(n: number): number[] {
  if (n <= 0) return [];
  const each = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - each * (n - 1) : each));
}
