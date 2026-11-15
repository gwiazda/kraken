// The Roasts screen: the roasting log, which lot each roast used, and choosing a lot or marking a sample.
// Everything from outside comes through RoastsPageDeps (main.ts provides it).

import { busy, button, el, infoTip, message } from '../../ui/dom';
import { googleErrorNodes } from '../../ui/googleErrors';
import { isDeleted, type Lot, type LotsRepository } from '../lots';
import { allocate } from './allocation';
import { emptyRoastForm, formFromRoast, fromRoastime, validateRoastForm, type Roast, type RoastForm, type RoastFormErrors } from './model';
import { roastListRows, type RoastListRow } from './present';
import type { RoastsRepository } from './repo';

export interface RoastsPageDeps {
  repo: RoastsRepository;
  lots: LotsRepository;
  whoAmI: () => Promise<string>;
  /** Runs an action that talks to Google, renewing the sign-in first if needed. Call it inside a click. */
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  signIn: () => Promise<void>;
  isSignedOut: (error: unknown) => boolean;
  isIgnorable: (error: unknown) => boolean;
  describeError: (error: unknown) => string;
  now: () => Date;
  /** Kraken is saving to Google (true) or done (false): Back and the menu wait meanwhile. */
  busy: (on: boolean) => void;
  /** Opens "Sync with RoasTime". */
  openSync: () => void;
  /** The add/edit form opened (so the browser's Back closes it) / closed. */
  formOpened: () => void;
  formClosed: () => void;
}

type Mode = { kind: 'add' } | { kind: 'edit'; roast: Roast };

