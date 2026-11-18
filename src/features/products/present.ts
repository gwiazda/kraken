// What a product's page shows, as plain text, so it is tested without a browser: per bag size the main (retail)
// gross price with its net, and the wholesale price at each discount (net, whole złoty, with the gross for the
// invoice). The rules are in domain/prices.ts, shared with the Offer.

import { formatPln, formatWholePln } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize } from '../../domain/bagSizes';
import { bagCost, blendPerKg, earningsAt, suggestionsFor, type BeanCost } from '../../domain/blend';
import { netOf, roundGrosze, wholesalePrice } from '../../domain/prices';
import type { BeanLot } from '../costs';
import { typedBeanLoss, typedBeanPrice, type BeanForm } from './modelBeans';
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

// ---- What a bag costs and earns (the product's beans) ----

/** "23,82 zł", "−10,00 zł" (a loss) */
const signedMoney = (grosze: number) => {
  const rounded = roundGrosze(Math.abs(grosze));
  return grosze < 0 && rounded > 0 ? `−${formatPln(rounded)}` : formatPln(rounded);
};

export interface CostingRow {
  readonly grams: number;
  readonly size: string;
  /** Cost of one bag (coffee + packaging): "24,15 zł"; '' when it cannot be worked out. */
  readonly cost: string;
  /** The parts, for the tooltip/small print: "coffee 22,65 zł + packaging 1,50 zł". */
  readonly parts: string;
  /** Suggested prices to click: "59 zł" at "2×", earning "23,82 zł" per bag. */
  readonly suggestions: readonly { readonly grosze: number; readonly text: string; readonly markup: string; readonly earnings: string }[];
  /** What the price set for this size earns per bag; '' without a price or a cost. */
  readonly earnings: string;
  /** True when that price does not even cover the cost. */
  readonly losing: boolean;
}

export interface Costing {
  /** "Made of 60 % KENYA-26-09 · Kegwa and 40 % Etiopia offer (planned)"; '' without beans. */
  readonly madeOf: string;
  /** "79,35 zł per kg of roasted coffee"; '' when it cannot be worked out. */
  readonly perKg: string;
  readonly rows: readonly CostingRow[];
  /** Why something cannot be worked out, in plain words (missing price, packaging, …). */
  readonly notes: readonly string[];
}

/**
 * What one bag of each size costs and earns, from the product's beans (as in the form), every lot, the packaging
 * per size, VAT and the usual roast loss. `prices` are the product's main gross prices per size (grosze).
 */
export function costing(
  beans: readonly BeanForm[],
  lots: readonly BeanLot[],
  packaging: ReadonlyMap<number, number | null>,
  vatTenths: number,
  defaultLossTenths: number,
  prices: Readonly<Partial<Record<number, number>>>,
): Costing {
  const notes: string[] = [];
  const parts: string[] = [];
  const costs: BeanCost[] = beans.map((bean) => {
    if (bean.kind === 'lot') {
      const lot = lots.find((l) => l.lotId === bean.lotId);
      if (!lot) {
        notes.push(bean.lotId ? 'One of the lots is no longer on the Lots page: choose another.' : 'Choose a lot for each bean.');
        parts.push(`${bean.sharePercent} % (no lot chosen)`);
        return { greenPerKg: null, loss: 0, sharePercent: bean.sharePercent };
      }
      if (lot.greenPerKg === null) notes.push(`${lot.label} has no price yet: add it on the Lots page (Edit).`);
      parts.push(`${bean.sharePercent} % ${lot.label}`);
      return { greenPerKg: lot.greenPerKg, loss: lot.lossTenths / 1000, sharePercent: bean.sharePercent };
    }
    const price = typedBeanPrice(bean.plannedPrice);
    const loss = typedBeanLoss(bean.plannedLoss);
    const name = bean.plannedName.trim() || 'planned bean';
    if (price === null) notes.push(`Enter the price per kg of ${name}.`);
    parts.push(`${bean.sharePercent} % ${name} (planned)`);
    return { greenPerKg: price, loss: (loss ?? defaultLossTenths) / 1000, sharePercent: bean.sharePercent };
  });
  const total = beans.reduce((sum, b) => sum + b.sharePercent, 0);
  if (beans.length > 0 && total !== 100) notes.push(`The shares add up to ${total} %, not 100 %.`);
  const perKg = beans.length > 0 ? blendPerKg(costs) : null;
  const madeOf = parts.length === 0 ? '' : `Made of ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}`;
  const rows = BAG_SIZES_G.map((grams): CostingRow => {
    const pack = packaging.get(grams) ?? null;
    const size = formatBagSize(grams);
    const empty = { grams, size, cost: '', parts: '', suggestions: [], earnings: '', losing: false };
    if (perKg === null) return empty;
    const bag = bagCost(perKg, grams, pack);
    if (bag.total === null) return { ...empty, parts: `coffee ${formatPln(roundGrosze(bag.coffee))}, packaging not entered` };
    const cost = bag.total;
    const price = prices[grams];
    const earned = price === undefined ? null : earningsAt(price, cost, vatTenths);
    return {
      grams,
      size,
      cost: formatPln(roundGrosze(cost)),
      parts: `coffee ${formatPln(roundGrosze(bag.coffee))} and packaging ${formatPln(bag.packaging ?? 0)}`,
      suggestions: suggestionsFor(cost, vatTenths).map((s) => ({ grosze: s.gross, text: formatWholePln(s.gross), markup: `${String(s.markupHundredths / 100).replace('.', ',')}×`, earnings: signedMoney(s.earnings) })),
      earnings: earned === null ? '' : signedMoney(earned),
      losing: earned !== null && earned < 0,
    };
  });
  const missingPackaging = perKg !== null && BAG_SIZES_G.filter((g) => (packaging.get(g) ?? null) === null);
  if (missingPackaging && missingPackaging.length > 0) notes.push(`No packaging entered for ${missingPackaging.map(formatBagSize).join(', ')}: add it under Packaging & discounts.`);
  return { madeOf, perKg: perKg === null ? '' : `${formatPln(roundGrosze(perKg))} per kg of roasted coffee`, rows, notes: [...new Set(notes)] };
}

