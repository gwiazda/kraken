// What the Sales page shows, as plain text, so it is tested without a browser: a short summary of each entry (who,
// what, how many bags) and the filters with their counts. No prices (owner, 2026-11-19).

import { formatBagSize } from '../../domain/bagSizes';
import { formatDate, localDate } from '../../core/dates';
import { count } from '../../core/polish';
import { DATE_LABELS, KIND_LABELS, STATUS_LABELS, bagCount, isDeleted, linesOf, sortSales, type InvoiceStatus, type Sale, type SaleKind, type SaleLine } from './model';

export type SalesFilter = 'all' | InvoiceStatus | 'sample' | 'own_use';

/** The filter buttons, "All" first (owner, 2026-11-19). */
export const FILTERS: readonly { filter: SalesFilter; label: string }[] = [
  { filter: 'all', label: 'Wszystkie' },
  { filter: 'to_issue', label: 'Faktura do wystawienia' },
  { filter: 'issued', label: 'Faktura wystawiona' },
  { filter: 'paid', label: 'Opłacone' },
  { filter: 'sample', label: 'Próbki' },
  { filter: 'own_use', label: 'Na własny użytek' },
];

const matches = (sale: Sale, filter: SalesFilter) =>
  filter === 'all' || (filter === 'sample' || filter === 'own_use' ? sale.kind === filter : sale.kind === 'sale' && sale.status === filter);

export interface SaleRow {
  readonly sale: Sale;
  readonly date: string;
  readonly kind: SaleKind | null;
  readonly kindLabel: string;
  /** "Café Nowa", "Café X, Kazimierz (not a client)", or the reason for own use. */
  readonly who: string;
  /** "GWATEMALA 1 kg × 3, KENIA 250 g × 1 (free)" */
  readonly items: string;
  /** How many bags: "4 bags (1 free)", "1 bag". */
  readonly bags: string;
  /** When the invoice was issued (issued or paid); '' otherwise. */
  readonly invoiceDate: string;
  readonly createdBy: string;
}

/**
 * Who an entry is for: the client ("Café Nowa"; "? (nie ma takiego klienta)" when it cannot be found), a place
 * typed in ("Café X, Kazimierz (nie jest klientem)"), or for own use the reason saved before 2026-11-21 ('' if none).
 */
export function whoText(sale: Sale, clientName: (id: string) => string | undefined): string {
  if (sale.kind === 'own_use') return sale.reason;
  if (sale.clientId) return clientName(sale.clientId) ?? '? (nie ma takiego klienta)';
  return sale.place ? `${sale.place} (nie jest klientem)` : '';
}

/** A deleted entry in "Usunięte wpisy": "19.11.2026 · Sprzedaż · Café Nowa" (no trailing "·" when there is no who). */
export function deletedEntryText(sale: Sale, clientName: (id: string) => string | undefined): string {
  return [formatDate(sale.date), sale.kind ? KIND_LABELS[sale.kind] : '?', whoText(sale, clientName)].filter((part) => part !== '').join(' · ');
}

/**
 * The entries shown for a filter, newest first, without deleted ones; and how many each filter has. `clientName` and
 * `productName` look up names (a deleted or missing one shows as "?").
 */
