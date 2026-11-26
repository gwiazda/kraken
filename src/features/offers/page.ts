// The Offer screen (owner, 2026-11-17): who it is for and the date, ticked products, bag sizes and discounts, a live
// preview of the offer pages, and "Save as PDF" (Chrome's print window; the file name is filled in). Nothing is saved
// in the sheet: the PDF is the record (owner: "keep it simple, only the offer").
// Everything from outside comes through OfferPageDeps (main.ts provides it).

import { formatDate, isValidDate, localDate } from '../../core/dates';
import { busy, button, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { activeDiscounts, readSettings, type CostSettings, type CostsRepository, type Discount } from '../costs';
import { BAG_SIZES_G, formatBagSize } from '../../domain/bagSizes';
import { isClientDeleted, offerDeals, sortClients, type Client, type ClientsRepository, type SpecialPrice, type SpecialPricesRepository } from '../clients';
import { isOnSale, isProductDeleted, sortProducts, type Product, type ProductsRepository } from '../products';
import { showOfferPages } from './document';
import { MAX_TIERS, OFFER_VALID_DAYS, addDays, discountText, validateOffer, type OfferErrors, type OfferForm } from './model';
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
    render(el('p', {}, busy('Wczytuję produkty…')));
    // The clients and their special prices are extra: if they cannot be read, the offer still works (typed name).
    const extra = () =>
      Promise.all([deps.clients.load(), deps.prices.load()]).then(
        ([c, p]) => ({ clients: c.clients, deals: p.deals, problems: [...c.problems, ...p.problems] }),
        (error: unknown) => {
          if (deps.isSignedOut(error) || deps.isIgnorable(error)) throw error;
          return { clients: [] as Client[], deals: [] as SpecialPrice[], problems: [`Nie udało się wczytać klientów i ich cen specjalnych (${deps.describeError(error)}); wpisz nazwę odbiorcy.`] };
        },
      );
    const all = () => Promise.all([deps.products.load(), deps.costs.load(), extra()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([products, costs, found]) => {
        if (!root.isConnected) return;
        const { settings, problems } = readSettings(costs.settings);
        const discounts = activeDiscounts(costs.discounts);
        // A price Kraken cannot read is named here, so a missing size on the offer is not a mystery.
        // Only the products that can go on it (and those whose status cannot be read: that says why they are missing).
        const productProblems = products.products.filter((p) => isOnSale(p) || (!isProductDeleted(p) && p.status === null)).flatMap((p) => p.problems);
        showForm(products.products, settings, discounts.discounts, found.clients, found.deals, [...products.problems, ...problems, ...discounts.problems, ...found.problems, ...productProblems]);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) =>
          render(
            ...googleErrorNodes(e, deps, {
              retry: () => load(),
              retryLabel: 'Zaloguj się i pokaż ofertę',
              show,
              other: { label: 'Spróbuj ponownie', action: () => load(true), mayHaveSaved: false },
              signedOutNote: 'Nic nie zostało utracone.',
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
    const products = sortProducts(all).filter(isOnSale); // only "W sprzedaży" (owner, 2026-11-26)
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

    const customer = el('input', { id: 'offer-customer', type: 'text', autocomplete: 'off', placeholder: 'puste = oferta ogólna' });
    // Pick a client (their name fills in; their special prices can be used) or type any name (not a client yet).
    const clientSelect = el('select', { id: 'offer-client' }, el('option', { value: '' }, 'Nie klient (wpisz nazwę)'), ...clients.map((c) => el('option', { value: c.id }, c.name)));
    const useDeals = el('input', { type: 'checkbox', id: 'offer-use-deals' });
    const useDealsLabel = el('span', {});
    const useDealsRow = el('p', { class: 'offer-choices', hidden: '' }, el('label', { for: useDeals.id }, useDeals, useDealsLabel));
    /** The picked client's usable special prices (empty: none picked, or none). */
    let deals = new Map<string, number>();
    /** The client whose name was filled in (to clear it when "Not a client" is chosen again). */
    let filled = '';
    const pickClient = () => {
      const picked = clients.find((c) => c.id === clientSelect.value);
      if (picked) customer.value = picked.name;
      else if (filled && customer.value === filled) customer.value = '';
      filled = picked?.name ?? '';
      deals = picked ? offerDeals(allDeals, picked.id, products) : new Map(); // only products on sale can be on it
      useDealsRow.hidden = deals.size === 0;
      useDeals.checked = deals.size > 0;
      useDealsLabel.textContent = ` Użyj cen specjalnych: ${picked?.name ?? ''} (${deals.size}); ta wielkość pokaże tylko ich cenę`;
      update();
    };
    clientSelect.addEventListener('change', pickClient);
    // Another name typed over the client's: the offer is for someone else, so their special prices are not used.
    customer.addEventListener('input', () => {
      if (clientSelect.value !== '' && customer.value.trim() !== filled) {
        clientSelect.value = '';
        filled = '';
        deals = new Map();
        useDeals.checked = false;
        useDealsRow.hidden = true;
      }
    });
    const dealsUsed = () => (useDeals.checked ? deals : new Map<string, number>());
    const date = el('input', { id: 'offer-date', type: 'date' });
    date.value = today;
    const validUntil = el('span', { class: 'muted small' });

    const productBoxes = products.map((p) => {
      const sizes = BAG_SIZES_G.filter((g) => p.prices[g] !== undefined).map(formatBagSize);
      const hint = [p.brewMethod, sizes.length > 0 ? sizes.join(', ') : 'bez cen'].filter((t) => t).join(' · ');
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
          up.setAttribute('aria-label', `Przesuń ${b.name} w górę`);
          down.setAttribute('aria-label', `Przesuń ${b.name} w dół`);
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
      const { box, node } = checkbox(`offer-tier-${d.tenths}`, i < MAX_TIERS, el('span', {}, el('strong', {}, discountText(d.tenths).replace('-', '−')), ' ', d.name || el('span', { class: 'muted' }, '(bez nazwy)')));
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
      'Wróć do tekstu standardowego',
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
      validUntil.textContent = isValidDate(form.date) ? `Ważna do ${formatDate(addDays(form.date, OFFER_VALID_DAYS))} (${OFFER_VALID_DAYS} dni).` : '';
      if (!isValidDate(form.date)) form.date = today; // the preview needs some date while one is typed
      const offer = buildOffer(products, form, settings.vatTenths, OFFER_VALID_DAYS, dealsUsed());
      fileName = offer.fileName;
      warnings.replaceChildren(...offer.warnings.map((text) => message(text, 'error')));
      fillBanner(offer.banner);
      showOfferPages(preview, offer);
    };

    const saveAsPdf = () => {
      const form = readForm();
      const offer = isValidDate(form.date) ? buildOffer(products, form, settings.vatTenths, OFFER_VALID_DAYS, dealsUsed()) : null;
      const errors = validateOffer(form, dealsUsed().size > 0, offer?.withoutPrice ?? []);
      for (const [key, line] of errorLines) line.textContent = errors[key] ?? '';
      if (Object.keys(errors).length > 0) {
        status.replaceChildren(message('Popraw to, co jest zaznaczone powyżej.', 'error'));
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
      el('div', { class: 'page-head' }, el('h2', {}, 'Oferta')),
      el(
        'p',
        { class: 'muted small' },
        `Ceny hurtowe są netto, liczone od głównej ceny brutto każdego produktu (minus rabat, zaokrąglone do pełnych złotych). Kraken niczego nie zapisuje: ofertą jest plik PDF.`,
      ),
      ...problems.map((text) => message(text, 'error')),
      section(
        'Dla kogo',
        el(
          'div',
          { class: 'fields' },
          ...(clients.length > 0 ? [el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: clientSelect.id }, 'Klient')), clientSelect)] : []),
          el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: customer.id }, 'Odbiorca'), infoTip('Zostaw puste, aby przygotować ofertę ogólną, bez „Dla:”.')), customer),
          el('div', { class: 'field' }, el('div', { class: 'label-row' }, el('label', { for: date.id }, 'Data oferty *')), date, validUntil, errorLine('date')),
        ),
        useDealsRow,
      ),
      section(
        'Produkty',
        ...(products.length === 0
          ? [el('p', { class: 'muted' }, 'Nie ma produktów w sprzedaży. ', button('Dodaj je albo zmień ich status w zakładce Produkty', deps.openProducts, 'link'))]
          : [
              el('p', { class: 'muted small' }, 'Zaznacz, co trafia do oferty; ↑ ↓ ustawiają kolejność.'),
              productList,
              el('p', { class: 'small' }, button('Zaznacz wszystkie', selectAll(true), 'link'), ' · ', button('Odznacz wszystkie', selectAll(false), 'link')),
            ]),
        errorLine('products'),
      ),
      section('Wielkości torebek', el('div', { class: 'offer-choices' }, ...sizeBoxes.map((b) => b.node)), errorLine('sizes')),
      section(
        'Rabaty',
        el(
          'p',
          { class: 'muted small' },
          `Najwyżej ${MAX_TIERS} na jednej ofercie, żeby była czytelna. Nazwa jest przy każdej cenie, np. „Do 10 kg (-15%)”. Rabaty dodasz lub zmienisz w zakładce Opakowania i rabaty. Przy cenach specjalnych klienta możesz odznaczyć wszystkie: wtedy widać tylko jego ceny (odznacz produkty bez nich).`,
        ),
        ...(tierRows.length > 0 ? [el('div', { class: 'offer-choices' }, ...tierRows.map((t) => t.node))] : [el('p', { class: 'muted' }, 'Nie ma jeszcze rabatów: dodaj je w zakładce Opakowania i rabaty.')]),
        errorLine('tiers'),
      ),
      section(
        'Baner na dole',
        el('p', { class: 'muted small' }, 'Tworzony z zaznaczonych rabatów i wielkości. W razie potrzeby zmień go tutaj; pusta linia jest pomijana.'),
        el(
          'div',
          { class: 'fields' },
          el('div', { class: 'field field-wide' }, el('div', { class: 'label-row' }, el('label', { for: bannerTitle.id }, 'Tytuł')), bannerTitle),
          el('div', { class: 'field field-wide' }, el('div', { class: 'label-row' }, el('label', { for: bannerLine.id }, 'Główna linia')), bannerLine),
          el('div', { class: 'field field-wide' }, el('div', { class: 'label-row' }, el('label', { for: bannerNote.id }, 'Drobny druk')), bannerNote),
        ),
        el('p', { class: 'small' }, bannerReset),
        errorLine('banner'),
      ),
      el(
        'div',
        { class: 'actions' },
        button('Zapisz jako PDF', saveAsPdf),
      ),
      el(
        'p',
        { class: 'muted small' },
        'Chrome otworzy okno drukowania: jako miejsce docelowe wybierz „Zapisz jako PDF”, potem Zapisz. Nazwa pliku jest już wpisana.',
      ),
      status,
      warnings,
      el('h3', {}, 'Podgląd'),
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
