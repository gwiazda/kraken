// The Special prices section on a client's page (owner, 2026-11-20): the net prices agreed with this client, each
// with what they would pay otherwise and what it earns; add, change, delete and restore a deal. It loads on its own
// (the products and their costs, the deals), so the client form never waits for it, and saves each change at once.

import { formatWholePln } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize, isBagSize } from '../../domain/bagSizes';
import { busy, button, el, infoTip, message } from '../../ui/dom';
import { loadProductsWithCosts, isProductDeleted, sortProducts, type ProductsRepository, type ProductsWithCosts } from '../products';
import type { CostsRepository } from '../costs';
import type { LotsRepository } from '../lots';
import type { RoastsRepository } from '../roasts';
import type { Client } from './model';
import { canRestoreDeal, changedDealFields, dealPriceChange, dealsOf, isDealDeleted, validateDeal, type DealErrors, type DealForm, type SpecialPrice } from './modelPrices';
import { dealRows } from './presentPrices';
import type { SpecialPricesRepository } from './repoPrices';

export interface PricesSectionDeps {
  prices: SpecialPricesRepository;
  products: ProductsRepository;
  costs: CostsRepository;
  lots: LotsRepository;
  roasts: RoastsRepository;
  whoAmI: () => Promise<string>;
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  now: () => Date;
  busy: (on: boolean) => void;
  /**
   * Google's error with its buttons (sign in again, try again), as on the rest of the page. `mayHaveSaved`: after a
   * save (the page's reload button then says it drops the client form above).
   */
  errorNodes: (error: unknown, retry: () => void, retryLabel: string, show: (e: unknown) => void, mayHaveSaved: boolean) => Node[];
}

const MARGIN_TIP =
  'Marża brutto: część ceny netto, która zostaje Ci po zapłaceniu za torebkę (kawę i opakowanie). 50 % znaczy, że z każdych 100 zł netto 50 zł jest Twoje.';

