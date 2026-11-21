// Sales (owner, 2026-11-19): what went out, added by either owner. One record per entry:
// - a **sale** to a client: lines (product, bag size, number of bags, free or not) and an invoice status: to be
//   issued → issued (the date it was issued) → paid. The invoice itself is made in Fakturownia;
// - a **sample** left somewhere: a client, or just a place typed in (a café not yet a client);
// - **own use**: one of the owners took a bag. No reason is asked (owner, 2026-11-21): Kraken never writes the
//   "reason" column any more, so a reason saved earlier stays exactly as it is (and is still shown in the list).
// Samples and own use have no invoice. Sales do not change stock (owner, 2026-11-19).
// No prices here (owner, 2026-11-19): Sales records how much went out; the owner takes the prices from the client's
// offer when issuing the invoice, and the partner does not need to know them. The "unit_price_net_pln" column of the
// Sale lines tab stays in the sheet (added by migration 10) but is left empty.
// Pure: no Google, no screen.

import { isValidDate } from '../../core/dates';
import { BAG_SIZES_G, isBagSize } from '../../domain/bagSizes';

/** A row as read from the sheet, by column name (shared with the other sales model files). */
export type Fields = Readonly<Record<string, string>>;

export const SALES_TAB = 'Sales';
export const SALE_COLUMNS = ['date', 'kind', 'client_id', 'place', 'reason', 'invoice_status', 'invoice_number', 'invoice_date', 'paid_date', 'notes'] as const;
export const SALE_LINES_TAB = 'Sale lines';
export const LINE_COLUMNS = ['sale_id', 'position', 'product_id', 'bag_size_g', 'bags', 'unit_price_net_pln', 'free'] as const;

export type SaleKind = 'sale' | 'sample' | 'own_use';
export const SALE_KINDS: readonly SaleKind[] = ['sale', 'sample', 'own_use'];
export type InvoiceStatus = 'to_issue' | 'issued' | 'paid';

/** For the screen. */
export const KIND_LABELS: Readonly<Record<SaleKind, string>> = { sale: 'Sprzedaż', sample: 'Próbka', own_use: 'Na własny użytek' };
/** "Data sprzedaży", "Data próbki": the label of an entry's date (Polish needs the right form of the word). */
export const DATE_LABELS: Readonly<Record<SaleKind, string>> = { sale: 'Data sprzedaży', sample: 'Data próbki', own_use: 'Data wydania' };

/** The heading of an entry's page: "Sprzedaż z 20.11.2026", "Wydanie na własny użytek z 20.11.2026". */
export const HEADING_LABELS: Readonly<Record<SaleKind, string>> = { sale: 'Sprzedaż', sample: 'Próbka', own_use: 'Wydanie na własny użytek' };

export const STATUS_LABELS: Readonly<Record<InvoiceStatus, string>> = { to_issue: 'Faktura do wystawienia', issued: 'Faktura wystawiona', paid: 'Opłacona' };

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
  /** Grams (a bag size, or any amount for a sample); null when the cell cannot be read. */
  readonly grams: number | null;
  /** Whole bags; null when the cell cannot be read. */
  readonly bags: number | null;
  readonly free: boolean;
  /** Cells Kraken could not read, one sentence each. */
  readonly problems: readonly string[];
  readonly deletedAt: string;
  readonly source: Fields;
}

/** A cell's text without spaces around ('' when the column is missing). */
export const text = (fields: Fields, name: string) => (fields[name] ?? '').trim();

