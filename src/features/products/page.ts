// The Products screen (owner, 2026-11-17/18), the one place for prices:
// - the list: name, brew method, origin and main prices; click a name to open the product;
// - a product's page: main (retail) gross prices and the wholesale prices at each discount, its offer details;
// - the form: details, and the planner (planner.ts, shared with the Product planner tab): the beans it is made of and its
//   main prices with suggestions and earnings.
// Everything from outside comes through ProductsPageDeps (main.ts provides it).

import { formatWholePln } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize, type BagSize } from '../../domain/bagSizes';
import { busy, button, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { DEFAULT_SETTINGS, activeDiscounts, type BeanLot, type CostSettings, type CostsRepository, type Discount } from '../costs';
import type { LotsRepository } from '../lots';
import type { RoastsRepository } from '../roasts';
import {
  BREW_METHODS,
  changedProductFields,
  emptyProductForm,
  formFromProduct,
  isDeleted,
  sortProducts,
  validateProductForm,
  type Product,
  type ProductForm,
  type ProductFormErrors,
  PRICE_FIELDS,
} from './model';
import { beansOf, formFromBean, validateBeans, type ProductBean } from './modelBeans';
import { costing, priceRows, productDetails, type Costing } from './present';
import { MARGIN_TIP, costsBySize, pricesTable } from './priceTable';
import { beanName, createPlanner, loadPlannerData, type PlannerStart } from './planner';
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
  /** Opens the Product planner with these beans and prices (a copy: the product is not changed). */
  openPlanner: (start: PlannerStart) => void;
}

/** The text fields of the form; the prices are in the planner. */
type TextKey = Exclude<keyof ProductForm, (typeof PRICE_FIELDS)[BagSize]>;

