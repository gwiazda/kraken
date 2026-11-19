// Sales (owner, 2026-11-19): what went out, added by either owner. One record per entry:
// - a **sale** to a client: lines (product, bag size, number of bags, free or not) and an invoice status: to be
//   issued → issued (date, optional number) → paid (date). The invoice itself is made in Fakturownia;
// - a **sample** left somewhere: a client, or just a place typed in (a café not yet a client);
// - **own use**: one of the owners took a bag, with a reason.
// Samples and own use have no invoice. Sales do not change stock (owner, 2026-11-19).
// No prices here (owner, 2026-11-19): Sales records how much went out; the owner takes the prices from the client's
// offer when issuing the invoice, and the partner does not need to know them. The "unit_price_net_pln" column of the
// Sale lines tab stays in the sheet (added by migration 10) but is left empty.
// Pure: no Google, no screen.

import { isValidDate } from '../../core/dates';
import { BAG_SIZES_G, isBagSize } from '../../domain/bagSizes';

type Fields = Readonly<Record<string, string>>;

export const SALES_TAB = 'Sales';
export const SALE_COLUMNS = ['date', 'kind', 'client_id', 'place', 'reason', 'invoice_status', 'invoice_number', 'invoice_date', 'paid_date', 'notes'] as const;
export const SALE_LINES_TAB = 'Sale lines';
export const LINE_COLUMNS = ['sale_id', 'position', 'product_id', 'bag_size_g', 'bags', 'unit_price_net_pln', 'free'] as const;

export type SaleKind = 'sale' | 'sample' | 'own_use';
export const SALE_KINDS: readonly SaleKind[] = ['sale', 'sample', 'own_use'];
export type InvoiceStatus = 'to_issue' | 'issued' | 'paid';

/** For the screen. */
export const KIND_LABELS: Readonly<Record<SaleKind, string>> = { sale: 'Sale', sample: 'Sample', own_use: 'Own use' };
export const STATUS_LABELS: Readonly<Record<InvoiceStatus, string>> = { to_issue: 'Invoice to be issued', issued: 'Invoice issued', paid: 'Paid' };

export interface Sale {
  readonly id: string;
  readonly row: number;
  /** YYYY-MM-DD */
  readonly date: string;
  /** null when the cell cannot be read. */
  readonly kind: SaleKind | null;
  readonly clientId: string;
  /** Where a sample was left, when it is not a client. */
  readonly place: string;
  /** Why a bag was taken (own use). */
  readonly reason: string;
  /** Sales only; null for samples and own use (or a cell that cannot be read). */
  readonly status: InvoiceStatus | null;
  readonly invoiceNumber: string;
  readonly invoiceDate: string;
  readonly paidDate: string;
  readonly notes: string;
  readonly createdBy: string;
  readonly problems: readonly string[];
  readonly deletedAt: string;
  readonly source: Fields;
}

export interface SaleLine {
  readonly id: string;
  readonly row: number;
  readonly saleId: string;
  readonly position: number;
  readonly productId: string;
  /** null when the cell is not one of the bag sizes. */
  readonly grams: number | null;
  /** Whole bags; null when the cell cannot be read. */
  readonly bags: number | null;
  readonly free: boolean;
  readonly deletedAt: string;
  readonly source: Fields;
}

const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

