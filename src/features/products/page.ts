// The Products screen (owner, 2026-11-17): the list of products, and the form to add or edit one. A product is named
// however the owner likes and is not linked to lots; its details and main gross prices are what an offer shows.
// Everything from outside comes through ProductsPageDeps (main.ts provides it).

import { formatWholePln } from '../../core/numbers';
import { BAG_SIZES_G, formatBagSize, type BagSize } from '../../domain/bagSizes';
import { busy, button, el, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
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
} from './model';
import type { ProductsRepository } from './repo';

export interface ProductsPageDeps {
  repo: ProductsRepository;
  whoAmI: () => Promise<string>;
  /** Runs an action that talks to Google, renewing the sign-in first if needed. Call it inside a click. */
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  signIn: () => Promise<void>;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  now: () => Date;
  /** The add/edit form opened (so the browser's Back closes it) / closed. */
  formOpened: () => void;
  formClosed: () => void;
  /** Kraken is saving to Google (true) or done (false): Back and the menu wait meanwhile. */
  busy: (on: boolean) => void;
}

interface FieldSpec {
  key: keyof ProductForm;
  label: string;
  hint?: string;
  decimal?: boolean;
  required?: boolean;
  list?: readonly string[];
}

/** The form; the Polish words in brackets are the labels on the offer. */
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
  {
    title: 'Main prices, gross',
    fields: [
      { key: 'price250', label: '250 g (zł)', decimal: true, hint: 'Empty: not offered in this size.' },
      { key: 'price500', label: '500 g (zł)', decimal: true },
      { key: 'price1000', label: '1 kg (zł)', decimal: true },
    ],
  },
];

const FIELDS = SECTIONS.flatMap((s) => s.fields);

