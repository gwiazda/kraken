// Reads and writes products through the shared record table (IDs, times, soft delete, "changed meanwhile" check).
// The page depends on the ProductsRepository interface.

import { sheetRecordTable, type RecordTable } from '../../core/records';
import type { SheetsClient } from '../../core/sheets';
import { PRODUCTS_TAB, PRODUCT_COLUMNS, productFromFields, type Product } from './model';
import { BEAN_COLUMNS, PRODUCT_BEANS_TAB, beanChanges, beanFromFields, type ProductBean } from './modelBeans';

type Fields = Readonly<Record<string, string>>;

export interface ProductsRepository {
  /** All products and their beans, deleted ones included, plus rows Kraken could not use. */
  load(): Promise<{ products: Product[]; beans: ProductBean[]; problems: string[] }>;
  /** Gives the new product's ID. */
  add(fields: Fields, by: string, now: Date): Promise<string>;
  update(product: Product, fields: Fields, now: Date): Promise<void>;
  remove(product: Product, now: Date): Promise<void>;
  restore(product: Product, now: Date): Promise<void>;
  /**
   * Makes a product's stored beans (`existing`, in order) become `wanted` (from validateBeans): at most two requests,
   * one for changes and removals (soft delete), one for new beans.
   */
  saveBeans(productId: string, wanted: readonly Fields[], existing: readonly ProductBean[], by: () => Promise<string>, now: Date): Promise<void>;
}

export function productsRepository(table: RecordTable, beans: RecordTable): ProductsRepository {
  return {
    async load() {
      const [products, rows] = await Promise.all([table.load(), beans.load()]);
      return {
        products: products.records.map((r) => productFromFields(r.fields, r.row)),
        beans: rows.records.map((r) => beanFromFields(r.fields, r.row)),
        problems: [...products.problems, ...rows.problems],
      };
    },
    add: async (fields, by, now) => (await table.add(fields, by, now))['id'] ?? '',
    update: async (product, fields, now) => void (await table.update(product.id, fields, product.source, now)),
    remove: async (product, now) => void (await table.remove(product.id, product.source, now)),
    restore: async (product, now) => void (await table.restore(product.id, product.source, now)),
    async saveBeans(productId, wanted, existing, by, now) {
      const { updates, adds, removes } = beanChanges(existing, wanted);
      const changes = [
        ...updates.map(({ bean, changes }) => ({ id: bean.id, changes, loaded: bean.source })),
        ...removes.map((bean) => ({ id: bean.id, changes: {}, loaded: bean.source, deleted: true })),
      ];
      if (changes.length > 0) await beans.updateMany(changes, now);
      if (adds.length > 0) await beans.addMany(adds.map((fields) => ({ ...fields, product_id: productId })), await by(), now);
    },
  };
}

export const sheetProductsRepository = (client: SheetsClient, spreadsheetId: string): ProductsRepository =>
  productsRepository(sheetRecordTable(client, spreadsheetId, PRODUCTS_TAB, PRODUCT_COLUMNS), sheetRecordTable(client, spreadsheetId, PRODUCT_BEANS_TAB, BEAN_COLUMNS));