export function saleRows(
  sales: readonly Sale[],
  lines: readonly SaleLine[],
  filter: SalesFilter,
  clientName: (id: string) => string | undefined,
  productName: (id: string) => string | undefined,
): { rows: SaleRow[]; counts: Record<SalesFilter, number> } {
  const active = sortSales(sales.filter((s) => !isDeleted(s)));
  const counts = Object.fromEntries(FILTERS.map(({ filter: f }) => [f, active.filter((s) => matches(s, f)).length])) as Record<SalesFilter, number>;
  const rows = active
    .filter((s) => matches(s, filter))
    .map((sale): SaleRow => {
      const own = linesOf(lines, sale.id);
      const items = own
        .map((l) => `${productName(l.productId) ?? '?'} ${l.grams === null ? '?' : formatBagSize(l.grams)} × ${l.bags ?? '?'}${l.free ? ' (gratis)' : ''}`)
        .join(', ');
      const who = whoText(sale, clientName);
      const invoiceDate = sale.kind === 'sale' && (sale.status === 'issued' || sale.status === 'paid') ? sale.invoiceDate : '';
      return {
        sale,
        date: formatDate(sale.date),
        kind: sale.kind,
        kindLabel: sale.kind ? KIND_LABELS[sale.kind] : '?',
        who,
        items: items || '—',
        bags: bagsText(own, sale.kind),
        invoiceDate: formatDate(invoiceDate),
        createdBy: sale.createdBy,
      };
    });
  return { rows, counts };
}

/**
 * "4 torebki (1 gratis)", "1 torebka", "5 torebek"; for a sample (any amount, not a bag size) "8 opakowań"; '' without
 * lines. Free bags count only for a sale (`kind`): samples and own use are never invoiced anyway.
 */
export function bagsText(lines: readonly { bags: number | null; free: boolean }[], kind: SaleKind | null = 'sale'): string {
  if (lines.length === 0) return '';
  const { bags, free } = bagCount(kind === 'sale' ? lines : lines.map((l) => ({ ...l, free: false })));
  const counted = kind === 'sample' ? count(bags, 'opakowanie', 'opakowania', 'opakowań') : count(bags, 'torebka', 'torebki', 'torebek');
  return `${counted}${free > 0 ? ` (${free} gratis)` : ''}`;
}

/** A client as the Clients tab has it now (read from there each time, never copied into the sale). */
export interface ClientInfo {
  readonly name: string;
  /** The name in CEIDG; '' when not given. */
  readonly registeredName: string;
  /** "15 %", "—" for none, or the stored text in quotes when it cannot be read ("„abc”"). */
  readonly discount: string;
  readonly deleted: boolean;
}

type Fact = { label: string; value: string };

/**
 * The client chosen in an entry's form (owner, 2026-11-24): name, name in CEIDG and discount, taken from Clients.
 * None without a client (`clientId` ''); `client` is undefined when it cannot be found.
 */
export function clientFacts(clientId: string, client: ClientInfo | undefined): Fact[] {
  if (!clientId) return [];
  if (!client) return [{ label: 'Klient', value: '? (nie ma takiego klienta)' }];
  return [
    { label: 'Klient', value: `${client.name}${client.deleted ? ' (usunięty)' : ''}` },
    { label: 'Nazwa w CEIDG', value: client.registeredName || '—' },
    { label: 'Rabat', value: client.discount },
  ];
}

/**
 * The facts at the top of an entry's edit screen (owner, 2026-11-19: "make it clear when the record was added and
 * when the invoice was issued"): the date of the entry, the day it was added to Kraken (and by whom), and for a
 * sale its invoice status and the date the invoice was issued.
 */
export function saleFacts(sale: Sale): Fact[] {
  const created = new Date(sale.source['created_at'] ?? '');
  const added = Number.isNaN(created.getTime()) ? '—' : `${formatDate(localDate(created))}${sale.createdBy ? ` (${sale.createdBy})` : ''}`;
  const facts = [
    { label: sale.kind ? DATE_LABELS[sale.kind] : 'Data', value: formatDate(sale.date) || '—' },
    { label: 'Dodano do Krakena', value: added },
  ];
  if (sale.kind === 'sale') {
    facts.push({ label: 'Stan faktury', value: sale.status ? STATUS_LABELS[sale.status] : '? (nie da się odczytać)' });
    facts.push({ label: 'Data wystawienia faktury', value: (sale.status === 'issued' || sale.status === 'paid') && sale.invoiceDate ? formatDate(sale.invoiceDate) : 'Jeszcze nie' });
  }
  return facts;
}
