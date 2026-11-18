// Wholesale discounts (owner, 2026-11-18): each with a name shown on the offer, e.g. "Do 10 kg" = 15 %. The owner
// adds or removes them on the Packaging & discounts page; a product's page shows a column for each, and the Offer
// lets the owner tick which ones to include. Pure: no Google, no screen.

import { percentFromCell, percentText } from './model';

type Fields = Readonly<Record<string, string>>;

export const DISCOUNTS_TAB = 'Discounts';
export const DISCOUNT_COLUMNS = ['percent', 'name'] as const;

/** A discount name is printed next to every price on the offer, so it must stay short ("Do 10 kg", "10–20 kg"). */
export const DISCOUNT_NAME_MAX = 12;

/** Until the owner changes anything, Kraken uses the discounts of the owner's offer template. */
export const DEFAULT_DISCOUNTS: readonly { tenths: number; name: string }[] = [
  { tenths: 150, name: 'Do 10 kg' },
  { tenths: 250, name: '10–20 kg' },
  { tenths: 300, name: '20+ kg' },
];

export interface DiscountRow {
  readonly id: string;
  readonly row: number;
  /** Tenths of a percent; null if the cell cannot be read. */
  readonly tenths: number | null;
  readonly percentText: string;
  readonly name: string;
  readonly deletedAt: string;
  readonly source: Fields;
}

const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

export function discountFromFields(fields: Fields, row: number): DiscountRow {
  const tenths = percentFromCell(text(fields, 'percent'));
  return {
    id: text(fields, 'id'),
    row,
    tenths: typeof tenths === 'number' && tenths > 0 ? tenths : null,
    percentText: text(fields, 'percent'),
    name: text(fields, 'name'),
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

/** A discount in use: its row (none while the defaults are used), the percentage and the name. */
export interface Discount {
  readonly row: DiscountRow | null;
  readonly tenths: number;
  readonly name: string;
}

/**
 * The discounts in use, lowest first. While the Discounts tab has no rows at all, the defaults (15 / 25 / 30 %);
 * once the owner has changed anything, exactly the active rows (so deleting all of them really means none).
 */
export function activeDiscounts(rows: readonly DiscountRow[]): { discounts: Discount[]; usingDefaults: boolean; problems: string[] } {
  if (rows.length === 0) return { discounts: DEFAULT_DISCOUNTS.map((d) => ({ row: null, ...d })), usingDefaults: true, problems: [] };
  const problems: string[] = [];
  const discounts: Discount[] = [];
  for (const row of rows.filter((r) => r.deletedAt === '')) {
    if (row.tenths === null) {
      problems.push(`The discount "${row.percentText}" in row ${row.row} of the Discounts tab cannot be read, so it is left out.`);
      continue;
    }
    if (discounts.some((d) => d.tenths === row.tenths)) {
      problems.push(`The Discounts tab has ${percentText(row.tenths).replace('.', ',')} % twice (row ${row.row}); Kraken uses the first.`);
      continue;
    }
    discounts.push({ row, tenths: row.tenths, name: row.name });
  }
  return { discounts: discounts.sort((a, b) => a.tenths - b.tenths), usingDefaults: false, problems };
}

export interface DiscountForm {
  percent: string;
  name: string;
}

/** Checks a discount typed by the owner. `others`: the other discounts in use (a percentage can be there once). */
export function validateDiscount(
  form: DiscountForm,
  others: readonly { tenths: number }[],
): { ok: true; tenths: number; name: string; fields: Record<string, string> } | { ok: false; errors: Partial<DiscountForm> } {
  const errors: Partial<DiscountForm> = {};
  const tenths = percentFromCell(form.percent.trim());
  if (typeof tenths !== 'number' || tenths === 0) errors.percent = 'Enter a discount from 1 to 99, e.g. 20.';
  else if (others.some((d) => d.tenths === tenths)) errors.percent = 'This discount is already in the list.';
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (name.length > DISCOUNT_NAME_MAX) errors.name = `At most ${DISCOUNT_NAME_MAX} characters, so it fits next to the prices on the offer.`;
  if (typeof tenths !== 'number' || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, tenths, name, fields: { percent: percentText(tenths), name } };
}

/** The cells of a discount row. */
export const discountFields = (d: { tenths: number; name: string }): Record<string, string> => ({ percent: percentText(d.tenths), name: d.name });
