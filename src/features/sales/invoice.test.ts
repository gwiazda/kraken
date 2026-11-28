import { describe, expect, it } from 'vitest';
import type { Client } from '../clients';
import { cardDiffers, chooseClient, deletedInFakturownia, invoiceDraft, issuedFields, invoiceIdsToAsk, ksefState, ksefWaiting, paidUpdates, pricesUpToDate } from './invoice';
import { lineFromFields, saleFromFields } from './model';
import { priceSale, type PricingData } from './pricing';

// Made-up sales, clients and products only.
const sale = (row: number, o: Record<string, string> = {}) =>
  saleFromFields({ id: `S${row}`, date: '2026-11-27', kind: 'sale', client_id: 'C1', invoice_status: 'to_issue', discount_percent: '25', ...o }, row);
const line = (row: number, o: Record<string, string> = {}) =>
  lineFromFields({ id: `L${row}`, sale_id: 'S2', position: String(row), product_id: 'K', bag_size_g: '1000', bags: '8', unit_price_net_pln: '112', price_kind: 'special', free: '', ...o }, row);
const client = (o: Partial<Client> = {}): Client => ({ id: 'C1', row: 2, name: 'Café Nowa', nip: '9876543210', email: 'kawa@example.com', registeredName: 'Nowa Kawa Sp. z o.o.', problems: [], deletedAt: '', source: {}, ...o });
const names: Record<string, string> = { K: 'KENIA', G: 'GWATEMALA' };
const productName = (id: string) => names[id];

describe('invoiceDraft (owner, 2026-11-28)', () => {
  it('builds the invoice from the saved sale: CEIDG name, NIP, lines "KENIA 1 kg", saved net prices, 14 days, VAT 23 %', () => {
    const lines = [line(2), line(3, { product_id: 'G', bag_size_g: '250', bags: '16', unit_price_net_pln: '30', price_kind: 'discount' }), line(4, { free: 'yes', bags: '2', unit_price_net_pln: '' })];
    const result = invoiceDraft(sale(2), lines, client(), productName, 230, '2026-11-28');
    expect(result).toEqual({
      ok: true,
      draft: {
        buyer: { name: 'Nowa Kawa Sp. z o.o.', nip: '9876543210', email: 'kawa@example.com' },
        request: {
          orderId: 'S2',
          sellDate: '2026-11-27',
          issueDate: '2026-11-28',
          paymentDays: 14,
          positions: [
            { name: 'KENIA 1 kg', quantity: 8, priceNet: '112', totalGross: '1102.08', tax: 23 }, // 896 zł + 23 %
            { name: 'GWATEMALA 250 g', quantity: 16, priceNet: '30', totalGross: '590.4', tax: 23 }, // the free bags are left off
          ],
        },
        totalNet: 137600,
        totalGross: 169248, // 1102,08 + 590,40 zł
        lineGross: [110208, 59040],
        vatPercent: 23,
      },
    });
  });

  it('adds up the gross totals line by line (prices with grosze; per line, not per unit: to confirm on a real invoice)', () => {
    // 3 × 30,55 = 91,65 → 112,7295 → 112,73 zł; 7 × 12,35 = 86,45 → 106,3335 → 106,33 zł; together 219,06 zł
    // (VAT on the summed 178,10 zł would give 219,063 → 219,06 zł here, but can differ by a grosz in other cases).
    const lines = [line(2, { bags: '3', unit_price_net_pln: '30.55' }), line(3, { bags: '7', unit_price_net_pln: '12.35' })];
    const result = invoiceDraft(sale(2), lines, client(), productName, 230, '2026-11-28');
    expect(result.ok && result.draft.request.positions.map((p) => p.totalGross)).toEqual(['112.73', '106.33']);
    expect(result.ok && result.draft.totalGross).toBe(21906);
  });

  it("uses the client's short name when it has no CEIDG name", () => {
    const result = invoiceDraft(sale(2), [line(2)], client({ registeredName: '' }), productName, 230, '2026-11-28');
    expect(result.ok && result.draft.buyer.name).toBe('Café Nowa');
  });

  it('says why it cannot be issued', () => {
    const why = (s = sale(2), lines = [line(2)], c: Client | 'none' = client()) => {
      const r = invoiceDraft(s, lines, c === 'none' ? undefined : c, productName, 230, '2026-11-28');
      return r.ok ? [] : r.problems;
    };
    expect(why(sale(2, { kind: 'sample', invoice_status: '' }))).toEqual(['Fakturę wystawia się tylko dla sprzedaży.']);
    expect(why(sale(2, { invoice_status: 'issued' }))).toEqual(['Faktura za tę sprzedaż jest już wystawiona.']);
    expect(why(sale(2, { fakturownia_id: '345' }))).toEqual(['Faktura za tę sprzedaż jest już wystawiona.']);
    expect(why(sale(2), [line(2)], client({ nip: '' }))).toEqual(['Café Nowa nie ma NIP-u: uzupełnij go w zakładce Klienci.']);
    expect(why(sale(2), [line(2)], client({ email: ' ' }))).toEqual(['Café Nowa nie ma adresu e-mail (faktura trafia na niego): uzupełnij go w zakładce Klienci.']);
    expect(why(sale(2), [line(2)], 'none')).toEqual(['Tej sprzedaży nie da się przypisać do klienta z zakładki Klienci.']);
    expect(why(sale(2), [line(2)], client({ deletedAt: 'x' }))).toEqual(['Tej sprzedaży nie da się przypisać do klienta z zakładki Klienci.']);
    expect(why(sale(2), [line(2, { free: 'yes' })])).toEqual(['Na fakturze nie byłoby nic do zapłaty (same gratisy).']);
    expect(why(sale(2), [])).toEqual(['Ta sprzedaż nie ma produktów.']);
    expect(why(sale(2), [line(2, { unit_price_net_pln: '' })])).toEqual([
      'Nie wszystkie produkty mają zapisaną cenę (KENIA): kliknij Zapisz, a jeśli to nie pomoże, sprawdź ceny w zakładce Produkty.',
    ]);
  });
});

