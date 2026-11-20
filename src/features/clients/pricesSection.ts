// The Special prices section on a client's page (owner, 2026-11-20): the net prices agreed with this client, each
// with what they would pay otherwise and what it earns; add, change, delete and restore a deal. It loads on its own
// (the products and their costs, the deals), so the client form never waits for it, and saves each change at once.

import { formatPln } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize, isBagSize } from '../../domain/bagSizes';
import { busy, button, el, infoTip, message } from '../../ui/dom';
import { loadProductsWithCosts, isProductDeleted, sortProducts, type ProductsRepository, type ProductsWithCosts } from '../products';
import type { CostsRepository } from '../costs';
import type { LotsRepository } from '../lots';
import type { RoastsRepository } from '../roasts';
import type { Client } from './model';
import { canRestoreDeal, changedDealFields, dealsOf, isDealDeleted, validateDeal, type DealErrors, type DealForm, type SpecialPrice } from './modelPrices';
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
  /** Google's error with its buttons (sign in again, try again), as on the rest of the page. */
  errorNodes: (error: unknown, retry: () => void, retryLabel: string, show: (e: unknown) => void) => Node[];
}

const MARGIN_TIP =
  'Gross margin: the part of the price without VAT that stays with you after paying for the bag (its coffee and packaging). 50 % means that of every 100 zł without VAT, 50 zł is yours.';

