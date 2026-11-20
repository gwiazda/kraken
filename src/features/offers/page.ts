// The Offer screen (owner, 2026-11-17): who it is for and the date, ticked products, bag sizes and discounts, a live
// preview of the offer pages, and "Save as PDF" (Chrome's print window; the file name is filled in). Nothing is saved
// in the sheet: the PDF is the record (owner: "keep it simple, only the offer").
// Everything from outside comes through OfferPageDeps (main.ts provides it).

import { isValidDate, localDate } from '../../core/dates';
import { busy, button, el, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { activeDiscounts, readSettings, type CostSettings, type CostsRepository, type Discount } from '../costs';
import { BAG_SIZES_G, formatBagSize } from '../../domain/bagSizes';
import { isClientDeleted, offerDeals, sortClients, type Client, type ClientsRepository, type SpecialPrice, type SpecialPricesRepository } from '../clients';
import { isProductDeleted, sortProducts, type Product, type ProductsRepository } from '../products';
import { showOfferPages } from './document';
import { MAX_TIERS, OFFER_VALID_DAYS, addDays, discountText, polishDate, validateOffer, type OfferErrors, type OfferForm } from './model';
import { buildOffer } from './present';

export interface OfferPageDeps {
  products: ProductsRepository;
  costs: CostsRepository;
  /** To pick the customer from Clients and use their special prices (owner, 2026-11-20). */
  clients: ClientsRepository;
  prices: SpecialPricesRepository;
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
    // The clients and their special prices are extra: if they cannot be read, the offer still works (typed name).
    const extra = () =>
      Promise.all([deps.clients.load(), deps.prices.load()]).then(
        ([c, p]) => ({ clients: c.clients, deals: p.deals, problems: [...c.problems, ...p.problems] }),
        (error: unknown) => {
          if (deps.isSignedOut(error) || deps.isIgnorable(error)) throw error;
          return { clients: [] as Client[], deals: [] as SpecialPrice[], problems: [`The clients and their special prices could not be read (${deps.describeError(error)}); type the customer's name.`] };
        },
      );
    const all = () => Promise.all([deps.products.load(), deps.costs.load(), extra()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([products, costs, found]) => {
        if (!root.isConnected) return;
        const { settings, problems } = readSettings(costs.settings);
        const discounts = activeDiscounts(costs.discounts);
        // A price Kraken cannot read is named here, so a missing size on the offer is not a mystery.
        const productProblems = products.products.filter((p) => !isProductDeleted(p)).flatMap((p) => p.problems);
        showForm(products.products, settings, discounts.discounts, found.clients, found.deals, [...products.problems, ...problems, ...discounts.problems, ...found.problems, ...productProblems]);
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

  function showForm(
    all: readonly Product[],
    settings: CostSettings,
    discounts: readonly Discount[],
    allClients: readonly Client[],
    allDeals: readonly SpecialPrice[],
    problems: readonly string[],
  ): void {
    const products = sortProducts(all).filter((p) => !isProductDeleted(p));
    const clients = sortClients(allClients).filter((c) => !isClientDeleted(c));
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
    // Pick a client (their name fills in; their special prices can be used) or type any name (not a client yet).
    const clientSelect = el('select', { id: 'offer-client' }, el('option', { value: '' }, 'Not a client (type the name)'), ...clients.map((c) => el('option', { value: c.id }, c.name)));
    const useDeals = el('input', { type: 'checkbox', id: 'offer-use-deals' });
    const useDealsLabel = el('span', {});
    const useDealsRow = el('p', { class: 'offer-choices', hidden: '' }, el('label', { for: useDeals.id }, useDeals, useDealsLabel));
    /** The picked client's usable special prices (empty: none picked, or none). */
    let deals = new Map<string, number>();
    const pickClient = () => {
      const picked = clients.find((c) => c.id === clientSelect.value);
      if (picked) customer.value = picked.name;
      deals = picked ? offerDeals(allDeals, picked.id, all) : new Map();
      useDealsRow.hidden = deals.size === 0;
      useDeals.checked = deals.size > 0;
      useDealsLabel.textContent = ` Use ${picked?.name ?? ''}'s special prices (${deals.size}): that size shows only their price`;
      update();
    };
    clientSelect.addEventListener('change', pickClient);
    const dealsUsed = () => (useDeals.checked ? deals : new Map<string, number>());
    const date = el('input', { id: 'offer-date', type: 'date' });
    date.value = today;
    const validUntil = el('span', { class: 'muted small' });

    const productBoxes = products.map((p) => {
      const sizes = BAG_SIZES_G.filter((g) => p.prices[g] !== undefined).map(formatBagSize);
      const hint = [p.brewMethod, sizes.length > 0 ? sizes.join(', ') : 'no prices'].filter((t) => t).join(' · ');
      return { id: p.id, name: p.name, ...checkbox(`offer-product-${p.id}`, true, el('span', {}, p.name, ' ', el('span', { class: 'muted small' }, `(${hint})`))) };
    });
    /** The products in the order they appear on the offer (owner, 2026-11-17: ↑ ↓ to change it). */
    let order = [...productBoxes];
    const productList = el('ol', { class: 'offer-order' });
    const showOrder = (focus?: { id: string; up: boolean }) => {
      productList.replaceChildren(
        ...order.map((b, i) => {
          const move = (by: number) => () => {
            const next = [...order];
            const [moved] = next.splice(i, 1);
            if (!moved) return;
            next.splice(i + by, 0, moved);
            order = next;
            showOrder({ id: b.id, up: by < 0 });
            update();
          };
          const up = button('↑', move(-1), 'secondary');
          const down = button('↓', move(1), 'secondary');
          up.disabled = i === 0;
          down.disabled = i === order.length - 1;
          up.setAttribute('aria-label', `Move ${b.name} up`);
          down.setAttribute('aria-label', `Move ${b.name} down`);
          if (focus?.id === b.id) queueMicrotask(() => ((focus.up && !up.disabled) || down.disabled ? up : down).focus());
          return el('li', {}, el('span', { class: 'offer-order-moves' }, up, down), b.node);
        }),
      );
    };
    showOrder();
    const sizeBoxes = BAG_SIZES_G.map((g) => ({ grams: g, ...checkbox(`offer-size-${g}`, START_SIZES.includes(g), formatBagSize(g)) }));
    // The discounts from Packaging & discounts, with their names. At most MAX_TIERS on one offer (each adds a price
    // line to every card), so the first ones are ticked and the rest wait until one is unticked.
    const tierRows = discounts.map((d, i) => {
      const { box, node } = checkbox(`offer-tier-${d.tenths}`, i < MAX_TIERS, el('span', {}, el('strong', {}, discountText(d.tenths).replace('-', '−')), ' ', d.name || el('span', { class: 'muted' }, '(no name)')));
      return { tenths: d.tenths, name: d.name, box, node };
    });
    const limitTiers = () => {
      const full = tierRows.filter((t) => t.box.checked).length >= MAX_TIERS;
      for (const t of tierRows) t.box.disabled = full && !t.box.checked;
    };
    limitTiers();

    const readForm = (): OfferForm => ({
      customer: customer.value,
      date: date.value,
      productIds: order.filter((b) => b.box.checked).map((b) => b.id),
      sizes: sizeBoxes.filter((b) => b.box.checked).map((b) => b.grams),
      tiers: tierRows.filter((t) => t.box.checked).map((t) => ({ tenths: t.tenths, label: t.name })),
      banner: bannerEdited ? { title: bannerTitle.value.trim(), line: bannerLine.value.trim(), note: bannerNote.value.trim() } : null,
    });

    // The yellow banner: made from the ticked discounts and sizes until the owner changes it; "Back to the standard
    // text" makes it follow them again.
    let bannerEdited = false;
    const bannerTitle = el('input', { id: 'offer-banner-title', type: 'text', autocomplete: 'off' });
    const bannerLine = el('textarea', { id: 'offer-banner-line', rows: '2' });
    const bannerNote = el('textarea', { id: 'offer-banner-note', rows: '2' });
    const bannerReset = button(
      'Back to the standard text',
      () => {
        bannerEdited = false;
        update();
      },
      'link',
    );
    const fillBanner = (banner: { title: string; line: string; note: string }) => {
      bannerReset.hidden = !bannerEdited;
      if (bannerEdited) return;
      bannerTitle.value = banner.title;
      bannerLine.value = banner.line;
      bannerNote.value = banner.note;
    };
    for (const input of [bannerTitle, bannerLine, bannerNote]) {
      input.addEventListener('input', () => {
        bannerEdited = true;
        update();
      });
    }

    const warnings = el('div', {});
    const preview = el('div', { class: 'offer-preview' });
    const status = el('div', {});
    let fileName = '';

    /** Redraws the preview at most once per screen frame (typing a name does not rebuild it for every key). */
    let pending = 0;
    const update = () => {
      if (pending === 0) pending = window.requestAnimationFrame(redraw);
    };
    const redraw = () => {
      pending = 0;
      const form = readForm();
      validUntil.textContent = isValidDate(form.date) ? `Valid until ${polishDate(addDays(form.date, OFFER_VALID_DAYS))} (${OFFER_VALID_DAYS} days).` : '';
      if (!isValidDate(form.date)) form.date = today; // the preview needs some date while one is typed
      const offer = buildOffer(products, form, settings.vatTenths, OFFER_VALID_DAYS, dealsUsed());
      fileName = offer.fileName;
      warnings.replaceChildren(...offer.warnings.map((text) => message(text, 'error')));
      fillBanner(offer.banner);
      showOfferPages(preview, offer);
    };

    const saveAsPdf = () => {
      const errors = validateOffer(readForm(), dealsUsed().size > 0);
      for (const [key, line] of errorLines) line.textContent = errors[key] ?? '';
      if (Object.keys(errors).length > 0) {
        status.replaceChildren(message('Please fix what is marked above.', 'error'));
        return;
      }
      status.replaceChildren();
      if (pending !== 0) window.cancelAnimationFrame(pending);
      redraw();
      void printOffer(preview, fileName);
    };

    for (const t of tierRows) t.box.addEventListener('input', limitTiers);
    for (const input of [customer, date, useDeals, ...productBoxes.map((b) => b.box), ...sizeBoxes.map((b) => b.box), ...tierRows.map((t) => t.box)]) {
      input.addEventListener('input', update);
    }

    const section = (title: string, ...children: (Node | string)[]) => el('fieldset', { class: 'form-section' }, el('legend', {}, title), ...children);
    const selectAll = (on: boolean) => () => {
      for (const b of order) b.box.checked = on;
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
          ...(clients.length > 0 ? [el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: clientSelect.id }, 'Client')), clientSelect)] : []),
          el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: customer.id }, 'Customer *')), customer, errorLine('customer')),
          el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: date.id }, 'Offer date *')), date, validUntil, errorLine('date')),
        ),
        useDealsRow,
      ),
      section(
        'Products',
        ...(products.length === 0
          ? [el('p', { class: 'muted' }, 'No products yet. ', button('Add them on the Products page', deps.openProducts, 'link'))]
          : [
              el('p', { class: 'muted small' }, 'Tick what goes on the offer; ↑ ↓ set the order.'),
              productList,
              el('p', { class: 'small' }, button('Select all', selectAll(true), 'link'), ' · ', button('Select none', selectAll(false), 'link')),
            ]),
        errorLine('products'),
      ),
      section('Bag sizes', el('div', { class: 'offer-choices' }, ...sizeBoxes.map((b) => b.node)), errorLine('sizes')),
      section(
        'Discounts',
        el(
          'p',
          { class: 'muted small' },
          `Up to ${MAX_TIERS} on one offer, so it stays readable. The name is shown next to each price, e.g. "Do 10 kg (-15%)". Add or change discounts under Packaging & discounts. With a client's special prices you may untick them all: then only their prices are shown (untick the products without one).`,
        ),
        ...(tierRows.length > 0 ? [el('div', { class: 'offer-choices' }, ...tierRows.map((t) => t.node))] : [el('p', { class: 'muted' }, 'No discounts yet: add them under Packaging & discounts.')]),
        errorLine('tiers'),
      ),
      section(
        'Banner at the bottom',
        el('p', { class: 'muted small' }, 'Made from the ticked discounts and sizes. Change it here if needed; an empty line is left out.'),
        el(
          'div',
          { class: 'fields' },
          el('div', { class: 'field field-wide' }, el('div', { class: 'label-row' }, el('label', { for: bannerTitle.id }, 'Title')), bannerTitle),
          el('div', { class: 'field field-wide' }, el('div', { class: 'label-row' }, el('label', { for: bannerLine.id }, 'Main line')), bannerLine),
          el('div', { class: 'field field-wide' }, el('div', { class: 'label-row' }, el('label', { for: bannerNote.id }, 'Small print')), bannerNote),
        ),
        el('p', { class: 'small' }, bannerReset),
        errorLine('banner'),
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
    redraw();
  }

  load(fromClick);
}

/**
 * Prints only the offer: a copy of the preview pages goes into a container at the top of the page, everything else
 * is hidden while printing (style.css), and the page title becomes the PDF's file name.
 */
let printing = false;

async function printOffer(preview: HTMLElement, fileName: string): Promise<void> {
  if (printing) return; // a second click while the first is starting would print every page twice
  const holder = el('div', { class: 'offer-print' });
  const doc = preview.querySelector('.offer-doc');
  if (!doc) return;
  printing = true;
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
    printing = false;
  };
  window.addEventListener('afterprint', cleanUp, { once: true });
  window.print();
}
