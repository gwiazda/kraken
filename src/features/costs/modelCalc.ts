// The cost of one bag and the suggested prices (docs/REQUIREMENTS.md section 6). Pure, so every step is tested.
// Amounts are exact fractions of a grosz during the calculation and rounded to the grosz (half up) only for the
// screen, so rounding never adds up across the steps.
//
//   green price per kg      = (coffee price + delivery cost) ÷ kg delivered                        (net)
//   roasted from 1 kg green = 1 kg × (1 − roast loss)
//   cost of 1 kg roasted    = green price per kg ÷ (1 − roast loss)
//   coffee in one bag       = cost of 1 kg roasted × bag size in kg
//   cost of one bag         = coffee in one bag + every cost item of that size (bag, label, ...)
//   price at a markup       = cost of one bag × markup (net); gross = net × (1 + VAT)
//   suggested price         = that gross rounded to whole złoty (half up); its net = suggested gross ÷ (1 + VAT)

import type { CostSettings } from './model';

/** One roast's share in a lot: the green grams it took from the lot, and the whole roast's weights. */
export interface RoastShare {
  readonly partGrams: number;
  readonly greenGrams: number;
  /** Roasted weight in tenths of a gram; null if not entered. */
  readonly roastedDecigrams: number | null;
}

/**
 * The average roast loss of a lot, weighted by the green coffee each roast took from it (a roast split over two lots
 * counts with its part). Only roasts with both weights count. Null if there are none, or the weights make no sense.
 */
export function averageLoss(shares: readonly RoastShare[]): { loss: number; roasts: number } | null {
  let green = 0;
  let roasted = 0;
  let roasts = 0;
  for (const share of shares) {
    if (share.roastedDecigrams === null || share.roastedDecigrams <= 0 || share.greenGrams <= 0 || share.partGrams <= 0) continue;
    green += share.partGrams;
    roasted += (share.roastedDecigrams / 10) * (share.partGrams / share.greenGrams);
    roasts++;
  }
  if (roasts === 0) return null;
  const loss = 1 - roasted / green;
  return loss >= 0 && loss < 1 ? { loss, roasts } : null;
}

/** Where the roast loss comes from: typed by the owner, the average of the lot's roasts, or the default setting. */
export type LossSource = { kind: 'own' } | { kind: 'average'; roasts: number } | { kind: 'default' };

export function chooseLoss(ownTenths: number | null, average: { loss: number; roasts: number } | null, settings: CostSettings): { loss: number; source: LossSource } {
  if (ownTenths !== null) return { loss: ownTenths / 1000, source: { kind: 'own' } };
  if (average) return { loss: average.loss, source: { kind: 'average', roasts: average.roasts } };
  return { loss: settings.defaultLossTenths / 1000, source: { kind: 'default' } };
}

export interface BagInput {
  readonly id: string;
  readonly grams: number;
  /** The net cost items of this size, in grosze. None: the costs are not entered yet ("missing cost"). */
  readonly itemsGrosze: readonly number[];
}

export interface PriceAtMarkup {
  readonly markupHundredths: number;
  /** Exact net and gross at this markup (grosze, not rounded): shown in the step-by-step calculation. */
  readonly net: number;
  readonly gross: number;
  /** The suggested price: the gross rounded to whole złoty (grosze, a multiple of 100). */
  readonly suggestedGross: number;
  /** The net of the suggested price: suggested gross ÷ (1 + VAT) (grosze, not rounded). */
  readonly suggestedNet: number;
}

export interface BagCalculation {
  readonly id: string;
  readonly grams: number;
  /** Cost of the roasted coffee in the bag (grosze, not rounded). */
  readonly coffee: number;
  /** Cost items together (grosze); null when none are entered. */
  readonly items: number | null;
  /** Cost of one bag (grosze, not rounded); null when the cost items are missing. */
  readonly total: number | null;
  /** Empty when the total is missing. */
  readonly prices: readonly PriceAtMarkup[];
}

export interface LotCalculation {
  /** Net green price per kg (grosze, not rounded). */
  readonly greenPerKg: number;
  readonly loss: number;
  /** Roasted coffee from 1 kg green, in kg. */
  readonly roastedFromKg: number;
  /** Cost of 1 kg roasted coffee (grosze, not rounded). */
  readonly roastedPerKg: number;
  readonly bags: readonly BagCalculation[];
}

/** Gross from net: net × (1 + VAT). */
export const grossOf = (net: number, vatTenths: number) => (net * (1000 + vatTenths)) / 1000;

/** Net from gross: gross ÷ (1 + VAT). */
export const netOf = (gross: number, vatTenths: number) => (gross * 1000) / (1000 + vatTenths);


/**
 * The full calculation for one lot. `priceGrosze` is the coffee price plus the delivery cost, `quantityGrams` the
 * green coffee delivered. Null when the price or quantity is missing (the screen says what to add).
 */
export function calculateLot(
  priceGrosze: number | null,
  quantityGrams: number | null,
  loss: number,
  bags: readonly BagInput[],
  settings: CostSettings,
): LotCalculation | null {
  if (priceGrosze === null || quantityGrams === null || quantityGrams <= 0 || loss < 0 || loss >= 1) return null;
  const greenPerKg = (priceGrosze * 1000) / quantityGrams;
  const roastedFromKg = 1 - loss;
  const roastedPerKg = greenPerKg / roastedFromKg;
  return {
    greenPerKg,
    loss,
    roastedFromKg,
    roastedPerKg,
    bags: bags.map((bag) => {
      const coffee = (roastedPerKg * bag.grams) / 1000;
      const items = bag.itemsGrosze.length === 0 ? null : bag.itemsGrosze.reduce((a, b) => a + b, 0);
      const total = items === null ? null : coffee + items;
      const prices =
        total === null
          ? []
          : settings.markupHundredths.map((m) => {
              const net = (total * m) / 100;
              const gross = grossOf(net, settings.vatTenths);
              const suggestedGross = roundToZloty(gross);
              return { markupHundredths: m, net, gross, suggestedGross, suggestedNet: netOf(suggestedGross, settings.vatTenths) };
            });
      return { id: bag.id, grams: bag.grams, coffee, items, total, prices };
    }),
  };
}

/** A calculated amount rounded to the grosz, half up (for the screen). */
export const roundGrosze = (amount: number) => Math.round(amount + 1e-9);

/**
 * An amount in grosze rounded to whole złoty, half up (74,50 → 75 zł; 74,49 → 74 zł). Gives grosze. It first rounds to
 * the grosz, as the screen shows it, so an amount shown as 74,50 zł always becomes 75 zł.
 */
export const roundToZloty = (amount: number) => roundGrosze(roundGrosze(amount) / 100) * 100;
