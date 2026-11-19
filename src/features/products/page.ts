// The Products screen (owner, 2026-11-17/18), the one place for prices:
// - the list: name, brew method, origin and main prices; click a name to open the product;
// - a product's page: main (retail) gross prices and the wholesale prices at each discount, its offer details;
// - the form: details and main gross prices, with suggested prices from a lot to click, or typed.
// A product is named however the owner likes and is not linked to lots (a lot only gives suggestions).
// Everything from outside comes through ProductsPageDeps (main.ts provides it).

import { formatPln, formatWholePln, parseMoney } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize, type BagSize } from '../../domain/bagSizes';
import { busy, button, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { MAX_BEANS, dividersOf, evenShares, moveDivider, typeShare } from '../../domain/blend';
import { DEFAULT_SETTINGS, activeDiscounts, pricingFor, type BeanLot, type CostSettings, type CostsRepository, type Discount } from '../costs';
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
import { beansOf, formFromBean, validateBeans, type BeanForm, type ProductBean } from './modelBeans';
import { costing, discountHeader, priceRows, productDetails, type Costing, type PriceCell } from './present';
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
  /** Every active lot as a possible bean (newest first), and the packaging cost of each size (null: not entered). */
  let beanLots: BeanLot[] = [];
  let packaging: ReadonlyMap<number, number | null> = new Map();
  let beans: ProductBean[] = [];

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
          const problem = `The packaging, discounts and lots could not be read (${deps.describeError(error)}); the default VAT and discounts are used.`;
          return { settings: DEFAULT_SETTINGS, discounts: activeDiscounts([]).discounts, lots: [] as BeanLot[], packaging: new Map<number, number | null>(), problems: [problem] };
        },
      );
    const all = () => Promise.all([deps.repo.load(), pricing()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([result, found]) => {
        if (!root.isConnected) return;
        products = result.products;
        settings = found.settings;
        discounts = found.discounts;
        beanLots = found.lots;
        packaging = found.packaging;
        beans = result.beans;
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

    const made = costing(beansOf(beans, product.id).map(formFromBean), beanLots, packaging, vat, settings.defaultLossTenths, product.prices);
    const costCard = el(
      'section',
      { class: 'product-card' },
      el('h3', {}, 'Cost and earnings ', infoTip('What one bag costs you (the coffee from its beans plus the packaging), and what you earn on it at the retail price, without VAT.')),
      ...(made.madeOf
        ? [
            el('p', { class: 'made-of' }, made.madeOf, ...(made.perKg ? [el('span', { class: 'muted' }, ` · ${made.perKg}`)] : [])),
            ...made.notes.map((n) => el('p', { class: 'muted small' }, n)),
            earningsTable(made),
            el(
              'details',
              { class: 'how' },
              el('summary', {}, 'How is this worked out?'),
              ...(made.perKgSteps.length > 0 ? [el('ol', { class: 'how-steps' }, ...made.perKgSteps.map((step) => el('li', {}, step)))] : []),
              ...made.rows
                .filter((r) => r.steps.length > 0)
                .map((r) => el('div', {}, el('strong', {}, r.size), el('ol', { class: 'how-steps' }, ...r.steps.map((step) => el('li', {}, step))))),
            ),
          ]
        : [el('p', { class: 'muted' }, 'Choose the beans this product is made of (Edit) to see what a bag costs and earns.')]),
    );

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
      costCard,
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

  /** Per size: the cost of one bag, the retail price and what it earns. */
  function earningsTable(made: Costing): HTMLElement {
    return el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'data-table product-prices' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, ''), el('th', { scope: 'col', class: 'num' }, 'Cost of one bag'), el('th', { scope: 'col', class: 'num' }, 'You earn per bag'))),
        el(
          'tbody',
          {},
          ...made.rows.map((r) =>
            el(
              'tr',
              {},
              el('th', { scope: 'row' }, r.size),
              el('td', { class: 'num nowrap' }, el('strong', { class: 'price-main' }, r.cost || '—'), ...(r.parts ? [el('span', { class: 'price-other' }, r.parts)] : [])),
              el('td', { class: `num nowrap${r.losing ? ' losing' : ''}` }, r.earnings ? el('strong', { class: 'price-main' }, r.earnings) : el('span', { class: 'muted' }, r.cost ? 'no retail price' : '—')),
            ),
          ),
        ),
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

    // ---- The beans: up to 3, each a lot or a planned bean. Their shares are set on one bar: drag the divider between
    // two colours, or type a percentage (owner, 2026-11-19: easier than one slider per bean). ----
    const existingBeans = product ? beansOf(beans, product.id) : [];
    let beanForms: BeanForm[] = existingBeans.map(formFromBean);
    const beansHolder = el('div', { class: 'beans' });
    const beansError = el('p', { class: 'field-error', role: 'alert' });
    const splitHolder = el('div', { class: 'split-holder' });
    /** The parts of the bar, its dividers and the typed percentages, updated in place while dragging (keeps focus). */
    let parts: HTMLElement[] = [];
    let dividers: HTMLInputElement[] = [];
    let shareInputs: HTMLInputElement[] = [];
    let legendNames: HTMLElement[] = [];

    const beanName = (form: BeanForm, i: number) =>
      form.kind === 'lot' ? (beanLots.find((l) => l.lotId === form.lotId)?.label ?? `Bean ${i + 1}`) : form.plannedName.trim() || `Bean ${i + 1}`;
    const shares = () => beanForms.map((f) => f.sharePercent);
    const applyShares = (next: readonly number[]) =>
      next.forEach((share, k) => {
        const f = beanForms[k];
        if (f) f.sharePercent = share;
      });

    const showSplit = () => {
      const at = dividersOf(shares());
      beanForms.forEach((form, i) => {
        const part = parts[i];
        if (part) {
          part.style.flex = String(form.sharePercent);
          part.textContent = form.sharePercent >= 8 ? `${form.sharePercent} %` : '';
        }
        const input = shareInputs[i];
        if (input && document.activeElement !== input) input.value = String(form.sharePercent);
        const name = legendNames[i];
        if (name) name.textContent = beanName(form, i);
      });
      dividers.forEach((d, k) => (d.value = String(at[k] ?? 0)));
    };

    const renderSplit = () => {
      parts = [];
      dividers = [];
      shareInputs = [];
      legendNames = [];
      if (beanForms.length < 2) {
        splitHolder.replaceChildren(...(beanForms.length === 1 ? [el('p', { class: 'muted small' }, 'One bean: it is 100 % of the bag. Add another to make a blend.')] : []));
        return;
      }
      const bar = el('div', { class: 'split-bar', 'aria-hidden': 'true' });
      parts = beanForms.map((_, i) => el('span', { class: `split-part bean-colour-${i + 1}` }));
      bar.append(...parts);
      dividers = dividersOf(shares()).map((_, k) => {
        const range = el('input', { type: 'range', min: '0', max: '100', step: '1', class: 'split-divider', 'aria-label': `Divider between bean ${k + 1} and bean ${k + 2}` });
        range.addEventListener('input', () => {
          applyShares(moveDivider(shares(), k, Number(range.value)));
          showSplit();
          update();
        });
        return range;
      });
      const legend = el(
        'div',
        { class: 'split-legend' },
        ...beanForms.map((_, i) => {
          const input = el('input', { type: 'text', inputmode: 'numeric', class: 'split-input', id: `bean-${i}-share`, autocomplete: 'off' });
          input.addEventListener('input', () => {
            const value = Number(input.value.trim());
            if (input.value.trim() === '' || !Number.isInteger(value)) return;
            applyShares(typeShare(shares(), i, value));
            showSplit();
            update();
          });
          input.addEventListener('blur', showSplit); // shows the share as kept (e.g. after typing more than allowed)
          shareInputs.push(input);
          const name = el('span', { class: 'split-name' });
          legendNames.push(name);
          return el('label', { class: 'split-item', for: input.id }, el('span', { class: `dot bean-colour-${i + 1}` }), name, input, '%');
        }),
      );
      splitHolder.replaceChildren(el('div', { class: 'split' }, bar, ...dividers), legend);
      showSplit();
    };

    const renderBeans = () => {
      beansHolder.replaceChildren(
        ...beanForms.map((form, i) => {
          const row = el('div', { class: `bean-row bean-${i + 1}` });
          const kind = el('select', { id: `bean-${i}-kind`, 'aria-label': `Bean ${i + 1}: where it comes from` });
          kind.append(el('option', { value: 'lot' }, 'A lot from Lots'), el('option', { value: 'planned' }, 'A planned bean (not bought yet)'));
          kind.value = form.kind;
          kind.addEventListener('change', () => {
            form.kind = kind.value === 'planned' ? 'planned' : 'lot';
            renderBeans();
            update();
          });
          const what: Node[] = [];
          if (form.kind === 'lot') {
            const lot = el('select', { id: `bean-${i}-lot`, 'aria-label': `Bean ${i + 1}: lot` });
            lot.append(el('option', { value: '' }, 'Choose a lot…'));
            for (const l of beanLots) lot.append(el('option', { value: l.lotId }, `${l.label} · ${l.greenPerKg === null ? 'no price yet' : `${formatPln(Math.round(l.greenPerKg))} per kg`}`));
            lot.value = form.lotId;
            lot.addEventListener('change', () => {
              form.lotId = lot.value;
              showSplit();
              update();
            });
            what.push(lot);
          } else {
            const input = (key: 'plannedName' | 'plannedPrice' | 'plannedLoss', label: string, attrs: Record<string, string>) => {
              const node = el('input', { id: `bean-${i}-${key}`, type: 'text', autocomplete: 'off', ...attrs });
              node.value = form[key];
              node.addEventListener('input', () => {
                form[key] = node.value;
                if (key === 'plannedName') showSplit();
                update();
              });
              return el('label', { class: 'bean-field', for: node.id }, el('span', { class: 'bean-field-label' }, label), node);
            };
            what.push(
              input('plannedName', 'Name', { placeholder: 'e.g. Etiopia offer' }),
              input('plannedPrice', 'Price per kg (zł)', { inputmode: 'decimal', class: 'input-money', placeholder: 'e.g. 52,50' }),
              input('plannedLoss', 'Roast loss %', { inputmode: 'decimal', class: 'input-short', placeholder: String(settings.defaultLossTenths / 10).replace('.', ',') }),
              infoTip('The price you were quoted for 1 kg of green beans, with delivery and without VAT. Leave the roast loss empty to use your usual one.'),
            );
          }
          const remove = button(
            'Remove',
            () => {
              const removed = beanForms[i]?.sharePercent ?? 0;
              beanForms = beanForms.filter((_, k) => k !== i);
              const tail = beanForms[beanForms.length - 1];
              if (tail) tail.sharePercent += removed; // its share goes to the last bean, so the total stays 100 %
              if (beanForms.length === 1 && beanForms[0]) beanForms[0].sharePercent = 100;
              renderBeans();
              update();
            },
            'link',
          );
          row.append(el('div', { class: 'bean-head' }, el('span', { class: `dot bean-colour-${i + 1}` }), el('strong', {}, `Bean ${i + 1}`), kind, remove), el('div', { class: 'bean-what' }, ...what));
          return row;
        }),
        ...(beanForms.length < MAX_BEANS
          ? [
              button(
                beanForms.length === 0 ? 'Choose a bean' : 'Add another bean',
                () => {
                  const even = evenShares(beanForms.length + 1);
                  const added: BeanForm = { kind: 'lot', lotId: '', plannedName: '', plannedPrice: '', plannedLoss: '', sharePercent: 0 };
                  beanForms = [...beanForms, added].map((f, k): BeanForm => ({ ...f, sharePercent: even[k] ?? 0 }));
                  renderBeans();
                  update();
                },
                'secondary',
              ),
            ]
          : []),
      );
      renderSplit();
    };

    const beansSection = el(
      'fieldset',
      { class: 'form-section' },
      el('legend', {}, 'Made of'),
      el(
        'p',
        { class: 'muted small' },
        `Up to ${MAX_BEANS} beans: lots you have, or a planned bean you are thinking of buying. `,
        infoTip('Drag a white divider on the bar to change how much of the bag each bean is, or type the percentage. The shares always add up to 100 %.'),
      ),
      splitHolder,
      beansHolder,
      beansError,
    );

    // ---- Prices: one row per size, the price in zł, suggested prices to click and what the price earns ----
    const chipHolders = new Map<BagSize, HTMLElement>();
    const earnHolders = new Map<BagSize, HTMLElement>();
    /** "How is this worked out?" of each size: created once, so it stays open while the shares or prices change. */
    const howHolders = new Map<BagSize, { box: HTMLDetailsElement; list: HTMLOListElement }>();
    const madeOfLine = el('p', { class: 'made-of' });
    const notesHolder = el('div', {});
    const perKgList = el('ol', { class: 'how-steps' });
    const perKgTitle = el('summary', {});
    const perKgBox = el('details', { class: 'how' }, perKgTitle, perKgList);
    const summary = el('div', { class: 'costing-summary' }, madeOfLine, perKgBox, notesHolder);
    /** The prices as typed so far (grosze), for "you earn"; a price that cannot be read yet is left out. */
    const typedPrices = (): Partial<Record<number, number>> => {
      const out: Partial<Record<number, number>> = {};
      for (const grams of BAG_SIZES_G) {
        const grosze = parseMoney(inputs[PRICE_KEYS[grams]].value);
        if (typeof grosze === 'number' && grosze > 0) out[grams] = grosze;
      }
      return out;
    };
    const update = () => {
      const made = costing(beanForms, beanLots, packaging, settings.vatTenths, settings.defaultLossTenths, typedPrices());
      madeOfLine.replaceChildren(...(made.madeOf ? [made.madeOf, ...(made.perKg ? [el('span', { class: 'muted' }, ` · ${made.perKg}`)] : [])] : []));
      madeOfLine.hidden = !made.madeOf;
      perKgTitle.textContent = `Why ${made.perKg.replace(' of roasted coffee', '')}?`;
      perKgList.replaceChildren(...made.perKgSteps.map((step) => el('li', {}, step)));
      perKgBox.hidden = made.perKgSteps.length === 0;
      notesHolder.replaceChildren(...made.notes.map((n) => el('p', { class: 'muted small' }, n)));
      for (const r of made.rows) {
        const grams = r.grams as BagSize;
        const input = inputs[PRICE_KEYS[grams]];
        const chips = r.suggestions.map((sug) => {
          const value = String(sug.grosze / 100);
          const chip = el(
            'button',
            { type: 'button', class: 'chip', 'aria-pressed': String(input.value.trim() === value) },
            el('strong', {}, sug.text),
            el('span', { class: 'chip-note' }, `${sug.markup} · earns ${sug.earnings}`),
          );
          chip.addEventListener('click', () => {
            input.value = value;
            update();
          });
          return chip;
        });
        chipHolders.get(grams)?.replaceChildren(...(chips.length > 0 ? chips : r.parts ? [el('span', { class: 'muted small' }, r.parts)] : []));
        earnHolders.get(grams)?.replaceChildren(
          ...(r.earnings ? [el('span', { class: r.losing ? 'earn losing' : 'earn' }, r.losing ? `You lose ${r.earnings.replace('−', '')} per bag` : `You earn ${r.earnings} per bag`)] : []),
          ...(r.cost ? [el('span', { class: 'muted small' }, ` (a bag costs you ${r.cost})`)] : []),
        );
        const how = howHolders.get(grams);
        if (how) {
          how.list.replaceChildren(...r.steps.map((step) => el('li', {}, step)));
          how.box.hidden = r.steps.length === 0;
        }
      }
    };
    const priceRow = (grams: BagSize) => {
      const input = inputFor(PRICE_KEYS[grams], { inputmode: 'decimal', class: 'input-money', placeholder: '—' });
      input.addEventListener('input', update);
      const chips = el('div', { class: 'chips' });
      chipHolders.set(grams, chips);
      const earn = el('div', { class: 'price-earn' });
      earnHolders.set(grams, earn);
      const list = el('ol', { class: 'how-steps' });
      const box = el('details', { class: 'how' }, el('summary', {}, 'How is this worked out?'), list);
      howHolders.set(grams, { box, list });
      return el(
        'div',
        { class: 'price-row' },
        el('label', { for: input.id, class: 'price-size' }, formatBagSize(grams)),
        el('span', { class: 'price-input' }, input, el('span', { class: 'price-unit' }, 'zł')),
        chips,
        earn,
        box,
        errorLines[PRICE_KEYS[grams]],
      );
    };

    const priceSection = el(
      'fieldset',
      { class: 'form-section' },
      el('legend', {}, 'Main prices, with VAT'),
      el(
        'p',
        { class: 'muted small' },
        'What a shop customer pays. Click a suggestion or type your own; empty: not offered. ',
        infoTip(
          'For 250 g, Kraken suggests two, two and a half or three times what the bag costs you, with VAT. Bigger bags follow your 250 g price: as many small bags as fit, with the packaging of one big bag. "Earns" is what is left for you after the cost of the bag, without VAT.',
        ),
      ),
      summary,
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

    /** The product once its row is saved: if the beans then fail, a retry saves only the beans (never a second product). */
    let savedId: string | null = null;

    function save(): void {
      const result = validateProductForm(readForm());
      const beanCheck = validateBeans(beanForms);
      beansError.textContent = beanCheck.ok
        ? ''
        : [beanCheck.shares, ...beanCheck.errors.flatMap((e, i) => Object.values(e).map((text) => `${beanName(beanForms[i] ?? beanForms[0]!, i)}: ${text}`))].filter((t) => t).join(' ');
      if (!result.ok || !beanCheck.ok) {
        showErrors(result.ok ? {} : result.errors);
        banner.replaceChildren(message('Please fix what is marked below.', 'error'));
        return;
      }
      showErrors({});
      banner.replaceChildren();
      setBusy(true);
      deps.busy(true);
      deps
        .withGoogle(async () => {
          if (savedId === null) {
            if (product) await deps.repo.update(product, changedProductFields(product, result.fields), deps.now());
            savedId = product ? product.id : await deps.repo.add(result.fields, await deps.whoAmI(), deps.now());
          }
          await deps.repo.saveBeans(savedId, beanCheck.fields, existingBeans, deps.whoAmI, deps.now());
          return savedId;
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
      // Beans on the left, prices on the right (stays in view while the shares change); stacked on a narrow screen.
      el('div', { class: 'costing-grid' }, el('div', { class: 'costing-beans' }, beansSection), el('div', { class: 'costing-prices' }, priceSection)),
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
    renderBeans();
    update();
    inputs.name.focus();
  }

  load(note, fromClick);
}
