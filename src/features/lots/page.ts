// The Lots screen: the list of green coffee deliveries, and the form to add or edit one.
// Everything it needs from outside comes through LotsPageDeps (main.ts provides it), so the screen never reaches
// into sign-in or Google directly. The logic it shows is in model.ts and present.ts, which are tested.

import { ConflictError, TableError } from '../../core/records';
import { button, el, infoTip, message } from '../../ui/dom';
import { emptyLotForm, formFromLot, validateLotForm, type Lot, type LotForm, type LotFormErrors } from './model';
import { codeAfterChange, formPricePerKg, lotListRows } from './present';
import type { LotsRepository } from './repo';

export interface LotsPageDeps {
  repo: LotsRepository;
  /** The signed-in person's email, for "created by". */
  whoAmI: () => Promise<string>;
  /** Runs an action that talks to Google, renewing the sign-in first if needed. Call it inside a click. */
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  /** Opens Google's sign-in window. Call it inside a click. */
  signIn: () => Promise<void>;
  isSignedOut: (error: unknown) => boolean;
  /** Ignorable errors (e.g. a newer sign-in attempt replaced this one). */
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  now: () => Date;
}

const PRICE_TIP = 'Entered by hand. Not imported from RoasTime.';

type Mode = { kind: 'add' } | { kind: 'edit'; lot: Lot };

interface FieldSpec {
  key: keyof LotForm;
  label: string;
  hint?: string;
  tip?: string;
  type?: 'text' | 'date' | 'textarea';
  decimal?: boolean;
  required?: boolean;
}

/** The form, in sections (owner, 2026-11-15: coffee details together, delivery together, prices together). */
const SECTIONS: readonly { title: string; fields: readonly FieldSpec[]; pricePerKg?: true }[] = [
  {
    title: 'Coffee',
    fields: [
      { key: 'name', label: 'Name', hint: 'e.g. Kenya Kegwa', required: true },
      { key: 'country', label: 'Country', required: true },
      { key: 'region', label: 'Region' },
      { key: 'altitude', label: 'Altitude', hint: 'e.g. 1700–1900 m' },
      { key: 'process', label: 'Process', hint: 'e.g. Washed, Natural' },
      { key: 'variety', label: 'Variety' },
    ],
  },
  {
    title: 'Delivery',
    fields: [
      { key: 'deliveryDate', label: 'Delivery date', type: 'date', required: true },
      { key: 'code', label: 'Code', hint: 'Suggested from country and date; you can change it.', required: true },
      { key: 'quantityKg', label: 'Quantity delivered (kg)', decimal: true, required: true },
      { key: 'supplier', label: 'Supplier' },
    ],
  },
  {
    title: 'Price',
    fields: [
      { key: 'coffeePrice', label: 'Coffee price, net (PLN)', hint: 'Whole delivery. Can be entered later.', tip: PRICE_TIP, decimal: true },
      { key: 'deliveryCost', label: 'Delivery cost, net (PLN)', hint: 'Whole delivery. Leave empty if none.', tip: PRICE_TIP, decimal: true },
    ],
    pricePerKg: true,
  },
  { title: 'Notes', fields: [{ key: 'notes', label: 'Notes', type: 'textarea' }] },
];

const FIELDS: readonly FieldSpec[] = SECTIONS.flatMap((section) => section.fields);

