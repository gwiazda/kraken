import { describe, expect, it } from 'vitest';
import { lastNoteText, lastNotes, noteFromFields, notesOf, validateNote } from './modelNotes';

// Made-up notes.
const note = (row: number, o: Record<string, string> = {}) => noteFromFields({ id: `N${row}`, sale_id: 'S1', date: '2026-11-25', text: 'Called, they liked the Kenia', deleted_at: '', ...o }, row);

describe('sample notes', () => {
  it("lists a sample's notes newest first; deleted ones separately", () => {
    const list = [note(2, { date: '2026-11-21' }), note(3), note(4, { date: '2026-11-25', text: 'Second call' }), note(5, { sale_id: 'S2' }), note(6, { deleted_at: '2026-11-26T10:00:00.000Z' })];
    expect(notesOf(list, 'S1').map((n) => n.id)).toEqual(['N4', 'N3', 'N2']);
    expect(notesOf(list, 'S1', true).map((n) => n.id)).toEqual(['N6']);
  });

  it('gives the newest note for the list, shortened', () => {
    expect(lastNoteText([note(2, { date: '2026-11-21' }), note(3)], 'S1')).toBe('25.11.2026: Called, they liked the Kenia');
    expect(lastNoteText([note(2, { text: 'x'.repeat(100) })], 'S1')).toBe(`25.11.2026: ${'x'.repeat(79)}…`);
    expect(lastNoteText([], 'S1')).toBe('');
    // cut by character: an emoji at the cut is never split in half
    expect(lastNoteText([note(2, { text: `${'x'.repeat(78)}☕👍 more` })], 'S1')).toBe(`25.11.2026: ${'x'.repeat(78)}☕…`);
  });

  it('gives the newest note of every sample at once, without deleted ones', () => {
    const list = [note(2, { date: '2026-11-21' }), note(3, { text: 'Later' }), note(4, { sale_id: 'S2', text: 'Other' }), note(5, { text: 'Gone', deleted_at: '2026-11-26T10:00:00.000Z' })];
    expect([...lastNotes(list)]).toEqual([
      ['S1', '25.11.2026: Later'],
      ['S2', '25.11.2026: Other'],
    ]);
  });

  it('needs a date and some text', () => {
    expect(validateNote({ date: '2026-11-25', text: '  Called  ' }, 'S1')).toEqual({ ok: true, fields: { sale_id: 'S1', date: '2026-11-25', text: 'Called' } });
    expect(validateNote({ date: '', text: 'Called' }, 'S1')).toEqual({ ok: false, error: 'Wybierz datę notatki.' });
    expect(validateNote({ date: '2026-11-25', text: ' ' }, 'S1')).toEqual({ ok: false, error: 'Wpisz notatkę, np. „Dzwoniłem, smakowała im Kenia”.' });
    expect(validateNote({ date: '2026-11-25', text: 'x'.repeat(1001) }, 'S1')).toEqual({ ok: false, error: 'Najwyżej 1000 znaków.' });
  });
});
