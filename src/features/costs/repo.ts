// Reads and writes the Costs & prices tabs (the bag sizes are fixed in the code, owner 2026-11-16) through the shared record table (IDs, times, soft delete, "changed
// meanwhile" check). The page depends on the CostsRepository interface.

import { sheetRecordTable, type RecordTable } from '../../core/records';
import type { SheetsClient } from '../../core/sheets';
import {
  BAG_COSTS_TAB,
  BAG_COST_COLUMNS,
  LOT_COSTS_TAB,
  LOT_COST_COLUMNS,
  SETTINGS_TAB,
  SETTING_COLUMNS,
  bagCostFromFields,
  lotCostFromFields,
  settingFromFields,
  type BagCost,
  type LotCost,
  type SettingRow,
} from './model';
import { DISCOUNTS_TAB, DISCOUNT_COLUMNS, discountFromFields, type DiscountRow } from './modelDiscounts';

type Fields = Readonly<Record<string, string>>;

export interface CostData {
  readonly settings: SettingRow[];
  readonly costs: BagCost[];
  readonly lotCosts: LotCost[];
  readonly discounts: DiscountRow[];
  /** Rows Kraken could not use, one sentence each. */
  readonly problems: string[];
}

export interface CostsRepository {
  load(): Promise<CostData>;
  /**
   * Saves settings by name: changed ones are updated, new ones added. `loaded` is what the page showed. `by` (who is
   * signed in) is asked only if a row is added.
   */
  saveSettings(values: Readonly<Record<string, string>>, loaded: readonly SettingRow[], by: () => Promise<string>, now: Date): Promise<void>;
  addBagCost(fields: Fields, by: string, now: Date): Promise<void>;
  updateBagCost(cost: BagCost, fields: Fields, now: Date): Promise<void>;
  removeBagCost(cost: BagCost, now: Date): Promise<void>;
  /** The owner's roast loss for a lot ('' = use the average again). */
  saveLoss(lotId: string, value: string, existing: LotCost | undefined, by: () => Promise<string>, now: Date): Promise<void>;
  /** Adds discounts in one request (one, or the whole list when the defaults are written for the first time). */
  addDiscounts(list: readonly Fields[], by: string, now: Date): Promise<void>;
  updateDiscount(row: DiscountRow, fields: Fields, now: Date): Promise<void>;
  removeDiscount(row: DiscountRow, now: Date): Promise<void>;
}

export interface CostTables {
  settings: RecordTable;
  costs: RecordTable;
  lotCosts: RecordTable;
  discounts: RecordTable;
}

export function costsRepository(tables: CostTables): CostsRepository {
  return {
    async load() {
      const [settings, costs, lotCosts, discounts] = await Promise.all([tables.settings.load(), tables.costs.load(), tables.lotCosts.load(), tables.discounts.load()]);
      return {
        settings: settings.records.map((r) => settingFromFields(r.fields, r.row)),
        costs: costs.records.map((r) => bagCostFromFields(r.fields, r.row)),
        lotCosts: lotCosts.records.map((r) => lotCostFromFields(r.fields, r.row)),
        discounts: discounts.records.map((r) => discountFromFields(r.fields, r.row)),
        problems: [...settings.problems, ...costs.problems, ...lotCosts.problems, ...discounts.problems],
      };
    },
    async saveSettings(values, loaded, by, now) {
      const active = loaded.filter((r) => r.deletedAt === '');
      const updates = [];
      const adds = [];
      for (const [name, value] of Object.entries(values)) {
        const row = active.find((r) => r.name === name);
        if (!row) adds.push({ name, value });
        else if (row.value !== value) updates.push({ id: row.id, changes: { value }, loaded: row.source });
      }
      if (updates.length > 0) await tables.settings.updateMany(updates, now);
      if (adds.length > 0) await tables.settings.addMany(adds, await by(), now);
    },
    addBagCost: async (fields, by, now) => void (await tables.costs.add(fields, by, now)),
    updateBagCost: async (cost, fields, now) => void (await tables.costs.update(cost.id, fields, cost.source, now)),
    removeBagCost: async (cost, now) => void (await tables.costs.remove(cost.id, cost.source, now)),
    async saveLoss(lotId, value, existing, by, now) {
      if (existing) await tables.lotCosts.update(existing.id, { roast_loss_percent: value }, existing.source, now);
      else if (value !== '') await tables.lotCosts.add({ lot_id: lotId, roast_loss_percent: value }, await by(), now);
    },
    addDiscounts: async (list, by, now) => void (await tables.discounts.addMany(list, by, now)),
    updateDiscount: async (row, fields, now) => void (await tables.discounts.update(row.id, fields, row.source, now)),
    removeDiscount: async (row, now) => void (await tables.discounts.remove(row.id, row.source, now)),
  };
}

export const sheetCostsRepository = (client: SheetsClient, spreadsheetId: string): CostsRepository =>
  costsRepository({
    settings: sheetRecordTable(client, spreadsheetId, SETTINGS_TAB, SETTING_COLUMNS),
    costs: sheetRecordTable(client, spreadsheetId, BAG_COSTS_TAB, BAG_COST_COLUMNS),
    lotCosts: sheetRecordTable(client, spreadsheetId, LOT_COSTS_TAB, LOT_COST_COLUMNS),
    discounts: sheetRecordTable(client, spreadsheetId, DISCOUNTS_TAB, DISCOUNT_COLUMNS),
  });
