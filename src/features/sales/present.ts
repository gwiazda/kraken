// What the Sales page shows, as plain text, so it is tested without a browser: the suggested net price of a line
// (the product's main price and the client's discount, the same rule as everywhere), a short summary of each entry,
// and the filters with their counts.

import { formatPln } from '../../core/numbers';
import { formatBagSize } from '../../domain/bagSizes';
import { netOf, roundGrosze, wholesalePrice } from '../../domain/prices';
import { KIND_LABELS, STATUS_LABELS, isDeleted, lineTotal, linesOf, saleTotal, sortSales, type InvoiceStatus, type Sale, type SaleKind, type SaleLine } from './model';

/**
 * The net price per bag a line starts with: with a discount, the wholesale price (the main price without VAT, minus
 * the discount, whole złoty, as on the product page and the offer); without one, the main price without VAT.
 */
export function suggestedPrice(mainGross: number | undefined, discountTenths: number | null, vatTenths: number): number | null {
  if (mainGross === undefined) return null;
  return discountTenths === null ? roundGrosze(netOf(mainGross, vatTenths)) : wholesalePrice(mainGross, discountTenths, vatTenths).net;
}

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
  /** Net total of a sale: "291,06 zł"; '' for samples and own use. */
  readonly total: string;
  /** "Invoice to be issued", "Invoice issued 2026-11-20 (FV 1/11)", "Paid 2026-11-25"; '' when there is no invoice. */
  readonly status: string;
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
      const status =
        sale.kind !== 'sale' || sale.status === null
          ? ''
          : sale.status === 'issued'
            ? `${STATUS_LABELS.issued} ${sale.invoiceDate}${sale.invoiceNumber ? ` (${sale.invoiceNumber})` : ''}`
            : sale.status === 'paid'
              ? `${STATUS_LABELS.paid} ${sale.paidDate}`
              : STATUS_LABELS.to_issue;
      return {
        sale,
        date: sale.date,
        kind: sale.kind,
        kindLabel: sale.kind ? KIND_LABELS[sale.kind] : '?',
        who,
        items: items || '—',
        total: sale.kind === 'sale' ? formatPln(saleTotal(own)) : '',
        status,
        createdBy: sale.createdBy,
      };
    });
  return { rows, counts };
}

/** A line's total for the form ("291,06 zł"), '' without one. */
export const lineTotalText = (line: { bags: number | null; priceGrosze: number | null; free: boolean }) => (line.free ? 'free' : line.bags && line.priceGrosze ? formatPln(lineTotal(line)) : '');
