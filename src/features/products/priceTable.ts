// The prices table (retail and each wholesale discount, per bag size, with what each price earns), shared by a
// product's page and the Product planner so both always look and work the same (owner, 2026-11-19).

import { el, infoTip } from '../../ui/dom';
import { discountHeader, type CompareRow, type PriceCell, type PriceRow } from './present';

/** What gross margin means, in plain words (owner, 2026-11-19: clear and transparent), for every tooltip that shows it. */
export const MARGIN_TIP =
  'Marża brutto: część ceny netto, która zostaje Ci po zapłaceniu za torebkę (kawę i opakowanie). 50 % znaczy, że z każdych 100 zł netto 50 zł jest Twoje. Im wyżej, tym lepiej; poniżej 0 % tracisz na każdej torebce.';

/** A wholesale column's header: the discount's name on top, then "−15 %". */
const discountTh = (d: { tenths: number; name: string }) =>
  el('th', { scope: 'col', class: 'num' }, d.name ? el('span', { class: 'col-name' }, d.name) : 'Hurt', el('br'), discountHeader(d.tenths));

function priceCell(cell: Pick<PriceCell, 'main' | 'earn' | 'margin' | 'losing' | 'marginLosing'> & { other?: string }, extra = ''): HTMLTableCellElement {
  return el(
    'td',
    { class: `num nowrap${extra}` },
    cell.main ? el('strong', { class: 'price-main' }, cell.main) : el('span', { class: 'muted' }, '—'),
    ...(cell.other ? [el('span', { class: 'price-other' }, cell.other)] : []),
    ...(cell.earn ? [el('span', { class: cell.losing ? 'price-earn-line losing' : 'price-earn-line' }, cell.earn)] : []),
    ...(cell.margin ? [el('span', { class: cell.marginLosing ? 'price-earn-line price-margin-line losing' : 'price-earn-line price-margin-line' }, cell.margin)] : []),
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
          el('th', { scope: 'col', class: 'num col-retail' }, 'Detal ', infoTip(`Ile płaci klient w sklepie, z VAT. Pod każdą ceną, gdy znany jest koszt torebki: ile zarabiasz na torebce (netto) i marża brutto. ${MARGIN_TIP}`)),
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
          el('th', { scope: 'col' }, 'Produkt'),
          el('th', { scope: 'col', class: 'num' }, 'Koszt torebki ', infoTip('Ile kosztuje Cię jedna torebka: kawa z jej ziaren plus opakowanie, netto.')),
          el('th', { scope: 'col', class: 'num' }, 'Cena detaliczna ', infoTip(`Ile płaci klient w sklepie, z VAT. Kolumny hurtowe pokazują cenę po każdym rabacie, netto. Pod każdą ceną: ile zarabiasz na torebce i marża brutto. ${MARGIN_TIP}`)),
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
            el('th', { scope: 'row' }, r.isPlan ? '▶ Ten plan' : r.name),
            el('td', { class: 'num nowrap' }, r.cost || muted(r.note)),
            priceCell({ ...r, main: r.price }),
            ...r.atDiscounts.map((a) => priceCell({ ...a, main: a.price })),
          ),
        ),
      ),
    ),
  );
}

