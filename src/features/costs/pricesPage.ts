// The Price list screen (owner, 2026-11-16): one row per coffee, one column per bag size.
// - "Main price": the gross price retail customers pay. Set it by clicking a suggested price (from Costs & prices)
//   or typing one; it is saved from today, older prices stay in the tab.
// - A discount (15 %, 25 %, 30 % or any typed %): the wholesale prices, net rounded to whole złoty, with the gross.
// Everything from outside comes through CostsPageDeps (main.ts provides it), like Costs & prices.

import { localDate } from '../../core/dates';
import { busy, button, el, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import type { Lot } from '../lots';
import type { Roast } from '../roasts';
import { formatPercent, parsePercent, percentText, readSettings } from './model';
import { priceFields, validatePrice } from './modelPrices';
import type { CostsPageDeps } from './page';
import { bagSizeViews, lotCards } from './present';
import { priceListRows, type CoffeeRow, type PriceCell } from './presentPrices';
import type { CostData } from './repo';

export function showPriceListPage(root: HTMLElement, deps: CostsPageDeps, fromClick = false): void {
  let data: CostData | null = null;
  let lots: Lot[] = [];
  let roasts: Roast[] = [];
  /** null: the main price; a number: wholesale at that discount (tenths of a percent). Kept after a save. */
  let discount: number | null = null;

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Loading the price list…')));
    const all = () => Promise.all([deps.repo.load(), deps.lots.load(), deps.roasts.load()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([costs, l, r]) => {
        if (!root.isConnected) return;
        data = costs;
        lots = l.lots;
        roasts = r.roasts;
        showPage(note);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) =>
          render(
            ...googleErrorNodes(e, deps, {
              retry: () => load(),
              retryLabel: 'Sign in and show the price list',
              show,
              other: { label: 'Try again', action: () => load(undefined, true), mayHaveSaved: false },
              signedOutNote: 'Nothing was lost.',
            }),
          );
        show(error);
      });
  }

  /** Saves, then reloads the page with `done` as the note; on failure keeps what was typed and explains in `slot`. */
  function save(slot: HTMLElement, action: () => Promise<void>, done: string): void {
    const locked = [...root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')].filter((node) => !node.disabled);
    for (const node of locked) node.disabled = true;
    slot.replaceChildren(busy('Saving…'));
    deps.busy(true);
    deps
      .withGoogle(action)
      .finally(() => deps.busy(false))
      .then(() => {
        if (root.isConnected) load(done);
      })
      .catch((error: unknown) => {
        if (!root.isConnected) return;
        for (const node of locked) node.disabled = false;
        slot.replaceChildren();
        if (deps.isIgnorable(error)) return;
        const show = (e: unknown) =>
          slot.replaceChildren(
            ...googleErrorNodes(e, deps, {
              retry: () => save(slot, action, done),
              retryLabel: 'Sign in and try again',
              show,
              other: { label: 'Reload the price list (drops what you typed)', action: () => load(undefined, true), mayHaveSaved: true },
            }),
          );
        show(error);
      });
  }

  function showPage(note?: string): void {
    if (!data) return;
    const { settings, problems: settingProblems } = readSettings(data.settings);
    const { views, problems: sizeProblems } = bagSizeViews(data.costs);
    const { cards } = lotCards(lots, roasts, data.lotCosts, views, settings); // its problems are shown on Costs & prices
    const today = localDate(deps.now());
    const { rows, problems } = priceListRows(cards, data.prices, settings, today, discount);

    const choice = (label: string, value: number | null) => {
      const b = button(label, () => ((discount = value), showPage()), 'link');
      if (value === discount) b.setAttribute('aria-current', 'page');
      return b;
    };
    const presets = settings.discountTenths;
    const other = otherDiscountForm(discount !== null && !presets.includes(discount) ? discount : null);

    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Price list')),
      el(
        'nav',
        { class: 'sub-nav', 'aria-label': 'Prices for' },
        choice('Main price', null),
        ...presets.map((d) => choice(`Wholesale −${formatPercent(d)}`, d)),
        other,
      ),
      ...(note ? [message(note)] : []),
      ...[...data.problems, ...settingProblems, ...sizeProblems, ...problems].map((text) => message(text, 'error')),
      el(
        'p',
        { class: 'muted small' },
        discount === null
          ? 'Main prices, gross: retail customers pay these. Wholesale prices are worked out from them.'
          : `Wholesale at −${formatPercent(discount)}: the main price without VAT, minus the discount, rounded to whole złoty (net). The gross is for the invoice.`,
      ),
      rows.length === 0 ? el('p', { class: 'muted' }, 'No coffees yet. Add lots on the Lots page.') : table(rows),
    );
  }

  /** "Other %": shows wholesale prices at any discount, without saving it. */
  function otherDiscountForm(current: number | null): HTMLElement {
    const input = el('input', { type: 'text', inputmode: 'decimal', id: 'other-discount', class: 'input-short', autocomplete: 'off', placeholder: '%' });
    if (current !== null) input.value = percentText(current).replace('.', ',');
    const error = el('span', { class: 'field-error', role: 'alert' });
    const form = el(
      'form',
      { class: 'inline-form', novalidate: '' },
      el('label', { for: input.id }, 'Other −'),
      input,
      ' % ',
      el('button', { type: 'submit', class: `btn ${current !== null ? 'btn-primary' : 'btn-secondary'}` }, 'Show'),
      error,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const tenths = parsePercent(input.value);
      if (typeof tenths !== 'number' || tenths === 0) {
        error.textContent = ' Enter a discount from 0,1 to 99,9, e.g. 20.';
        return;
      }
      discount = tenths;
      showPage();
    });
    return form;
  }

  function table(rows: readonly CoffeeRow[]): HTMLElement {
    const sizes = rows[0]?.cells.map((c) => c.label) ?? [];
    return el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'data-table price-table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Coffee'), ...sizes.map((s) => el('th', { scope: 'col', class: 'num' }, s)))),
        el(
          'tbody',
          {},
          ...rows.map((row) => el('tr', {}, el('th', { scope: 'row' }, row.title), ...row.cells.map((cell) => cellNode(row, cell)))),
        ),
      ),
    );
  }

  function cellNode(row: CoffeeRow, cell: PriceCell): HTMLElement {
    const td = el('td', { class: 'num' });
    const show = () => {
      const shown: Node[] = cell.main
        ? [el('strong', {}, cell.main), el('br'), el('span', { class: 'muted small nowrap' }, cell.other), el('br'), el('span', { class: 'muted small nowrap' }, cell.since)]
        : [el('span', { class: 'muted' }, '—')];
      const edit = discount === null ? [el('br'), button(cell.main ? 'Change' : 'Set price', () => editPrice(row, cell, td, show), 'link')] : [];
      td.replaceChildren(...shown, ...edit);
    };
    show();
    return td;
  }

  function editPrice(row: CoffeeRow, cell: PriceCell, td: HTMLElement, cancel: () => void): void {
    const id = `price-${row.key}-${cell.grams}`.replace(/[^\w-]/g, '_');
    const input = el('input', { type: 'text', inputmode: 'decimal', id, class: 'input-money', autocomplete: 'off' });
    if (cell.current?.grossGrosze != null) input.value = cell.current.grossText.replace('.', ',');
    const error = el('p', { class: 'field-error', role: 'alert' });
    const status = el('div', { class: 'save-status' });
    const suggestions = cell.suggestions.length
      ? el(
          'p',
          { class: 'small' },
          'Suggested: ',
          ...cell.suggestions.flatMap((s) => [
            button(`${s.text} (${s.markup})`, () => ((input.value = String(s.grosze / 100)), input.focus()), 'secondary'),
            ' ',
          ]),
        )
      : el('p', { class: 'muted small' }, 'No suggestion yet: add the lot price and bag costs under Costs & prices.');
    const form = el(
      'form',
      { class: 'price-form', novalidate: '' },
      suggestions,
      el('label', { for: id }, `Main price, gross zł (${cell.label}) `),
      input,
      ' ',
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'),
      ' ',
      button('Cancel', cancel, 'secondary'),
      status,
      error,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = validatePrice(input.value);
      if (!result.ok) {
        error.textContent = result.error;
        return;
      }
      save(
        status,
        async () => {
          const now = deps.now();
          await deps.repo.savePrice(priceFields(row.country, row.coffeeName, cell.grams, result.grosze, localDate(now)), await deps.whoAmI(), now);
        },
        `${row.title}, ${cell.label}: main price saved.`,
      );
    });
    td.replaceChildren(form);
    input.focus();
  }

  load(undefined, fromClick);
}
