// What the Costs & prices page shows, as plain text, so it is tested without a browser. Joins the lots, the roasts
// (for the average roast loss) and the cost tabs, and runs the calculation.

import { formatKg, formatPln, formatWholePln } from '../../core/numbers';
import { isDeleted, sortLots, type Lot } from '../lots';
import { allocate, type Roast } from '../roasts';
import { BAG_SIZES_G, formatBagSize, formatMarkup, formatPercent, type BagCost, type CostSettings, type LotCost } from './model';
import { averageLoss, calculateLot, chooseLoss, roundGrosze, type BagInput, type RoastShare } from './modelCalc';

export interface BagSizeView {
  readonly grams: number;
  /** As stored in the Bag costs tab ("250"). */
  readonly id: string;
  readonly label: string;
  readonly costs: readonly BagCost[];
  /** Net cost of the items together, e.g. "1,15 zł"; "missing cost" when none are entered. */
  readonly itemsText: string;
  readonly unreadable: boolean;
}

/** The fixed bag sizes (250 g, 500 g, 1 kg) with their active cost items. Items Kraken cannot place are reported. */
export function bagSizeViews(costs: readonly BagCost[]): { views: BagSizeView[]; unplaced: BagCost[]; problems: string[] } {
  const problems: string[] = [];
  const active = costs.filter((c) => c.deletedAt === '');
  const ids = BAG_SIZES_G.map(String);
  const unplaced = active.filter((c) => !ids.includes(c.bagSizeId));
  if (unplaced.length > 0) {
    problems.push(
      `${unplaced.length} bag cost item${unplaced.length === 1 ? ' is' : 's are'} for a bag size Kraken does not use, so ${unplaced.length === 1 ? 'it is' : 'they are'} left out. Delete ${unplaced.length === 1 ? 'it' : 'them'} under "Bag costs & settings" and add ${unplaced.length === 1 ? 'it' : 'them'} again to 250 g, 500 g or 1 kg.`,
    );
  }
  const views = BAG_SIZES_G.map((grams): BagSizeView => {
    const id = String(grams);
    const own = active.filter((c) => c.bagSizeId === id);
    const unreadable = own.some((c) => c.costGrosze === null);
    for (const c of own.filter((c) => c.costGrosze === null)) {
      problems.push(`The cost "${c.costText}" of ${c.item || 'an item'} (${formatBagSize(grams)}) cannot be read, so that bag size shows "missing cost". Edit it under "Bag costs & settings".`);
    }
    const sum = own.reduce((total, c) => total + (c.costGrosze ?? 0), 0);
    return { grams, id, label: formatBagSize(grams), costs: own, itemsText: own.length === 0 || unreadable ? 'missing cost' : formatPln(sum), unreadable };
  });
  return { views, unplaced, problems };
}

export interface BagLine {
  readonly label: string;
  readonly coffee: string;
  readonly items: string;
  /** "missing cost" when the size has no (readable) cost items. */
  readonly total: string;
  readonly missing: boolean;
  /**
   * One per markup: "2×"; the suggested price (gross, whole złoty, e.g. "59 zł") and its net; and the exact net and
   * gross before rounding (for "Show calculation").
   */
  readonly prices: readonly {
    readonly markup: string;
    /** The suggested gross price in grosze (whole złoty), to pick on the Price list. */
    readonly suggestedGrossGrosze: number;
    readonly suggestedGross: string;
    readonly suggestedNet: string;
    readonly net: string;
    readonly gross: string;
  }[];
}

export interface LotCard {
  readonly lot: Lot;
  readonly title: string;
  readonly subtitle: string;
  /** Why the lot cannot be calculated (e.g. the price is missing); empty when it can. */
  readonly missing: string;
  readonly greenPerKg: string;
  readonly loss: string;
  /** "average of 23 roasts", "your own", "default: no roasts yet". */
  readonly lossSource: string;
  /** The loss in use, in tenths of a percent (for the Change form). */
  readonly lossTenths: number;
  readonly ownLoss: LotCost | undefined;
  readonly roastedFromKg: string;
  readonly roastedPerKg: string;
  readonly bags: readonly BagLine[];
}

const money = (grosze: number) => formatPln(roundGrosze(grosze));