interface FieldSpec {
  key: TextKey;
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

const TEXT_KEYS: readonly TextKey[] = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

/** `create`: open "Add product" straight away with these beans and prices (from the Product planner). */
export function showProductsPage(root: HTMLElement, deps: ProductsPageDeps, note?: string, fromClick = false, create?: PlannerStart): void {
  let products: Product[] = [];
  let problems: string[] = [];
  let settings: CostSettings = DEFAULT_SETTINGS;
  let discounts: Discount[] = activeDiscounts([]).discounts;
  /** Every active lot as a possible bean (newest first), and the packaging cost of each size (null: not entered). */
  let beanLots: BeanLot[] = [];
  let packaging: ReadonlyMap<number, number | null> = new Map();
  let beans: ProductBean[] = [];

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);
  /** A product's beans and prices, as the planner starts with them. */
  const plannerStartOf = (product: Product | null): PlannerStart => {
    const form = product ? formFromProduct(product) : emptyProductForm();
    return {
      beans: product ? beansOf(beans, product.id).map(formFromBean) : [],
      prices: Object.fromEntries(BAG_SIZES_G.map((g) => [g, form[PRICE_FIELDS[g]]])),
    };
  };
  /** "Create product from this" opens the form once; a later reload (e.g. after a failed save) shows the list. */
  let pendingCreate = create;

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
    // The products come first; the planner's data (packaging, discounts, lots) is extra: if it cannot be read, the
    // products are still shown, with the default VAT and discounts and a note.
    const pricing = () => loadPlannerData(deps);
    const all = () => Promise.all([deps.repo.load(), pricing()]);
    (fromClick ? deps.withGoogle(all) : all())
      .then(([result, found]) => {
        if (!root.isConnected) return;
        products = result.products;
        settings = found.settings;
        discounts = found.discounts;
        beanLots = found.beanLots;
        packaging = found.packaging;
        beans = result.beans;
        problems = [...result.problems, ...found.problems];
        const open = openId ? products.find((p) => p.id === openId && !isDeleted(p)) : undefined;
        if (open) showProduct(open, note);
        else if (pendingCreate) {
          const plan = pendingCreate;
          pendingCreate = undefined;
          showForm(null, plan);
        }
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

    const made = costing(beansOf(beans, product.id).map(formFromBean), beanLots, packaging, vat, settings.defaultLossTenths, product.prices);
    const pricesHolder = pricesTable(
      priceRows(
        product.prices,
        discounts.map((d) => d.tenths),
        vat,
        costsBySize(made.rows),
      ),
      discounts,
    );

    const costCard = el(
      'section',
      { class: 'product-card' },
      el('h3', {}, 'Cost and earnings ', infoTip(`What one bag costs you (the coffee from its beans plus the packaging), what you earn on it at the retail price, without VAT, and the gross margin. ${MARGIN_TIP}`)),
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
      actions.replaceChildren(button('Try in Product planner', () => deps.openPlanner(plannerStartOf(product)), 'secondary'), button('Edit', () => showForm(product), 'secondary'), button('Delete', ask, 'secondary'));
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
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col' }, ''),
            el('th', { scope: 'col', class: 'num' }, 'Cost of one bag'),
            el('th', { scope: 'col', class: 'num' }, 'You earn per bag'),
            el('th', { scope: 'col', class: 'num' }, 'Gross margin ', infoTip(MARGIN_TIP)),
          ),
        ),
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
              el('td', { class: `num nowrap${r.marginLosing ? ' losing' : ''}` }, r.margin ? el('strong', { class: 'price-main' }, r.margin) : el('span', { class: 'muted' }, '—')),
            ),
          ),
        ),
      ),
    );
  }

  // ---- The form ----

  /** Adds (`product` null) or edits a product. `startFrom`: beans and prices brought from the Product planner. */
  function showForm(product: Product | null, startFrom?: PlannerStart): void {
    deps.formOpened();
    const initial = product ? formFromProduct(product) : emptyProductForm();
    const inputs = {} as Record<TextKey, HTMLInputElement>;
    const errorLines = {} as Record<TextKey, HTMLParagraphElement>;

    const inputFor = (key: TextKey, attrs: Record<string, string> = {}) => {
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

    // The beans and the prices: the planner, the same piece as the Product planner tab (one place for both, owner 2026-11-19).
    const existingBeans = product ? beansOf(beans, product.id) : [];
    const planner = createPlanner({ settings, beanLots, packaging }, startFrom ?? plannerStartOf(product), {
      pricesTitle: 'Main prices, with VAT',
      pricesIntro: 'What a shop customer pays. Click a suggestion or type your own; empty: not offered. ',
    });

    const banner = el('div', { class: 'form-banner' });
    const label = product ? 'Save changes' : 'Save product';
    const saveButton = el('button', { type: 'submit', class: 'btn btn-primary' }, label);
    const back = () => (product ? showProduct(product) : showList());
    const cancelButton = button('Cancel', back, 'secondary');
    const readForm = (): ProductForm => {
      const prices = planner.prices();
      const text = Object.fromEntries(TEXT_KEYS.map((key) => [key, inputs[key].value])) as Pick<ProductForm, TextKey>;
      return { ...text, ...Object.fromEntries(BAG_SIZES_G.map((g) => [PRICE_FIELDS[g], prices[g]])) } as ProductForm;
    };

    const showErrors = (errors: ProductFormErrors) => {
      for (const key of TEXT_KEYS) {
        errorLines[key].textContent = errors[key] ?? '';
        inputs[key].setAttribute('aria-invalid', errors[key] ? 'true' : 'false');
      }
      const first = TEXT_KEYS.find((key) => errors[key]);
      if (first) inputs[first].focus();
      planner.showPriceErrors(Object.fromEntries(BAG_SIZES_G.map((g) => [g, errors[PRICE_FIELDS[g]]])), !first);
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
      const beanForms = planner.beans();
      const beanCheck = validateBeans(beanForms);
      planner.showBeanErrors(
        beanCheck.ok ? '' : [beanCheck.shares, ...beanCheck.errors.flatMap((e, i) => Object.values(e).map((text) => `${beanName(beanForms[i] ?? beanForms[0]!, i, beanLots)}: ${text}`))].filter((t) => t).join(' '),
      );
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
          // Who is signed in is asked once per save (a new product and new beans both need it).
          let email: string | null = null;
          const by = async () => (email ??= await deps.whoAmI());
          if (savedId === null) {
            if (product) await deps.repo.update(product, changedProductFields(product, result.fields), deps.now());
            savedId = product ? product.id : await deps.repo.add(result.fields, await by(), deps.now());
            await deps.repo.saveBeans(savedId, beanCheck.fields, existingBeans, by, deps.now());
            return savedId;
          }
          // A retry after the product row was saved: read the product and its beans again (part of the save may have
          // gone through), then write only what still differs, including anything changed in the form meanwhile.
          const fresh = await deps.repo.load();
          const stored = fresh.products.find((p) => p.id === savedId);
          if (stored) {
            const changes = changedProductFields(stored, result.fields);
            if (Object.keys(changes).length > 0) await deps.repo.update(stored, changes, deps.now());
          }
          await deps.repo.saveBeans(savedId, beanCheck.fields, beansOf(fresh.beans, savedId), by, deps.now());
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
      planner.node,
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
    inputs.name.focus();
  }

  load(note, fromClick);
}
