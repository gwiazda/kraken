// Follow-up notes on a sample (owner, 2026-11-20): a dated log, e.g. "25.11.2026: Dzwoniłem, smakowała im Kenia".
// Add new ones, delete old ones (soft delete, can be restored). Pure: no Google, no screen.

import { formatDate, isValidDate } from '../../core/dates';
import { text, type Fields } from './model';

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

/** A note as one short line for the Sales list: "25.11.2026: Dzwoniłem, smakowała im Kenia" (at most 80 characters). */
function shortNote(note: SaleNote): string {
  const chars = Array.from(note.text.replace(/\s+/g, ' ').trim()); // by character, so an emoji is never cut in half
  return `${formatDate(note.date)}: ${chars.length > 80 ? `${chars.slice(0, 79).join('')}…` : chars.join('')}`;
}

/** The newest note of a sample, for the Sales list; '' without one. */
export function lastNoteText(notes: readonly SaleNote[], saleId: string): string {
  const [newest] = notesOf(notes, saleId);
  return newest ? shortNote(newest) : '';
}

/** The newest note of every sample at once (sale id → short line), for drawing the list. */
export function lastNotes(notes: readonly SaleNote[]): Map<string, string> {
  const newest = new Map<string, SaleNote>();
  for (const note of notes) {
    if (isNoteDeleted(note)) continue;
    const seen = newest.get(note.saleId);
    if (!seen || note.date > seen.date || (note.date === seen.date && note.row > seen.row)) newest.set(note.saleId, note);
  }
  return new Map([...newest].map(([id, note]) => [id, shortNote(note)]));
}

export interface NoteForm {
  date: string;
  text: string;
}

/** Checks a new note; on success gives the cells to store. */
export function validateNote(form: NoteForm, saleId: string): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  const body = form.text.trim();
  if (!isValidDate(form.date)) return { ok: false, error: 'Wybierz datę notatki.' };
  if (body === '') return { ok: false, error: 'Wpisz notatkę, np. „Dzwoniłem, smakowała im Kenia”.' };
  if (body.length > NOTE_MAX) return { ok: false, error: `Najwyżej ${NOTE_MAX} znaków.` };
  return { ok: true, fields: { sale_id: saleId, date: form.date, text: body } };
}
