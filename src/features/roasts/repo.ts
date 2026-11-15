// Reads and writes roasts through the shared record table (IDs, times, soft delete, "changed meanwhile" check).

import { sheetRecordTable, type RecordTable } from '../../core/records';
import type { SheetsClient } from '../../core/sheets';
import { ROASTS_TAB, ROAST_COLUMNS, roastFromFields, type Roast } from './model';

type Fields = Readonly<Record<string, string>>;

export interface RoastsRepository {
  load(): Promise<{ roasts: Roast[]; problems: string[] }>;
  add(fields: Fields, by: string, now: Date): Promise<Roast>;
  /** Several roasts in one request (all or none). */
  addMany(list: readonly Fields[], by: string, now: Date): Promise<Roast[]>;
  update(roast: Roast, fields: Fields, now: Date): Promise<Roast>;
  /** Several edits in one request; `deleted` also soft-deletes (true) or restores (false). If any roast was changed meanwhile, nothing is written. */
  updateMany(list: readonly { roast: Roast; fields: Fields; deleted?: boolean }[], now: Date): Promise<Roast[]>;
  remove(roast: Roast, now: Date): Promise<Roast>;
  restore(roast: Roast, now: Date): Promise<Roast>;
}

export function roastsRepository(table: RecordTable): RoastsRepository {
  return {
    async load() {
      const { records, problems } = await table.load();
      return { roasts: records.map((r) => roastFromFields(r.fields, r.row)), problems };
    },
    add: async (fields, by, now) => roastFromFields(await table.add(fields, by, now), 0),
    addMany: async (list, by, now) => (await table.addMany(list, by, now)).map((fields) => roastFromFields(fields, 0)),
    update: async (roast, fields, now) => roastFromFields(await table.update(roast.id, fields, roast.source, now), roast.row),
    updateMany: async (list, now) =>
      (await table.updateMany(list.map(({ roast, fields, deleted }) => ({ id: roast.id, changes: fields, loaded: roast.source, ...(deleted === undefined ? {} : { deleted }) })), now)).map((fields, i) =>
        roastFromFields(fields, list[i]?.roast.row ?? 0),
      ),
    remove: async (roast, now) => roastFromFields(await table.remove(roast.id, roast.source, now), roast.row),
    restore: async (roast, now) => roastFromFields(await table.restore(roast.id, roast.source, now), roast.row),
  };
}

export const sheetRoastsRepository = (client: SheetsClient, spreadsheetId: string): RoastsRepository =>
  roastsRepository(sheetRecordTable(client, spreadsheetId, ROASTS_TAB, ROAST_COLUMNS));
