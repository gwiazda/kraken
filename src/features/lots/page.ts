// The Lots screen: the list of green coffee deliveries, and the form to add or edit one.
// Everything it needs from outside comes through LotsPageDeps (main.ts provides it), so the screen never reaches
// into sign-in or Google directly. The logic it shows is in model.ts and present.ts, which are tested.

import { busy, button, clickableRow, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes as explainGoogleError } from '../../ui/googleErrors';
import { formatPln, parseKg } from '../../core/numbers';
import { changedFields, emptyLotForm, formFromLot, lotSource, typedPricePerKg, validateLotForm, type Lot, type LotForm, type LotFormErrors } from './model';
import { codeAfterChange, deletedCount, formatLoss, lotListRows, type LossByLot, type LotListRow, type StockByLot } from './present';
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
  /** Green coffee used and left per lot ID, counted from the roasts (oldest delivery first). */
  loadStock: (lots: readonly Lot[]) => Promise<StockByLot>;
  /** The roast loss of each lot (its own value, else the average of its roasts, else the usual loss). */
  loadLosses: (lots: readonly Lot[]) => Promise<{ losses: LossByLot; problems: string[] }>;
  /** Checks a roast loss typed for a lot ('' = use the average again); gives the value to store. */
  checkLoss: (value: string) => { ok: true; value: string } | { ok: false; error: string };
  /** Saves a lot's own roast loss ('' = back to the average of its roasts). */
  saveLoss: (lotId: string, value: string) => Promise<void>;
  /** The add/edit form opened (so the browser's Back closes it) / closed. */
  formOpened: () => void;
  formClosed: () => void;
  /** Kraken is saving to Google (true) or done (false): Back and the menu wait meanwhile. */
  busy: (on: boolean) => void;
}


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

/** The form, in sections (owner, 2026-11-15). The price is back on the lot (owner, 2026-11-18). */
const SECTIONS: readonly { title: string; fields: readonly FieldSpec[] }[] = [
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
    title: 'Price (what you paid, without VAT)',
    fields: [
      {
        key: 'coffeePrice',
        label: 'Coffee price (zł)',
        hint: 'For the whole delivery, e.g. 4500.',
        tip: 'What you paid the supplier for the whole delivery, without VAT.',
        decimal: true,
      },
      {
        key: 'deliveryCost',
        label: 'Delivery cost (zł)',
        hint: 'Leave empty if there was none.',
        tip: 'What you paid for shipping this delivery, without VAT. Kraken adds it to the coffee price.',
        decimal: true,
      },
    ],
  },
  { title: 'Notes', fields: [{ key: 'notes', label: 'Notes', type: 'textarea' }] },
];

const FIELDS: readonly FieldSpec[] = SECTIONS.flatMap((section) => section.fields);

