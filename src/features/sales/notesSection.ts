// The "Follow-up notes" section of a sample (owner, 2026-11-20): a dated log under the sample's form, e.g.
// "2026-11-25: called, they liked the Kenia". Add a note, delete an old one (it can be restored). Each change is
// saved at once, apart from the form above.

import { busy, button, el, infoTip, message } from '../../ui/dom';
import { NOTE_MAX, isNoteDeleted, notesOf, validateNote, type SaleNote } from './modelNotes';
import type { SaleNotesRepository } from './repoNotes';

export interface NotesSectionDeps {
  notes: SaleNotesRepository;
  whoAmI: () => Promise<string>;
  withGoogle: <T>(action: () => Promise<T>) => Promise<T>;
  isIgnorable: (error: unknown) => boolean;
  now: () => Date;
  today: () => string;
  busy: (on: boolean) => void;
  /** The notes as now stored (after each change), so the Sales list shows the newest one without a reload. */
  changed: (notes: SaleNote[]) => void;
  /** Google's error with its buttons, as on the rest of the page (the reload button says it drops the form). */
  errorNodes: (error: unknown, retry: () => void, retryLabel: string, show: (e: unknown) => void) => Node[];
}

/** `all`: every note as loaded with the Sales page (so the section shows at once). */
export function notesSection(saleId: string, all: readonly SaleNote[], deps: NotesSectionDeps): HTMLElement {
  let notes = [...all];
  const body = el('div', {});
  const section = el(
    'fieldset',
    { class: 'form-section sample-notes' },
    el('legend', {}, 'Follow-up notes ', infoTip('A dated log for this sample: what they said, when you called, what to do next. The newest one is shown in the Sales list. Each note is saved straight away.')),
    body,
  );

  function save(action: () => Promise<void>, done: string, slot: HTMLElement, retry: () => void): void {
    for (const node of body.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>('button, input, textarea')) node.disabled = true;
    slot.replaceChildren(busy('Saving…'));
    deps.busy(true);
    deps
      .withGoogle(async () => {
        await action();
        notes = (await deps.notes.load()).notes;
        deps.changed(notes);
      })
      .finally(() => deps.busy(false))
      .then(() => show(done))
      .catch((error: unknown) => {
        if (deps.isIgnorable(error)) return show();
        const again = (e: unknown) => show(undefined, deps.errorNodes(e, retry, 'Sign in and try again', again));
        again(error);
      });
  }

  function show(note?: string, error?: Node[]): void {
    const current = notesOf(notes, saleId);
    const deleted = notesOf(notes, saleId, true);

    const date = el('input', { type: 'date', class: 'input-short', 'aria-label': 'Date of the note' });
    date.value = deps.today();
    const text = el('textarea', { rows: '2', maxlength: String(NOTE_MAX), 'aria-label': 'Note', placeholder: 'e.g. Called, they liked the Kenia; send an offer' });
    const errorLine = el('p', { class: 'field-error', role: 'alert' });
    const addButton = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Add note');
    const form = el('form', { class: 'note-add', novalidate: '' }, date, text, addButton, errorLine);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = validateNote({ date: date.value, text: text.value }, saleId);
      if (!result.ok) {
        errorLine.textContent = result.error;
        return;
      }
      const go = () => save(async () => deps.notes.add(result.fields, await deps.whoAmI(), deps.now()), 'Note added.', addButton, go);
      go();
    });

    const item = (n: SaleNote) => {
      const actions = el('span', { class: 'row-actions' });
      if (isNoteDeleted(n)) {
        const go = () => save(() => deps.notes.restore(n, deps.now()), 'Note restored.', actions, go);
        actions.append(button('Restore', go, 'link'));
      } else {
        const go = () => save(() => deps.notes.remove(n, deps.now()), 'Note deleted. It can be restored below.', actions, go);
        actions.append(button('Delete', go, 'link'));
      }
      return el('li', { class: isNoteDeleted(n) ? 'row-deleted' : '' }, el('strong', { class: 'note-date' }, n.date), ' ', el('span', { class: 'note-text' }, n.text), ' ', actions);
    };

    body.replaceChildren(
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      form,
      current.length === 0 ? el('p', { class: 'muted small' }, 'No notes yet.') : el('ul', { class: 'note-list' }, ...current.map(item)),
      ...(deleted.length > 0 ? [el('details', { class: 'small deleted-products' }, el('summary', {}, `Deleted notes (${deleted.length})`), el('ul', { class: 'note-list' }, ...deleted.map(item)))] : []),
    );
  }

  show();
  return section;
}
