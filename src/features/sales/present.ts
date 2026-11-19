// What the Sales page shows, as plain text, so it is tested without a browser: a short summary of each entry (who,
// what, how many bags) and the filters with their counts. No prices (owner, 2026-11-19).

import { formatBagSize } from '../../domain/bagSizes';
import { KIND_LABELS, bagCount, isDeleted, linesOf, sortSales, type InvoiceStatus, type Sale, type SaleKind, type SaleLine } from './model';

export type SalesFilter = 'all' | InvoiceStatus | 'sample' | 'own_use';

export const FILTERS: readonly { filter: SalesFilter; label: string }[] = [
  { filter: 'to_issue', label: 'Invoice to be issued' },
  { filter: 'issued', label: 'Invoice issued' },
  { filter: 'paid', label: 'Paid' },
  { filter: 'sample', label: 'Samples' },
  { filter: 'own_use', label: 'Own use' },
  { filter: 'all', label: 'All' },
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
  /** The date of the status shown next to it: when the invoice was issued, or when it was paid; '' otherwise. */
  readonly statusDate: string;
  readonly createdBy: string;
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
        .map((l) => `${productName(l.productId) ?? '?'} ${l.grams === null ? '?' : formatBagSize(l.grams)} × ${l.bags ?? '?'}${l.free ? ' (free)' : ''}`)
        .join(', ');
      const who =
        sale.kind === 'own_use'
          ? sale.reason
          : sale.clientId
            ? (clientName(sale.clientId) ?? '? (client not found)')
            : sale.place
              ? `${sale.place} (not a client)`
              : '';
      const statusDate = sale.kind !== 'sale' ? '' : sale.status === 'issued' ? sale.invoiceDate : sale.status === 'paid' ? sale.paidDate : '';
      return {
        sale,
        date: sale.date,
        kind: sale.kind,
        kindLabel: sale.kind ? KIND_LABELS[sale.kind] : '?',
        who,
        items: items || '—',
        bags: bagsText(own),
        statusDate,
        createdBy: sale.createdBy,
      };
    });
  return { rows, counts };
}

/** "4 bags (1 free)", "1 bag", '' without lines. */
export function bagsText(lines: readonly { bags: number | null; free: boolean }[]): string {
  if (lines.length === 0) return '';
  const { bags, free } = bagCount(lines);
  return `${bags} ${bags === 1 ? 'bag' : 'bags'}${free > 0 ? ` (${free} free)` : ''}`;
}
