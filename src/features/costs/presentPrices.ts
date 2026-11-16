// What the Price list page shows, as plain text, so it is tested without a browser. One row per coffee (country +
// coffee name of its active lots), one cell per bag size: the main price in use, or the wholesale price at a discount.

import { formatPln, formatWholePln } from '../../core/numbers';
import { isDeleted } from '../lots';
import { BAG_SIZES_G, formatBagSize, type CostSettings } from './model';
import { netOf, roundGrosze } from './modelCalc';
import { coffeeKey, currentPrice, priceProblem, wholesalePrice, type PriceEntry } from './modelPrices';
import type { LotCard } from './present';

export interface Suggestion {
  /** "2,5×" */
  readonly markup: string;
  /** Grosze (whole złoty). */
  readonly grosze: number;
  /** "74 zł" */
  readonly text: string;
}

export interface PriceCell {
  readonly grams: number;
  readonly label: string;
  /** The main price in use; null if none is set yet. */
  readonly current: PriceEntry | null;
  /** Main price: gross "74 zł" and net "60,16 zł"; wholesale: net "51 zł" and gross "62,73 zł". '' when no price. */
  readonly main: string;
  readonly other: string;
  /** "since 2026-11-16"; '' when no price. */
  readonly since: string;
  /** The suggested prices of the newest lot of this coffee with a calculation (from Costs & prices). */
  readonly suggestions: readonly Suggestion[];
}

export interface CoffeeRow {
  readonly key: string;
  /** "Kenya · Kegwa" */
  readonly title: string;
  readonly country: string;
  readonly coffeeName: string;
  /** The lot whose calculation gives the suggestions, e.g. "KENYA-26-09"; '' if none can be calculated. */
  readonly suggestionsFrom: string;
  readonly cells: readonly PriceCell[];
}

const money = (grosze: number) => formatPln(roundGrosze(grosze));

/**
 * One row per coffee with an active lot, sorted by country and name. `cards` are the Costs & prices lot cards
 * (one per active lot, newest delivery first). `discountTenths` null shows the main (retail) price; a number shows wholesale prices.
 */
export function priceListRows(
  cards: readonly LotCard[],
  prices: readonly PriceEntry[],
  settings: CostSettings,
  today: string,
  discountTenths: number | null,
): { rows: CoffeeRow[]; problems: string[] } {
  const problems = prices.map(priceProblem).filter((p): p is string => p !== null);
  const coffees = new Map<string, { country: string; coffeeName: string; card: LotCard | undefined }>();
  for (const card of cards) {
    if (isDeleted(card.lot)) continue;
    const key = coffeeKey(card.lot.country, card.lot.name);
    const known = coffees.get(key);
    const usable = card.bags.some((b) => b.prices.length > 0) ? card : undefined;
    // Cards come newest first: the first lot of a coffee names it; the first one with a calculation gives suggestions.
    if (!known) coffees.set(key, { country: card.lot.country, coffeeName: card.lot.name, card: usable });
    else if (!known.card && usable) coffees.set(key, { ...known, card: usable });
  }
  const rows = [...coffees.entries()].map(([key, coffee]): CoffeeRow => ({
    key,
    title: [coffee.country || '—', coffee.coffeeName || '—'].join(' · '),
    country: coffee.country,
    coffeeName: coffee.coffeeName,
    suggestionsFrom: coffee.card?.lot.code ?? '',
    cells: BAG_SIZES_G.map((grams, i): PriceCell => {
      const current = currentPrice(prices, key, grams, today);
      const bag = coffee.card?.bags[i];
      const suggestions = (bag?.prices ?? []).map((p) => ({ markup: p.markup, grosze: p.suggestedGrossGrosze, text: p.suggestedGross }));
      const base = { grams, label: formatBagSize(grams), current, suggestions };
      if (!current || current.grossGrosze === null) return { ...base, main: '', other: '', since: '' };
      const since = `since ${current.validFrom}`;
      if (discountTenths === null) {
        return { ...base, main: formatWholePln(current.grossGrosze), other: `${money(netOf(current.grossGrosze, settings.vatTenths))} net`, since };
      }
      const wholesale = wholesalePrice(current.grossGrosze, discountTenths, settings.vatTenths);
      return { ...base, main: `${formatWholePln(wholesale.net)} net`, other: `${money(wholesale.gross)} gross`, since };
    }),
  }));
  rows.sort((a, b) => a.title.localeCompare(b.title, 'pl'));
  return { rows, problems };
}
