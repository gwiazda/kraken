// What a client's Special prices section shows, as plain text, so it is tested without a browser: each deal with
// what the client would pay otherwise, what one bag earns and the gross margin, and a note when the retail price
// has changed since the deal was set or the deal is not used.

import { formatPln, formatWholePln } from '../../core/numbers';
import { formatBagSize } from '../../domain/bagSizes';
import { formatPercent, marginText } from '../../domain/percent';
import { grossMarginPercent, netOf, roundGrosze, wholesalePrice } from '../../domain/prices';
import { dealUnusable, dealsOf, type DealProduct, type SpecialPrice } from './modelPrices';

export interface DealRow {
  readonly deal: SpecialPrice;
  /** "KENIA" ('?' when the product is not in the list) */
  readonly product: string;
  /** "250 g" ('?' when the cell cannot be read) */
  readonly size: string;
  /** "38 zł", "38,50 zł" */
  readonly price: string;
  /**
   * What they would pay without the deal: at each discount (it depends on the invoice's weight, owner 2026-11-27),
   * named as in Packaging & discounts, "zamiast 41 zł (Do 10 kg) / 36 zł (10–20 kg) / 34 zł (20+ kg)" (a discount
   * without a name: "−15 %"); with no discounts set, "zamiast 47,97 zł (cena detaliczna netto)"; '' when unknown.
   */
  readonly insteadOf: string;
  /** "zarabiasz 13,85 zł · marża 36 %" / "strata 2,10 zł · marża −6 %"; '' when the cost of a bag is not known. */
  readonly earn: string;
  readonly losing: boolean;
  /** "Cena detaliczna przy ustalaniu tej ceny: 59 zł, teraz 64 zł."; '' when unchanged. */
  readonly retailChanged: string;
  /** Why it is not used on offers ('' when it is). */
  readonly unusable: string;
}

/**
 * A client's deals (not deleted), by product name and size. `discounts`: the wholesale discounts of Packaging &
 * discounts, lowest first (as `activeDiscounts` gives them); `bagCosts`: the cost of one bag per product and size (grosze).
 */
export function dealRows(
  deals: readonly SpecialPrice[],
  clientId: string,
  products: readonly DealProduct[],
  discounts: readonly { readonly tenths: number; readonly name: string }[],
  vatTenths: number,
  bagCosts: ReadonlyMap<string, Partial<Record<number, number>>>,
): DealRow[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return dealsOf(deals, clientId)
    .map((deal): DealRow => {
      const product = byId.get(deal.productId);
      const retail = product && deal.grams !== null ? product.prices[deal.grams] : undefined;
      const insteadOf =
        retail === undefined
          ? ''
          : discounts.length > 0
            ? `zamiast ${discounts.map((d) => `${formatWholePln(wholesalePrice(retail, d.tenths, vatTenths).net)} (${d.name || `−${formatPercent(d.tenths)}`})`).join(' / ')}`
            : `zamiast ${formatPln(roundGrosze(netOf(retail, vatTenths)))} (cena detaliczna netto)`;
      const cost = deal.grams === null ? undefined : bagCosts.get(deal.productId)?.[deal.grams];
      let earn = '';
      let losing = false;
      if (cost !== undefined && deal.netGrosze !== null) {
        const earned = deal.netGrosze - cost;
        const amount = roundGrosze(Math.abs(earned));
        losing = earned < 0 && amount > 0;
        earn = `${losing ? 'strata' : 'zarabiasz'} ${formatPln(amount)} · marża ${marginText(grossMarginPercent(deal.netGrosze, cost))}`;
      }
      const retailChanged =
        retail !== undefined && deal.retailAtDeal !== null && retail !== deal.retailAtDeal
          ? `Cena detaliczna przy ustalaniu tej ceny: ${formatWholePln(deal.retailAtDeal)}, teraz ${formatWholePln(retail)}.`
          : '';
      return {
        deal,
        product: product?.name ?? '?',
        size: deal.grams === null ? '?' : formatBagSize(deal.grams),
        price: deal.netGrosze === null ? '?' : formatWholePln(deal.netGrosze),
        insteadOf,
        earn,
        losing,
        retailChanged,
        unusable: dealUnusable(deal, product),
      };
    })
    .sort((a, b) => a.product.localeCompare(b.product, 'pl') || (a.deal.grams ?? 0) - (b.deal.grams ?? 0));
}