export function showRoastsPage(root: HTMLElement, deps: RoastsPageDeps, note?: string, fromClick = false): void {
  let roasts: Roast[] = [];
  let lots: Lot[] = [];
  let problems: string[] = [];
  let showDeleted = false;
  let onlyNeedsLot = false;

  const render = (...children: (Node | string)[]) => root.replaceChildren(...children);

  function load(note?: string, fromClick = false): void {
    render(el('p', {}, busy('Loading roasts…')));
    const both = () => Promise.all([deps.repo.load(), deps.lots.load()]);
    (fromClick ? deps.withGoogle(both) : both())
      .then(([r, l]) => {
        if (!root.isConnected) return;
        roasts = r.roasts;
        lots = l.lots;
        problems = r.problems;
        showList(note);
      })
      .catch((error: unknown) => {
        if (!root.isConnected || deps.isIgnorable(error)) return;
        const show = (e: unknown) =>
          render(
            ...googleErrorNodes(e, deps, {
              retry: () => load(),
              retryLabel: 'Sign in and show roasts',
              show,
              other: { label: 'Try again', action: () => load(undefined, true), mayHaveSaved: false },
              signedOutNote: 'Nothing was lost.',
            }),
          );
        show(error);
      });
  }

  /** The explanation and buttons after a failed save, delete or restore. */
  function saveError(error: unknown, retry: () => void, show: (e: unknown) => void, reloadLabel = 'Reload roasts'): Node[] {
    return googleErrorNodes(error, deps, {
      retry,
      retryLabel: 'Sign in and try again',
      show,
      other: { label: reloadLabel, action: () => load(undefined, true), mayHaveSaved: true },
    });
  }

  function lockPage(): void {
    for (const node of root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')) node.disabled = true;
  }

  function showList(note?: string, error?: Node[]): void {
    deps.formClosed(); // the list replaces any open form
    const allocation = allocate(lots, roasts);
    const deletedCount = roasts.filter((r) => r.deletedAt !== '').length;
    if (deletedCount === 0) showDeleted = false;
    const all = roastListRows(roasts, lots, allocation, showDeleted);
    const needing = all.filter((row) => row.needsLot && !row.deleted).length;
    if (needing === 0) onlyNeedsLot = false;
    const rows = onlyNeedsLot ? all.filter((row) => row.needsLot) : all;

    function change(row: RoastListRow, kind: 'remove' | 'restore', tr: HTMLTableRowElement, cell: HTMLElement): void {
      lockPage();
      tr.classList.add('row-busy');
      cell.replaceChildren(busy(kind === 'remove' ? 'Deleting…' : 'Restoring…'));
      deps.busy(true);
      deps
        .withGoogle(() => (kind === 'remove' ? deps.repo.remove(row.roast, deps.now()) : deps.repo.restore(row.roast, deps.now())))
        .finally(() => deps.busy(false))
        .then(() => {
          if (root.isConnected) load(kind === 'remove' ? 'Roast deleted. "Show deleted" brings it back.' : 'Roast restored.');
        })
        .catch((e: unknown) => {
          if (!root.isConnected) return;
          if (deps.isIgnorable(e)) {
            showList();
            return;
          }
          const show = (err: unknown) => showList(undefined, saveError(err, () => load(undefined, true), show));
          show(e);
        });
    }

    function rowNodes(row: RoastListRow): HTMLTableRowElement[] {
      const cell = el('td', { class: 'row-actions nowrap' });
      const marks = [
        ...(row.sample ? [el('span', { class: 'badge badge-muted' }, 'Sample')] : []),
        ...(row.needsLot ? [el('span', { class: 'badge badge-warn' }, 'Needs a lot')] : []),
        ...(row.beforeDelivery ? [el('span', { class: 'badge', title: 'Roasted before this lot was delivered: check the coffee chosen in RoasTime.' }, 'Before delivery')] : []),
        ...(row.chosen ? [el('span', { class: 'badge badge-muted', title: 'Lot chosen in Kraken' }, 'Chosen')] : []),
        ...(row.problems.length > 0 ? [el('span', { class: 'badge badge-warn', title: row.problems.join(' ') }, 'Check')] : []),
      ];
      const tr = el(
        'tr',
        row.deleted ? { class: 'row-deleted' } : {},
        el('td', { class: 'nowrap' }, row.when),
        el('td', {}, row.name, ...(row.source === 'By hand' ? [' ', el('span', { class: 'muted small' }, '(by hand)')] : [])),
        el('td', {}, row.coffee),
        el('td', { class: 'num nowrap' }, row.green),
        el('td', { class: 'num nowrap' }, row.roasted),
        el('td', { class: 'num nowrap' }, row.loss),
        el('td', { class: row.counted ? '' : 'muted small' }, row.lots, ...(marks.length > 0 ? [' ', ...marks.flatMap((m) => [m, ' '])] : [])),
        cell,
      );
      const confirmRow = el('tr', { class: 'confirm-row', hidden: '' });
      const normal = (focusDelete = false) => {
        confirmRow.hidden = true;
        const del = button('Delete', ask, 'link');
        cell.replaceChildren(
          ...(row.deleted
            ? [button('Restore', () => change(row, 'restore', tr, cell), 'link')]
            : [button('Edit', () => showForm({ kind: 'edit', roast: row.roast }), 'link'), del]),
        );
        if (focusDelete) del.focus();
      };
      const ask = () => {
        cell.replaceChildren();
        const no = button('No', () => normal(true), 'secondary');
        confirmRow.replaceChildren(
          el(
            'td',
            { colspan: '8' },
            el('span', {}, `Delete the roast ${row.name} (${row.when})? It can be restored later under "Show deleted". `),
            button(
              'Yes, delete',
              () => {
                confirmRow.hidden = true;
                change(row, 'remove', tr, cell);
              },
              'primary',
            ),
            ' ',
            no,
          ),
        );
        confirmRow.hidden = false;
        no.focus();
      };
      normal();
      return [tr, confirmRow];
    }

    const switchBox = (id: string, label: string, checked: boolean, onChange: (on: boolean) => void) => {
      const box = el('input', { type: 'checkbox', id });
      box.checked = checked;
      box.addEventListener('change', () => onChange(box.checked));
      return el('span', { class: 'switch' }, box, ' ', el('label', { for: id }, label));
    };

    render(
      el(
        'div',
        { class: 'page-head' },
        el('h2', {}, 'Roasts'),
        el('div', { class: 'head-actions' }, button('Sync with RoasTime', () => deps.openSync(), 'secondary'), button('Add roast', () => showForm({ kind: 'add' }))),
      ),
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      ...problems.map((text) => message(text, 'error')),
      ...(needing > 0 ? [message(`${needing} roast${needing === 1 ? ' has' : 's have'} no coffee: choose a lot (Edit), or mark ${needing === 1 ? 'it' : 'them'} as a sample. Until then ${needing === 1 ? 'it is' : 'they are'} not counted in any lot.`, 'error')] : []),
      el(
        'p',
        { class: 'switches small' },
        ...(needing > 0 ? [switchBox('only-needs-lot', `Only roasts that need a lot (${needing})`, onlyNeedsLot, (on) => ((onlyNeedsLot = on), showList()))] : []),
        ...(deletedCount > 0 ? [switchBox('show-deleted-roasts', `Show deleted (${deletedCount})`, showDeleted, (on) => ((showDeleted = on), showList()))] : []),
      ),
      rows.length === 0
        ? el('p', { class: 'muted' }, 'No roasts yet. Click "Sync with RoasTime" to bring in the roasting log, or "Add roast".')
        : el(
            'div',
            { class: 'table-wrap' },
            el(
              'table',
              { class: 'data-table' },
              el('thead', {}, el('tr', {}, ...['Roasted', 'Name', 'Coffee', 'Green', 'Roasted', 'Loss', 'Lot', ''].map((h) => el('th', { scope: 'col' }, h)))),
              el('tbody', {}, ...rows.flatMap(rowNodes)),
            ),
          ),
    );
  }

  function showForm(mode: Mode): void {
    deps.formOpened();
    const roast = mode.kind === 'edit' ? mode.roast : null;
    const full = !roast || !fromRoastime(roast);
    const initial: RoastForm = roast ? formFromRoast(roast) : emptyRoastForm(deps.now());
    const choosable = lots.filter((lot) => !isDeleted(lot)).sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
    const ids = choosable.map((lot) => lot.id);
    if (initial.lotId !== '' && !ids.includes(initial.lotId)) initial.lotId = ''; // a deleted lot: back to automatic

    const errorLines = new Map<keyof RoastForm, HTMLParagraphElement>();
    const field = (key: keyof RoastForm, label: string, input: HTMLElement, hint?: string, tip?: string) => {
      const error = el('p', { class: 'field-error', role: 'alert' });
      errorLines.set(key, error);
      return el(
        'div',
        { class: `field${key === 'notes' ? ' field-wide' : ''}` },
        el('div', { class: 'label-row' }, el('label', { for: `roast-${key}` }, label), ...(tip ? [infoTip(tip)] : [])),
        input,
        ...(hint ? [el('p', { class: 'field-hint' }, hint)] : []),
        error,
      );
    };
    const text = (key: keyof RoastForm, type = 'text', decimal = false) => {
      const input = el('input', { id: `roast-${key}`, type, autocomplete: 'off', ...(decimal ? { inputmode: 'decimal' } : {}) });
      input.value = String(initial[key]);
      return input;
    };
    const date = text('date', 'date');
    const time = text('time', 'time');
    const name = text('name');
    const green = text('greenG', 'text', true);
    const roasted = text('roastedG', 'text', true);
    const lotSelect = el(
      'select',
      { id: 'roast-lotId' },
      el('option', { value: '' }, roast && roast.roastime.beanId !== '' ? 'Automatic: oldest delivery of its coffee first' : 'No lot (not counted)'),
      ...choosable.map((lot) => el('option', { value: lot.id }, `${lot.code} · ${lot.name} · delivered ${lot.deliveryDate}`)),
    );
    lotSelect.value = initial.lotId;
    const sample = el('input', { type: 'checkbox', id: 'roast-sample' });
    sample.checked = initial.sample;
    const notes = el('textarea', { id: 'roast-notes', rows: '3' });
    notes.value = initial.notes;

    const read = (): RoastForm => ({
      date: date.value,
      time: time.value,
      name: name.value,
      greenG: green.value,
      roastedG: roasted.value,
      lotId: lotSelect.value,
      sample: sample.checked,
      notes: notes.value,
    });
    const showErrors = (errors: RoastFormErrors) => {
      for (const [key, line] of errorLines) line.textContent = errors[key] ?? '';
    };

    const banner = el('div', { class: 'form-banner' });
    const save = el('button', { type: 'submit', class: 'btn btn-primary' }, mode.kind === 'add' ? 'Save roast' : 'Save changes');
    const cancel = button('Cancel', () => showList(), 'secondary');

    function submit(): void {
      const result = validateRoastForm(read(), full, ids);
      if (!result.ok) {
        showErrors(result.errors);
        banner.replaceChildren(message('Please fix the fields marked below.', 'error'));
        return;
      }
      showErrors({});
      banner.replaceChildren();
      save.disabled = true;
      cancel.disabled = true;
      save.replaceChildren(busy('Saving…'));
      deps.busy(true);
      deps
        .withGoogle(async () => (roast ? deps.repo.update(roast, result.fields, deps.now()) : deps.repo.add(result.fields, await deps.whoAmI(), deps.now())))
        .finally(() => deps.busy(false))
        .then(() => {
          if (root.isConnected) load('Roast saved.');
        })
        .catch((error: unknown) => {
          save.disabled = false;
          cancel.disabled = false;
          save.replaceChildren(mode.kind === 'add' ? 'Save roast' : 'Save changes');
          if (!root.isConnected || deps.isIgnorable(error)) return;
          const show = (e: unknown) => banner.replaceChildren(...saveError(e, () => submit(), show, 'Reload roasts (drops this form)'));
          show(error);
        });
    }

    const form = el(
      'form',
      { class: 'lot-form', novalidate: '' },
      el(
        'fieldset',
        { class: 'form-section' },
        el('legend', {}, 'Roast'),
        full
          ? el(
              'div',
              { class: 'fields' },
              field('date', 'Date *', date),
              field('time', 'Time', time),
              field('name', 'Name', name, 'e.g. Kenia 03.11.2026-1'),
              field('greenG', 'Green weight (g) *', green, 'Weight before roasting, whole grams.'),
              field('roastedG', 'Roasted weight (g)', roasted, 'Weight after roasting. Can be entered later.'),
            )
          : el(
              'p',
              { class: 'muted small' },
              `${roast?.name || 'Roast'} from RoasTime. Date, name and weights come from RoasTime; change them there and sync again.`,
            ),
      ),
      el(
        'fieldset',
        { class: 'form-section' },
        el('legend', {}, 'Lot'),
        el(
          'div',
          { class: 'fields' },
          field(
            'lotId',
            'Lot',
            lotSelect,
            roast && roast.roastime.beanId !== '' ? 'Leave on automatic unless the roast used a different lot.' : 'Without a lot the roast is not counted in any stock.',
            'Stock left is calculated from these choices; nothing else changes.',
          ),
          el(
            'div',
            { class: 'field' },
            el('div', { class: 'label-row' }, el('label', { for: 'roast-sample' }, 'Sample'), infoTip('A sample with a coffee or a lot is counted in stock; without one it is not.')),
            el('span', {}, sample, ' ', el('label', { for: 'roast-sample' }, 'This roast was a sample')),
          ),
        ),
      ),
      el('fieldset', { class: 'form-section' }, el('legend', {}, 'Notes'), el('div', { class: 'fields' }, field('notes', 'Notes', notes))),
      el('div', { class: 'actions' }, save, cancel),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!save.disabled) submit();
    });

    render(
      el('h2', {}, mode.kind === 'add' ? 'Add roast' : `Edit roast ${roast?.name || ''}`),
      ...(roast && roast.problems.length > 0 ? roast.problems.map((t) => message(t, 'error')) : []),
      banner,
      form,
    );
    (full ? date : lotSelect).focus();
  }

  load(note, fromClick);
}
