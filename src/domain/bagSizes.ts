// Shared business constants: what Kraken knows about Krak's bags, used by several features (Costs & prices, the
// Price list, Products, the Offer). Pure: no Google, no screen.
// Adding or removing a size is more than this list: the Products tab has a price column per size (a new migration),
// and the product form, the Offer's starting sizes and the "suggested retail price" size (250 g) name sizes too.

import { toDecimalText } from '../core/numbers';

/** The bag sizes, fixed (owner, 2026-11-16: always 250 g, 500 g and 1 kg), in grams. */
export const BAG_SIZES_G = [250, 500, 1000] as const;
export type BagSize = (typeof BAG_SIZES_G)[number];

/** True for one of the bag sizes (e.g. a size read from a sheet or a form). */
export const isBagSize = (grams: number): grams is BagSize => (BAG_SIZES_G as readonly number[]).includes(grams);

/** For the screen and the offer: "250 g", "1 kg", "1,5 kg" (whole grams, as all sizes are). */
export function formatBagSize(grams: number): string {
  return grams >= 1000 ? `${toDecimalText(grams, 3).replace('.', ',')} kg` : `${grams} g`;
}
