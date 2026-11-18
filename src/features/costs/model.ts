// Packaging & discounts and the cost calculation: the tabs, what a row means, and checking what the owner types.
// Pure: no Google, no screen. Settings (VAT, default roast loss), the packaging cost items of each bag size, and a
// per-lot roast loss override. The multipliers are fixed (owner, 2026-11-18). Discounts: modelDiscounts.ts.
// Rules agreed with the owner on 2026-11-16 (docs/REQUIREMENTS.md section 6): all costs are net; markups give the
// net price; gross = net × (1 + VAT); roast loss = the average of the lot's roasts unless the owner types one.

import { moneyText, parseDecimal, parseMoney, toDecimalText } from '../../core/numbers';

type Fields = Readonly<Record<string, string>>;

export const SETTINGS_TAB = 'Cost settings';
export const SETTING_COLUMNS = ['name', 'value'] as const;
export const BAG_COSTS_TAB = 'Bag costs';
/** `bag_size_id` holds the bag size in grams ("250", "500", "1000"). */
export const BAG_COST_COLUMNS = ['bag_size_id', 'item', 'cost_net_pln'] as const;
export const LOT_COSTS_TAB = 'Lot costs';
export const LOT_COST_COLUMNS = ['lot_id', 'roast_loss_percent'] as const;

const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

// ---- Settings ----

/** The price multipliers, fixed (owner, 2026-11-18): 2×, 2,5× and 3× the cost of one bag. In hundredths. */
export const MARKUPS: readonly number[] = [200, 250, 300];

/** Percentages in tenths (230 = 23,0 %), markups in hundredths (250 = 2,5×). */
export interface CostSettings {
  readonly vatTenths: number;
  /** Always MARKUPS; kept here so the calculation gets everything it needs in one place. */
  readonly markupHundredths: readonly number[];
  readonly defaultLossTenths: number;
}

/** Used until the owner saves their own (owner, 2026-11-16: VAT 23 %, default loss 15 %). */
export const DEFAULT_SETTINGS: CostSettings = { vatTenths: 230, markupHundredths: MARKUPS, defaultLossTenths: 150 };

/**
 * The settings rows Kraken reads. Rows named "markups" or "wholesale_discounts_percent" may still be in the tab from
 * earlier versions; they are no longer read (the multipliers are fixed, discounts have their own tab).
 */
export const SETTING_NAMES = { vat: 'vat_percent', defaultLoss: 'default_roast_loss_percent' } as const;

export interface SettingRow {
  readonly id: string;
  readonly row: number;
  readonly name: string;
  readonly value: string;
  readonly deletedAt: string;
  readonly source: Fields;
}

export const settingFromFields = (fields: Fields, row: number): SettingRow => ({
  id: text(fields, 'id'),
  row,
  name: text(fields, 'name'),
  value: text(fields, 'value'),
  deletedAt: text(fields, 'deleted_at'),
  source: fields,
});

/** A percentage typed by a person: "23", "15,5" → tenths. Null if empty, undefined if not a valid percentage below 100. */
export function parsePercent(value: string): number | null | undefined {
  const tenths = parseDecimal(value, 1);
  if (tenths === null || tenths === undefined) return tenths;
  return tenths < 1000 ? tenths : undefined;
}

/**
 * A percentage as Kraken stores and accepts it: 0, or at least 1 % (e.g. "15.5"). A cell typed by hand as "20%" in
 * Google Sheets arrives as 0.2, which would silently read as 0,2 %; so values between 0 and 1 % are refused (the page
 * says the cell cannot be read, and the forms ask for e.g. 15 instead of 0,15).
 */
export function percentFromCell(value: string): number | null | undefined {
  const tenths = parsePercent(value);
  return typeof tenths === 'number' && tenths > 0 && tenths < 10 ? undefined : tenths;
}

export const percentText = (tenths: number) => toDecimalText(tenths, 1);
/** For the screen: "23 %", "15,5 %". */
export const formatPercent = (tenths: number) => `${percentText(tenths).replace('.', ',')} %`;

/** For the screen: "2,5×". */
export const formatMarkup = (hundredths: number) => `${toDecimalText(hundredths, 2).replace('.', ',')}×`;

/**
 * The settings in use: each saved value that Kraken can read, otherwise the default. Problems name the rows that
 * could not be used (shown on the page, never silently ignored).
 */
export function readSettings(rows: readonly SettingRow[]): { settings: CostSettings; problems: string[] } {
  const problems: string[] = [];
  const active = rows.filter((r) => r.deletedAt === '');
  const valueOf = (name: string): string | null => {
    const found = active.filter((r) => r.name === name);
    if (found.length > 1) problems.push(`The Cost settings tab has ${found.length} rows named "${name}" (rows ${found.map((r) => r.row).join(', ')}); Kraken uses the first.`);
    return found[0]?.value ?? null;
  };
  const read = <T>(name: string, parse: (v: string) => T | null | undefined, fallback: T): T => {
    const value = valueOf(name);
    if (value === null || value === '') return fallback;
    const parsed = parse(value);
    if (parsed === null || parsed === undefined) {
      problems.push(`The setting "${name}" has the value "${value}", which Kraken cannot read; it uses the default instead.`);
      return fallback;
    }
    return parsed;
  };
  return {
    settings: {
      vatTenths: read(SETTING_NAMES.vat, percentFromCell, DEFAULT_SETTINGS.vatTenths),
      markupHundredths: MARKUPS,
      defaultLossTenths: read(SETTING_NAMES.defaultLoss, percentFromCell, DEFAULT_SETTINGS.defaultLossTenths),
    },
    problems,
  };
}

