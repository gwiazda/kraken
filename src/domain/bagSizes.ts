// Shared business constants: what Kraken knows about Krak's bags, used by several features (Costs & prices, the
// Price list, Products, the Offer). Pure: no Google, no screen. Change a size here and every page follows.

import { toDecimalText } from '../core/numbers';

/** The bag sizes, fixed (owner, 2026-11-16: always 250 g, 500 g and 1 kg), in grams. */
export const BAG_SIZES_G = [250, 500, 1000] as const;
export type BagSize = (typeof BAG_SIZES_G)[number];

/** For the screen and the offer: "250 g", "1 kg", "1,5 kg". */
export function formatBagSize(grams: number): string {
  return grams >= 1000 ? `${toDecimalText(grams, 3).replace('.', ',')} kg` : `${grams} g`;
}
