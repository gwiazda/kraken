// Reads and writes products through the shared record table (IDs, times, soft delete, "changed meanwhile" check).
// The page depends on the ProductsRepository interface.

import { sheetRecordTable, type RecordTable } from '../../core/records';
import type { SheetsClient } from '../../core/sheets';
import { PRODUCTS_TAB, PRODUCT_COLUMNS, productFromFields, type Product } from './model';

type Fields = Readonly<Record<string, string>>;

export interface ProductsRepository {
  /** All products, deleted ones included, plus rows Kraken could not use. */
  load(): Promise<{ products: Product[]; problems: string[] }>;
  add(fields: Fields, by: string, now: Date): Promise<void>;
  update(product: Product, fields: Fields, now: Date): Promise<void>;
  remove(product: Product, now: Date): Promise<void>;
  restore(product: Product, now: Date): Promise<void>;
}

export function productsRepository(table: RecordTable): ProductsRepository {
  return {
    async load() {
      const { records, problems } = await table.load();
      return { products: records.map((r) => productFromFields(r.fields, r.row)), problems };
    },
    add: async (fields, by, now) => void (await table.add(fields, by, now)),
    update: async (product, fields, now) => void (await table.update(product.id, fields, product.source, now)),
    remove: async (product, now) => void (await table.remove(product.id, product.source, now)),
    restore: async (product, now) => void (await table.restore(product.id, product.source, now)),
  };
}

export const sheetProductsRepository = (client: SheetsClient, spreadsheetId: string): ProductsRepository =>
  productsRepository(sheetRecordTable(client, spreadsheetId, PRODUCTS_TAB, PRODUCT_COLUMNS));
