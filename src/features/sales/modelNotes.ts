// Follow-up notes on a sample (owner, 2026-11-20): a dated log, e.g. "2026-11-25: called, they liked the Kenia".
// Add new ones, delete old ones (soft delete, can be restored). Pure: no Google, no screen.

import { isValidDate } from '../../core/dates';

type Fields = Readonly<Record<string, string>>;

export const SALE_NOTES_TAB = 'Sale notes';
export const NOTE_COLUMNS = ['sale_id', 'date', 'text'] as const;

/** At most this many characters in one note. */
export const NOTE_MAX = 1000;

export interface SaleNote {
  readonly id: string;
  readonly row: number;
  readonly saleId: string;
  /** YYYY-MM-DD */
  readonly date: string;
  readonly text: string;
  readonly deletedAt: string;
  readonly source: Fields;
}

const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

export function noteFromFields(fields: Fields, row: number): SaleNote {
  return {
    id: text(fields, 'id'),
    row,
    saleId: text(fields, 'sale_id'),
    date: text(fields, 'date'),
    text: fields['text'] ?? '',
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

export const isNoteDeleted = (note: SaleNote) => note.deletedAt !== '';

/** A sample's notes, newest first (the same day: the one added last first); deleted ones only when asked. */
export function notesOf(notes: readonly SaleNote[], saleId: string, deleted = false): SaleNote[] {
  return notes
    .filter((n) => n.saleId === saleId && isNoteDeleted(n) === deleted)
    .sort((a, b) => b.date.localeCompare(a.date) || b.row - a.row);
}

/** The newest note of a sample, for the Sales list: "2026-11-25: called, they liked the Kenia"; '' without one. */
export function lastNoteText(notes: readonly SaleNote[], saleId: string): string {
  const [newest] = notesOf(notes, saleId);
  if (!newest) return '';
  const line = newest.text.replace(/\s+/g, ' ').trim();
  return `${newest.date}: ${line.length > 80 ? `${line.slice(0, 79)}…` : line}`;
}

export interface NoteForm {
  date: string;
  text: string;
}

/** Checks a new note; on success gives the cells to store. */
export function validateNote(form: NoteForm, saleId: string): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  const body = form.text.trim();
  if (!isValidDate(form.date)) return { ok: false, error: 'Enter the date of the note, e.g. 2026-11-25.' };
  if (body === '') return { ok: false, error: 'Write the note, e.g. "Called, they liked the Kenia".' };
  if (body.length > NOTE_MAX) return { ok: false, error: `At most ${NOTE_MAX} characters.` };
  return { ok: true, fields: { sale_id: saleId, date: form.date, text: body } };
}
