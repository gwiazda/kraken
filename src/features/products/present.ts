// What a product's page shows, as plain text, so it is tested without a browser: per bag size the main (retail)
// gross price with its net, and the wholesale price at each discount (net, whole złoty, with the gross for the
// invoice). The rules are in domain/prices.ts, shared with the Offer.

import { formatPln, formatWholePln } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize } from '../../domain/bagSizes';
import { BASE_GRAMS, bagCost, blendPerKg, earningsAt, roastedPerKg, scaledPrice, suggestionsFor, type BeanCost } from '../../domain/blend';
import { grossOf, netOf, roundGrosze, wholesalePrice } from '../../domain/prices';
import type { BeanLot } from '../costs';
import { typedBeanLoss, typedBeanPrice, type BeanForm } from './modelBeans';
import type { Product } from './model';

export interface PriceCell {
  /** The big number: "59 zł"; '—' when the product has no price for this size. */
  readonly main: string;
  /** The small line under it: "47,97 zł net" / "50,43 zł gross"; '' when there is no price. */
  readonly other: string;
  /** What one bag earns at this price: "earns 26,70 zł" / "loses 2,10 zł"; '' when the cost is not known. */
  readonly earn: string;
  /** True when this price does not cover what the bag costs. */
  readonly losing: boolean;
}

export interface PriceRow {
  /** "250 g" */
  readonly size: string;
  readonly retail: PriceCell;
  /** One per discount, in the order given. */
  readonly wholesale: readonly PriceCell[];
}

const money = (grosze: number) => formatPln(roundGrosze(grosze));
const NONE: PriceCell = { main: '—', other: '', earn: '', losing: false };

/** "earns 26,70 zł" or "loses 2,10 zł" (rounded to the grosz, as shown); '' without a cost. */
function earnText(earned: number | null): { earn: string; losing: boolean } {
  if (earned === null) return { earn: '', losing: false };
  const rounded = roundGrosze(earned);
  return rounded < 0 ? { earn: `loses ${formatPln(-rounded)}`, losing: true } : { earn: `earns ${formatPln(rounded)}`, losing: false };
}

/** "−15 %", "−12,5 %" (the column headers). */
export const discountHeader = (tenths: number) => `−${String(tenths / 10).replace('.', ',')} %`;

/**
 * One row per bag size: the main (retail) gross price and the wholesale price at each discount (tenths of a
 * percent), from the main prices per size (grosze). With what one bag costs (`costs`, grosze), each price also says
 * what it earns. Used by a product's page and the Product planner, so both always show the same.
 */
