// Reads and writes lots. The page depends on the LotsRepository interface; the real one uses the shared record table
// (which handles IDs, times, soft delete and the "someone else changed it" check).

import { sheetRecordTable, type RecordTable } from '../../core/records';
import type { SheetsClient } from '../../core/sheets';
import { LOTS_TAB, LOT_COLUMNS, lotFromFields, type Lot } from './model';

export interface LotsRepository {
  /** All lots, deleted ones included, plus rows Kraken could not use. */
  load(): Promise<{ lots: Lot[]; problems: string[] }>;
  add(fields: Readonly<Record<string, string>>, by: string, now: Date): Promise<Lot>;
  /** Adds several lots in one request (all or none). */
  addMany(list: readonly Readonly<Record<string, string>>[], by: string, now: Date): Promise<Lot[]>;
  update(lot: Lot, fields: Readonly<Record<string, string>>, now: Date): Promise<Lot>;
  remove(lot: Lot, now: Date): Promise<Lot>;
  restore(lot: Lot, now: Date): Promise<Lot>;
}

export function lotsRepository(table: RecordTable): LotsRepository {
  return {
    async load() {
      const { records, problems } = await table.load();
      return { lots: records.map((r) => lotFromFields(r.fields, r.row)), problems };
    },
    add: async (fields, by, now) => lotFromFields(await table.add(fields, by, now), 0),
    addMany: async (list, by, now) => (await table.addMany(list, by, now)).map((fields) => lotFromFields(fields, 0)),
    update: async (lot, fields, now) => lotFromFields(await table.update(lot.id, fields, lot.source, now), lot.row),
    remove: async (lot, now) => lotFromFields(await table.remove(lot.id, lot.source, now), lot.row),
    restore: async (lot, now) => lotFromFields(await table.restore(lot.id, lot.source, now), lot.row),
  };
}

export const sheetLotsRepository = (client: SheetsClient, spreadsheetId: string): LotsRepository =>
  lotsRepository(sheetRecordTable(client, spreadsheetId, LOTS_TAB, LOT_COLUMNS));
