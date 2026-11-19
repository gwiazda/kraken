// Reads and writes sales and their lines through the shared record table (IDs, times, soft delete, "changed
// meanwhile" check). The page depends on the SalesRepository interface.

import { saveChildren, sheetRecordTable, type RecordTable } from '../../core/records';
import type { SheetsClient } from '../../core/sheets';
import { LINE_COLUMNS, SALES_TAB, SALE_COLUMNS, SALE_LINES_TAB, lineFromFields, saleFromFields, type Sale, type SaleLine } from './model';

type Fields = Readonly<Record<string, string>>;

export interface SalesRepository {
  /** All sales and lines, deleted ones included, plus rows Kraken could not use. */
  load(): Promise<{ sales: Sale[]; lines: SaleLine[]; problems: string[] }>;
  /** Adds a sale (without lines: then saveLines, so a retry after failed lines never adds the sale twice); gives its ID. */
  add(fields: Fields, by: string, now: Date): Promise<string>;
  /** Changes a sale's cells (only those given). */
  update(sale: Sale, fields: Fields, now: Date): Promise<void>;
  /**
   * Makes a sale's stored lines (`existing`, in order) become `wanted`: at most two requests, one for changes and
   * removals (soft delete), one for new lines.
   */
  saveLines(saleId: string, wanted: readonly Fields[], existing: readonly SaleLine[], by: () => Promise<string>, now: Date): Promise<void>;
  remove(sale: Sale, now: Date): Promise<void>;
  restore(sale: Sale, now: Date): Promise<void>;
}

export function salesRepository(sales: RecordTable, lines: RecordTable): SalesRepository {
  return {
    async load() {
      const [s, l] = await Promise.all([sales.load(), lines.load()]);
      return {
        sales: s.records.map((r) => saleFromFields(r.fields, r.row)),
        lines: l.records.map((r) => lineFromFields(r.fields, r.row)),
        problems: [...s.problems, ...l.problems],
      };
    },
    add: async (fields, by, now) => (await sales.add(fields, by, now))['id'] ?? '',
    update: async (sale, fields, now) => void (await sales.update(sale.id, fields, sale.source, now)),
    saveLines: (saleId, wanted, existing, by, now) => saveChildren(lines, 'sale_id', saleId, existing, wanted, by, now),
    remove: async (sale, now) => void (await sales.remove(sale.id, sale.source, now)),
    restore: async (sale, now) => void (await sales.restore(sale.id, sale.source, now)),
  };
}

export const sheetSalesRepository = (client: SheetsClient, spreadsheetId: string): SalesRepository =>
  salesRepository(sheetRecordTable(client, spreadsheetId, SALES_TAB, SALE_COLUMNS), sheetRecordTable(client, spreadsheetId, SALE_LINES_TAB, LINE_COLUMNS));