export function priceRows(
  prices: Readonly<Partial<Record<number, number>>>,
  discountTenths: readonly number[],
  vatTenths: number,
  costs: Readonly<Partial<Record<number, number>>> = {},
): PriceRow[] {
  return BAG_SIZES_G.map((grams) => {
    const gross = prices[grams];
    if (gross === undefined) return { size: formatBagSize(grams), retail: NONE, wholesale: discountTenths.map(() => NONE) };
    const cost = costs[grams];
    return {
      size: formatBagSize(grams),
      retail: { main: formatWholePln(gross), other: `${money(netOf(gross, vatTenths))} net`, ...earnText(cost === undefined ? null : earningsAt(gross, cost, vatTenths)) },
      wholesale: discountTenths.map((d) => {
        const price = wholesalePrice(gross, d, vatTenths);
        return { main: formatWholePln(price.net), other: `${money(price.gross)} gross`, ...earnText(cost === undefined ? null : price.net - cost) };
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
  /** Cost of one bag in grosze (not rounded); null when it cannot be worked out. */
  readonly costGrosze: number | null;
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
  /** How it is worked out, step by step in plain sentences with the numbers ("How is this worked out?"). */
  readonly steps: readonly string[];
}

export interface Costing {
  /** "Made of 60 % KENYA-26-09 · Kegwa and 40 % Etiopia offer (planned)"; '' without beans. */
  readonly madeOf: string;
  /** "79,35 zł per kg of roasted coffee"; '' when it cannot be worked out. */
  readonly perKg: string;
  readonly rows: readonly CostingRow[];
  /** Why something cannot be worked out, in plain words (missing price, packaging, …). */
  readonly notes: readonly string[];
  /** Why the roasted coffee costs what it does per kg, step by step ("Why … per kg?"). */
  readonly perKgSteps: readonly string[];
}

const percentText = (tenths: number) => `${String(tenths / 10).replace('.', ',')} %`;
const MARKUP_WORDS: Readonly<Record<number, string>> = { 200: 'Twice', 250: 'Two and a half times', 300: 'Three times' };

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
  /** Each bean's name and where its roast loss comes from, for the explanation. */
  const explained: { name: string; lossNote: string }[] = [];
  const costs: BeanCost[] = beans.map((bean) => {
    if (bean.kind === 'lot') {
      const lot = lots.find((l) => l.lotId === bean.lotId);
      if (!lot) {
        notes.push(bean.lotId ? 'One of the lots is no longer on the Lots page: choose another.' : 'Choose a lot for each bean.');
        parts.push(`${bean.sharePercent} % (no lot chosen)`);
        explained.push({ name: 'no lot chosen', lossNote: '' });
        return { greenPerKg: null, loss: 0, sharePercent: bean.sharePercent };
      }
      if (lot.greenPerKg === null) notes.push(`${lot.label} has no price yet: add it on the Lots page (Edit).`);
      parts.push(`${bean.sharePercent} % ${lot.label}`);
      explained.push({ name: lot.label, lossNote: lot.lossSource ? ` (${lot.lossSource})` : '' });
      return { greenPerKg: lot.greenPerKg, loss: lot.lossTenths / 1000, sharePercent: bean.sharePercent };
    }
    const price = typedBeanPrice(bean.plannedPrice);
    const loss = typedBeanLoss(bean.plannedLoss);
    const name = bean.plannedName.trim() || 'planned bean';
    if (price === null) notes.push(`Enter the price per kg of ${name}.`);
    parts.push(`${bean.sharePercent} % ${name} (planned)`);
    explained.push({ name, lossNote: loss === null ? ' (your usual loss)' : ' (your number)' });
    return { greenPerKg: price, loss: (loss ?? defaultLossTenths) / 1000, sharePercent: bean.sharePercent };
  });
  const total = beans.reduce((sum, b) => sum + b.sharePercent, 0);
  if (beans.length > 0 && total !== 100) notes.push(`The shares add up to ${total} %, not 100 %.`);
  const perKg = beans.length > 0 ? blendPerKg(costs) : null;
  const madeOf = parts.length === 0 ? '' : `Made of ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}`;
  const money = (grosze: number) => formatPln(roundGrosze(grosze));
  const perKgSteps: string[] = [];
  if (perKg !== null) {
    const roasted = costs.map((c) => roastedPerKg(c.greenPerKg, c.loss) ?? 0);
    costs.forEach((c, i) => {
      const lossTenths = Math.round(c.loss * 1000);
      perKgSteps.push(
        `${explained[i]?.name ?? 'Bean'}: the green coffee costs ${money(c.greenPerKg ?? 0)} per kg. Roasting takes away ${percentText(lossTenths)} of the weight${explained[i]?.lossNote ?? ''}, so 1 kg of roasted coffee costs ${money(roasted[i] ?? 0)}.`,
      );
    });
    if (costs.length > 1) {
      const mix = costs.map((c, i) => `${c.sharePercent} % of ${money(roasted[i] ?? 0)}`);
      perKgSteps.push(`In the bag: ${mix.slice(0, -1).join(', ')} and ${mix[mix.length - 1]}, which comes to ${money(perKg)} per kg of roasted coffee.`);
    }
  }
  const vatText = percentText(vatTenths);
  const rows = BAG_SIZES_G.map((grams): CostingRow => {
    const pack = packaging.get(grams) ?? null;
    const size = formatBagSize(grams);
    const empty = { grams, costGrosze: null, size, cost: '', parts: '', suggestions: [], earnings: '', losing: false, steps: [] };
    if (perKg === null) return empty;
    const bag = bagCost(perKg, grams, pack);
    const coffeeStep = `Coffee: ${size} of roasted coffee at ${money(perKg)} per kg costs ${money(bag.coffee)}.`;
    if (bag.total === null) {
      return { ...empty, parts: `coffee ${money(bag.coffee)}, packaging not entered`, steps: [coffeeStep, `Packaging for ${size} is not entered yet: add it under Packaging & discounts to see the full cost.`] };
    }
    const cost = bag.total;
    const price = prices[grams];
    const earned = price === undefined ? null : earningsAt(price, cost, vatTenths);
    const base = grams === BASE_GRAMS;
    const basePrice = prices[BASE_GRAMS];
    const basePack = packaging.get(BASE_GRAMS) ?? null;
    // 250 g: the cost × 2 / 2,5 / 3. Bigger bags follow the 250 g price (owner, 2026-11-19).
    const scaled = !base && basePrice !== undefined && basePack !== null ? scaledPrice(basePrice, basePack, grams, pack ?? 0, vatTenths) : null;
    const bags = grams / BASE_GRAMS;
    const bagsText = bags === 2 ? 'Two' : bags === 4 ? 'Four' : String(bags);
    const baseSuggestions = base ? suggestionsFor(cost, vatTenths) : [];
    const suggestionSteps = base
      ? baseSuggestions.map((sug) => {
          const net = (cost * sug.markupHundredths) / 100;
          return `${MARKUP_WORDS[sug.markupHundredths] ?? `${sug.markupHundredths / 100} times`} the cost is ${money(net)}; with VAT ${money(grossOf(net, vatTenths))}, rounded to ${formatWholePln(sug.gross)}. At that price you earn ${signedMoney(earningsAt(sug.gross, cost, vatTenths))} per bag.`;
        })
      : scaled && basePrice !== undefined && basePack !== null
        ? [
            `Suggested price, from your ${formatBagSize(BASE_GRAMS)} price: ${bagsText.toLowerCase()} ${formatBagSize(BASE_GRAMS)} bags at ${formatWholePln(basePrice)} are ${money(bags * basePrice)}. Take away the packaging of those ${bagsText.toLowerCase()} small bags (${money(bags * grossOf(basePack, vatTenths))} with VAT) and add the packaging of one ${size} bag (${money(grossOf(pack ?? 0, vatTenths))} with VAT): ${money(scaled.exact)}, rounded to ${formatWholePln(scaled.gross)}. At that price you earn ${signedMoney(earningsAt(scaled.gross, cost, vatTenths))} per bag.`,
          ]
        : basePrice === undefined
          ? [`Set the ${formatBagSize(BASE_GRAMS)} price first: the suggested ${size} price is worked out from it.`]
          : [`Add the packaging for ${formatBagSize(BASE_GRAMS)} under Packaging & discounts: the suggested ${size} price is worked out from the ${formatBagSize(BASE_GRAMS)} bag.`];
    const steps = [
      coffeeStep,
      `Packaging: ${formatPln(bag.packaging ?? 0)} (the bag, label and the rest, from Packaging & discounts).`,
      `So one bag costs you ${money(cost)}, without VAT.`,
      ...(price !== undefined && earned !== null
        ? [
            `Your price ${formatWholePln(price)} includes ${vatText} VAT; without VAT it is ${money(netOf(price, vatTenths))}. Take away the ${money(cost)} the bag costs: you ${earned < 0 ? 'lose' : 'earn'} ${formatPln(roundGrosze(Math.abs(earned)))} per bag.`,
          ]
        : []),
      ...suggestionSteps,
    ];
    return {
      grams,
      costGrosze: cost,
      size,
      cost: formatPln(roundGrosze(cost)),
      parts: `coffee ${money(bag.coffee)} and packaging ${formatPln(bag.packaging ?? 0)}`,
      steps,
      suggestions: base
        ? baseSuggestions.map((s) => ({ grosze: s.gross, text: formatWholePln(s.gross), markup: `${String(s.markupHundredths / 100).replace('.', ',')}×`, earnings: signedMoney(s.earnings) }))
        : scaled
          ? [{ grosze: scaled.gross, text: formatWholePln(scaled.gross), markup: `like ${bags} × ${formatBagSize(BASE_GRAMS)}`, earnings: signedMoney(earningsAt(scaled.gross, cost, vatTenths)) }]
          : [],
      earnings: earned === null ? '' : signedMoney(earned),
      losing: earned !== null && roundGrosze(earned) < 0, // as shown: never "You lose 0,00 zł"
    };
  });
  const missingPackaging = perKg !== null && BAG_SIZES_G.filter((g) => (packaging.get(g) ?? null) === null);
  if (missingPackaging && missingPackaging.length > 0) notes.push(`No packaging entered for ${missingPackaging.map(formatBagSize).join(', ')}: add it under Packaging & discounts.`);
  return { madeOf, perKg: perKg === null ? '' : `${formatPln(roundGrosze(perKg))} per kg of roasted coffee`, rows, notes: [...new Set(notes)], perKgSteps };
}

// ---- Comparing a plan with the products ----

export interface CompareRow {
  readonly name: string;
  /** The plan being tried (shown highlighted). */
  readonly isPlan: boolean;
  /** Cost of one bag: "21,26 zł"; '' when it cannot be worked out (no beans, no price, no packaging). */
  readonly cost: string;
  /** The retail price: "59 zł"; '' without one. */
  readonly price: string;
  /** What one bag earns at the retail price ("earns …" / "loses …"); '' when unknown. */
  readonly earn: string;
  readonly losing: boolean;
  /**
   * At each wholesale discount, in the order given (from Packaging & discounts): the price after the discount (net,
   * whole złoty: "41 zł"; '' without a retail price) and what one bag earns at it ('' when the cost is unknown).
   */
  readonly atDiscounts: readonly { readonly price: string; readonly earn: string; readonly losing: boolean }[];
  /** Why something is missing, in a few words ("no beans chosen"). */
  readonly note: string;
}

/**
 * The plan next to every product, for one bag size: what a bag costs, its retail price, what it earns, and what it
 * earns at each wholesale discount (`discounts`, tenths, as set under Packaging & discounts). Sorted by what they
 * earn, the most first; rows that cannot be worked out last.
 */
export function compareRows(
  entries: readonly { name: string; isPlan: boolean; beans: readonly BeanForm[]; prices: Readonly<Partial<Record<number, number>>> }[],
  grams: number,
  lots: readonly BeanLot[],
  packaging: ReadonlyMap<number, number | null>,
  vatTenths: number,
  defaultLossTenths: number,
  discounts: readonly number[],
): CompareRow[] {
  const rows = entries.map((entry) => {
    const row = costing(entry.beans, lots, packaging, vatTenths, defaultLossTenths, entry.prices).rows.find((r) => r.grams === grams);
    const cost = row?.costGrosze ?? null;
    const price = entry.prices[grams];
    const earned = cost === null || price === undefined ? null : earningsAt(price, cost, vatTenths);
    const retail = earnText(earned);
    const atDiscounts = discounts.map((d) => {
      const net = price === undefined ? null : wholesalePrice(price, d, vatTenths).net;
      return { price: net === null ? '' : formatWholePln(net), ...earnText(net === null || cost === null ? null : net - cost) };
    });
    const note =
      entry.beans.length === 0 ? 'no beans chosen' : cost === null ? 'cost not known yet' : price === undefined ? `no ${formatBagSize(grams)} price` : '';
    return {
      sortBy: earned === null ? Number.NEGATIVE_INFINITY : earned,
      name: entry.name,
      isPlan: entry.isPlan,
      cost: cost === null ? '' : money(cost),
      price: price === undefined ? '' : formatWholePln(price),
      earn: retail.earn,
      losing: retail.losing,
      atDiscounts,
      note,
    };
  });
  return rows.sort((a, b) => b.sortBy - a.sortBy).map(({ sortBy: _sortBy, ...row }) => row);
}

