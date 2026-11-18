// The Products screen (owner, 2026-11-17/18), the one place for prices:
// - the list: name, brew method, origin and main prices; click a name to open the product;
// - a product's page: main (retail) gross prices and the wholesale prices at each discount, its offer details;
// - the form: details and main gross prices, with suggested prices from a lot to click, or typed.
// A product is named however the owner likes and is not linked to lots (a lot only gives suggestions).
// Everything from outside comes through ProductsPageDeps (main.ts provides it).

import { formatWholePln } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize, type BagSize } from '../../domain/bagSizes';
import { busy, button, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { DEFAULT_SETTINGS, activeDiscounts, pricingFor, type CostSettings, type CostsRepository, type Discount, type LotSuggestion } from '../costs';
import type { LotsRepository } from '../lots';
import type { RoastsRepository } from '../roasts';
import {
  BREW_METHODS,
  PRICE_FIELDS as PRICE_KEYS,
  changedProductFields,
  emptyProductForm,
  formFromProduct,
  isDeleted,
  sortProducts,
  validateProductForm,
  type Product,
  type ProductForm,
  type ProductFormErrors,
} from './model';
import { discountHeader, priceRows, productDetails, suggestedLot, type PriceCell } from './present';
import type { ProductsRepository } from './repo';

export interface ProductsPageDeps {
  repo: ProductsRepository;
  /** For the VAT, the discounts and the suggested prices (Packaging & discounts, lots). */
  costs: CostsRepository;
  lots: LotsRepository;
  roasts: RoastsRepository;
  whoAmI: () => Promise<string>;
  /** Runs an action that talks to Google, renewing the sign-in first if needed. Call it inside a click. */
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  signIn: () => Promise<void>;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  now: () => Date;
  /** A product or the form opened (so the browser's Back returns to the list) / back on the list. */
  formOpened: () => void;
  formClosed: () => void;
  /** Kraken is saving to Google (true) or done (false): Back and the menu wait meanwhile. */
  busy: (on: boolean) => void;
}

interface FieldSpec {
  key: keyof ProductForm;
  label: string;
  hint?: string;
  required?: boolean;
  list?: readonly string[];
}

/** The text fields; the Polish words in brackets are the labels on the offer. */
const SECTIONS: readonly { title: string; fields: readonly FieldSpec[] }[] = [
  {
    title: 'Product',
    fields: [
      { key: 'name', label: 'Name on the offer', hint: 'e.g. Gwatemala, Kenia Filtr', required: true },
      { key: 'brewMethod', label: 'Brew method', hint: 'e.g. Espresso, Filtr', list: BREW_METHODS },
    ],
  },
  {
    title: 'Details on the offer',
    fields: [
      { key: 'country', label: 'Country (Kraj)' },
      { key: 'region', label: 'Region (Region)' },
      { key: 'altitude', label: 'Altitude (Wysokość uprawy)', hint: 'e.g. 1900-2200 m n.p.m.' },
      { key: 'processing', label: 'Processing (Obróbka)', hint: 'e.g. Washed, Natural' },
      { key: 'variety', label: 'Variety (Odmiana)' },
      { key: 'flavourProfile', label: 'Flavour profile (Profil smakowy)', hint: 'e.g. Migdał, biała czekolada' },
    ],
  },
];

const FIELD_KEYS: readonly (keyof ProductForm)[] = [...SECTIONS.flatMap((s) => s.fields.map((f) => f.key)), ...BAG_SIZES_G.map((g) => PRICE_KEYS[g])];

export function showProductsPage(root: HTMLElement, deps: ProductsPageDeps, note?: string, fromClick = false): void {
  let products: Product[] = [];
  let problems: string[] = [];
  let settings: CostSettings = DEFAULT_SETTINGS;
  let discounts: Discount[] = activeDiscounts([]).discounts;
  let suggestions: LotSuggestion[] = [];

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function errorNodes(error: unknown, retry: () => void, retryLabel: string, show: (e: unknown) => void, mayHaveSaved: boolean, reloadLabel = 'Reload products'): Node[] {
    return googleErrorNodes(error, deps, {
      retry,
      retryLabel,
      show,
      ...(mayHaveSaved ? {} : { signedOutNote: 'Nothing was lost.' }),
      other: { label: mayHaveSaved ? reloadLabel : 'Try again', action: () => load(undefined, true), mayHaveSaved },
    });
  }

  /** Loads everything, then shows the list, or the product `openId` (after saving it). */
  function load(note?: string, fromClick = false, openId?: string): void {
    render(el('p', {}, busy('Loading products…')));
    // The products come first; the settings and suggestions (cost tabs, lots, roasts) are extras: if they cannot be
    // read, the products are still shown, with the default VAT and discounts and a note.
    const pricing = () =>
      Promise.all([deps.costs.load(), deps.lots.load(), deps.roasts.load()]).then(
        ([costs, lots, roasts]) => {
          const found = pricingFor(costs, lots.lots, roasts.roasts);
          return { ...found, problems: [...costs.problems, ...found.problems] };
        },
        (error: unknown) => {
          if (deps.isSignedOut(error) || deps.isIgnorable(error)) throw error;
          const problem = `The price settings and suggestions could not be read (${deps.describeError(error)}); the default VAT and discounts are used.`;
          return { settings: DEFAULT_SETTINGS, discounts: activeDiscounts([]).discounts, suggestions: [] as LotSuggestion[], problems: [problem] };
        },
      );
    const all = () => Promise.all([deps.repo.load(), pricing()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([result, found]) => {
        if (!root.isConnected) return;
        products = result.products;
        settings = found.settings;
        discounts = found.discounts;
        suggestions = found.suggestions;
        problems = [...result.problems, ...found.problems];
        const open = openId ? products.find((p) => p.id === openId && !isDeleted(p)) : undefined;
        if (open) showProduct(open, note);
        else showList(note);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) => render(...errorNodes(e, () => load(), 'Sign in and show products', show, false));
        show(error);
      });
  }

  function lockPage(): void {
    for (const node of root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')) node.disabled = true;
  }

  /** Delete or Restore, inside the click (so a sign-in renewal can open Google's window). `progress` shows the spinner. */
  function change(product: Product, kind: 'remove' | 'restore', progress: () => void): void {
    progress();
    deps.busy(true);
    deps
      .withGoogle(() => (kind === 'remove' ? deps.repo.remove(product, deps.now()) : deps.repo.restore(product, deps.now())))
      .finally(() => deps.busy(false))
      .then(() => {
        if (root.isConnected) load(kind === 'remove' ? `Deleted ${product.name}. It can be restored under "Deleted products".` : `Restored ${product.name}.`);
      })
      .catch((error: unknown) => {
        if (!root.isConnected) return;
        if (deps.isIgnorable(error)) return showList();
        const working = kind === 'remove' ? `Deleting ${product.name}…` : `Restoring ${product.name}…`;
        const label = kind === 'remove' ? `Sign in and delete ${product.name}` : `Sign in and restore ${product.name}`;
        const show = (e: unknown) => showList(undefined, errorNodes(e, () => change(product, kind, () => render(el('p', {}, busy(working)))), label, show, true));
        show(error);
      });
  }

  // ---- The list ----

  function showList(note?: string, error?: Node[]): void {
    deps.formClosed();
    const sorted = sortProducts(products);
    const active = sorted.filter((p) => !isDeleted(p));
    const deleted = sorted.filter(isDeleted);
    const price = (p: Product, grams: BagSize) => {
      const grosze = p.prices[grams];
      return grosze === undefined ? el('span', { class: 'muted' }, '—') : formatWholePln(grosze);
    };
    const origin = (p: Product) => [p.country, p.region].filter((t) => t).join(', ');

    const row = (p: Product, restorable: boolean) => {
      const actions = el('td', { class: 'row-actions nowrap' });
      if (restorable) {
        const restore = () =>
          change(p, 'restore', () => {
            lockPage();
            actions.replaceChildren(busy('Restoring…'));
          });
        actions.append(button('Restore', restore, 'link'));
      }
      return el(
        'tr',
        restorable ? { class: 'row-deleted' } : {},
        el(
          'td',
          {},
          restorable ? el('span', {}, p.name) : button(p.name, () => showProduct(p), 'link'),
          ...(p.brewMethod ? [' ', el('span', { class: 'badge badge-muted' }, p.brewMethod)] : []),
          ...(p.problems.length > 0 ? [' ', el('span', { class: 'badge badge-warn', title: p.problems.join(' ') }, 'Check')] : []),
        ),
        el('td', {}, origin(p) || el('span', { class: 'muted' }, '—')),
        ...BAG_SIZES_G.map((g) => el('td', { class: 'num nowrap' }, price(p, g))),
        ...(restorable ? [actions] : []),
      );
    };

    const table = (list: readonly Product[], restorable: boolean) =>
      el(
        'div',
        { class: 'table-wrap' },
        el(
          'table',
          { class: 'data-table product-table' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { scope: 'col' }, 'Product'),
              el('th', { scope: 'col' }, 'Origin'),
              ...BAG_SIZES_G.map((g) => el('th', { scope: 'col', class: 'num' }, formatBagSize(g))),
              ...(restorable ? [el('th', { scope: 'col' }, '')] : []),
            ),
          ),
          el('tbody', {}, ...list.map((p) => row(p, restorable))),
        ),
      );

    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Products'), el('div', { class: 'head-actions' }, button('Add product', () => showForm(null)))),
      el('p', { class: 'muted small' }, 'Main prices, gross (retail). Click a product to see its wholesale prices.'),
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      ...active.filter((p) => p.problems.length > 0).map((p) => message(p.problems.join(' '), 'error')),
      active.length === 0 ? el('p', { class: 'muted' }, 'No products yet. Click "Add product".') : table(active, false),
      ...(deleted.length > 0 ? [el('details', { class: 'small deleted-products' }, el('summary', {}, `Deleted products (${deleted.length})`), table(deleted, true))] : []),
    );
  }

  // ---- One product ----

  function showProduct(product: Product, note?: string): void {
    deps.formOpened();
    const vat = settings.vatTenths;

    const priceCell = (c: PriceCell, extra = '') =>
      el('td', { class: `num nowrap${extra}` }, el('strong', { class: 'price-main' }, c.main), ...(c.other ? [el('span', { class: 'price-other' }, c.other)] : []));
    const pricesHolder = el('div', {});
    const showPrices = () => {
      const columns = discounts;
      const rows = priceRows(
        product,
        columns.map((d) => d.tenths),
        vat,
      );
      pricesHolder.replaceChildren(
        el(
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
                ...columns.map((d) => el('th', { scope: 'col', class: 'num' }, d.name ? el('span', { class: 'col-name' }, d.name) : 'Wholesale', el('br'), discountHeader(d.tenths))),
              ),
            ),
            el('tbody', {}, ...rows.map((r) => el('tr', {}, el('th', { scope: 'row' }, r.size), priceCell(r.retail, ' col-retail'), ...r.wholesale.map((c) => priceCell(c))))),
          ),
        ),
      );
    };
    showPrices();

    const details = productDetails(product);
    const actions = el('div', { class: 'head-actions' });
    const confirm = el('div', {});
    const normal = () => {
      confirm.replaceChildren();
      actions.replaceChildren(button('Edit', () => showForm(product), 'secondary'), button('Delete', ask, 'secondary'));
    };
    const ask = () => {
      const no = button('No', normal, 'secondary');
      const yes = () =>
        change(product, 'remove', () => {
          lockPage();
          confirm.replaceChildren(el('p', {}, busy('Deleting…')));
        });
      confirm.replaceChildren(el('p', { class: 'message muted' }, `Delete ${product.name}? It can be restored later from the list. `, button('Yes, delete', yes, 'primary'), ' ', no));
      no.focus();
    };
    normal();

    render(
      el('p', { class: 'small back-link' }, button('← All products', () => showList(), 'link')),
      el('div', { class: 'page-head' }, el('h2', {}, product.name, ...(product.brewMethod ? [' ', el('span', { class: 'badge badge-muted' }, product.brewMethod)] : [])), actions),
      confirm,
      ...(note ? [message(note)] : []),
      ...product.problems.map((text) => message(text, 'error')),
      el(
        'section',
        { class: 'product-card' },
        el(
          'h3',
          {},
          'Prices ',
          infoTip(
            'Retail is what a shop customer pays, with VAT. Wholesale is what a business pays: the retail price without VAT, made cheaper by their discount and rounded to whole złoty.',
          ),
        ),
        pricesHolder,
      ),
      el(
        'section',
        { class: 'product-card' },
        el('h3', {}, 'On the offer'),
        details.length === 0
          ? el('p', { class: 'muted' }, 'No details yet. Click Edit to add them.')
          : el('dl', { class: 'product-details' }, ...details.flatMap((d) => [el('dt', {}, d.label), el('dd', {}, d.value)])),
      ),
    );
  }

  // ---- The form ----

  function showForm(product: Product | null): void {
    deps.formOpened();
    const initial = product ? formFromProduct(product) : emptyProductForm();
    const inputs = {} as Record<keyof ProductForm, HTMLInputElement>;
    const errorLines = {} as Record<keyof ProductForm, HTMLParagraphElement>;

    const inputFor = (key: keyof ProductForm, attrs: Record<string, string> = {}) => {
      const id = `product-${key}`;
      const input = el('input', { id, type: 'text', autocomplete: 'off', 'aria-describedby': `${id}-error`, ...attrs });
      input.value = initial[key];
      inputs[key] = input;
      errorLines[key] = el('p', { class: 'field-error', id: `${id}-error`, role: 'alert' });
      return input;
    };

    const fieldNode = (spec: FieldSpec) => {
      const input = inputFor(spec.key, spec.list ? { list: `product-${spec.key}-list` } : {});
      return el(
        'div',
        { class: 'field' },
        el('div', { class: 'label-row' }, el('label', { for: input.id }, spec.label, spec.required ? ' *' : '')),
        input,
        ...(spec.list ? [el('datalist', { id: `product-${spec.key}-list` }, ...spec.list.map((v) => el('option', { value: v })))] : []),
        ...(spec.hint ? [el('p', { class: 'field-hint' }, spec.hint)] : []),
        errorLines[spec.key],
      );
    };

    // Prices: one row per size, typed in zł, with the chosen lot's suggestions as buttons that fill the price in.
    const lotSelect = el('select', { id: 'product-suggestions-lot' });
    lotSelect.append(el('option', { value: '' }, 'Choose a lot…'));
    for (const s of suggestions) lotSelect.append(el('option', { value: s.lotId }, s.label));
    lotSelect.value = suggestedLot(initial, suggestions);
    const chipHolders = new Map<BagSize, HTMLElement>();
    const showChips = () => {
      const lot = suggestions.find((s) => s.lotId === lotSelect.value);
      for (const grams of BAG_SIZES_G) {
        const holder = chipHolders.get(grams);
        if (!holder) continue;
        const input = inputs[PRICE_KEYS[grams]];
        const chips = (lot?.bySize.get(grams) ?? []).map((s) => {
          const value = String(s.grosze / 100);
          const chip = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(input.value.trim() === value) }, el('strong', {}, s.text), el('span', { class: 'chip-note' }, s.markup));
          chip.addEventListener('click', () => {
            input.value = value;
            showChips();
          });
          return chip;
        });
        holder.replaceChildren(...(chips.length > 0 ? chips : lot ? [el('span', { class: 'muted small' }, 'No suggestion: add the packaging for this size under Packaging & discounts.')] : []));
      }
    };
    const priceRow = (grams: BagSize) => {
      const input = inputFor(PRICE_KEYS[grams], { inputmode: 'decimal', class: 'input-money', placeholder: 'not offered' });
      input.addEventListener('input', showChips);
      const chips = el('div', { class: 'chips' });
      chipHolders.set(grams, chips);
      return el(
        'div',
        { class: 'price-row' },
        el('label', { for: input.id, class: 'price-size' }, formatBagSize(grams)),
        el('span', { class: 'price-input' }, input, el('span', { class: 'price-unit' }, 'zł')),
        chips,
        errorLines[PRICE_KEYS[grams]],
      );
    };
    lotSelect.addEventListener('change', showChips);

    const priceSection = el(
      'fieldset',
      { class: 'form-section' },
      el('legend', {}, 'Main prices, gross'),
      el('p', { class: 'muted small' }, 'What retail customers pay; wholesale prices are worked out from these. Click a suggestion or type your own. Empty: not offered in that size.'),
      ...(suggestions.length > 0
        ? [
            el(
              'div',
              { class: 'suggest-from' },
              el('label', { for: lotSelect.id }, 'Suggestions from lot'),
              lotSelect,
              infoTip('Kraken takes what one bag costs you and suggests a price two, two and a half or three times higher, with VAT added. Only the price you pick is saved.'),
            ),
          ]
        : [el('p', { class: 'muted small' }, 'No suggestions yet: add a price to a lot (Lots) and the packaging (Packaging & discounts).')]),
      el('div', { class: 'price-rows' }, ...BAG_SIZES_G.map(priceRow)),
    );

    const banner = el('div', { class: 'form-banner' });
    const label = product ? 'Save changes' : 'Save product';
    const saveButton = el('button', { type: 'submit', class: 'btn btn-primary' }, label);
    const back = () => (product ? showProduct(product) : showList());
    const cancelButton = button('Cancel', back, 'secondary');
    const readForm = () => Object.fromEntries(FIELD_KEYS.map((key) => [key, inputs[key].value])) as unknown as ProductForm;

    const showErrors = (errors: ProductFormErrors) => {
      for (const key of FIELD_KEYS) {
        errorLines[key].textContent = errors[key] ?? '';
        inputs[key].setAttribute('aria-invalid', errors[key] ? 'true' : 'false');
      }
      const first = FIELD_KEYS.find((key) => errors[key]);
      if (first) inputs[first].focus();
    };
    const setBusy = (working: boolean) => {
      saveButton.disabled = working;
      cancelButton.disabled = working;
      saveButton.replaceChildren(working ? busy('Saving…') : label);
    };

    function save(): void {
      const result = validateProductForm(readForm());
      if (!result.ok) {
        showErrors(result.errors);
        banner.replaceChildren(message('Please fix the fields marked below.', 'error'));
        return;
      }
      showErrors({});
      banner.replaceChildren();
      setBusy(true);
      deps.busy(true);
      deps
        .withGoogle(async () => {
          if (!product) return deps.repo.add(result.fields, await deps.whoAmI(), deps.now());
          await deps.repo.update(product, changedProductFields(product, result.fields), deps.now());
          return product.id;
        })
        .finally(() => deps.busy(false))
        .then((id) => {
          if (root.isConnected) load(`Saved ${result.fields['name'] ?? ''}.`, false, id);
        })
        .catch((error: unknown) => {
          setBusy(false);
          if (deps.isIgnorable(error)) return;
          const show = (e: unknown) => {
            banner.replaceChildren(...errorNodes(e, save, 'Sign in and save', show, true, 'Reload products (drops this form)'));
            banner.scrollIntoView({ block: 'nearest' });
          };
          show(error);
        });
    }

    const formNode = el(
      'form',
      { class: 'lot-form', novalidate: '' },
      ...SECTIONS.map((section) => el('fieldset', { class: 'form-section' }, el('legend', {}, section.title), el('div', { class: 'fields' }, ...section.fields.map(fieldNode)))),
      priceSection,
      el('div', { class: 'actions' }, saveButton, cancelButton),
    );
    formNode.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!saveButton.disabled) save();
    });

    render(
      el('p', { class: 'small back-link' }, button(product ? `← ${product.name}` : '← All products', back, 'link')),
      el('h2', {}, product ? `Edit ${product.name}` : 'Add product'),
      el('p', { class: 'muted small' }, 'Fields marked * are required. Empty details are left out of the offer.'),
      ...(product ? product.problems.map((text) => message(text, 'error')) : []),
      banner,
      formNode,
    );
    showChips();
    inputs.name.focus();
  }

  load(note, fromClick);
}
