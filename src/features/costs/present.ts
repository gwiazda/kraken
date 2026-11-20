// The cost calculation as plain text (bag costs per size, lot cards for suggestions and roast loss), so it is tested without a browser. Joins the lots, the roasts
// (for the average roast loss) and the cost tabs, and runs the calculation.

import { formatKg, formatPln, formatWholePln } from '../../core/numbers';
import { plural } from '../../core/polish';
import { isDeleted, sortLots, type Lot } from '../lots';
import { allocate, type Roast } from '../roasts';
import { BAG_SIZES_G, formatBagSize } from '../../domain/bagSizes';
import type { CostData } from './repo';
import { activeDiscounts, type Discount } from './modelDiscounts';
import { readSettings, formatMarkup, formatPercent, type BagCost, type CostSettings, type LotCost } from './model';
import { roundGrosze } from '../../domain/prices';
import { averageLoss, calculateLot, chooseLoss, type BagInput, type RoastShare } from './modelCalc';

export interface BagSizeView {
  readonly grams: number;
  /** As stored in the Bag costs tab ("250"). */
  readonly id: string;
  readonly label: string;
  readonly costs: readonly BagCost[];
  /** Net cost of the items together, e.g. "1,15 zł"; "brak kosztu" when none are entered. */
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
      `Pozycje kosztów opakowań (${unplaced.length}) dotyczą wielkości torebki, której Kraken nie używa, więc są pomijane. Usuń je w zakładce Opakowania i rabaty i dodaj ponownie do 250 g, 500 g albo 1 kg.`,
    );
  }
  const views = BAG_SIZES_G.map((grams): BagSizeView => {
    const id = String(grams);
    const own = active.filter((c) => c.bagSizeId === id);
    const unreadable = own.some((c) => c.costGrosze === null);
    for (const c of own.filter((c) => c.costGrosze === null)) {
      problems.push(`Nie da się odczytać kosztu „${c.costText}” (${c.item || 'pozycja'}, ${formatBagSize(grams)}), więc ta wielkość torebki pokazuje „brak kosztu”. Kliknij go w zakładce Opakowania i rabaty, aby poprawić.`);
    }
    const sum = own.reduce((total, c) => total + (c.costGrosze ?? 0), 0);
    return { grams, id, label: formatBagSize(grams), costs: own, itemsText: own.length === 0 || unreadable ? 'brak kosztu' : formatPln(sum), unreadable };
  });
  return { views, unplaced, problems };
}

