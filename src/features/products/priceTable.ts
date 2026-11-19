// The prices table (retail and each wholesale discount, per bag size, with what each price earns), shared by a
// product's page and the Product planner so both always look and work the same (owner, 2026-11-19).

import { el } from '../../ui/dom';
import { discountHeader, type PriceCell, type PriceRow } from './present';

function priceCell(cell: PriceCell, extra = ''): HTMLTableCellElement {
  return el(
    'td',
    { class: `num nowrap${extra}` },
    el('strong', { class: 'price-main' }, cell.main),
    ...(cell.other ? [el('span', { class: 'price-other' }, cell.other)] : []),
    ...(cell.earn ? [el('span', { class: cell.losing ? 'price-earn-line losing' : 'price-earn-line' }, cell.earn)] : []),
  );
}

/** One row per size: the retail price, then one column per discount (its name on top). */
export function pricesTable(rows: readonly PriceRow[], discounts: readonly { tenths: number; name: string }[]): HTMLElement {
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      { class: 'data-table product-prices' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col' }, ''),
          el('th', { scope: 'col', class: 'num col-retail' }, 'Retail'),
          ...discounts.map((d) => el('th', { scope: 'col', class: 'num' }, d.name ? el('span', { class: 'col-name' }, d.name) : 'Wholesale', el('br'), discountHeader(d.tenths))),
        ),
      ),
      el('tbody', {}, ...rows.map((r) => el('tr', {}, el('th', { scope: 'row' }, r.size), priceCell(r.retail, ' col-retail'), ...r.wholesale.map((c) => priceCell(c))))),
    ),
  );
}

/** The cost of one bag per size (grosze), from the costing rows, for "earns" in the table. */
export const costsBySize = (rows: readonly { grams: number; costGrosze: number | null }[]): Partial<Record<number, number>> =>
  Object.fromEntries(rows.flatMap((r) => (r.costGrosze === null ? [] : [[r.grams, r.costGrosze] as const])));
