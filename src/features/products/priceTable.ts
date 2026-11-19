// The prices table (retail and each wholesale discount, per bag size, with what each price earns), shared by a
// product's page and the Product planner so both always look and work the same (owner, 2026-11-19).

import { el, infoTip } from '../../ui/dom';
import { discountHeader, type CompareRow, type PriceCell, type PriceRow } from './present';

/** A wholesale column's header: the discount's name on top, then "−15 %". */
const discountTh = (d: { tenths: number; name: string }) =>
  el('th', { scope: 'col', class: 'num' }, d.name ? el('span', { class: 'col-name' }, d.name) : 'Wholesale', el('br'), discountHeader(d.tenths));

function priceCell(cell: Pick<PriceCell, 'main' | 'earn' | 'losing'> & { other?: string }, extra = ''): HTMLTableCellElement {
  return el(
    'td',
    { class: `num nowrap${extra}` },
    cell.main ? el('strong', { class: 'price-main' }, cell.main) : el('span', { class: 'muted' }, '—'),
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
          ...discounts.map(discountTh),
        ),
      ),
      el('tbody', {}, ...rows.map((r) => el('tr', {}, el('th', { scope: 'row' }, r.size), priceCell(r.retail, ' col-retail'), ...r.wholesale.map((c) => priceCell(c))))),
    ),
  );
}

/** The cost of one bag per size (grosze), from the costing rows, for "earns" in the table. */
export const costsBySize = (rows: readonly { grams: number; costGrosze: number | null }[]): Partial<Record<number, number>> =>
  Object.fromEntries(rows.flatMap((r) => (r.costGrosze === null ? [] : [[r.grams, r.costGrosze] as const])));

/**
 * The Product planner's comparison: one row per product and the plan (highlighted), for one bag size: cost of a bag,
 * retail price and what it earns, then at each wholesale discount the price after it and what it earns.
 */
export function compareTable(rows: readonly CompareRow[], discounts: readonly { tenths: number; name: string }[]): HTMLElement {
  const muted = (text: string) => el('span', { class: 'muted small' }, text || '—');
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      { class: 'data-table compare-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col' }, 'Product'),
          el('th', { scope: 'col', class: 'num' }, 'Cost of a bag ', infoTip('What one bag costs you: the coffee from its beans plus the packaging, without VAT.')),
          el('th', { scope: 'col', class: 'num' }, 'Retail price ', infoTip('What a shop customer pays, with VAT. The wholesale columns show the price after each discount, without VAT, and what one bag earns at it.')),
          ...discounts.map(discountTh),
        ),
      ),
      el(
        'tbody',
        {},
        ...rows.map((r) =>
          el(
            'tr',
            r.isPlan ? { class: 'compare-plan' } : {},
            el('th', { scope: 'row' }, r.isPlan ? '▶ This plan' : r.name),
            el('td', { class: 'num nowrap' }, r.cost || muted(r.note)),
            priceCell({ main: r.price, earn: r.earn, losing: r.losing }),
            ...r.atDiscounts.map((a) => priceCell({ main: a.price, earn: a.earn, losing: a.losing })),
          ),
        ),
      ),
    ),
  );
}