export interface BagLine {
  readonly grams: number;
  readonly label: string;
  readonly coffee: string;
  readonly items: string;
  /** "brak kosztu" when the size has no (readable) cost items. */
  readonly total: string;
  readonly missing: boolean;
  /**
   * One per markup: "2×"; the suggested price (gross, whole złoty, e.g. "59 zł") and its net; and the exact net and
   * gross before rounding (for "Show calculation").
   */
  readonly prices: readonly {
    readonly markup: string;
    /** The suggested gross price in grosze (whole złoty), to pick in the product form. */
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
  /** Green price per kg (grosze, not rounded) from the calculation; null when the price or quantity is missing. */
  readonly greenPerKgGrosze: number | null;
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
      problems.push(`Nie da się odczytać ubytku „${own.lossText}” zapisanego dla ${lot.code}; zamiast niego używana jest średnia z jej wypałów.`);
    }
    const lotShares = shares.get(lot.id) ?? [];
    const average = averageLoss(lotShares);
    const weighed = lotShares.filter((s) => s.roastedDecigrams !== null && s.roastedDecigrams > 0 && s.partGrams > 0).length;
    const nonsense = average === null && weighed > 0;
    if (nonsense && !(own && own.lossTenths !== null)) {
      problems.push(`Wypały dostawy ${lot.code} dają ubytek poniżej 0 % albo 100 % i więcej, więc używany jest zwykły ubytek. Sprawdź ich wagi w zakładce Wypały.`);
    }
    const { loss, source } = chooseLoss(own?.lossTenths ?? null, average, settings);
    const price = lot.coffeePriceGrosze === null ? null : lot.coffeePriceGrosze + (lot.deliveryCostGrosze ?? 0);
    const calc = calculateLot(price, lot.quantityGrams, loss, bags, settings);
    const lossTenths = Math.round(loss * 1000);
    const lossSource =
      source.kind === 'own'
        ? 'Twój własny ubytek'
        : source.kind === 'average'
          ? `średnia z ${source.roasts} ${plural(source.roasts, 'wypału', 'wypałów', 'wypałów')}`
          : nonsense
            ? 'zwykły ubytek: wagi wypałów są niesensowne'
            : 'zwykły ubytek: brak wypałów z obiema wagami';
    const base = {
      lot,
      title: `${lot.code} · ${lot.name}`,
      loss: formatPercent(lossTenths),
      lossTenths,
      lossSource,
      ownLoss: own,
    };
    if (!calc) {
      const missing =
        lot.coffeePriceGrosze === null
          ? 'Brak ceny: kliknij „Dodaj cenę” poniżej.'
          : 'Brak ilości: wpisz dostarczone kg w zakładce Dostawy (kliknij dostawę).';
      return { ...base, missing, greenPerKg: '', greenPerKgGrosze: null, roastedFromKg: '', roastedPerKg: '', bags: [] };
    }
    return {
      ...base,
      missing: '',
      greenPerKg: `${money(calc.greenPerKg)} / kg`,
      greenPerKgGrosze: calc.greenPerKg,
      roastedFromKg: formatKg(Math.round(calc.roastedFromKg * 1000)),
      roastedPerKg: `${money(calc.roastedPerKg)} / kg`,
      bags: calc.bags.map((bag, i) => ({
        grams: bag.grams,
        label: sizes[i]?.label ?? formatBagSize(bag.grams),
        coffee: money(bag.coffee),
        items: bag.items === null ? 'brak kosztu' : money(bag.items),
        total: bag.total === null ? 'brak kosztu' : money(bag.total),
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

/** A lot as a product's bean (owner, 2026-11-18): what 1 kg of it costs green, and its roast loss. */
export interface BeanLot {
  readonly lotId: string;
  /** "KENYA-26-09 · Kegwa" */
  readonly label: string;
  /** Green price per kg (grosze, without VAT, with delivery); null when the lot has no price or quantity yet. */
  readonly greenPerKg: number | null;
  /** Tenths of a percent. */
  readonly lossTenths: number;
  /** "average of 23 roasts", "your own", "usual loss: …" */
  readonly lossSource: string;
}

/**
 * Everything the Products page needs: VAT and the usual loss, the wholesale discounts, every active lot as a bean
 * (newest delivery first) and the packaging cost of each bag size (null: not entered).
 */
export function pricingFor(
  data: CostData,
  lots: readonly Lot[],
  roasts: readonly Roast[],
): { settings: CostSettings; discounts: Discount[]; lots: BeanLot[]; packaging: ReadonlyMap<number, number | null>; problems: string[] } {
  const { settings, problems } = readSettings(data.settings);
  const discounts = activeDiscounts(data.discounts);
  const { views, problems: sizeProblems } = bagSizeViews(data.costs);
  const { cards, problems: cardProblems } = lotCards(lots, roasts, data.lotCosts, [], settings);
  const beanLots = cards.map((card) => ({ lotId: card.lot.id, label: card.title, greenPerKg: card.greenPerKgGrosze, lossTenths: card.lossTenths, lossSource: card.lossSource }));
  const packaging = new Map(views.map((v) => [v.grams, v.costs.length === 0 || v.unreadable ? null : v.costs.reduce((sum, c) => sum + (c.costGrosze ?? 0), 0)]));
  return { settings, discounts: discounts.discounts, lots: beanLots, packaging, problems: [...problems, ...discounts.problems, ...sizeProblems, ...cardProblems] };
}

/** A lot's roast loss for the Lots page: the one in use, where it comes from, and the owner's own value as typed. */
export interface LotLoss {
  /** Tenths of a percent (160 = 16 %). */
  readonly lossTenths: number;
  /** "average of 23 roasts", "your own", "usual: no roasts with both weights yet". */
  readonly source: string;
  /** The owner's own value as stored ("14.2"); '' when the average or the usual loss is used. */
  readonly own: string;
}

/**
 * The roast loss of every active lot (see lotCards: own value, else the average of its roasts, else the usual), and
 * the problems found on the way (an unreadable saved loss, roast weights that make no sense), for the Lots page.
 */
export function lotLosses(data: CostData, lots: readonly Lot[], roasts: readonly Roast[]): { losses: Map<string, LotLoss>; problems: string[] } {
  const { settings, problems: settingProblems } = readSettings(data.settings);
  const { cards, problems } = lotCards(lots, roasts, data.lotCosts, [], settings);
  const losses = new Map(cards.map((card) => [card.lot.id, { lossTenths: card.lossTenths, source: card.lossSource, own: card.ownLoss?.lossTenths != null ? card.ownLoss.lossText : '' }]));
  return { losses, problems: [...settingProblems, ...problems] };
}

