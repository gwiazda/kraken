// Reads and writes clients through the shared record table (IDs, times, soft delete, "changed meanwhile" check).
// The page depends on the ClientsRepository interface.

import { sheetRecordTable, type RecordTable } from '../../core/records';
import type { SheetsClient } from '../../core/sheets';
import { CLIENTS_TAB, CLIENT_COLUMNS, clientFromFields, type Client } from './model';

type Fields = Readonly<Record<string, string>>;

export interface ClientsRepository {
  /** All clients, deleted ones included, plus rows Kraken could not use. */
  load(): Promise<{ clients: Client[]; problems: string[] }>;
  add(fields: Fields, by: string, now: Date): Promise<void>;
  update(client: Client, fields: Fields, now: Date): Promise<void>;
  remove(client: Client, now: Date): Promise<void>;
  restore(client: Client, now: Date): Promise<void>;
}

export function clientsRepository(table: RecordTable): ClientsRepository {
  return {
    async load() {
      const { records, problems } = await table.load();
      return { clients: records.map((r) => clientFromFields(r.fields, r.row)), problems };
    },
    add: async (fields, by, now) => void (await table.add(fields, by, now)),
    update: async (client, fields, now) => void (await table.update(client.id, fields, client.source, now)),
    remove: async (client, now) => void (await table.remove(client.id, client.source, now)),
    restore: async (client, now) => void (await table.restore(client.id, client.source, now)),
  };
}

export const sheetClientsRepository = (client: SheetsClient, spreadsheetId: string): ClientsRepository =>
  clientsRepository(sheetRecordTable(client, spreadsheetId, CLIENTS_TAB, CLIENT_COLUMNS));
