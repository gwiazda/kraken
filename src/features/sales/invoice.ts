// Issuing a sale's VAT invoice in Fakturownia (owner, 2026-11-28; docs/FAKTUROWNIA.md), and reading back which ones are
// paid. The invoice is built from the sale as saved: its lines and saved prices (REQUIREMENTS section 4), the client's
// CEIDG name and NIP; 14 days to pay, by transfer; sell date = the sale's date, issue date = today. Free bags are left
// off. Only the owner issues; Kraken never sends anything to KSeF (the owner does, in Fakturownia).
// No Google, no screen: the page sends what this builds through core/fakturownia.ts.

import { addDays } from '../../core/dates';
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
  /** The net total (grosze), and the gross total: the lines' gross totals added up (what the invoice shows). */
  readonly totalNet: number;
  readonly totalGross: number;
  /** Each position's gross total in grosze (the same as its `totalGross` text), for the check screen. */
  readonly lineGross: readonly number[];
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
  // The invoice goes to the client by e-mail (owner, 2026-11-28): none, no invoice.
  if (client && client.email.trim() === '') problems.push(`${client.name} nie ma adresu e-mail (faktura trafia na niego): uzupełnij go w zakładce Klienci.`);
  const paid = lines.filter((l) => !l.free);
  if (lines.length === 0) problems.push('Ta sprzedaż nie ma produktów.');
  else if (paid.length === 0) problems.push('Na fakturze nie byłoby nic do zapłaty (same gratisy).');
  const unpriced = paid.filter((l) => l.unitNetGrosze === null || l.bags === null || l.grams === null);
  if (unpriced.length > 0) problems.push(`Nie wszystkie produkty mają zapisaną cenę (${unpriced.map((l) => productName(l.productId) ?? '?').join(', ')}): kliknij Zapisz, a jeśli to nie pomoże, sprawdź ceny w zakładce Produkty.`);
  if (vatTenths % 10 !== 0) problems.push('Stawka VAT w Opakowania i rabaty nie jest pełnym procentem.');
  if (problems.length > 0 || !client) return { ok: false, problems };
  // Each line's gross total, to the grosz: quantity × net price + VAT (Fakturownia requires it on every line). Not
  // yet checked against a real invoice whether Fakturownia also rounds per line (not per unit): to see on the first
  // invoice with prices in grosze; the middleman refuses any gross that does not match this rule.
  const lineGross = (l: SaleLine) => roundGrosze(grossOf((l.unitNetGrosze ?? 0) * (l.bags ?? 0), vatTenths));
  const positions = paid.map((l) => ({
    name: `${productName(l.productId) ?? '?'} ${formatBagSize(l.grams ?? 0)}`,
    quantity: l.bags ?? 0,
    priceNet: moneyText(l.unitNetGrosze ?? 0),
    totalGross: moneyText(lineGross(l)),
    tax: vatTenths / 10,
  }));
  const totalNet = paid.reduce((sum, l) => sum + (l.unitNetGrosze ?? 0) * (l.bags ?? 0), 0);
  return {
    ok: true,
    draft: {
      buyer: { name: client.registeredName || client.name, nip, email: client.email },
      request: { orderId: sale.id, sellDate: sale.date, issueDate: today, paymentDays: PAYMENT_DAYS, positions },
      totalNet,
      totalGross: paid.reduce((sum, l) => sum + lineGross(l), 0),
      lineGross: paid.map(lineGross),
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

/**
 * Which Fakturownia client to invoice (owner, 2026-11-28): the first with this NIP, or none (then Kraken adds it, with
 * its e-mail). A card there without an e-mail stops the invoice: the invoice goes to that e-mail.
 */
export function chooseClient(
  found: readonly { id: number; name: string; email: string }[],
): { ok: true; card: { id: number; name: string; email: string } | null } | { ok: false; problem: string } {
  const client = found[0];
  if (!client) return { ok: true, card: null };
  if (client.email.trim() === '') return { ok: false, problem: `Klient „${client.name}” w Fakturowni nie ma adresu e-mail: dodaj go na karcie klienta w Fakturowni, a potem wystaw fakturę.` };
  return { ok: true, card: { id: client.id, name: client.name, email: client.email.trim() } };
}

/**
 * When the Fakturownia card of the client differs from Klienci (the invoice uses the card): one sentence for the
 * check screen, or '' when name and e-mail are the same (capitals and spaces ignored).
 */
export function cardDiffers(card: { name: string; email: string }, buyer: { name: string; email: string }): string {
  const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
  const diff = [...(same(card.name, buyer.name) ? [] : ['nazwę']), ...(same(card.email, buyer.email) ? [] : ['e-mail'])];
  return diff.length === 0 ? '' : `Karta klienta w Fakturowni ma inną ${diff.join(' i ')} niż zakładka Klienci; faktura użyje danych z Fakturowni. Jeśli są nieaktualne, popraw je najpierw na karcie w Fakturowni.`;
}

/** The sale's cells once its invoice is issued: "Faktura wystawiona" today, with the number, id and link. */
export const issuedFields = (invoice: IssuedInvoice, today: string): Record<string, string> => ({
  invoice_status: 'issued',
  invoice_date: today,
  invoice_number: invoice.number,
  fakturownia_id: String(invoice.id),
  fakturownia_url: invoice.url,
});

/** How far back paid invoices are still asked about (KSeF): one may be paid before it was sent. */
const PAID_KSEF_DAYS = 60;

/**
 * The Fakturownia ids of the invoices Kraken issued to ask about (paid? in KSeF?), at most 40 at a time (the middleman's
 * limit): those not paid yet, and those paid whose invoice date is within the last 60 days (owner, 2026-11-28: see at a
 * glance which still need sending to KSeF).
 */
export function invoiceIdsToAsk(sales: readonly Sale[], today: string): number[][] {
  const since = addDays(today, -PAID_KSEF_DAYS);
  const ids = sales
    .filter((s) => s.deletedAt === '' && s.kind === 'sale' && s.fakturowniaId !== null && (s.status === 'issued' || (s.status === 'paid' && (s.invoiceDate === '' || s.invoiceDate >= since))))
    .map((s) => s.fakturowniaId as number);
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
  return chunks;
}

export type KsefKind = 'sent' | 'test' | 'not_sent' | 'pending' | 'error' | 'other';

/**
 * What Fakturownia's KSeF state (`gov_status`, KSeF.md) means, in Polish for the screen. Kraken never sends to KSeF: the
 * owner does, in Fakturownia; this only shows which invoices still need it. Demo states ("demo_ok") are the test mode.
 */
/** The short badge of each state in the Sales list (owner, 2026-11-28: short, with icons; the full text on hover). */
const KSEF_BADGES: Readonly<Record<KsefKind, string>> = { sent: 'KSeF ✓', test: 'KSeF test', not_sent: 'KSeF ✗', pending: 'KSeF ⏳', error: 'KSeF ⚠', other: 'KSeF –' };

export function ksefState(status: string | null): { kind: KsefKind; text: string; badge: string; warn: boolean } {
  const demo = status?.startsWith('demo_') ?? false;
  const s = demo ? (status ?? '').slice(5) : (status ?? '');
  const test = demo ? ' (tryb testowy)' : '';
  const state = (kind: KsefKind, text: string) => ({ kind, text, badge: KSEF_BADGES[kind], warn: kind === 'not_sent' || kind === 'error' || kind === 'test' });
  if (s === '') return state('not_sent', 'nie wysłana do KSeF');
  // Only KSeF's test mode: not really in KSeF, so it still needs sending (owner, 2026-11-28: see what is left to send).
  if (demo && s === 'ok') return state('test', 'w KSeF (tryb testowy)');
  if (s === 'ok') return state('sent', 'w KSeF');
  if (s === 'processing') return state('pending', `wysyłana do KSeF${test}`);
  if (s === 'offline') return state('pending', `czeka na KSeF (offline)${test}`);
  if (s === 'not_applicable') return state('other', 'nie dotyczy KSeF');
  if (s === 'not_connected') return state('error', 'KSeF nie jest połączony w Fakturowni');
  return state('error', `błąd KSeF${test}: sprawdź w Fakturowni`);
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