export function saleFromFields(fields: Fields, row: number): Sale {
  const problems: string[] = [];
  const kindText = text(fields, 'kind');
  const kind = (SALE_KINDS as readonly string[]).includes(kindText) ? (kindText as SaleKind) : null;
  if (kind === null) problems.push(`Wiersz ${row} zakładki „Sales” ma rodzaj „${kindText}”, a powinien być sale, sample albo own_use.`);
  const statusText = text(fields, 'invoice_status');
  const status = statusText === 'to_issue' || statusText === 'issued' || statusText === 'paid' ? statusText : null;
  if (kind === 'sale' && status === null) problems.push(`Wiersz ${row} zakładki „Sales” ma stan faktury „${statusText}”, którego Kraken nie umie odczytać.`);
  const date = text(fields, 'date');
  if (!isValidDate(date)) problems.push(`Wiersz ${row} zakładki „Sales” ma datę „${date}”, która nie jest datą (RRRR-MM-DD).`);
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

/**
 * The most a sample line can weigh, in grams. Samples are any amount (owner, 2026-11-20: "our samples are sometimes
 * 150 g or 100 g"); sales and own use are in the bag sizes.
 */
export const MAX_SAMPLE_GRAMS = 5000;

/** A whole number of grams a line can have: 1 to MAX_SAMPLE_GRAMS (the bag sizes are among them). */
export const isLineWeight = (grams: number) => Number.isInteger(grams) && grams >= 1 && grams <= MAX_SAMPLE_GRAMS;

export function lineFromFields(fields: Fields, row: number): SaleLine {
  const grams = Number(text(fields, 'bag_size_g'));
  const bags = Number(text(fields, 'bags'));
  const problems: string[] = [];
  if (!isLineWeight(grams)) problems.push(`Wiersz ${row} zakładki „Sale lines” ma gramaturę „${text(fields, 'bag_size_g')}”, która nie jest wagą w gramach (od 1 do ${MAX_SAMPLE_GRAMS}).`);
  if (!(Number.isInteger(bags) && bags > 0)) problems.push(`Wiersz ${row} zakładki „Sale lines” ma liczbę torebek „${text(fields, 'bags')}”, która nie jest liczbą całkowitą; nie jest liczona.`);
  return {
    id: text(fields, 'id'),
    row,
    saleId: text(fields, 'sale_id'),
    position: Number(text(fields, 'position')) || 0,
    productId: text(fields, 'product_id'),
    grams: isLineWeight(grams) ? grams : null,
    bags: Number.isInteger(bags) && bags > 0 ? bags : null,
    free: text(fields, 'free') === 'yes',
    problems,
    deletedAt: text(fields, 'deleted_at'),
    source: fields,
  };
}

export const isDeleted = (sale: Sale) => sale.deletedAt !== '';

/**
 * Lines of a sale or own use that are not a bag size (any amount is only for samples), e.g. a row edited by hand,
 * or a sample changed into a sale: one sentence each, for the page's problems. `sales`: those not deleted.
 */
export function lineSizeProblems(sales: readonly Sale[], lines: readonly SaleLine[]): string[] {
  const kindOf = new Map(sales.map((s) => [s.id, s.kind]));
  return lines
    .filter((l) => l.deletedAt === '' && l.grams !== null && !isBagSize(l.grams) && kindOf.has(l.saleId) && kindOf.get(l.saleId) !== 'sample')
    .map((l) => `Wiersz ${l.row} zakładki „Sale lines” ma ${l.grams} g, a dowolną gramaturę mogą mieć tylko próbki: otwórz wpis i wybierz wielkość torebki.`);
}

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
  /** Bag size in grams, as text ("250"); for a sample any amount ("150"). */
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
  notes: string;
  lines: LineForm[];
}

export interface SaleErrors {
  date?: string;
  client?: string;
  place?: string;
  notes?: string;
  lines?: string;
  /** Per line, in order. */
  line: (string | undefined)[];
}

export const emptyLine = (): LineForm => ({ productId: '', grams: String(BAG_SIZES_G[0]), bags: '1', free: false });

export const emptySaleForm = (today: string): SaleForm => ({ date: today, kind: 'sale', clientId: '', place: '', notes: '', lines: [emptyLine()] });

export function formFromSale(sale: Sale, lines: readonly SaleLine[]): SaleForm {
  return {
    date: sale.date,
    kind: sale.kind ?? 'sale',
    clientId: sale.clientId,
    place: sale.place,
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
  if (!isValidDate(form.date)) errors.date = 'Wybierz datę.';
  const place = form.place.trim().replace(/\s+/g, ' ');
  if (form.kind === 'sale' && !clientIds.includes(form.clientId)) errors.client = 'Wybierz klienta (nowych dodasz w zakładce Klienci).';
  if (form.kind === 'sample' && form.clientId === '' && place === '') errors.place = 'Wybierz klienta albo wpisz, gdzie została próbka, np. Café Nowa, Kazimierz.';
  if (form.kind === 'sample' && form.clientId !== '' && !clientIds.includes(form.clientId)) errors.client = 'Wybierz klienta z listy.';
  if (place.length > 200) errors.place = 'Najwyżej 200 znaków.';
  if (form.notes.length > 2000) errors.notes = 'Najwyżej 2000 znaków.';
  if (form.lines.length === 0) errors.lines = 'Dodaj co najmniej jeden produkt.';
  const lines = form.lines.map((line, i) => {
    const bags = typedBags(line.bags);
    const grams = Number(line.grams);
    const problems: string[] = [];
    if (!productIds.includes(line.productId)) problems.push('wybierz produkt');
    if (form.kind === 'sample' ? !isLineWeight(grams) : !isBagSize(grams)) problems.push(form.kind === 'sample' ? `wpisz gramaturę w gramach (od 1 do ${MAX_SAMPLE_GRAMS})` : 'wybierz wielkość torebki');
    if (bags === null) problems.push(form.kind === 'sample' ? 'wpisz liczbę opakowań (od 1 do 999)' : 'wpisz liczbę torebek (od 1 do 999)');
    if (problems.length > 0) errors.line[i] = `Pozycja ${i + 1}: ${problems.join(', ')}.`;
    return {
      position: String(i + 1),
      product_id: line.productId,
      bag_size_g: String(grams),
      bags: String(bags ?? ''),
      unit_price_net_pln: '',
      free: form.kind === 'sale' && line.free ? 'yes' : '',
    };
  });
  const failed = [errors.date, errors.client, errors.place, errors.notes, errors.lines, ...errors.line].some((e) => e);
  if (failed) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      date: form.date,
      kind: form.kind,
      client_id: form.kind === 'own_use' ? '' : form.clientId,
      place: form.kind === 'sample' && form.clientId === '' ? place : '',
      notes: form.notes,
    },
    lines,
  };
}