describe('pricesUpToDate', () => {
  const data: PricingData = { clientId: 'C1', retail: () => 22000, special: (p, g) => (p === 'K' && g === 1000 ? 11200 : undefined), discounts: [], vatTenths: 230 };
  const toPrice = [{ productId: 'K', grams: 1000, bags: 8, free: false }];

  it('is true when the saved prices are what the sale is priced at now', () => {
    expect(pricesUpToDate(priceSale(toPrice, data), sale(2, { discount_percent: '' }), [line(2)])).toBe(true);
  });

  it('is false when a price or the discount changed since the sale was saved', () => {
    expect(pricesUpToDate(priceSale(toPrice, data), sale(2, { discount_percent: '' }), [line(2, { unit_price_net_pln: '110' })])).toBe(false);
    expect(pricesUpToDate(priceSale(toPrice, data), sale(2, { discount_percent: '25' }), [line(2)])).toBe(false);
    expect(pricesUpToDate(priceSale(toPrice, data), sale(2, { discount_percent: '' }), [line(2, { price_kind: 'discount' })])).toBe(false);
  });
});

describe('after issuing, and paid', () => {
  it('sets the sale to "Faktura wystawiona" today with the number, id and link', () => {
    expect(issuedFields({ id: 345, number: '12/11/2026', url: 'https://x.example/invoice/t' }, '2026-11-28')).toEqual({
      invoice_status: 'issued',
      invoice_date: '2026-11-28',
      invoice_number: '12/11/2026',
      fakturownia_id: '345',
      fakturownia_url: 'https://x.example/invoice/t',
    });
  });

  const issued = (row: number, id: string, o: Record<string, string> = {}) => sale(row, { invoice_status: 'issued', invoice_date: '2026-11-28', fakturownia_id: id, ...o });

  it('asks about the invoices Kraken issued that are not paid, and paid ones from the last 60 days (KSeF), 40 at a time', () => {
    const sales = [
      issued(2, '345'),
      issued(3, ''),
      sale(4),
      issued(5, '346', { invoice_status: 'paid', invoice_date: '2026-11-01' }),
      issued(6, '347', { deleted_at: 'x' }),
      issued(7, '348'),
      issued(8, '349', { invoice_status: 'paid', invoice_date: '2026-09-28' }), // 61 days before: not asked
      issued(9, '350', { invoice_status: 'paid', invoice_date: '2026-09-29' }), // 60 days: asked
      issued(10, '351', { invoice_status: 'paid', invoice_date: '' }), // no date known: asked
    ];
    expect(invoiceIdsToAsk(sales, '2026-11-28')).toEqual([[345, 346, 348, 350, 351]]);
    expect(invoiceIdsToAsk(Array.from({ length: 90 }, (_, i) => issued(i + 2, String(1000 + i))), '2026-11-28').map((c) => c.length)).toEqual([40, 40, 10]);
  });

  it('marks paid only those Fakturownia shows as paid, keeping the issue date', () => {
    const sales = [issued(2, '345'), issued(3, '346'), issued(4, '347')];
    const states = [
      { id: 345, number: '1', status: 'paid', paidDate: '2026-12-05', ksefStatus: 'ok', ksefNumber: null },
      { id: 346, number: '2', status: 'partial', paidDate: null, ksefStatus: 'ok', ksefNumber: null },
      { id: 999, number: '9', status: 'paid', paidDate: '2026-12-05', ksefStatus: 'ok', ksefNumber: null },
    ];
    expect(paidUpdates(sales, states)).toEqual([{ sale: sales[0], fields: { invoice_status: 'paid', invoice_date: '2026-11-28' } }]);
  });
});

