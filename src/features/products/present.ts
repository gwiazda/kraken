// What a product's page shows, as plain text, so it is tested without a browser: per bag size the main (retail)
// gross price with its net, and the wholesale price at each discount (net, whole złoty, with the gross for the
// invoice). The rules are in domain/prices.ts, shared with the Offer.

import { formatPln, formatWholePln } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize } from '../../domain/bagSizes';
import { netOf, roundGrosze, wholesalePrice } from '../../domain/prices';
import type { Product } from './model';

export interface PriceCell {
  /** The big number: "59 zł"; '—' when the product has no price for this size. */
  readonly main: string;
  /** The small line under it: "47,97 zł net" / "50,43 zł gross"; '' when there is no price. */
  readonly other: string;
}

export interface PriceRow {
  /** "250 g" */
  readonly size: string;
  readonly retail: PriceCell;
  /** One per discount, in the order given. */
  readonly wholesale: readonly PriceCell[];
}

const money = (grosze: number) => formatPln(roundGrosze(grosze));
const NONE: PriceCell = { main: '—', other: '' };

/** "−15 %", "−12,5 %" (the column headers). */
export const discountHeader = (tenths: number) => `−${String(tenths / 10).replace('.', ',')} %`;

/** One row per bag size: the main price and the wholesale price at each discount (tenths of a percent). */
export function priceRows(product: Product, discountTenths: readonly number[], vatTenths: number): PriceRow[] {
  return BAG_SIZES_G.map((grams) => {
    const gross = product.prices[grams];
    if (gross === undefined) return { size: formatBagSize(grams), retail: NONE, wholesale: discountTenths.map(() => NONE) };
    return {
      size: formatBagSize(grams),
      retail: { main: formatWholePln(gross), other: `${money(netOf(gross, vatTenths))} net` },
      wholesale: discountTenths.map((d) => {
        const price = wholesalePrice(gross, d, vatTenths);
        return { main: formatWholePln(price.net), other: `${money(price.gross)} gross` };
      }),
    };
  });
}

/** The details shown on the offer, with their offer labels; only the ones filled in. */
export function productDetails(product: Product): { label: string; value: string }[] {
  const all: [string, string][] = [
    ['Country (Kraj)', product.country],
    ['Region', product.region],
    ['Altitude (Wysokość uprawy)', product.altitude],
    ['Processing (Obróbka)', product.processing],
    ['Variety (Odmiana)', product.variety],
    ['Flavour profile (Profil smakowy)', product.flavourProfile],
  ];
  return all.filter(([, value]) => value).map(([label, value]) => ({ label, value }));
}

/**
 * Which lot's suggestions to show first in the product form: the newest lot whose label (code and coffee name) or
 * country appears in the product's name or country, ignoring capitals (e.g. product "Kenia Kegwa" → lot
 * "KENYA-26-09 · Kegwa"). `lots` are newest first. '' when none matches: the owner picks one, so suggestions from a
 * different coffee are never shown by guess.
 */
export function suggestedLot(product: { name: string; country: string }, lots: readonly { lotId: string; label: string; country: string }[]): string {
  const text = `${product.name} ${product.country}`.toLowerCase();
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const match = lots.find((l) => [...words(l.label.split('·')[1] ?? ''), ...words(l.country)].some((w) => text.includes(w)));
  return match?.lotId ?? '';
}