export function saleFromFields(fields: Fields, row: number): Sale {
  const problems: string[] = [];
  const kindText = text(fields, 'kind');
  const kind = (SALE_KINDS as readonly string[]).includes(kindText) ? (kindText as SaleKind) : null;
  if (kind === null) problems.push(`Row ${row} of the Sales tab has the kind "${kindText}", which is not sale, sample or own_use.`);
  const statusText = text(fields, 'invoice_status');
  const status = statusText === 'to_issue' || statusText === 'issued' || statusText === 'paid' ? statusText : null;
  if (kind === 'sale' && status === null) problems.push(`Row ${row} of the Sales tab has the invoice status "${statusText}", which Kraken cannot read.`);
  const date = text(fields, 'date');
  if (!isValidDate(date)) problems.push(`Row ${row} of the Sales tab has the date "${date}", which is not a date (YYYY-MM-DD).`);
  return {
    id: text(fields, 'id'),
    row,
    date,
    kind,
    clientId: text(fields, 'client_id'),
    place: text(fields, 'place'),
    reason: text(fields, 'reason'),
    status: kind === 'sale' ? status : null,
    invoiceNumber: text(fields, 'invoice_number'),
    invoiceDate: text(fields, 'invoice_date'),
    paidDate: text(fields, 'paid_date'),
    notes: fields['notes'] ?? '',
    createdBy: text(fields, 'created_by'),
    problems,
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

export function lineFromFields(fields: Fields, row: number): SaleLine {
  const grams = Number(text(fields, 'bag_size_g'));
  const bags = Number(text(fields, 'bags'));
  return {
    id: text(fields, 'id'),
    row,
    saleId: text(fields, 'sale_id'),
    position: Number(text(fields, 'position')) || 0,
    productId: text(fields, 'product_id'),
    grams: isBagSize(grams) ? grams : null,
    bags: Number.isInteger(bags) && bags > 0 ? bags : null,
    free: text(fields, 'free') === 'yes',
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

export const isDeleted = (sale: Sale) => sale.deletedAt !== '';

/** A sale's active lines, in their order. */
export const linesOf = (lines: readonly SaleLine[], saleId: string) =>
  lines.filter((l) => l.deletedAt === '' && l.saleId === saleId).sort((a, b) => a.position - b.position || a.row - b.row);

/** Newest first; the same day: the one added last first. */
export function sortSales(sales: readonly Sale[]): Sale[] {
  return [...sales].sort((a, b) => b.date.localeCompare(a.date) || b.row - a.row);
}

/** How many bags went out, and how many of them free (for the list). */
export const bagCount = (lines: readonly { bags: number | null; free: boolean }[]) => ({
  bags: lines.reduce((sum, l) => sum + (l.bags ?? 0), 0),
  free: lines.reduce((sum, l) => sum + (l.free ? (l.bags ?? 0) : 0), 0),
});

// ---- The form ----

export interface LineForm {
  productId: string;
  /** Bag size in grams, as text ("250"). */
  grams: string;
  bags: string;
  /** Free bags (gratis): not to be invoiced. */
  free: boolean;
}

export interface SaleForm {
  date: string;
  kind: SaleKind;
  clientId: string;
  place: string;
  reason: string;
  notes: string;
  lines: LineForm[];
}

export interface SaleErrors {
  date?: string;
  client?: string;
  place?: string;
  reason?: string;
  notes?: string;
  lines?: string;
  /** Per line, in order. */
  line: (string | undefined)[];
}

export const emptyLine = (): LineForm => ({ productId: '', grams: String(BAG_SIZES_G[0]), bags: '1', free: false });

export const emptySaleForm = (today: string): SaleForm => ({ date: today, kind: 'sale', clientId: '', place: '', reason: '', notes: '', lines: [emptyLine()] });

export function formFromSale(sale: Sale, lines: readonly SaleLine[]): SaleForm {
  return {
    date: sale.date,
    kind: sale.kind ?? 'sale',
    clientId: sale.clientId,
    place: sale.place,
    reason: sale.reason,
    notes: sale.notes,
    lines: lines.map((l) => ({
      productId: l.productId,
      grams: l.grams === null ? text(l.source, 'bag_size_g') : String(l.grams),
      bags: l.bags === null ? text(l.source, 'bags') : String(l.bags),
      free: l.free,
    })),
  };
}

/** Whole bags while typing; null when not a whole number from 1 to 999. */
export function typedBags(value: string): number | null {
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}

/**
 * Checks a sale, sample or own use. `clientIds` and `productIds`: the active ones (a deleted one cannot be chosen).
 * On success gives the sale's cells (without the invoice status, which the caller sets) and the lines' cells.
 */
export function validateSale(
  form: SaleForm,
  clientIds: readonly string[],
  productIds: readonly string[],
): { ok: true; fields: Record<string, string>; lines: Record<string, string>[] } | { ok: false; errors: SaleErrors } {
  const errors: SaleErrors = { line: form.lines.map(() => undefined) };
  if (!isValidDate(form.date)) errors.date = 'Enter the date, e.g. 2026-11-19.';
  const place = form.place.trim().replace(/\s+/g, ' ');
  const reason = form.reason.trim().replace(/\s+/g, ' ');
  if (form.kind === 'sale' && !clientIds.includes(form.clientId)) errors.client = 'Choose the client (add new ones on the Clients page).';
  if (form.kind === 'sample' && form.clientId === '' && place === '') errors.place = 'Choose a client or type where the sample was left, e.g. Café Nowa, Kazimierz.';
  if (form.kind === 'sample' && form.clientId !== '' && !clientIds.includes(form.clientId)) errors.client = 'Choose a client from the list.';
  if (form.kind === 'own_use' && reason === '') errors.reason = 'Say why, e.g. for a tasting at home.';
  if (place.length > 200) errors.place = 'At most 200 characters.';
  if (reason.length > 200) errors.reason = 'At most 200 characters.';
  if (form.notes.length > 2000) errors.notes = 'At most 2000 characters.';
  if (form.lines.length === 0) errors.lines = 'Add at least one product.';
  const lines = form.lines.map((line, i) => {
    const bags = typedBags(line.bags);
    const grams = Number(line.grams);
    const problems: string[] = [];
    if (!productIds.includes(line.productId)) problems.push('choose the product');
    if (!isBagSize(grams)) problems.push('choose the bag size');
    if (bags === null) problems.push('enter the number of bags (1 to 999)');
    if (problems.length > 0) errors.line[i] = `Line ${i + 1}: ${problems.join(', ')}.`;
    return {
      position: String(i + 1),
      product_id: line.productId,
      bag_size_g: String(grams),
      bags: String(bags ?? ''),
      unit_price_net_pln: '',
      free: form.kind === 'sale' && line.free ? 'yes' : '',
    };
  });
  const failed = [errors.date, errors.client, errors.place, errors.reason, errors.notes, errors.lines, ...errors.line].some((e) => e);
  if (failed) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      date: form.date,
      kind: form.kind,
      client_id: form.kind === 'own_use' ? '' : form.clientId,
      place: form.kind === 'sample' && form.clientId === '' ? place : '',
      reason: form.kind === 'own_use' ? reason : '',
      notes: form.notes,
    },
    lines,
  };
}

/** The invoice cells when a sale is first saved, or when its kind changes. Samples and own use have none. */
export const startingInvoice = (kind: SaleKind): Record<string, string> =>
  kind === 'sale' ? { invoice_status: 'to_issue' } : { invoice_status: '', invoice_number: '', invoice_date: '', paid_date: '' };

/**
 * The cells to write when the invoice status changes. Issued needs the date it was issued (the number is optional);
 * paid needs the date it was paid. Going back clears what came after.
 */
export function statusChange(
  to: InvoiceStatus,
  details: { invoiceDate?: string; invoiceNumber?: string; paidDate?: string },
): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  if (to === 'to_issue') return { ok: true, fields: { invoice_status: 'to_issue', invoice_number: '', invoice_date: '', paid_date: '' } };
  if (to === 'issued') {
    if (!isValidDate(details.invoiceDate ?? '')) return { ok: false, error: 'Enter the date the invoice was issued.' };
    const number = (details.invoiceNumber ?? '').trim();
    if (number.length > 60) return { ok: false, error: 'The invoice number can have at most 60 characters.' };
    return { ok: true, fields: { invoice_status: 'issued', invoice_date: details.invoiceDate ?? '', invoice_number: number, paid_date: '' } };
  }
  if (!isValidDate(details.paidDate ?? '')) return { ok: false, error: 'Enter the date it was paid.' };
  return { ok: true, fields: { invoice_status: 'paid', paid_date: details.paidDate ?? '' } };
}

/**
 * What to write so the stored lines (`existing`, in order) become `wanted` (from validateSale): each position is
 * updated where something changed, new positions are added, lines no longer wanted are soft-deleted.
 */
export function lineChanges(
  existing: readonly SaleLine[],
  wanted: readonly Record<string, string>[],
): { updates: { line: SaleLine; changes: Record<string, string> }[]; adds: Record<string, string>[]; removes: SaleLine[] } {
  const updates: { line: SaleLine; changes: Record<string, string> }[] = [];
  const adds: Record<string, string>[] = [];
  wanted.forEach((fields, i) => {
    const line = existing[i];
    if (!line) {
      adds.push(fields);
      return;
    }
    const changes: Record<string, string> = {};
    for (const [column, value] of Object.entries(fields)) if (text(line.source, column) !== value) changes[column] = value;
    if (Object.keys(changes).length > 0) updates.push({ line, changes });
  });
  return { updates, adds, removes: existing.slice(wanted.length) };
}

/** Only the sale's cells that differ from it as loaded (an edit writes only what changed). */
export function changedSaleFields(sale: Sale, fields: Readonly<Record<string, string>>): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [column, value] of Object.entries(fields)) if ((column === 'notes' ? (sale.source['notes'] ?? '') : text(sale.source, column)) !== value) changed[column] = value;
  return changed;
}
