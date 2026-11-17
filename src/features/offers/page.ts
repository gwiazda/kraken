// The Offer screen (owner, 2026-11-17): who it is for and the date, ticked products, bag sizes and discounts, a live
// preview of the offer pages, and "Save as PDF" (Chrome's print window; the file name is filled in). Nothing is saved
// in the sheet: the PDF is the record (owner: "keep it simple, only the offer").
// Everything from outside comes through OfferPageDeps (main.ts provides it).

import { isValidDate, localDate } from '../../core/dates';
import { busy, button, el, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { readSettings, type CostSettings, type CostsRepository } from '../costs';
import { PRODUCT_SIZES_G, formatSize, isProductDeleted, sortProducts, type Product, type ProductsRepository } from '../products';
import { showOfferPages } from './document';
import { DEFAULT_TIER_LABELS, OFFER_VALID_DAYS, addDays, discountText, polishDate, validateOffer, type OfferErrors, type OfferForm } from './model';
import { buildOffer } from './present';

export interface OfferPageDeps {
  products: ProductsRepository;
  costs: CostsRepository;
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  signIn: () => Promise<void>;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  now: () => Date;
  /** Opens the Products page. */
  openProducts: () => void;
}

/** Sizes ticked at the start: the ones on the owner's template. */
const START_SIZES = [250, 1000];

export function showOfferPage(root: HTMLElement, deps: OfferPageDeps, fromClick = false): void {
  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function load(fromClick = false): void {
    render(el('p', {}, busy('Loading products…')));
    const both = () => Promise.all([deps.products.load(), deps.costs.load()]);
    (fromClick ? deps.withGoogle(both) : both())
      .then(([products, costs]) => {
        if (!root.isConnected) return;
        const { settings, problems } = readSettings(costs.settings);
        showForm(products.products, settings, [...products.problems, ...problems]);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) =>
          render(
            ...googleErrorNodes(e, deps, {
              retry: () => load(),
              retryLabel: 'Sign in and show the offer',
              show,
              other: { label: 'Try again', action: () => load(true), mayHaveSaved: false },
              signedOutNote: 'Nothing was lost.',
            }),
          );
        show(error);
      });
  }

  function showForm(all: readonly Product[], settings: CostSettings, problems: readonly string[]): void {
    const products = sortProducts(all).filter((p) => !isProductDeleted(p));
    const today = localDate(deps.now());
    const errorLines = new Map<keyof OfferErrors, HTMLElement>();
    const errorLine = (key: keyof OfferErrors) => {
      const line = el('p', { class: 'field-error', role: 'alert' });
      errorLines.set(key, line);
      return line;
    };
    const checkbox = (id: string, checked: boolean, label: string | Node) => {
      const box = el('input', { type: 'checkbox', id });
      box.checked = checked;
      return { box, node: el('label', { for: id }, box, label) };
    };

    const customer = el('input', { id: 'offer-customer', type: 'text', autocomplete: 'off', placeholder: 'e.g. Kawiarnia Pod Lipą' });
    const date = el('input', { id: 'offer-date', type: 'date' });
    date.value = today;
    const validUntil = el('span', { class: 'muted small' });

    const productBoxes = products.map((p) => {
      const sizes = PRODUCT_SIZES_G.filter((g) => p.prices[g] !== undefined).map(formatSize);
      const hint = [p.brewMethod, sizes.length > 0 ? sizes.join(', ') : 'no prices'].filter((t) => t).join(' · ');
      return { id: p.id, ...checkbox(`offer-product-${p.id}`, true, el('span', {}, p.name, ' ', el('span', { class: 'muted small' }, `(${hint})`))) };
    });
    const sizeBoxes = PRODUCT_SIZES_G.map((g) => ({ grams: g, ...checkbox(`offer-size-${g}`, START_SIZES.includes(g), formatSize(g)) }));
    const tierRows = settings.discountTenths.map((tenths) => {
      const name = el('input', { type: 'text', id: `offer-tier-${tenths}`, class: 'input-money', autocomplete: 'off', placeholder: 'no name' });
      name.value = DEFAULT_TIER_LABELS[tenths] ?? '';
      const { box, node } = checkbox(`offer-tier-box-${tenths}`, true, discountText(tenths).replace('-', '−'));
      return { tenths, box, name, node: el('span', { class: 'offer-tier-choice' }, node, ' ', name) };
    });

    const readForm = (): OfferForm => ({
      customer: customer.value,
      date: date.value,
      productIds: productBoxes.filter((b) => b.box.checked).map((b) => b.id),
      sizes: sizeBoxes.filter((b) => b.box.checked).map((b) => b.grams),
      tiers: tierRows.filter((t) => t.box.checked).map((t) => ({ tenths: t.tenths, label: t.name.value.trim() })),
    });

    const warnings = el('div', {});
    const preview = el('div', { class: 'offer-preview' });
    const status = el('div', {});
    let fileName = '';

    const update = () => {
      const form = readForm();
      validUntil.textContent = isValidDate(form.date) ? `Valid until ${polishDate(addDays(form.date, OFFER_VALID_DAYS))} (${OFFER_VALID_DAYS} days).` : '';
      if (!isValidDate(form.date)) form.date = today; // the preview needs some date while one is typed
      const offer = buildOffer(products, form, settings.vatTenths, OFFER_VALID_DAYS);
      fileName = offer.fileName;
      warnings.replaceChildren(...offer.warnings.map((text) => message(text, 'error')));
      showOfferPages(preview, offer);
    };

    const saveAsPdf = () => {
      const errors = validateOffer(readForm());
      for (const [key, line] of errorLines) line.textContent = errors[key] ?? '';
      if (Object.keys(errors).length > 0) {
        status.replaceChildren(message('Please fix what is marked above.', 'error'));
        return;
      }
      status.replaceChildren();
      update();
      void printOffer(preview, fileName);
    };

    for (const input of [customer, date, ...productBoxes.map((b) => b.box), ...sizeBoxes.map((b) => b.box), ...tierRows.flatMap((t) => [t.box, t.name])]) {
      input.addEventListener('input', update);
    }

    const section = (title: string, ...children: (Node | string)[]) => el('fieldset', { class: 'form-section' }, el('legend', {}, title), ...children);
    const selectAll = (on: boolean) => () => {
      for (const b of productBoxes) b.box.checked = on;
      update();
    };

    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Offer')),
      el(
        'p',
        { class: 'muted small' },
        `The offer is in Polish. Wholesale prices are net, worked out from each product's main gross price (−discount, rounded to whole złoty). Nothing is saved in Kraken: the PDF is the offer.`,
      ),
      ...problems.map((text) => message(text, 'error')),
      section(
        'For',
        el(
          'div',
          { class: 'fields' },
          el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: customer.id }, 'Customer *')), customer, errorLine('customer')),
          el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: date.id }, 'Offer date *')), date, validUntil, errorLine('date')),
        ),
      ),
      section(
        'Products',
        ...(products.length === 0
          ? [el('p', { class: 'muted' }, 'No products yet. ', button('Add them on the Products page', deps.openProducts, 'link'))]
          : [
              el('div', { class: 'offer-choices' }, ...productBoxes.map((b) => b.node)),
              el('p', { class: 'small' }, button('Select all', selectAll(true), 'link'), ' · ', button('Select none', selectAll(false), 'link')),
            ]),
        errorLine('products'),
      ),
      section('Bag sizes', el('div', { class: 'offer-choices' }, ...sizeBoxes.map((b) => b.node)), errorLine('sizes')),
      section(
        'Discounts',
        el('p', { class: 'muted small' }, 'The name is shown next to the price, e.g. "Do 10 kg (-15%)". More discounts: Costs & prices → Bag costs & settings.'),
        el('div', { class: 'offer-choices' }, ...tierRows.map((t) => t.node)),
        errorLine('tiers'),
      ),
      el(
        'div',
        { class: 'actions' },
        button('Save as PDF', saveAsPdf),
      ),
      el(
        'p',
        { class: 'muted small' },
        'Chrome opens its print window: choose "Save as PDF" as the destination, then Save. The file name is already filled in.',
      ),
      status,
      warnings,
      el('h3', {}, 'Preview'),
      preview,
    );
    update();
  }

  load(fromClick);
}

/**
 * Prints only the offer: a copy of the preview pages goes into a container at the top of the page, everything else
 * is hidden while printing (style.css), and the page title becomes the PDF's file name.
 */
async function printOffer(preview: HTMLElement, fileName: string): Promise<void> {
  const holder = el('div', { class: 'offer-print' });
  const doc = preview.querySelector('.offer-doc');
  if (!doc) return;
  holder.append(doc.cloneNode(true));
  document.body.append(holder);
  await Promise.all([...holder.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
  const title = document.title;
  document.title = fileName;
  document.body.classList.add('print-offer');
  const cleanUp = () => {
    document.body.classList.remove('print-offer');
    document.title = title;
    holder.remove();
  };
  window.addEventListener('afterprint', cleanUp, { once: true });
  window.print();
}
