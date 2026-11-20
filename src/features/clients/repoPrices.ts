// Reads and writes special prices through the shared record table (IDs, times, soft delete, "changed meanwhile"
// check). The pages depend on the SpecialPricesRepository interface.

import { sheetRecordTable, type RecordTable } from '../../core/records';
import type { SheetsClient } from '../../core/sheets';
import { SPECIAL_PRICES_TAB, SPECIAL_PRICE_COLUMNS, specialPriceFromFields, type SpecialPrice } from './modelPrices';

type Fields = Readonly<Record<string, string>>;

export interface SpecialPricesRepository {
  /** All deals, deleted ones included, plus rows Kraken could not use. */
  load(): Promise<{ deals: SpecialPrice[]; problems: string[] }>;
  add(fields: Fields, by: string, now: Date): Promise<void>;
  update(deal: SpecialPrice, fields: Fields, now: Date): Promise<void>;
  remove(deal: SpecialPrice, now: Date): Promise<void>;
  restore(deal: SpecialPrice, now: Date): Promise<void>;
}

export function specialPricesRepository(table: RecordTable): SpecialPricesRepository {
  return {
    async load() {
      const { records, problems } = await table.load();
      return { deals: records.map((r) => specialPriceFromFields(r.fields, r.row)), problems };
    },
    add: async (fields, by, now) => void (await table.add(fields, by, now)),
    update: async (deal, fields, now) => void (await table.update(deal.id, fields, deal.source, now)),
    remove: async (deal, now) => void (await table.remove(deal.id, deal.source, now)),
    restore: async (deal, now) => void (await table.restore(deal.id, deal.source, now)),
  };
}

export const sheetSpecialPricesRepository = (client: SheetsClient, spreadsheetId: string): SpecialPricesRepository =>
  specialPricesRepository(sheetRecordTable(client, spreadsheetId, SPECIAL_PRICES_TAB, SPECIAL_PRICE_COLUMNS));