export function pricesSection(client: Client, deps: PricesSectionDeps): HTMLElement {
  const body = el('div', {}, busy('Loading special prices…'));
  const section = el(
    'section',
    { class: 'form-section special-prices' },
    el(
      'h3',
      {},
      'Special prices ',
      infoTip(
        `Net prices (without VAT) agreed with ${client.name} for one product and bag size. On the Offer, pick ${client.name} and tick "Use their special prices": that size then shows only this price. A deal stays until you change or delete it; it keeps its price when the retail price changes.`,
      ),
    ),
    body,
  );
  let found: ProductsWithCosts | null = null;
  let deals: SpecialPrice[] = [];
  let problems: string[] = [];

  const show = (...children: (Node | string)[]) => body.replaceChildren(...children);

  function load(note?: string, fromClick = false): void {
    show(busy('Loading special prices…'));
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
        const again = (e: unknown) => show(...deps.errorNodes(e, () => load(undefined, true), 'Sign in and show special prices', again));
        again(error);
      });
  }

  /** Saves one change inside the click, then reads the deals again. */
  function save(action: () => Promise<void>, done: string, slot: HTMLElement, retry: () => void): void {
    for (const node of body.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')) node.disabled = true;
    slot.replaceChildren(busy('Saving…'));
    deps.busy(true);
    deps
      .withGoogle(action)
      .finally(() => deps.busy(false))
      .then(() => load(done))
      .catch((error: unknown) => {
        if (deps.isIgnorable(error)) return showDeals();
        const again = (e: unknown) => showDeals(undefined, deps.errorNodes(e, retry, 'Sign in and try again', again));
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
        actions.replaceChildren(button('Change', change, 'link'), button('Delete', remove, 'link'));
      };
      const change = () => {
        const input = el('input', { type: 'text', inputmode: 'decimal', class: 'input-xs', 'aria-label': `New price for ${r.product} ${r.size}, without VAT` });
        input.value = r.deal.netGrosze === null ? '' : String(r.deal.netGrosze / 100).replace('.', ',');
        const errorLine = el('span', { class: 'field-error', role: 'alert' });
        const form = el('form', { class: 'inline-form', novalidate: '' }, input, ' zł ', el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'), button('Cancel', normal, 'secondary'), errorLine);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const others = dealsOf(deals, client.id).filter((d) => d.id !== r.deal.id);
          const result = validateDeal({ productId: r.deal.productId, grams: String(r.deal.grams ?? ''), price: input.value }, client.id, products, others);
          if (!result.ok) {
            errorLine.textContent = Object.values(result.errors).join(' ');
            return;
          }
          // A changed deal also takes today's retail price as its new starting point.
          const fields = changedDealFields(r.deal, result.fields);
          const go = () => save(() => deps.prices.update(r.deal, fields, deps.now()), `Saved the price for ${r.product} ${r.size}.`, actions, go);
          go();
        });
        priceCell.replaceChildren(form);
        actions.replaceChildren();
        input.focus();
      };
      const remove = () => {
        const go = () => save(() => deps.prices.remove(r.deal, deps.now()), `Deleted the price for ${r.product} ${r.size}. It can be restored below.`, actions, go);
        go();
      };
      normal();
      const notes = [
        ...(r.unusable ? [el('span', { class: 'deal-note' }, `Not used on offers: ${r.unusable}.`)] : []),
        ...(r.retailChanged ? [el('span', { class: 'deal-note' }, r.retailChanged)] : []),
      ];
      return el(
        'tr',
        r.unusable ? { class: 'row-deleted' } : {},
        el('td', {}, el('strong', {}, r.product), ...notes),
        el('td', { class: 'nowrap' }, r.size),
        priceCell,
        el('td', { class: 'muted small' }, r.insteadOf || '—'),
        el('td', { class: `nowrap small${r.losing ? ' losing' : ''}` }, r.earn || el('span', { class: 'muted' }, 'cost not known')),
        actions,
      );
    };

    // Adding a deal: product, then a size it has a price for, then the price.
    const form: DealForm = { productId: '', grams: '', price: '' };
    const productSelect = el('select', { 'aria-label': 'Product' }, el('option', { value: '' }, 'Choose a product…'), ...active.map((p) => el('option', { value: p.id }, p.name)));
    const sizeSelect = el('select', { 'aria-label': 'Bag size' });
    const priceInput = el('input', { type: 'text', inputmode: 'decimal', class: 'input-xs', 'aria-label': 'Price without VAT', placeholder: 'e.g. 38' });
    const errorLine = el('p', { class: 'field-error', role: 'alert' });
    const sizes = () => {
      const product = active.find((p) => p.id === productSelect.value);
      const available = BAG_SIZES_G.filter((g) => product?.prices[g] !== undefined);
      sizeSelect.replaceChildren(el('option', { value: '' }, 'Size…'), ...available.map((g) => el('option', { value: String(g) }, formatBagSize(g))));
      if (available.length === 1) sizeSelect.value = String(available[0]);
    };
    productSelect.addEventListener('change', sizes);
    sizes();
    const addButton = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Add');
    const addForm = el('form', { class: 'inline-form deal-add', novalidate: '' }, productSelect, sizeSelect, priceInput, ' zł net ', addButton, errorLine);
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
      const go = () => save(async () => deps.prices.add(result.fields, await deps.whoAmI(), deps.now()), 'Special price added.', addButton, go);
      go();
    });

    const restoreRow = (d: SpecialPrice) => {
      const product = products.find((p) => p.id === d.productId);
      const label = `${product?.name ?? '?'} ${d.grams === null ? '?' : formatBagSize(d.grams)}`;
      const cell = el('td', { class: 'row-actions nowrap' });
      if (canRestoreDeal(d, deals)) {
        const go = () => save(() => deps.prices.restore(d, deps.now()), `Restored the price for ${label}.`, cell, go);
        cell.append(button('Restore', go, 'link'));
      } else cell.append(el('span', { class: 'muted small' }, 'there is a newer price for it'));
      return el('tr', { class: 'row-deleted' }, el('td', {}, label), el('td', { class: 'num nowrap' }, d.netGrosze === null ? '?' : formatPln(d.netGrosze)), cell);
    };

    show(
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      rows.length === 0
        ? el('p', { class: 'muted small' }, `No special prices for ${client.name} yet.`)
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
                  el('th', { scope: 'col' }, 'Product'),
                  el('th', { scope: 'col' }, 'Size'),
                  el('th', { scope: 'col', class: 'num' }, 'Their price (net)'),
                  el('th', { scope: 'col' }, 'Otherwise'),
                  el('th', { scope: 'col' }, 'You earn per bag ', infoTip(MARGIN_TIP)),
                  el('th', { scope: 'col' }, ''),
                ),
              ),
              el('tbody', {}, ...rows.map(row)),
            ),
          ),
      el('p', { class: 'small' }, el('strong', {}, 'Add a special price')),
      addForm,
      ...(deleted.length > 0
        ? [el('details', { class: 'small deleted-products' }, el('summary', {}, `Deleted special prices (${deleted.length})`), el('table', { class: 'data-table' }, el('tbody', {}, ...deleted.map(restoreRow))))]
        : []),
    );
  }

  load();
  return section;
}