/**
 * The cells to write when an entry is edited (before changedSaleFields): a changed kind starts its invoice again (a
 * sample turned into a sale: "to be issued"; a sale turned into a sample: no invoice). When the stored kind cannot
 * be read but its invoice status can, saving it as a sale keeps that status (a paid invoice never goes back to
 * "to be issued" because of a typo in the kind cell).
 */
export function saleEditFields(sale: Sale, kind: SaleKind, fields: Readonly<Record<string, string>>): Record<string, string> {
  const storedStatus = text(sale.source, 'invoice_status');
  const keepsInvoice = sale.kind === kind || (sale.kind === null && kind === 'sale' && Object.hasOwn(STATUS_LABELS, storedStatus));
  return keepsInvoice ? { ...fields } : { ...fields, ...startingInvoice(kind) };
}

/**
 * The clients and products the form accepts: the active ones, plus those the entry already uses (a client or
 * product deleted later never stops an old entry from being edited).
 */
export function choosableIds(
  activeClientIds: readonly string[],
  activeProductIds: readonly string[],
  sale: Sale | null,
  existingLines: readonly SaleLine[],
): { clientIds: string[]; productIds: string[] } {
  const clientIds = sale?.clientId ? [...activeClientIds, sale.clientId] : [...activeClientIds];
  return { clientIds, productIds: [...activeProductIds, ...existingLines.map((l) => l.productId).filter((id) => id !== '')] };
}

/** The invoice cells when a sale is first saved, or when its kind changes. Samples and own use have none. */
export const startingInvoice = (kind: SaleKind): Record<string, string> =>
  kind === 'sale' ? { invoice_status: 'to_issue' } : { invoice_status: '', invoice_number: '', invoice_date: '', paid_date: '' };

type StatusOf = Pick<Sale, 'invoiceDate' | 'status'>;

/** The invoice date already known (the sale is issued or paid and the date can be read); '' otherwise. */
const knownInvoiceDate = (sale: StatusOf) => (sale.status !== 'to_issue' && isValidDate(sale.invoiceDate) ? sale.invoiceDate : '');

/** The date offered in the small date box: the issue date the sale already has, else today. */
export const suggestedInvoiceDate = (sale: StatusOf, today: string): string => knownInvoiceDate(sale) || today;

/**
 * True when choosing this status asks for the date the invoice was issued: always for Issued, and for Paid only
 * when no issue date is known yet (straight from "to be issued"). Paid itself has no date (owner, 2026-11-19).
 */
export const needsInvoiceDate = (sale: StatusOf, to: InvoiceStatus): boolean => to === 'issued' || (to === 'paid' && knownInvoiceDate(sale) === '');

/**
 * The cells to write when the invoice status is chosen from the list (owner, 2026-11-19: one simple dropdown, any
 * status to any other). Two dates matter: the entry's own date and the date the invoice was issued (`date`, asked
 * when needsInvoiceDate). Paid keeps the issue date already known. Going back to "to be issued" clears it. The
 * `paid_date` column is not written.
 */
export function statusChange(sale: StatusOf, to: InvoiceStatus, date: string): { ok: true; fields: Record<string, string> } | { ok: false; error: string } {
  if (to === 'to_issue') return { ok: true, fields: { invoice_status: 'to_issue', invoice_date: '' } };
  const invoiceDate = to === 'paid' ? knownInvoiceDate(sale) || date : date;
  if (!isValidDate(invoiceDate)) return { ok: false, error: 'Wpisz datę wystawienia faktury.' };
  return { ok: true, fields: { invoice_status: to, invoice_date: invoiceDate } };
}

/** Only the sale's cells that differ from it as loaded (an edit writes only what changed). */
export function changedSaleFields(sale: Sale, fields: Readonly<Record<string, string>>): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const [column, value] of Object.entries(fields)) if ((column === 'notes' ? (sale.source['notes'] ?? '') : text(sale.source, column)) !== value) changed[column] = value;
  return changed;
}
