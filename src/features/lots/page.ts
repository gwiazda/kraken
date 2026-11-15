// The Lots screen: the list of green coffee deliveries, and the form to add or edit one.
// Everything it needs from outside comes through LotsPageDeps (main.ts provides it), so the screen never reaches
// into sign-in or Google directly. The logic it shows is in model.ts and present.ts, which are tested.

import { busy, button, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes as explainGoogleError } from '../../ui/googleErrors';
import { changedFields, emptyLotForm, formFromLot, lotSource, validateLotForm, type Lot, type LotForm, type LotFormErrors } from './model';
import { codeAfterChange, deletedCount, formPricePerKg, lotListRows, type LotListRow } from './present';
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
  /** Opens the "Import from RoasTime" screen. */
  openImport: () => void;
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

/** `fromClick`: opened by a click (e.g. the Lots menu), so the sign-in may be renewed before loading. */
export function showLotsPage(root: HTMLElement, deps: LotsPageDeps, note?: string, fromClick = false): void {
  let lots: Lot[] = [];
  let problems: string[] = [];
  let showDeleted = false;

  function render(...children: (Node | string)[]): void {
    root.replaceChildren(...children);
  }

  /** `fromClick`: started by a click, so the sign-in may be renewed first (renew on the next click). */
  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Loading lots…')));
    (fromClick ? deps.withGoogle(() => deps.repo.load()) : deps.repo.load())
      .then((result) => {
        lots = result.lots;
        problems = result.problems;
        showList(note);
      })
      .catch((error: unknown) => {
        if (!deps.isIgnorable(error)) showLoadError(error);
      });
  }

  function showLoadError(error: unknown): void {
    render(
      ...googleErrorNodes(error, {
        retry: () => load(),
        retryLabel: 'Sign in and show lots',
        show: showLoadError,
        otherButton: 'try-again',
        signedOutNote: 'Nothing was lost.',
      }),
    );
  }

  /** See ui/googleErrors.ts. `reload` (default) for actions that may have written something. */
  function googleErrorNodes(
    error: unknown,
    options: {
      retry: () => void;
      retryLabel: string;
      show: (error: unknown) => void;
      otherButton: 'try-again' | 'reload';
      reloadLabel?: string;
      signedOutNote?: string;
    },
  ): Node[] {
    const tryAgain = options.otherButton === 'try-again';
    return explainGoogleError(error, deps, {
      retry: options.retry,
      retryLabel: options.retryLabel,
      show: options.show,
      ...(options.signedOutNote ? { signedOutNote: options.signedOutNote } : {}),
      other: {
        label: tryAgain ? 'Try again' : (options.reloadLabel ?? 'Reload lots'),
        action: () => load(undefined, true),
        mayHaveSaved: !tryAgain,
      },
    });
  }

  /** Disables every button and box on the page while Google works, so nothing else can start meanwhile. */
  function lockPage(): void {
    for (const node of root.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) node.disabled = true;
  }

  /**
   * Delete or Restore. Called inside the click, so a sign-in renewal can open Google's window. `progress` shows the
   * spinner (in the row, or on the whole page after a sign-in).
   */
  function change(lot: Lot, kind: 'remove' | 'restore', progress: () => void): void {
    progress();
    deps
      .withGoogle(() => (kind === 'remove' ? deps.repo.remove(lot, deps.now()) : deps.repo.restore(lot, deps.now())))
      .then((saved) => {
        if (!root.isConnected) return; // the user went to another page meanwhile
        load(kind === 'remove' ? `Deleted ${saved.code}. You can bring it back with "Show deleted", then Restore.` : `Restored ${saved.code}.`);
      })
      .catch((error: unknown) => {
        if (!root.isConnected) return;
        if (deps.isIgnorable(error)) {
          showList();
          return;
        }
        const working = kind === 'remove' ? `Deleting ${lot.code}…` : `Restoring ${lot.code}…`;
        const showError = (e: unknown) =>
          showList(
            undefined,
            googleErrorNodes(e, {
              retry: () => change(lot, kind, () => render(el('p', {}, busy(working)))),
              retryLabel: kind === 'remove' ? `Sign in and delete ${lot.code}` : `Sign in and restore ${lot.code}`,
              show: showError,
              otherButton: 'reload',
            }),
          );
        showError(error);
      });
  }

  function showList(note?: string, error?: Node[]): void {
    const hidden = deletedCount(lots);
    if (hidden === 0) showDeleted = false; // the switch is not shown, so it must not stay on unseen
    const rows = lotListRows(lots, showDeleted);

    function rowNodes(row: LotListRow): HTMLTableRowElement[] {
      const cell = el('td', { class: 'row-actions nowrap' });
      const tr = el(
        'tr',
        row.deleted ? { class: 'row-deleted' } : {},
        el(
          'td',
          { class: 'code' },
          row.code,
          ...(row.deleted ? [' ', el('span', { class: 'badge badge-muted' }, row.deletedNote)] : []),
          ...(row.problems.length > 0 ? [' ', el('span', { class: 'badge badge-warn', title: row.problems.join(' ') }, 'Check')] : []),
        ),
        el('td', {}, row.name),
        el('td', {}, row.country),
        el('td', { class: 'nowrap' }, row.delivered),
        el('td', { class: 'num nowrap' }, row.quantity),
        el('td', { class: 'num nowrap' }, row.pricePerKg ?? (row.priceMissing ? el('span', { class: 'badge' }, 'Price missing') : '—')),
        el('td', {}, row.supplier),
        el('td', { class: 'nowrap' }, el('span', { class: row.source === 'RoasTime' ? 'badge badge-muted' : 'muted small' }, row.source)),
        cell,
      );
      const inRow = (text: string) => () => {
        lockPage();
        tr.classList.add('row-busy');
        cell.replaceChildren(busy(text));
      };
      // The "Delete …?" question gets its own full-width line under the lot, so the table never gets wider.
      const confirmRow = el('tr', { class: 'confirm-row', hidden: '' });
      const normal = (focusDelete = false) => {
        confirmRow.hidden = true;
        const deleteButton = button('Delete', ask, 'link');
        cell.replaceChildren(
          ...(row.deleted
            ? [button('Restore', () => change(row.lot, 'restore', inRow('Restoring…')), 'link')]
            : [button('Edit', () => showForm({ kind: 'edit', lot: row.lot }), 'link'), deleteButton]),
        );
        if (focusDelete) deleteButton.focus();
      };
      // A second click confirms. Deleting only hides the lot (it can be restored), so one short question is enough.
      const ask = () => {
        cell.replaceChildren();
        const no = button('No', () => normal(true), 'secondary');
        confirmRow.replaceChildren(
          el(
            'td',
            { colspan: '9' },
            el('span', {}, `Delete ${row.code}? It can be restored later under "Show deleted". `),
            button(
              'Yes, delete',
              () => {
                confirmRow.hidden = true;
                change(row.lot, 'remove', inRow('Deleting…'));
              },
              'primary',
            ),
            ' ',
            no,
          ),
        );
        confirmRow.hidden = false;
        no.focus(); // keyboard users land on the question; the safe answer first
      };
      normal();
      return [tr, confirmRow];
    }

    const table =
      rows.length === 0
        ? el('p', { class: 'muted' }, hidden > 0 ? 'No active lots.' : 'No lots yet. Click "Add lot" to record your first green coffee delivery.')
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
                  ...['Code', 'Name', 'Country', 'Delivered', 'Quantity', 'Green price / kg', 'Supplier', 'Source', ''].map((h) => el('th', { scope: 'col' }, h)),
                ),
              ),
              el('tbody', {}, ...rows.flatMap(rowNodes)),
            ),
          );

    const toggle = el('input', { type: 'checkbox', id: 'show-deleted' });
    toggle.checked = showDeleted;
    toggle.addEventListener('change', () => {
      showDeleted = toggle.checked;
      showList();
    });

    render(
      el(
        'div',
        { class: 'page-head' },
        el('h2', {}, 'Green coffee lots'),
        el('div', { class: 'head-actions' }, button('Import from RoasTime', () => deps.openImport(), 'secondary'), button('Add lot', () => showForm({ kind: 'add' }))),
      ),
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      ...rows
        .filter((row) => row.problems.length > 0 && !row.deleted)
        .map((row) => message(`${row.code}: ${row.problems.join(' ')} Open Edit to correct it.`, 'error')),
      table,
      ...(hidden > 0
        ? [el('p', { class: 'show-deleted small' }, toggle, ' ', el('label', { for: 'show-deleted' }, `Show deleted (${hidden})`))]
        : []),
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
        el('div', { class: 'label-row' }, el('label', { for: id }, spec.label, spec.required ? ' *' : ''), ...(spec.tip ? [infoTip(spec.tip)] : [])),
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
    // A real submit button inside the form: clicking it or pressing Enter in a field both save.
    const saveButton = el('button', { type: 'submit', class: 'btn btn-primary' }, mode.kind === 'add' ? 'Save lot' : 'Save changes');
    const cancelButton = button('Cancel', () => showList(), 'secondary');

    const showErrors = (errors: LotFormErrors) => {
      for (const spec of FIELDS) {
        errorLines[spec.key].textContent = errors[spec.key] ?? '';
        inputs[spec.key].setAttribute('aria-invalid', errors[spec.key] ? 'true' : 'false');
      }
      const first = FIELDS.find((spec) => errors[spec.key]);
      if (first) inputs[first.key].focus();
    };

    const setBusy = (working: boolean) => {
      saveButton.disabled = working;
      cancelButton.disabled = working;
      saveButton.replaceChildren(working ? busy('Saving…') : mode.kind === 'add' ? 'Save lot' : 'Save changes');
    };

    // Called directly inside the Save click, so a sign-in renewal can open Google's window.
    function save(): void {
      const form = readForm();
      const result = validateLotForm(form, others);
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
            : deps.repo.update(mode.lot, changedFields(initial, form, result.fields), deps.now()),
        )
        .then((saved) => load(`Saved ${saved.code}.`))
        .catch((error: unknown) => {
          setBusy(false);
          if (deps.isIgnorable(error)) return;
          showSaveError(error);
        });
    }

    function showSaveError(error: unknown): void {
      banner.replaceChildren(
        ...googleErrorNodes(error, {
          retry: () => save(),
          retryLabel: 'Sign in and save',
          show: showSaveError,
          otherButton: 'reload',
          reloadLabel: 'Reload lots (drops this form)',
        }),
      );
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
      el('div', { class: 'actions' }, saveButton, cancelButton),
    );
    formNode.addEventListener('submit', (event) => {
      event.preventDefault(); // Kraken saves through Google itself; the browser never sends the form anywhere
      if (!saveButton.disabled) save();
    });

    render(
      el('h2', {}, mode.kind === 'add' ? 'Add lot' : `Edit ${mode.lot.code}`),
      el(
        'p',
        { class: 'muted small' },
        mode.kind === 'edit' && lotSource(mode.lot) === 'RoasTime'
          ? 'Imported from RoasTime. A later import may update the name, country, region, process and quantity (you are asked first). Fields marked * are required.'
          : mode.kind === 'edit'
            ? 'Entered by hand. Imports from RoasTime never change it. Fields marked * are required.'
            : 'Fields marked * are required. One lot = one delivery of green coffee.',
      ),
      ...(mode.kind === 'edit' && mode.lot.problems.length > 0 ? mode.lot.problems.map((text) => message(text, 'error')) : []),
      banner,
      formNode,
    );
    inputs.name.focus();
  }

  load(note, fromClick);
}