/** The green coffee each roast took from each lot (from the stock allocation, so splits are counted right). */
export function sharesByLot(lots: readonly Lot[], roasts: readonly Roast[]): Map<string, RoastShare[]> {
  const allocation = allocate(lots, roasts);
  const byId = new Map(roasts.map((r) => [r.id, r]));
  const shares = new Map<string, RoastShare[]>();
  for (const [roastId, result] of allocation.roasts) {
    const roast = byId.get(roastId);
    if (!roast || result.status === 'not-counted' || roast.greenGrams === null) continue;
    for (const part of result.parts) {
      shares.set(part.lotId, [...(shares.get(part.lotId) ?? []), { partGrams: part.grams, greenGrams: roast.greenGrams, roastedDecigrams: roast.roastedDecigrams }]);
    }
  }
  return shares;
}

/** One card per active lot, newest delivery first. */
export function lotCards(
  lots: readonly Lot[],
  roasts: readonly Roast[],
  lotCosts: readonly LotCost[],
  sizes: readonly BagSizeView[],
  settings: CostSettings,
): { cards: LotCard[]; problems: string[] } {
  const problems: string[] = [];
  const shares = sharesByLot(lots, roasts);
  const bags: BagInput[] = sizes.map((v) => ({
    id: v.id,
    grams: v.grams,
    itemsGrosze: v.unreadable ? [] : v.costs.map((c) => c.costGrosze ?? 0),
  }));
  const active = sortLots(lots.filter((lot) => !isDeleted(lot))); // the same order as the Lots page
  const cards = active.map((lot): LotCard => {
    const own = lotCosts.find((c) => c.deletedAt === '' && c.lotId === lot.id);
    if (own && own.lossTenths === null && own.lossText !== '') {
      problems.push(`The roast loss "${own.lossText}" saved for ${lot.code} cannot be read; the average of its roasts is used instead.`);
    }
    const lotShares = shares.get(lot.id) ?? [];
    const average = averageLoss(lotShares);
    const weighed = lotShares.filter((s) => s.roastedDecigrams !== null && s.roastedDecigrams > 0 && s.partGrams > 0).length;
    const nonsense = average === null && weighed > 0;
    if (nonsense && !(own && own.lossTenths !== null)) {
      problems.push(`The roasts of ${lot.code} give a roast loss below 0 % or of 100 % or more, so the default loss is used. Check their weights on the Roasts page.`);
    }
    const { loss, source } = chooseLoss(own?.lossTenths ?? null, average, settings);
    const price = lot.coffeePriceGrosze === null ? null : lot.coffeePriceGrosze + (lot.deliveryCostGrosze ?? 0);
    const calc = calculateLot(price, lot.quantityGrams, loss, bags, settings);
    const lossTenths = Math.round(loss * 1000);
    const lossSource =
      source.kind === 'own'
        ? 'your own'
        : source.kind === 'average'
          ? `average of ${source.roasts} roast${source.roasts === 1 ? '' : 's'}`
          : nonsense
            ? 'default: the roast weights do not make sense'
            : 'default: no roasts with both weights yet';
    const base = {
      lot,
      title: `${lot.code} · ${lot.name}`,
      subtitle: [lot.deliveryDate && `delivered ${lot.deliveryDate}`, lot.country].filter((t) => t).join(' · '),
      loss: formatPercent(lossTenths),
      lossTenths,
      lossSource,
      ownLoss: own,
    };
    if (!calc) {
      const missing =
        lot.coffeePriceGrosze === null
          ? 'Price missing: click "Add price" below.'
          : 'Quantity missing: add the kg delivered on the Lots page (Edit).';
      return { ...base, missing, greenPerKg: '', roastedFromKg: '', roastedPerKg: '', bags: [] };
    }
    return {
      ...base,
      missing: '',
      greenPerKg: `${money(calc.greenPerKg)} / kg`,
      roastedFromKg: formatKg(Math.round(calc.roastedFromKg * 1000)),
      roastedPerKg: `${money(calc.roastedPerKg)} / kg`,
      bags: calc.bags.map((bag, i) => ({
        label: sizes[i]?.label ?? formatBagSize(bag.grams),
        coffee: money(bag.coffee),
        items: bag.items === null ? 'missing cost' : money(bag.items),
        total: bag.total === null ? 'missing cost' : money(bag.total),
        missing: bag.total === null,
        prices: bag.prices.map((p) => ({
          markup: formatMarkup(p.markupHundredths),
          suggestedGrossGrosze: p.suggestedGross,
          suggestedGross: formatWholePln(p.suggestedGross),
          suggestedNet: money(p.suggestedNet),
          net: money(p.net),
          gross: money(p.gross),
        })),
      })),
    };
  });
  return { cards, problems };
}
