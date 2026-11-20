// Reads and writes the follow-up notes of samples through the shared record table (IDs, times, soft delete).

import { sheetRecordTable, type RecordTable } from '../../core/records';
import type { SheetsClient } from '../../core/sheets';
import type { Fields } from './model';
import { NOTE_COLUMNS, SALE_NOTES_TAB, noteFromFields, type SaleNote } from './modelNotes';

export interface SaleNotesRepository {
  /** All notes, deleted ones included, plus rows Kraken could not use. */
  load(): Promise<{ notes: SaleNote[]; problems: string[] }>;
  add(fields: Fields, by: string, now: Date): Promise<void>;
  remove(note: SaleNote, now: Date): Promise<void>;
  restore(note: SaleNote, now: Date): Promise<void>;
}

export function saleNotesRepository(table: RecordTable): SaleNotesRepository {
  return {
    async load() {
      const { records, problems } = await table.load();
      return { notes: records.map((r) => noteFromFields(r.fields, r.row)), problems };
    },
    add: async (fields, by, now) => void (await table.add(fields, by, now)),
    remove: async (note, now) => void (await table.remove(note.id, note.source, now)),
    restore: async (note, now) => void (await table.restore(note.id, note.source, now)),
  };
}

export const sheetSaleNotesRepository = (client: SheetsClient, spreadsheetId: string): SaleNotesRepository =>
  saleNotesRepository(sheetRecordTable(client, spreadsheetId, SALE_NOTES_TAB, NOTE_COLUMNS));
