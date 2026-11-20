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
  /** A note is being saved (true) or done: the form above waits meanwhile (one save at a time on the page). */
  saving: (on: boolean) => void;
  /** False while the form above is being saved: a note then waits. */
  canSave: () => boolean;
  /** Google's error with its buttons, as on the rest of the page (the reload button says it drops the form). */
  errorNodes: (error: unknown, retry: () => void, retryLabel: string, show: (e: unknown) => void) => Node[];
}

/** `all`: every note as loaded with the Sales page (so the section shows at once). */
export function notesSection(saleId: string, all: readonly SaleNote[], deps: NotesSectionDeps): HTMLElement {
  let notes = [...all];
  /** The note being typed: kept when the section is redrawn (after deleting another note, or an error). */
  const draft = { date: deps.today(), text: '' };
  const body = el('div', {});
  const section = el(
    'fieldset',
    { class: 'form-section sample-notes' },
    el('legend', {}, 'Follow-up notes ', infoTip('A dated log for this sample: what they said, when you called, what to do next. The newest one is shown in the Sales list. Each note is saved straight away.')),
    body,
  );

  /**
   * An action that runs only once, even when "try again" calls it again after a later step failed (e.g. the note was
   * added, then reading the notes back failed): the retry then only reads them, never adds the note twice.
   */
  const once = (action: () => Promise<void>) => {
    let done = false;
    return async () => {
      if (done) return;
      await action();
      done = true;
    };
  };

  function save(action: () => Promise<void>, done: string, slot: HTMLElement, retry: () => void): void {
    if (!deps.canSave()) {
      show(undefined, [message('Wait a moment: the form above is being saved.', 'error')]);
      return;
    }
    deps.saving(true);
    for (const node of body.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>('button, input, textarea')) node.disabled = true;
    slot.replaceChildren(busy('Saving…'));
    deps.busy(true);
    deps
      .withGoogle(async () => {
        await action();
        notes = (await deps.notes.load()).notes;
        deps.changed(notes);
      })
      .finally(() => {
        deps.busy(false);
        deps.saving(false);
      })
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
    date.value = draft.date;
    date.addEventListener('input', () => (draft.date = date.value));
    const text = el('textarea', { rows: '2', maxlength: String(NOTE_MAX), 'aria-label': 'Note', placeholder: 'e.g. Called, they liked the Kenia; send an offer' });
    text.value = draft.text;
    text.addEventListener('input', () => (draft.text = text.value));
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
      const add = once(async () => {
        await deps.notes.add(result.fields, await deps.whoAmI(), deps.now());
        draft.text = ''; // saved: the next note starts empty
        draft.date = deps.today();
      });
      const go = () => save(add, 'Note added.', addButton, go);
      go();
    });

    const item = (n: SaleNote) => {
      const actions = el('span', { class: 'row-actions' });
      if (isNoteDeleted(n)) {
        const restore = once(() => deps.notes.restore(n, deps.now()));
        const go = () => save(restore, 'Note restored.', actions, go);
        actions.append(button('Restore', go, 'link'));
      } else {
        const remove = once(() => deps.notes.remove(n, deps.now()));
        const go = () => save(remove, 'Note deleted. It can be restored below.', actions, go);
        actions.append(button('Delete', go, 'link'));
      }
      return el('li', { class: isNoteDeleted(n) ? 'row-deleted' : '' }, el('strong', { class: 'note-date' }, n.date), ' ', el('span', { class: 'note-text' }, n.text), ' ', actions);
    };

    body.replaceChildren(
      ...(note ? [message(note)] : []),
      ...(error ?? []),
      form,
      current.length === 0 ? el('p', { class: 'muted small' }, 'No notes yet.') : el('ul', { class: 'note-list' }, ...current.map(item)),
      ...(deleted.length > 0 ? [el('details', { class: 'small deleted-notes' }, el('summary', {}, `Deleted notes (${deleted.length})`), el('ul', { class: 'note-list' }, ...deleted.map(item)))] : []),
    );
  }

  show();
  return section;
}