/** `fromClick`: opened by a click (e.g. the Lots menu), so the sign-in may be renewed before loading. */
export function showLotsPage(root: HTMLElement, deps: LotsPageDeps, note?: string, fromClick = false): void {
  let lots: Lot[] = [];
  let problems: string[] = [];
  let stock: StockByLot = new Map();
  let losses: LossByLot = new Map();
  let showDeleted = false;

  function render(...children: (Node | string)[]): void {
    root.replaceChildren(...children);
  }

  /** `fromClick`: started by a click, so the sign-in may be renewed first (renew on the next click). */
  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Loading lots…')));
    const both = async () => {
      const result = await deps.repo.load();
      // Stock comes from the Roasts tab; if that cannot be read, the lots are still shown (with a note).
      const stockResult = await deps.loadStock(result.lots).then(
        (map) => ({ map, problem: '' }),
        (error: unknown) => {
          if (deps.isSignedOut(error) || deps.isIgnorable(error)) throw error;
          return { map: new Map() as StockByLot, problem: `Stock left could not be calculated: ${deps.describeError(error)}` };
        },
      );
      // The roast loss comes from the Roasts and cost tabs; if that cannot be read, the lots are still shown too.
      const lossResult = await deps.loadLosses(result.lots).then(
        (found) => ({ map: found.losses, problems: found.problems }),
        (error: unknown) => {
          if (deps.isSignedOut(error) || deps.isIgnorable(error)) throw error;
          return { map: new Map() as LossByLot, problems: [`The roast loss could not be worked out: ${deps.describeError(error)}`] };
        },
      );
      const extra = [stockResult.problem, ...lossResult.problems].filter((p) => p);
      return { ...result, stock: stockResult.map, losses: lossResult.map, problems: [...result.problems, ...extra] };
    };
    (fromClick ? deps.withGoogle(both) : both())
      .then((result) => {
        if (!root.isConnected) return;
        lots = result.lots;
        problems = result.problems;
        stock = result.stock;
        losses = result.losses;
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
    deps.busy(true);
    deps
      .withGoogle(() => (kind === 'remove' ? deps.repo.remove(lot, deps.now()) : deps.repo.restore(lot, deps.now())))
      .finally(() => deps.busy(false))
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
    deps.formClosed(); // the list replaces any open form
    const hidden = deletedCount(lots);
    if (hidden === 0) showDeleted = false; // the switch is not shown, so it must not stay on unseen
    const rows = lotListRows(lots, showDeleted, stock, losses);

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
        el('td', { class: `num nowrap${row.overdrawn ? ' overdrawn' : ''}` }, row.stockLeft),
        el('td', { class: 'num nowrap' }, row.pricePerKg || (row.deleted || row.lot.coffeePriceGrosze !== null ? '—' : el('span', { class: 'badge badge-warn' }, 'Add price'))),
        el('td', { class: 'num nowrap', ...(row.lossNote ? { title: row.lossNote } : {}) }, row.loss || '—', ...(row.lossNote === 'your own' ? [el('span', { class: 'muted small' }, ' (own)')] : [])),
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
            : [deleteButton]),
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
            { colspan: '11' },
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
      if (!row.deleted) clickableRow(tr, () => showForm({ kind: 'edit', lot: row.lot }), `Open ${row.code}`);
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
                  ...['Code', 'Name', 'Country', 'Delivered', 'Quantity', 'Stock left'].map((h) => el('th', { scope: 'col' }, h)),
                  el('th', { scope: 'col', class: 'num' }, 'Price / kg ', infoTip('How much you paid for each kilo of green coffee in this delivery: the coffee price plus delivery, shared out over the kilos you got. Without VAT.')),
                  el(
                    'th',
                    { scope: 'col', class: 'num' },
                    'Roast loss ',
                    infoTip('Beans get lighter when roasted. With 15 % loss, 1 kg of green beans becomes 850 g of roasted coffee. Kraken uses the average of this lot\'s roasts, or your own number (click the lot).'),
                  ),
                  ...['Supplier', 'Source', ''].map((h) => el('th', { scope: 'col' }, h)),
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
        el('div', { class: 'head-actions' }, button('Add lot', () => showForm({ kind: 'add' }))),
      ),
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      ...rows
        .filter((row) => row.problems.length > 0 && !row.deleted)
        .map((row) => message(`${row.code}: ${row.problems.join(' ')} Open Edit to correct it.`, 'error')),
      ...rows.filter((row) => row.overdrawn && !row.deleted).map((row) => message(row.stockNote, 'error')),
      table,
      ...(hidden > 0
        ? [el('p', { class: 'show-deleted small' }, toggle, ' ', el('label', { for: 'show-deleted' }, `Show deleted (${hidden})`))]
        : []),
    );
  }

  function showForm(mode: Mode): void {
    deps.formOpened();
    const others = mode.kind === 'edit' ? lots.filter((lot) => lot.id !== mode.lot.id) : lots;
    const otherCodes = others.map((lot) => lot.code);
    const initial = mode.kind === 'edit' ? formFromLot(mode.lot) : emptyLotForm(deps.now());
    let codeTyped = mode.kind === 'edit';
    /** The lot once its row is saved: if the roast loss then fails, a retry saves only the loss (never a second lot). */
    let savedLot: Lot | null = null;

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

    const readForm = (): LotForm => ({ ...initial, ...(Object.fromEntries(FIELDS.map((spec) => [spec.key, inputs[spec.key].value])) as Partial<LotForm>) });

    const updateCode = () => {
      inputs.code.value = codeAfterChange(readForm(), codeTyped, otherCodes);
    };
    inputs.code.addEventListener('input', () => {
      codeTyped = inputs.code.value.trim() !== ''; // emptied again: go back to suggestions
      if (!codeTyped) updateCode();
    });
    inputs.country.addEventListener('input', updateCode);
    inputs.deliveryDate.addEventListener('input', updateCode);
    if (!codeTyped) updateCode();

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

    // Under the price: what 1 kg of green coffee cost, worked out while typing.
    const perKg = el('p', { class: 'price-per-kg', 'aria-live': 'polite' });
    const showPerKg = () => {
      const form = readForm();
      const grams = parseKg(form.quantityKg);
      const value = typedPricePerKg(form, typeof grams === 'number' ? grams : null);
      perKg.replaceChildren(
        ...(value !== null
          ? ['= ', el('strong', {}, formatPln(value)), ' for 1 kg of green coffee']
          : [el('span', { class: 'muted' }, 'Fill in the coffee price and the kg delivered to see what 1 kg cost you.')]),
      );
    };
    for (const key of ['coffeePrice', 'deliveryCost', 'quantityKg'] as const) inputs[key].addEventListener('input', showPerKg);
    showPerKg();

    // The roast loss: empty uses the average of this lot's roasts (or the usual loss); a number is the owner's own.
    const lossNow = mode.kind === 'edit' ? losses.get(mode.lot.id) : undefined;
    const lossInput = el('input', { id: 'lot-roastLoss', type: 'text', inputmode: 'decimal', autocomplete: 'off', class: 'input-short', 'aria-describedby': 'lot-roastLoss-error' });
    lossInput.value = lossNow?.own.replace('.', ',') ?? '';
    lossInput.placeholder = lossNow && !lossNow.own ? formatLoss(lossNow.lossTenths).replace(' %', '') : '';
    const lossError = el('p', { class: 'field-error', id: 'lot-roastLoss-error', role: 'alert' });
    const lossHint =
      lossNow && !lossNow.own
        ? `Empty: ${formatLoss(lossNow.lossTenths)}, the ${lossNow.source}.`
        : lossNow?.own
          ? 'Empty it to use the average of this lot\'s roasts again.'
          : 'Empty: the average of this lot\'s roasts once there are some, until then the usual loss.';
    const lossField = el(
      'div',
      { class: 'field' },
      el(
        'div',
        { class: 'label-row' },
        el('label', { for: lossInput.id }, 'Roast loss % (optional)'),
        infoTip(
          'Beans get lighter when roasted. With 15 % loss, 1 kg of green beans becomes 850 g of roasted coffee. Leave it empty and Kraken uses the average of this lot\'s roasts.',
        ),
      ),
      lossInput,
      el('p', { class: 'field-hint' }, lossHint),
      lossError,
    );

    const setBusy = (working: boolean) => {
      saveButton.disabled = working;
      cancelButton.disabled = working;
      saveButton.replaceChildren(working ? busy('Saving…') : mode.kind === 'add' ? 'Save lot' : 'Save changes');
    };

    // Called directly inside the Save click, so a sign-in renewal can open Google's window.
    function save(): void {
      const form = readForm();
      const result = validateLotForm(form, others);
      const loss = deps.checkLoss(lossInput.value);
      lossError.textContent = loss.ok ? '' : loss.error;
      lossInput.setAttribute('aria-invalid', loss.ok ? 'false' : 'true');
      if (!result.ok || !loss.ok) {
        showErrors(result.ok ? {} : result.errors);
        if (result.ok) lossInput.focus();
        banner.replaceChildren(message('Please fix the fields marked below.', 'error'));
        return;
      }
      const lossChanged = loss.value !== (lossNow?.own ?? '');
      showErrors({});
      banner.replaceChildren();
      setBusy(true);
      deps.busy(true);
      deps
        .withGoogle(async () => {
          const saved =
            savedLot ??
            (mode.kind === 'add'
              ? await deps.repo.add(result.fields, await deps.whoAmI(), deps.now())
              : await deps.repo.update(mode.lot, changedFields(initial, form, result.fields), deps.now()));
          savedLot = saved;
          if (lossChanged) await deps.saveLoss(saved.id, loss.value);
          return saved;
        })
        .finally(() => deps.busy(false))
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
            ...(section.fields.some((spec) => spec.key === 'coffeePrice') ? [lossField] : []),
          ),
          ...(section.fields.some((spec) => spec.key === 'coffeePrice') ? [perKg] : []),
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
      ...(mode.kind === 'edit' ? mode.lot.problems.map((text) => message(text, 'error')) : []),
      banner,
      formNode,
    );
    inputs.name.focus();
  }

  load(note, fromClick);
}
