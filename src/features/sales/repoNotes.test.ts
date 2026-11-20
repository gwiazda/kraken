import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { notesOf } from './modelNotes';
import { sheetSaleNotesRepository } from './repoNotes';

const now = new Date('2026-11-25T10:00:00.000Z');

describe('sheetSaleNotesRepository (in-memory Google)', () => {
  it('adds, soft-deletes and restores a note', async () => {
    const google = fakeGoogleDrive();
    const info = await createKrakenSpreadsheet(google, now);
    const repo = sheetSaleNotesRepository(google, info.id);
    expect(await repo.load()).toEqual({ notes: [], problems: [] });
    await repo.add({ sale_id: 'S1', date: '2026-11-25', text: 'Called, they liked the Kenia' }, 'owner@example.com', now);
    let [note] = (await repo.load()).notes;
    if (!note) throw new Error('setup');
    expect(note).toMatchObject({ saleId: 'S1', date: '2026-11-25', text: 'Called, they liked the Kenia' });
    await repo.remove(note, now);
    let notes = (await repo.load()).notes;
    expect(notesOf(notes, 'S1')).toEqual([]);
    [note] = notes;
    if (!note) throw new Error('setup');
    await repo.restore(note, now);
    notes = (await repo.load()).notes;
    expect(notesOf(notes, 'S1').map((n) => n.text)).toEqual(['Called, they liked the Kenia']);
  });
});