export function pricesSection(client: Client, deps: PricesSectionDeps): HTMLElement {
  const body = el('div', {}, busy('Wczytuję ceny specjalne…'));
  const section = el(
    'section',
    { class: 'form-section special-prices' },
    el(
      'h3',
      {},
      'Ceny specjalne ',
      infoTip(
        `Ceny netto (bez VAT) ustalone z ${client.name} dla jednego produktu i wielkości torebki. W Ofercie wybierz ${client.name} i zaznacz „Użyj cen specjalnych”: ta wielkość pokaże wtedy tylko tę cenę. Cena obowiązuje, dopóki jej nie zmienisz lub nie usuniesz; nie zmienia się, gdy zmienia się cena detaliczna.`,
      ),
    ),
    body,
  );
  let found: ProductsWithCosts | null = null;
  let deals: SpecialPrice[] = [];
  let problems: string[] = [];

  const show = (...children: (Node | string)[]) => body.replaceChildren(...children);

  function load(note?: string, fromClick = false): void {
    show(busy('Wczytuję ceny specjalne…'));
    const all = () => Promise.all([deps.prices.load(), loadProductsWithCosts(deps)]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([stored, products]) => {
        if (!section.isConnected) return; // the client's page was left meanwhile
        deals = stored.deals.filter((d) => d.clientId === client.id);
        found = products;
        problems = [...stored.problems, ...products.problems, ...dealsOf(deals, client.id).flatMap((d) => d.problems)];
        showDeals(note);
      })
      .catch((error: unknown) => {
        if (deps.isIgnorable(error)) return;
        const again = (e: unknown) => show(...deps.errorNodes(e, () => load(undefined, true), 'Zaloguj się i pokaż ceny specjalne', again, false));
        again(error);
      });
  }

  /** Reads only the deals again (after a save: the products and their costs have not changed). */
  function reloadDeals(note: string): Promise<void> {
    return deps.prices.load().then((stored) => {
      deals = stored.deals.filter((d) => d.clientId === client.id);
      problems = [...stored.problems, ...(found?.problems ?? []), ...dealsOf(deals, client.id).flatMap((d) => d.problems)];
      showDeals(note);
    });
  }

  /** Saves one change inside the click, then reads the deals again. */
  function save(action: () => Promise<void>, done: string, slot: HTMLElement, retry: () => void): void {
    for (const node of body.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')) node.disabled = true;
    slot.replaceChildren(busy('Zapisuję…'));
    deps.busy(true);
    deps
      .withGoogle(async () => {
        await action();
        await reloadDeals(done);
      })
      .finally(() => deps.busy(false))
      .catch((error: unknown) => {
        if (deps.isIgnorable(error)) return showDeals();
        const again = (e: unknown) => showDeals(undefined, deps.errorNodes(e, retry, 'Zaloguj się i spróbuj ponownie', again, true));
        again(error);
      });
  }

  function showDeals(note?: string, error?: Node[]): void {
    if (!found) return;
    const { products, bagCosts, vatTenths } = found;
    const active = sortProducts(products).filter((p) => !isProductDeleted(p));
    const rows = dealRows(deals, client.id, products, client.discountTenths, vatTenths, bagCosts);
    const deleted = deals.filter(isDealDeleted);

    const row = (r: (typeof rows)[number]) => {
      const actions = el('td', { class: 'row-actions nowrap' });
      const priceCell = el('td', { class: 'num nowrap' }, el('strong', {}, r.price));
      const normal = () => {
        priceCell.replaceChildren(el('strong', {}, r.price));
        actions.replaceChildren(button('Zmień', change, 'link'), button('Usuń', remove, 'link'));
      };
      const change = () => {
        const input = el('input', { type: 'text', inputmode: 'decimal', class: 'input-xs', 'aria-label': `Nowa cena netto dla ${r.product} ${r.size}` });
        input.value = r.deal.netGrosze === null ? '' : String(r.deal.netGrosze / 100).replace('.', ',');
        const errorLine = el('span', { class: 'field-error', role: 'alert' });
        const form = el('form', { class: 'inline-form', novalidate: '' }, input, ' zł ', el('button', { type: 'submit', class: 'btn btn-primary' }, 'Zapisz'), button('Anuluj', normal, 'secondary'), errorLine);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const result = dealPriceChange(r.deal, input.value, products.find((p) => p.id === r.deal.productId));
          if (!result.ok) {
            errorLine.textContent = result.error;
            return;
          }
          const fields = changedDealFields(r.deal, result.fields);
          if (Object.keys(fields).length === 0) return normal();
          const go = () => save(() => deps.prices.update(r.deal, fields, deps.now()), `Zapisano cenę dla ${r.product} ${r.size}.`, actions, go);
          go();
        });
        priceCell.replaceChildren(form);
        actions.replaceChildren();
        input.focus();
      };
      const remove = () => {
        const go = () => save(() => deps.prices.remove(r.deal, deps.now()), `Usunięto cenę dla ${r.product} ${r.size}. Można ją przywrócić poniżej.`, actions, go);
        go();
      };
      normal();
      const notes = [
        ...(r.unusable ? [el('span', { class: 'deal-note' }, `Nie trafia do ofert: ${r.unusable}.`)] : []),
        ...(r.retailChanged ? [el('span', { class: 'deal-note' }, r.retailChanged)] : []),
      ];
      return el(
        'tr',
        r.unusable ? { class: 'row-deleted' } : {},
        el('td', {}, el('strong', {}, r.product), ...notes),
        el('td', { class: 'nowrap' }, r.size),
        priceCell,
        el('td', { class: 'muted small' }, r.insteadOf || '—'),
        el('td', { class: `nowrap small${r.losing ? ' losing' : ''}` }, r.earn || el('span', { class: 'muted' }, 'koszt nieznany')),
        actions,
      );
    };

    // Adding a deal: product, then a size it has a price for, then the price.
    const form: DealForm = { productId: '', grams: '', price: '' };
    const productSelect = el('select', { 'aria-label': 'Produkt' }, el('option', { value: '' }, 'Wybierz produkt…'), ...active.map((p) => el('option', { value: p.id }, p.name)));
    const sizeSelect = el('select', { 'aria-label': 'Wielkość torebki' });
    const priceInput = el('input', { type: 'text', inputmode: 'decimal', class: 'input-xs', 'aria-label': 'Cena netto', placeholder: 'np. 38' });
    const errorLine = el('p', { class: 'field-error', role: 'alert' });
    const sizes = () => {
      const product = active.find((p) => p.id === productSelect.value);
      const available = BAG_SIZES_G.filter((g) => product?.prices[g] !== undefined);
      sizeSelect.replaceChildren(el('option', { value: '' }, 'Wielkość…'), ...available.map((g) => el('option', { value: String(g) }, formatBagSize(g))));
      if (available.length === 1) sizeSelect.value = String(available[0]);
    };
    productSelect.addEventListener('change', sizes);
    sizes();
    const addButton = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Dodaj');
    const addForm = el('form', { class: 'inline-form deal-add', novalidate: '' }, productSelect, sizeSelect, priceInput, ' zł netto ', addButton, errorLine);
    addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      form.productId = productSelect.value;
      form.grams = isBagSize(Number(sizeSelect.value)) ? sizeSelect.value : '';
      form.price = priceInput.value;
      const result = validateDeal(form, client.id, products, dealsOf(deals, client.id));
      if (!result.ok) {
        const e: DealErrors = result.errors;
        errorLine.textContent = [e.productId, e.grams, e.price].filter((t) => t).join(' ');
        return;
      }
      const go = () => save(async () => deps.prices.add(result.fields, await deps.whoAmI(), deps.now()), 'Dodano cenę specjalną.', addButton, go);
      go();
    });

    const restoreRow = (d: SpecialPrice) => {
      const product = products.find((p) => p.id === d.productId);
      const label = `${product?.name ?? '?'} ${d.grams === null ? '?' : formatBagSize(d.grams)}`;
      const cell = el('td', { class: 'row-actions nowrap' });
      if (canRestoreDeal(d, deals)) {
        const go = () => save(() => deps.prices.restore(d, deps.now()), `Przywrócono cenę dla ${label}.`, cell, go);
        cell.append(button('Przywróć', go, 'link'));
      } else cell.append(el('span', { class: 'muted small' }, 'jest dla niej nowsza cena'));
      return el('tr', { class: 'row-deleted' }, el('td', {}, label), el('td', { class: 'num nowrap' }, d.netGrosze === null ? '?' : formatWholePln(d.netGrosze)), cell);
    };

    show(
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      rows.length === 0
        ? el('p', { class: 'muted small' }, `${client.name} nie ma jeszcze cen specjalnych.`)
        : el(
            'div',
            { class: 'table-wrap' },
            el(
              'table',
              { class: 'data-table deal-table' },
              el(
                'thead',
                {},
                el(
                  'tr',
                  {},
                  el('th', { scope: 'col' }, 'Produkt'),
                  el('th', { scope: 'col' }, 'Wielkość'),
                  el('th', { scope: 'col', class: 'num' }, 'Ich cena (netto)'),
                  el('th', { scope: 'col' }, 'Zwykła cena'),
                  el('th', { scope: 'col' }, 'Zarabiasz na torebce ', infoTip(MARGIN_TIP)),
                  el('th', { scope: 'col' }, ''),
                ),
              ),
              el('tbody', {}, ...rows.map(row)),
            ),
          ),
      el('p', { class: 'small' }, el('strong', {}, 'Dodaj cenę specjalną')),
      addForm,
      ...(deleted.length > 0
        ? [el('details', { class: 'small deleted-products' }, el('summary', {}, `Usunięte ceny specjalne (${deleted.length})`), el('table', { class: 'data-table' }, el('tbody', {}, ...deleted.map(restoreRow))))]
        : []),
    );
  }

  load();
  return section;
}