export function showProductsPage(root: HTMLElement, deps: ProductsPageDeps, note?: string, fromClick = false): void {
  let products: Product[] = [];
  let problems: string[] = [];

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

  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Loading products…')));
    (fromClick ? deps.withGoogle(() => deps.repo.load()) : deps.repo.load())
      .then((result) => {
        if (!root.isConnected) return;
        products = result.products;
        problems = result.problems;
        showList(note);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) => render(...errorNodes(e, () => load(), 'Sign in and show products', show, false));
        show(error);
      });
  }

  function lockPage(): void {
    for (const node of root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) node.disabled = true;
  }

  /**
   * Delete or Restore, inside the click (so a sign-in renewal can open Google's window). `progress` shows the spinner:
   * in the row, or on the whole page when retried after an error (the row is gone by then).
   */
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
        const show = (e: unknown) =>
          showList(undefined, errorNodes(e, () => change(product, kind, () => render(el('p', {}, busy(working)))), kind === 'remove' ? `Sign in and delete ${product.name}` : `Sign in and restore ${product.name}`, show, true));
        show(error);
      });
  }

  function showList(note?: string, error?: Node[]): void {
    deps.formClosed();
    const sorted = sortProducts(products);
    const active = sorted.filter((p) => !isDeleted(p));
    const deleted = sorted.filter(isDeleted);
    const price = (p: Product, grams: BagSize) => {
      const grosze = p.prices[grams];
      return grosze === undefined ? el('span', { class: 'muted' }, '—') : formatWholePln(grosze);
    };

    const rowNodes = (p: Product): HTMLTableRowElement[] => {
      const cell = el('td', { class: 'row-actions nowrap' });
      const confirmRow = el('tr', { class: 'confirm-row', hidden: '' });
      const inRow = (text: string) => () => {
        lockPage();
        confirmRow.hidden = true;
        cell.replaceChildren(busy(text));
      };
      const normal = () => {
        confirmRow.hidden = true;
        cell.replaceChildren(
          ...(isDeleted(p)
            ? [button('Restore', () => change(p, 'restore', inRow('Restoring…')), 'link')]
            : [button('Edit', () => showForm(p), 'link'), button('Delete', ask, 'link')]),
        );
      };
      const ask = () => {
        cell.replaceChildren();
        const no = button('No', normal, 'secondary');
        confirmRow.replaceChildren(
          el(
            'td',
            { colspan: '7' },
            el('span', {}, `Delete ${p.name}? It can be restored later. `),
            button('Yes, delete', () => change(p, 'remove', inRow('Deleting…')), 'primary'),
            ' ',
            no,
          ),
        );
        confirmRow.hidden = false;
        no.focus();
      };
      normal();
      const tr = el(
        'tr',
        isDeleted(p) ? { class: 'row-deleted' } : {},
        el('td', {}, p.name, ...(p.problems.length > 0 ? [' ', el('span', { class: 'badge badge-warn', title: p.problems.join(' ') }, 'Check')] : [])),
        el('td', {}, p.brewMethod || el('span', { class: 'muted' }, '—')),
        el('td', {}, [p.country, p.region].filter((t) => t).join(', ') || el('span', { class: 'muted' }, '—')),
        ...BAG_SIZES_G.map((g) => el('td', { class: 'num nowrap' }, price(p, g))),
        cell,
      );
      return [tr, confirmRow];
    };

    const table = (list: readonly Product[]) =>
      el(
        'div',
        { class: 'table-wrap' },
        el(
          'table',
          { class: 'data-table' },
          el(
            'thead',
            {},
            el('tr', {}, ...['Name', 'Brew method', 'Origin', ...BAG_SIZES_G.map(formatBagSize), ''].map((h, i) => el('th', { scope: 'col', ...(i >= 3 && i < 6 ? { class: 'num' } : {}) }, h))),
          ),
          el('tbody', {}, ...list.flatMap(rowNodes)),
        ),
      );

    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Products'), el('div', { class: 'head-actions' }, button('Add product', () => showForm(null)))),
      el('p', { class: 'muted small' }, 'What you offer to customers. Prices are the main gross prices (retail); wholesale prices on an offer are worked out from them.'),
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      ...active.filter((p) => p.problems.length > 0).map((p) => message(p.problems.join(' '), 'error')),
      active.length === 0 ? el('p', { class: 'muted' }, 'No products yet. Click "Add product".') : table(active),
      ...(deleted.length > 0 ? [el('details', { class: 'small' }, el('summary', {}, `Deleted products (${deleted.length})`), table(deleted))] : []),
    );
  }

  function showForm(product: Product | null): void {
    deps.formOpened();
    const initial = product ? formFromProduct(product) : emptyProductForm();
    const inputs = {} as Record<keyof ProductForm, HTMLInputElement>;
    const errorLines = {} as Record<keyof ProductForm, HTMLParagraphElement>;

    const fieldNode = (spec: FieldSpec) => {
      const id = `product-${spec.key}`;
      const input = el('input', { id, type: 'text', autocomplete: 'off', ...(spec.decimal ? { inputmode: 'decimal' } : {}), ...(spec.list ? { list: `${id}-list` } : {}) });
      input.value = initial[spec.key];
      inputs[spec.key] = input;
      const error = el('p', { class: 'field-error', id: `${id}-error`, role: 'alert' });
      errorLines[spec.key] = error;
      input.setAttribute('aria-describedby', `${id}-error`);
      return el(
        'div',
        { class: 'field' },
        el('div', { class: 'label-row' }, el('label', { for: id }, spec.label, spec.required ? ' *' : '')),
        input,
        ...(spec.list ? [el('datalist', { id: `${id}-list` }, ...spec.list.map((v) => el('option', { value: v })))] : []),
        ...(spec.hint ? [el('p', { class: 'field-hint' }, spec.hint)] : []),
        error,
      );
    };

    const banner = el('div', { class: 'form-banner' });
    const label = product ? 'Save changes' : 'Save product';
    const saveButton = el('button', { type: 'submit', class: 'btn btn-primary' }, label);
    const cancelButton = button('Cancel', () => showList(), 'secondary');
    const readForm = () => Object.fromEntries(FIELDS.map((s) => [s.key, inputs[s.key].value])) as unknown as ProductForm;

    const showErrors = (errors: ProductFormErrors) => {
      for (const spec of FIELDS) {
        errorLines[spec.key].textContent = errors[spec.key] ?? '';
        inputs[spec.key].setAttribute('aria-invalid', errors[spec.key] ? 'true' : 'false');
      }
      const first = FIELDS.find((s) => errors[s.key]);
      if (first) inputs[first.key].focus();
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
        .withGoogle(async () =>
          product ? deps.repo.update(product, changedProductFields(product, result.fields), deps.now()) : deps.repo.add(result.fields, await deps.whoAmI(), deps.now()),
        )
        .finally(() => deps.busy(false))
        .then(() => {
          if (root.isConnected) load(`Saved ${result.fields['name'] ?? ''}.`);
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
      ...SECTIONS.map((section) =>
        el('fieldset', { class: 'form-section' }, el('legend', {}, section.title), el('div', { class: 'fields' }, ...section.fields.map(fieldNode))),
      ),
      el('div', { class: 'actions' }, saveButton, cancelButton),
    );
    formNode.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!saveButton.disabled) save();
    });

    render(
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
