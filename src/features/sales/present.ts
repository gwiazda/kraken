// What the Sales page shows, as plain text, so it is tested without a browser: a short summary of each entry (who,
// what, how many bags, the saved net total) and the filters with their counts, and a sale's prices (owner, 2026-11-27).

import { formatKg, formatPln, formatWholePln } from '../../core/numbers';
import { formatBagSize } from '../../domain/bagSizes';
import { formatPercent } from '../../domain/percent';
import { grossOf, netOf, roundGrosze } from '../../domain/prices';
import { formatDate, localDate } from '../../core/dates';
import { count } from '../../core/polish';
import { DATE_LABELS, KIND_LABELS, STATUS_LABELS, bagCount, isDeleted, linesOf, sortSales, type InvoiceStatus, type Sale, type SaleKind, type SaleLine } from './model';
import type { LineToPrice, SalePricing } from './pricing';

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
  /** The saved net total of a sale ("1472 zł"); '' for a sample, own use, or a sale not fully priced. */
  readonly net: string;
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
        net: savedNet(sale, own),
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
  readonly deleted: boolean;
}

type Fact = { label: string; value: string };

/**
 * The client chosen in an entry's form (owner, 2026-11-24): name and name in CEIDG, taken from Clients (no discount
 * per client since 2026-11-27: it depends on the invoice's weight).
 * None without a client (`clientId` ''); `client` is undefined when it cannot be found.
 */
export function clientFacts(clientId: string, client: ClientInfo | undefined): Fact[] {
  if (!clientId) return [];
  if (!client) return [{ label: 'Klient', value: '? (nie ma takiego klienta)' }];
  return [
    { label: 'Klient', value: `${client.name}${client.deleted ? ' (usunięty)' : ''}` },
    { label: 'Nazwa w CEIDG', value: client.registeredName || '—' },
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

/**
 * A sale's saved net total (owner, 2026-11-27), "1 472 zł"; '' for a sample or own use, and for a sale with a line
 * (not free) that has no saved price (e.g. saved before prices existed: open it and save it again).
 */
export function savedNet(sale: Pick<Sale, 'kind'>, lines: readonly Pick<SaleLine, 'free' | 'bags' | 'unitNetGrosze'>[]): string {
  if (sale.kind !== 'sale' || lines.length === 0) return '';
  let total = 0;
  for (const l of lines) {
    if (l.free) continue;
    if (l.unitNetGrosze === null || l.bags === null) return '';
    total += l.unitNetGrosze * l.bags;
  }
  return formatWholePln(total);
}

export interface PriceRow {
  /** "KENIA 1 kg" */
  readonly item: string;
  readonly bags: string;
  /** The starting price of one bag, the product's main price: "39,84 zł / 49 zł" (net / gross); '' when unknown. */
  readonly base: string;
  /** "−25 %", "cena specjalna", "gratis", or why there is no price. */
  readonly why: string;
  /** The client's price of one bag: "30 zł / 36,90 zł" (net / gross); '' for a free bag or a line without a price. */
  readonly price: string;
  readonly missing: boolean;
}

/**
 * A sale's prices for its page (owner, 2026-11-27): per line, one bag's starting price (the main price, net and
 * gross), the discount or special price, and the client's price (net and gross, to the grosz); then the weight and
 * discount, and the totals (the gross total is the net total with VAT, rounded once).
 * `discountName`: a discount's name in Packaging & discounts ("10–20 kg"), '' when it has none or is gone.
 */
export function priceView(
  lines: readonly LineToPrice[],
  pricing: SalePricing,
  productName: (id: string) => string | undefined,
  discountName: (tenths: number) => string,
  vatTenths: number,
): { rows: PriceRow[]; summary: string; total: string; totalGross: string } {
  const gross = (net: number) => formatPln(roundGrosze(grossOf(net, vatTenths)));
  const rows = lines.map((line, i): PriceRow => {
    const price = pricing.lines[i] ?? { kind: 'missing' as const, reason: '' };
    const item = `${productName(line.productId) ?? '?'} ${line.grams === null ? '?' : formatBagSize(line.grams)}`;
    const bags = line.bags === null ? '?' : String(line.bags);
    if (price.kind === 'free') return { item, bags, base: '', why: 'gratis', price: '', missing: false };
    if (price.kind === 'missing') return { item, bags, base: '', why: price.reason, price: '', missing: true };
    const base = price.retailGross === undefined ? '' : `${formatPln(roundGrosze(netOf(price.retailGross, vatTenths)))} / ${formatWholePln(price.retailGross)}`;
    const why = price.kind === 'special' ? 'cena specjalna' : `−${formatPercent(pricing.discountTenths ?? 0)}`;
    return { item, bags, base, why: price.kept ? `${why}, jak na fakturze` : why, price: `${formatWholePln(price.unitNet)} / ${gross(price.unitNet)}`, missing: false };
  });
  const name = pricing.discountKept ? 'jak na fakturze' : pricing.discountTenths === null ? '' : discountName(pricing.discountTenths);
  const discount = pricing.discountTenths === null ? 'bez rabatu' : `rabat −${formatPercent(pricing.discountTenths)}${name ? ` (${name})` : ''}`;
  return {
    rows,
    summary: `${formatKg(pricing.weightGrams)} kawy na fakturze (bez gratisów) · ${discount}`,
    total: formatWholePln(pricing.totalNet),
    totalGross: gross(pricing.totalNet),
  };
}