describe('chooseClient (owner, 2026-11-28)', () => {
  it('uses the Fakturownia client with this NIP, or none (Kraken adds it); a card without an e-mail stops the invoice', () => {
    expect(chooseClient([{ id: 7, name: 'Nowa Kawa', email: ' k@example.com ' }, { id: 8, name: 'Other', email: 'o@example.com' }])).toEqual({ ok: true, card: { id: 7, name: 'Nowa Kawa', email: 'k@example.com' } });
    expect(chooseClient([])).toEqual({ ok: true, card: null });
    expect(chooseClient([{ id: 7, name: 'Nowa Kawa', email: '' }])).toEqual({
      ok: false,
      problem: 'Klient „Nowa Kawa” w Fakturowni nie ma adresu e-mail: dodaj go na karcie klienta w Fakturowni, a potem wystaw fakturę.',
    });
  });
});

describe('cardDiffers', () => {
  it('says when the Fakturownia card has another name or e-mail than Klienci (the invoice uses the card)', () => {
    const buyer = { name: 'Nowa Kawa Sp. z o.o.', email: 'kawa@example.com' };
    expect(cardDiffers({ name: 'nowa kawa  sp. z o.o.', email: 'KAWA@example.com' }, buyer)).toBe('');
    expect(cardDiffers({ name: 'Stara Nazwa', email: 'kawa@example.com' }, buyer)).toBe('Karta klienta w Fakturowni ma inną nazwę niż zakładka Klienci; faktura użyje danych z Fakturowni. Jeśli są nieaktualne, popraw je najpierw na karcie w Fakturowni.');
    expect(cardDiffers({ name: 'Stara Nazwa', email: 'old@example.com' }, buyer)).toContain('inną nazwę i e-mail');
  });
});

describe('ksefState (owner, 2026-11-28)', () => {
  it("says in Polish where an invoice is with KSeF (Kraken never sends it: the owner does in Fakturownia)", () => {
    const k = (status: string | null) => {
      const r = ksefState(status);
      return [r.kind, r.text, r.warn];
    };
    expect(k(null)).toEqual(['not_sent', 'nie wysłana do KSeF', true]);
    expect(k('')).toEqual(['not_sent', 'nie wysłana do KSeF', true]);
    expect(k('ok')).toEqual(['sent', 'w KSeF', false]);
    expect(k('processing')).toEqual(['pending', 'wysyłana do KSeF', false]);
    expect(k('offline')).toEqual(['pending', 'czeka na KSeF (offline)', false]);
    expect(k('not_applicable')).toEqual(['other', 'nie dotyczy KSeF', false]);
    expect(k('not_connected')).toEqual(['error', 'KSeF nie jest połączony w Fakturowni', true]);
    for (const e of ['send_error', 'server_error', 'status_check_error', 'offline_error', 'duplicate_error', 'blocked_403_error', 'something_new']) {
      expect(k(e)).toEqual(['error', 'błąd KSeF: sprawdź w Fakturowni', true]);
    }
  });

  it('only in KSeF test mode is not really in KSeF: shown as such and still to send', () => {
    expect(ksefState('demo_ok')).toEqual({ kind: 'test', text: 'w KSeF (tryb testowy)', warn: true });
    expect(ksefState('demo_processing')).toMatchObject({ kind: 'pending', text: 'wysyłana do KSeF (tryb testowy)' });
  });
});

describe('ksefWaiting', () => {
  it('lists the sales whose invoice is not in KSeF yet, as far as Fakturownia said', () => {
    const issued2 = (row: number, id: string, o: Record<string, string> = {}) => sale(row, { invoice_status: 'issued', invoice_date: '2026-11-28', fakturownia_id: id, ...o });
    const sales = [issued2(2, '1'), issued2(3, '2'), issued2(4, '3'), issued2(5, '4'), issued2(6, '5', { deleted_at: 'x' }), issued2(7, '6'), sale(8)];
    const states = new Map([
      [1, { ksefStatus: null }],
      [2, { ksefStatus: 'ok' }],
      [3, { ksefStatus: 'send_error' }],
      [4, { ksefStatus: 'demo_ok' }],
      [5, { ksefStatus: null }],
    ]);
    expect(ksefWaiting(sales, states).map((s) => s.id)).toEqual(['S2', 'S4', 'S5']); // 6: not asked yet; 5: deleted
  });
});

describe('deletedInFakturownia (owner, 2026-11-28)', () => {
  it('lists the sales whose invoice no longer exists in Fakturownia', () => {
    const s = (row: number, id: string, o: Record<string, string> = {}) => sale(row, { invoice_status: 'issued', invoice_date: '2026-11-28', fakturownia_id: id, ...o });
    const sales = [s(2, '1'), s(3, '2'), s(4, '3', { deleted_at: 'x' }), sale(5)];
    expect(deletedInFakturownia(sales, new Set([1, 3])).map((x) => x.id)).toEqual(['S2']);
  });
});