export function showLotsPage(root: HTMLElement, deps: LotsPageDeps, note?: string): void {
  let lots: Lot[] = [];
  let problems: string[] = [];

  function render(...children: (Node | string)[]): void {
    root.replaceChildren(...children);
  }

  function load(note?: string): void {
    render(message('Loading lots…'));
    deps.repo
      .load()
      .then((result) => {
        lots = result.lots;
        problems = result.problems;
        showList(note);
      })
      .catch((error: unknown) => showLoadError(error));
  }

  function showLoadError(error: unknown): void {
    if (deps.isSignedOut(error)) {
      render(
        message('Your Google sign-in ran out. Nothing was lost.', 'error'),
        button('Sign in and show lots', () => {
          deps.signIn().then(
            () => load(),
            (e: unknown) => {
              if (!deps.isIgnorable(e)) showLoadError(e);
            },
          );
        }),
      );
      return;
    }
    render(message(deps.describeError(error), 'error'), button('Try again', () => load(), 'secondary'));
  }

  function showList(note?: string): void {
    const rows = lotListRows(lots);
    const table =
      rows.length === 0
        ? el('p', { class: 'muted' }, 'No lots yet. Click "Add lot" to record your first green coffee delivery.')
        : el(
            'div',
            { class: 'table-wrap' },
            el(
              'table',
              { class: 'data-table' },
              el(
                'thead',
                {},
                el(
                  'tr',
                  {},
                  ...['Code', 'Name', 'Country', 'Delivered', 'Quantity', 'Green price / kg', 'Supplier', ''].map((h) => el('th', { scope: 'col' }, h)),
                ),
              ),
              el(
                'tbody',
                {},
                ...rows.map((row) =>
                  el(
                    'tr',
                    {},
                    el(
                      'td',
                      { class: 'code' },
                      row.code,
                      ...(row.problems.length > 0 ? [' ', el('span', { class: 'badge badge-warn' }, 'Check'), infoTip(row.problems.join(' '))] : []),
                    ),
                    el('td', {}, row.name),
                    el('td', {}, row.country),
                    el('td', { class: 'nowrap' }, row.delivered),
                    el('td', { class: 'num nowrap' }, row.quantity),
                    el('td', { class: 'num nowrap' }, row.pricePerKg ?? (row.priceMissing ? el('span', { class: 'badge' }, 'Price missing') : '—')),
                    el('td', {}, row.supplier),
                    el('td', {}, button('Edit', () => showForm({ kind: 'edit', lot: row.lot }), 'link')),
                  ),
                ),
              ),
            ),
          );
    render(
      el('div', { class: 'page-head' }, el('h2', {}, 'Green coffee lots'), button('Add lot', () => showForm({ kind: 'add' }))),
      ...(note ? [message(note)] : []),
      ...problems.map((text) => message(text, 'error')),
      table,
    );
  }

  function showForm(mode: Mode): void {
    const others = mode.kind === 'edit' ? lots.filter((lot) => lot.id !== mode.lot.id) : lots;
    const otherCodes = others.map((lot) => lot.code);
    const initial = mode.kind === 'edit' ? formFromLot(mode.lot) : emptyLotForm(deps.now());
    let codeTyped = mode.kind === 'edit';

    const inputs = {} as Record<keyof LotForm, HTMLInputElement | HTMLTextAreaElement>;
    const errorLines = {} as Record<keyof LotForm, HTMLParagraphElement>;
    const fieldNodes = new Map<keyof LotForm, HTMLElement>();
    FIELDS.forEach((spec) => {
      const id = `lot-${spec.key}`;
      const input =
        spec.type === 'textarea'
          ? el('textarea', { id, rows: '3' })
          : el('input', { id, type: spec.type ?? 'text', autocomplete: 'off', ...(spec.decimal ? { inputmode: 'decimal' } : {}) });
      input.value = initial[spec.key];
      inputs[spec.key] = input;
      const error = el('p', { class: 'field-error', id: `${id}-error`, role: 'alert' });
      errorLines[spec.key] = error;
      input.setAttribute('aria-describedby', `${id}-error`);
      const node = el(
        'div',
        { class: `field${spec.type === 'textarea' ? ' field-wide' : ''}` },
        el('label', { for: id }, spec.label, spec.required ? ' *' : '', ...(spec.tip ? [' ', infoTip(spec.tip)] : [])),
        input,
        ...(spec.hint ? [el('p', { class: 'field-hint' }, spec.hint)] : []),
        error,
      );
      fieldNodes.set(spec.key, node);
    });

    const readForm = (): LotForm => Object.fromEntries(FIELDS.map((spec) => [spec.key, inputs[spec.key].value])) as unknown as LotForm;

    // Calculated, not typed: shown in the Price section like a field, updated while typing.
    const perKgValue = el('output', { class: 'calc-value', for: 'lot-coffeePrice lot-deliveryCost lot-quantityKg', 'aria-live': 'polite' });
    const perKgHint = el('p', { class: 'field-hint' });
    const pricePerKgField = el(
      'div',
      { class: 'field field-calc' },
      el('span', { class: 'label' }, 'Green price per kg ', infoTip('Calculated by Kraken: (coffee price + delivery cost) ÷ kg delivered.')),
      perKgValue,
      perKgHint,
    );
    const updatePreview = () => {
      const perKg = formPricePerKg(readForm());
      perKgValue.textContent = perKg ?? '—';
      perKgHint.textContent = perKg ? 'Calculated automatically.' : 'Shown when price and quantity are filled in.';
    };
    const updateCode = () => {
      inputs.code.value = codeAfterChange(readForm(), codeTyped, otherCodes);
    };
    inputs.code.addEventListener('input', () => {
      codeTyped = inputs.code.value.trim() !== ''; // emptied again: go back to suggestions
      if (!codeTyped) updateCode();
    });
    inputs.country.addEventListener('input', updateCode);
    inputs.deliveryDate.addEventListener('input', updateCode);
    for (const key of ['coffeePrice', 'deliveryCost', 'quantityKg'] as const) inputs[key].addEventListener('input', updatePreview);
    if (!codeTyped) updateCode();
    updatePreview();

    const banner = el('div', { class: 'form-banner' });
    const saveButton = button(mode.kind === 'add' ? 'Save lot' : 'Save changes', () => save());
    const cancelButton = button('Cancel', () => showList(), 'secondary');

    const showErrors = (errors: LotFormErrors) => {
      for (const spec of FIELDS) {
        errorLines[spec.key].textContent = errors[spec.key] ?? '';
        inputs[spec.key].setAttribute('aria-invalid', errors[spec.key] ? 'true' : 'false');
      }
      const first = FIELDS.find((spec) => errors[spec.key]);
      if (first) inputs[first.key].focus();
    };

    const setBusy = (busy: boolean) => {
      saveButton.disabled = busy;
      cancelButton.disabled = busy;
      saveButton.textContent = busy ? 'Saving…' : mode.kind === 'add' ? 'Save lot' : 'Save changes';
    };

    // Called directly inside the Save click, so a sign-in renewal can open Google's window.
    function save(): void {
      const result = validateLotForm(readForm(), others);
      if (!result.ok) {
        showErrors(result.errors);
        banner.replaceChildren(message('Please fix the fields marked below.', 'error'));
        return;
      }
      showErrors({});
      banner.replaceChildren();
      setBusy(true);
      deps
        .withGoogle(async () =>
          mode.kind === 'add'
            ? deps.repo.add(result.fields, await deps.whoAmI(), deps.now())
            : deps.repo.update(mode.lot, result.fields, deps.now()),
        )
        .then((saved) => load(`Saved ${saved.code}.`))
        .catch((error: unknown) => {
          setBusy(false);
          if (deps.isIgnorable(error)) return;
          showSaveError(error);
        });
    }

    function showSaveError(error: unknown): void {
      if (deps.isSignedOut(error)) {
        banner.replaceChildren(
          message('Your Google sign-in ran out. What you typed is still here.', 'error'),
          button('Sign in and save', () => {
            deps.signIn().then(
              () => save(),
              (e: unknown) => {
                if (!deps.isIgnorable(e)) showSaveError(e);
              },
            );
          }),
        );
      } else if (error instanceof ConflictError) {
        banner.replaceChildren(message(error.message, 'error'), button('Reload lots (drops this form)', () => load(), 'secondary'));
      } else if (error instanceof TableError) {
        banner.replaceChildren(message(error.message, 'error'));
      } else {
        banner.replaceChildren(message(`${deps.describeError(error)} Nothing was saved; try again.`, 'error'));
      }
      banner.scrollIntoView({ block: 'nearest' });
    }

    const formNode = el(
      'form',
      { class: 'lot-form', novalidate: '' },
      ...SECTIONS.map((section) =>
        el(
          'fieldset',
          { class: 'form-section' },
          el('legend', {}, section.title),
          el(
            'div',
            { class: 'fields' },
            ...section.fields.map((spec) => fieldNodes.get(spec.key) ?? ''),
            ...(section.pricePerKg ? [pricePerKgField] : []),
          ),
        ),
      ),
    );
    formNode.addEventListener('submit', (event) => {
      event.preventDefault(); // Enter in a field saves, like the button
      if (!saveButton.disabled) save();
    });

    render(
      el('h2', {}, mode.kind === 'add' ? 'Add lot' : `Edit ${mode.lot.code}`),
      el('p', { class: 'muted small' }, 'Fields marked * are required. One lot = one delivery of green coffee.'),
      ...(mode.kind === 'edit' && mode.lot.problems.length > 0 ? mode.lot.problems.map((text) => message(text, 'error')) : []),
      banner,
      formNode,
      el('div', { class: 'actions' }, saveButton, cancelButton),
    );
    inputs.name.focus();
  }

  load(note);
}