export interface SettingsForm {
  vat: string;
  defaultLoss: string;
}

export const formFromSettings = (s: CostSettings): SettingsForm => ({
  vat: percentText(s.vatTenths).replace('.', ','),
  defaultLoss: percentText(s.defaultLossTenths).replace('.', ','),
});

export type SettingsErrors = Partial<Record<keyof SettingsForm, string>>;

/** Checks the settings form; on success gives the values to store, by setting name. */
export function validateSettingsForm(form: SettingsForm): { ok: true; values: Record<string, string> } | { ok: false; errors: SettingsErrors } {
  const errors: SettingsErrors = {};
  const vat = percentFromCell(form.vat);
  if (typeof vat !== 'number') errors.vat = 'Enter the VAT rate, e.g. 23.';
  const loss = percentFromCell(form.defaultLoss);
  if (typeof loss !== 'number') errors.defaultLoss = 'Enter a percentage from 1 to 99, e.g. 15.';
  if (typeof vat !== 'number' || typeof loss !== 'number') return { ok: false, errors };
  return { ok: true, values: { [SETTING_NAMES.vat]: percentText(vat), [SETTING_NAMES.defaultLoss]: percentText(loss) } };
}

// ---- Bag costs (the sizes are fixed: domain/bagSizes.ts; a cost item stores its size in grams) ----

export interface BagCost {
  readonly id: string;
  readonly row: number;
  /** The bag size in grams, as stored ("250"). */
  readonly bagSizeId: string;
  readonly item: string;
  /** Net cost in grosze; null if the cell cannot be read. */
  readonly costGrosze: number | null;
  /** The cost cell as typed (shown if it cannot be read). */
  readonly costText: string;
  readonly deletedAt: string;
  readonly source: Fields;
}

export const bagCostFromFields = (fields: Fields, row: number): BagCost => {
  const cost = parseMoney(text(fields, 'cost_net_pln'));
  return {
    id: text(fields, 'id'),
    row,
    bagSizeId: text(fields, 'bag_size_id'),
    item: text(fields, 'item'),
    costGrosze: typeof cost === 'number' ? cost : null,
    costText: text(fields, 'cost_net_pln'),
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
};

export interface BagCostForm {
  item: string;
  cost: string;
}

export type BagCostErrors = Partial<Record<keyof BagCostForm, string>>;

export const formFromBagCost = (cost: BagCost): BagCostForm => ({
  item: cost.item,
  cost: cost.costGrosze === null ? cost.costText : `${Math.floor(cost.costGrosze / 100)},${String(cost.costGrosze % 100).padStart(2, '0')}`,
});

/** Checks a cost item (e.g. "Bag", "0,85"); gives the fields to store (without the bag size). */
export function validateBagCostForm(form: BagCostForm): { ok: true; fields: Record<string, string> } | { ok: false; errors: BagCostErrors } {
  const errors: BagCostErrors = {};
  const item = form.item.trim();
  if (item === '') errors.item = 'Enter what it is, e.g. Bag or Label.';
  else if (item.length > 100) errors.item = 'At most 100 characters.';
  const cost = parseMoney(form.cost);
  if (typeof cost !== 'number') errors.cost = 'Enter the net cost per bag in zł, e.g. 0,85.';
  else if (cost > 100000) errors.cost = 'That is more than 1 000 zł per bag; please check.';
  if (Object.keys(errors).length > 0 || typeof cost !== 'number') return { ok: false, errors };
  return { ok: true, fields: { item, cost_net_pln: moneyText(cost) } };
}

// ---- Roast loss per lot (the owner's override) ----

export interface LotCost {
  readonly id: string;
  readonly row: number;
  readonly lotId: string;
  /** The owner's roast loss in tenths of a percent; null if empty (use the average) or unreadable. */
  readonly lossTenths: number | null;
  readonly lossText: string;
  readonly deletedAt: string;
  readonly source: Fields;
}

export const lotCostFromFields = (fields: Fields, row: number): LotCost => {
  const loss = percentFromCell(text(fields, 'roast_loss_percent'));
  return {
    id: text(fields, 'id'),
    row,
    lotId: text(fields, 'lot_id'),
    lossTenths: typeof loss === 'number' ? loss : null,
    lossText: text(fields, 'roast_loss_percent'),
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
};

/** Checks a roast loss typed for a lot; empty means "use the average of the roasts again". */
export function validateLoss(value: string): { ok: true; value: string } | { ok: false; error: string } {
  if (value.trim() === '') return { ok: true, value: '' };
  const tenths = percentFromCell(value);
  if (typeof tenths !== 'number') return { ok: false, error: 'Enter a percentage from 1 to 99, e.g. 15,5 (or leave empty to use the average).' };
  return { ok: true, value: percentText(tenths) };
}
