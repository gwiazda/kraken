// Wholesale discounts (owner, 2026-11-18): each with a name shown on the offer, e.g. "Do 10 kg" = 15 %. The owner
// adds or removes them on the Packaging & discounts page; a product's page shows a column for each, and the Offer
// lets the owner tick which ones to include. Each also has the weight of coffee on one invoice from which it applies
// (owner, 2026-11-27: "od 10 kg"; 10 kg exactly already gets that discount), so an invoice's discount follows from
// its weight. Pure: no Google, no screen.

import { formatKg, kgText, parseKg } from '../../core/numbers';
import { percentFromCell, percentText } from './model';

type Fields = Readonly<Record<string, string>>;

export const DISCOUNTS_TAB = 'Discounts';
// Migration 015: from_kg, the invoice weight from which the discount applies (empty until the owner types it).
export const DISCOUNT_COLUMNS = ['percent', 'name', 'from_kg'] as const;

/** The most a discount can start from: 1000 kg on one invoice. */
const MAX_FROM_GRAMS = 1_000_000;

/** A discount name is printed next to every price on the offer, so it must stay short ("Do 10 kg", "10–20 kg"). */
export const DISCOUNT_NAME_MAX = 12;

/** Until the owner changes anything, Kraken uses the discounts of the owner's offer template. */
export const DEFAULT_DISCOUNTS: readonly { tenths: number; name: string; fromGrams: number }[] = [
  { tenths: 150, name: 'Do 10 kg', fromGrams: 0 },
  { tenths: 250, name: '10–20 kg', fromGrams: 10_000 },
  { tenths: 300, name: '20+ kg', fromGrams: 20_000 },
];

export interface DiscountRow {
  readonly id: string;
  readonly row: number;
  /** Tenths of a percent; null if the cell cannot be read. */
  readonly tenths: number | null;
  readonly percentText: string;
  readonly name: string;
  /** The invoice weight from which it applies, in grams; null when empty or when the cell cannot be read. */
  readonly fromGrams: number | null;
  readonly fromText: string;
  readonly deletedAt: string;
  readonly source: Fields;
}

/** A starting weight in grams: 0 to 1000 kg, at most 3 decimals ("10", "12,5"); null for anything else. */
function fromGramsOf(cell: string): number | null {
  const grams = parseKg(cell);
  return typeof grams === 'number' && grams <= MAX_FROM_GRAMS ? grams : null;
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
    fromGrams: fromGramsOf(text(fields, 'from_kg')),
    fromText: text(fields, 'from_kg'),
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

/** A discount in use: its row (none while the defaults are used), the percentage, the name and where it starts. */
export interface Discount {
  readonly row: DiscountRow | null;
  readonly tenths: number;
  readonly name: string;
  /** The invoice weight from which it applies, in grams; null until the owner types it (or it cannot be read). */
  readonly fromGrams: number | null;
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
      problems.push(`Nie da się odczytać rabatu „${row.percentText}” w wierszu ${row.row} zakładki „Discounts”, więc jest pominięty.`);
      continue;
    }
    if (discounts.some((d) => d.tenths === row.tenths)) {
      problems.push(`Zakładka „Discounts” ma dwa razy ${percentText(row.tenths).replace('.', ',')} % (wiersz ${row.row}); Kraken używa pierwszego.`);
      continue;
    }
    if (row.name.length > DISCOUNT_NAME_MAX) {
      problems.push(`Nazwa rabatu „${row.name}” w wierszu ${row.row} zakładki „Discounts” ma więcej niż ${DISCOUNT_NAME_MAX} znaków, więc nie zmieści się w ofercie. Kliknij ją tutaj, aby skrócić.`);
    }
    let fromGrams = row.fromGrams;
    if (row.fromText !== '' && fromGrams === null) {
      problems.push(`Nie da się odczytać wagi „${row.fromText}” rabatu −${percentText(row.tenths).replace('.', ',')} % (wiersz ${row.row} zakładki „Discounts”). Kliknij rabat tutaj, aby ją poprawić.`);
    } else if (fromGrams !== null && discounts.some((d) => d.fromGrams === fromGrams)) {
      problems.push(`Dwa rabaty zaczynają się od ${formatKg(fromGrams)} (wiersz ${row.row} zakładki „Discounts”); Kraken liczy tylko pierwszy. Kliknij rabat tutaj, aby to poprawić.`);
      fromGrams = null;
    }
    discounts.push({ row, tenths: row.tenths, name: row.name, fromGrams });
  }
  return { discounts: discounts.sort((a, b) => a.tenths - b.tenths), usingDefaults: false, problems };
}

export interface DiscountForm {
  percent: string;
  name: string;
  /** The invoice weight from which it applies, in kg as typed ("10", "12,5"). */
  from: string;
}

/**
 * Checks a discount typed by the owner. `others`: the other discounts in use (a percentage, and a starting weight,
 * can be there once).
 */
export function validateDiscount(
  form: DiscountForm,
  others: readonly { tenths: number; fromGrams: number | null }[],
): { ok: true; tenths: number; name: string; fromGrams: number; fields: Record<string, string> } | { ok: false; errors: Partial<DiscountForm> } {
  const errors: Partial<DiscountForm> = {};
  const tenths = percentFromCell(form.percent.trim());
  if (typeof tenths !== 'number' || tenths === 0) errors.percent = 'Wpisz rabat od 1 do 99, np. 20.';
  else if (others.some((d) => d.tenths === tenths)) errors.percent = 'Ten rabat jest już na liście.';
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (name.length > DISCOUNT_NAME_MAX) errors.name = `Najwyżej ${DISCOUNT_NAME_MAX} znaków, żeby zmieściło się przy cenach w ofercie.`;
  const fromGrams = fromGramsOf(form.from.trim());
  if (fromGrams === null) errors.from = 'Wpisz, od ilu kg kawy na fakturze obowiązuje rabat, np. 10 (0 dla najmniejszych zamówień).';
  else if (others.some((d) => d.fromGrams === fromGrams)) errors.from = `Inny rabat zaczyna się już od ${formatKg(fromGrams)}.`;
  if (typeof tenths !== 'number' || fromGrams === null || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, tenths, name, fromGrams, fields: discountFields({ tenths, name, fromGrams }) };
}

/** The cells of a discount row. */
export const discountFields = (d: { tenths: number; name: string; fromGrams: number | null }): Record<string, string> => ({
  percent: percentText(d.tenths),
  name: d.name,
  from_kg: d.fromGrams === null ? '' : kgText(d.fromGrams),
});

/**
 * The discount for an invoice with `grams` of coffee (owner, 2026-11-27): the one with the highest starting weight
 * not above it (10 kg exactly gets the discount "from 10 kg"). null when none applies: no discount has its starting
 * weight yet, or the invoice weighs less than the lowest one.
 */
export function discountForWeight<T extends { fromGrams: number | null }>(discounts: readonly T[], grams: number): T | null {
  let best: T | null = null;
  for (const d of discounts) if (d.fromGrams !== null && d.fromGrams <= grams && (best === null || d.fromGrams > (best.fromGrams ?? -1))) best = d;
  return best;
}
