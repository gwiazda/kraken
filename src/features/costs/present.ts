// What the Costs & prices page shows, as plain text, so it is tested without a browser. Joins the lots, the roasts
// (for the average roast loss) and the cost tabs, and runs the calculation.

import { formatKg, formatPln } from '../../core/numbers';
import { isDeleted, sortLots, type Lot } from '../lots';
import { allocate, type Roast } from '../roasts';
import { formatBagSize, formatMarkup, formatPercent, type BagCost, type BagSize, type CostSettings, type LotCost } from './model';
import { averageLoss, calculateLot, chooseLoss, roundGrosze, type BagInput, type RoastShare } from './modelCalc';

export interface BagSizeView {
  readonly size: BagSize;
  readonly label: string;
  readonly costs: readonly BagCost[];
  /** Net cost of the items together, e.g. "1,15 zł"; "missing cost" when none are entered. */
  readonly itemsText: string;
  readonly unreadable: boolean;
}

/** The active bag sizes, smallest first, with their active cost items. Unreadable sizes are left out (reported). */
export function bagSizeViews(sizes: readonly BagSize[], costs: readonly BagCost[]): { views: BagSizeView[]; problems: string[] } {
  const problems: string[] = [];
  const views: BagSizeView[] = [];
  for (const size of sizes.filter((s) => s.deletedAt === '')) {
    if (size.grams === null) {
      problems.push(`Row ${size.row} of the Bag sizes tab has a size Kraken cannot read ("${size.source.size_g ?? ''}"); it is left out.`);
      continue;
    }
    const own = costs.filter((c) => c.deletedAt === '' && c.bagSizeId === size.id);
    const unreadable = own.some((c) => c.costGrosze === null);
    for (const c of own.filter((c) => c.costGrosze === null)) {
      problems.push(`The cost "${c.costText}" of ${c.item || 'an item'} (${formatBagSize(size.grams)}) cannot be read, so that bag size shows "missing cost". Edit it below.`);
    }
    const sum = own.reduce((total, c) => total + (c.costGrosze ?? 0), 0);
    views.push({
      size,
      label: formatBagSize(size.grams),
      costs: own,
      itemsText: own.length === 0 || unreadable ? 'missing cost' : formatPln(sum),
      unreadable,
    });
  }
  views.sort((a, b) => (a.size.grams ?? 0) - (b.size.grams ?? 0));
  return { views, problems };
}

export interface BagLine {
  readonly label: string;
  readonly coffee: string;
  readonly items: string;
  /** "missing cost" when the size has no (readable) cost items. */
  readonly total: string;
  readonly missing: boolean;
  /** One per markup: "2×", net and gross. */
  readonly prices: readonly { readonly markup: string; readonly net: string; readonly gross: string }[];
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
    id: v.size.id,
    grams: v.size.grams ?? 0,
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
          ? 'Price missing: add the coffee price on the Lots page (Edit).'
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
        prices: bag.prices.map((p) => ({ markup: formatMarkup(p.markupHundredths), net: money(p.net), gross: money(p.gross) })),
      })),
    };
  });
  return { cards, problems };
}
