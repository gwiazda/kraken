// Issuing a sale's VAT invoice in Fakturownia (owner, 2026-11-28; docs/FAKTUROWNIA.md), and reading back which ones are
// paid. The invoice is built from the sale as saved: its lines and saved prices (REQUIREMENTS section 4), the client's
// CEIDG name and NIP; 14 days to pay, by transfer; sell date = the sale's date, issue date = today. Free bags are left
// off. Only the owner issues; Kraken never sends anything to KSeF (the owner does, in Fakturownia).
// No Google, no screen: the page sends what this builds through core/fakturownia.ts.

import type { InvoiceState, IssuedInvoice, NewInvoice } from '../../core/fakturownia';
import { moneyText } from '../../core/numbers';
import { formatBagSize } from '../../domain/bagSizes';
import { grossOf, roundGrosze } from '../../domain/prices';
import type { Client } from '../clients';
import { statusChange, type Sale, type SaleLine } from './model';
import { priceCells, type SalePricing } from './pricing';

/** Days to pay (owner, 2026-11-28). */
export const PAYMENT_DAYS = 14;

/** What the check screen shows and what is sent (the client's id in Fakturownia is found when issuing). */
export interface InvoiceDraft {
  readonly buyer: { readonly name: string; readonly nip: string; readonly email: string };
  readonly request: Omit<NewInvoice, 'clientId'>;
  /** The net total (grosze) and the same with VAT (rounded once, as on Sales). */
  readonly totalNet: number;
  readonly totalGross: number;
  readonly vatPercent: number;
}

/**
 * The invoice for a saved sale, or why it cannot be issued (one sentence each, for the owner). `lines`: the sale's
 * active lines in order, with their saved prices.
 */
export function invoiceDraft(
  sale: Sale,
  lines: readonly SaleLine[],
  client: Client | undefined,
  productName: (id: string) => string | undefined,
  vatTenths: number,
  today: string,
): { ok: true; draft: InvoiceDraft } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (sale.kind !== 'sale') problems.push('Fakturę wystawia się tylko dla sprzedaży.');
  else if (sale.fakturowniaId !== null || sale.status !== 'to_issue') problems.push('Faktura za tę sprzedaż jest już wystawiona.');
  if (!client || client.deletedAt !== '') problems.push('Tej sprzedaży nie da się przypisać do klienta z zakładki Klienci.');
  const nip = (client?.nip ?? '').replace(/\D/g, '');
  if (client && nip.length !== 10) problems.push(`${client.name} nie ma NIP-u: uzupełnij go w zakładce Klienci.`);
  const paid = lines.filter((l) => !l.free);
  if (lines.length === 0) problems.push('Ta sprzedaż nie ma produktów.');
  else if (paid.length === 0) problems.push('Na fakturze nie byłoby nic do zapłaty (same gratisy).');
  const unpriced = paid.filter((l) => l.unitNetGrosze === null || l.bags === null || l.grams === null);
  if (unpriced.length > 0) problems.push(`Nie wszystkie produkty mają zapisaną cenę (${unpriced.map((l) => productName(l.productId) ?? '?').join(', ')}): kliknij Zapisz, a jeśli to nie pomoże, sprawdź ceny w zakładce Produkty.`);
  if (vatTenths % 10 !== 0) problems.push('Stawka VAT w Opakowania i rabaty nie jest pełnym procentem.');
  if (problems.length > 0 || !client) return { ok: false, problems };
  const positions = paid.map((l) => ({
    name: `${productName(l.productId) ?? '?'} ${formatBagSize(l.grams ?? 0)}`,
    quantity: l.bags ?? 0,
    priceNet: moneyText(l.unitNetGrosze ?? 0),
    tax: vatTenths / 10,
  }));
  const totalNet = paid.reduce((sum, l) => sum + (l.unitNetGrosze ?? 0) * (l.bags ?? 0), 0);
  return {
    ok: true,
    draft: {
      buyer: { name: client.registeredName || client.name, nip, email: client.email },
      request: { orderId: sale.id, sellDate: sale.date, issueDate: today, paymentDays: PAYMENT_DAYS, positions },
      totalNet,
      totalGross: roundGrosze(grossOf(totalNet, vatTenths)),
      vatPercent: vatTenths / 10,
    },
  };
}

/**
 * True when the sale's saved prices are what it would be priced at now (`pricing`: worked out for its saved lines
 * today). Before issuing, a sale whose prices changed since it was saved (a new main price, special price or
 * discount) is saved again first, so the invoice never goes out at old prices.
 */
export function pricesUpToDate(pricing: SalePricing, sale: Sale, lines: readonly SaleLine[]): boolean {
  const cells = priceCells(pricing);
  if (cells.sale['discount_percent'] !== (sale.source['discount_percent'] ?? '').trim()) return false;
  return cells.lines.length === lines.length && cells.lines.every((c, i) => {
    const l = lines[i];
    return l !== undefined && c['unit_price_net_pln'] === (l.source['unit_price_net_pln'] ?? '').trim() && c['price_kind'] === (l.source['price_kind'] ?? '').trim();
  });
}

/** The sale's cells once its invoice is issued: "Faktura wystawiona" today, with the number, id and link. */
export const issuedFields = (invoice: IssuedInvoice, today: string): Record<string, string> => ({
  invoice_status: 'issued',
  invoice_date: today,
  invoice_number: invoice.number,
  fakturownia_id: String(invoice.id),
  fakturownia_url: invoice.url,
});

/** The Fakturownia ids of the invoices Kraken issued that are not paid yet (to ask about), at most 100 at a time. */
export function unpaidInvoiceIds(sales: readonly Sale[]): number[][] {
  const ids = sales.filter((s) => s.deletedAt === '' && s.kind === 'sale' && s.status === 'issued' && s.fakturowniaId !== null).map((s) => s.fakturowniaId as number);
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  return chunks;
}

/**
 * The sales to set to "Opłacona": those Kraken issued whose invoice Fakturownia now shows as paid (a partly paid one
 * stays "Faktura wystawiona"). Each with the cells to write (the issue date is kept).
 */
export function paidUpdates(sales: readonly Sale[], states: readonly InvoiceState[]): { sale: Sale; fields: Record<string, string> }[] {
  const paid = new Set(states.filter((s) => s.status === 'paid').map((s) => s.id));
  return sales.flatMap((sale) => {
    if (sale.deletedAt !== '' || sale.kind !== 'sale' || sale.status !== 'issued' || sale.fakturowniaId === null || !paid.has(sale.fakturowniaId)) return [];
    const change = statusChange(sale, 'paid', '');
    return change.ok ? [{ sale, fields: change.fields }] : [];
  });
}
