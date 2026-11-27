import { describe, expect, it } from 'vitest';
import { formatPln, formatWholePln } from '../../core/numbers';
import { lineFromFields, saleFromFields } from './model';
import { bagsText, clientFacts, deletedEntryText, priceView, saleFacts, savedNet, saleRows, whoText } from './present';

const sale = (row: number, o: Record<string, string> = {}) =>
  saleFromFields({ id: `S${row}`, date: '2026-11-19', kind: 'sale', client_id: 'C1', invoice_status: 'to_issue', created_by: 'partner@example.com', ...o }, row);
const line = (row: number, saleId: string, o: Record<string, string> = {}) =>
  lineFromFields({ id: `L${row}`, sale_id: saleId, position: '1', product_id: 'P1', bag_size_g: '1000', bags: '3', unit_price_net_pln: '97.02', free: '', ...o }, row);
const clients: Record<string, string> = { C1: 'Café Nowa' };
const products: Record<string, string> = { P1: 'GWATEMALA', P2: 'KENIA' };

describe('saleRows', () => {
  const sales = [
    sale(2),
    sale(3, { date: '2026-11-18', invoice_status: 'issued', invoice_date: '2026-11-20', invoice_number: 'FV 1/11' }),
    sale(4, { kind: 'sample', client_id: '', place: 'Café X, Kazimierz', invoice_status: '' }),
    sale(5, { kind: 'own_use', client_id: '', reason: 'Tasting at home', invoice_status: '' }),
    sale(6, { deleted_at: '2026-11-19T10:00:00.000Z' }),
  ];
  const lines = [line(2, 'S2'), line(3, 'S2', { position: '2', product_id: 'P2', bag_size_g: '250', bags: '1', free: 'yes' }), line(4, 'S4', { unit_price_net_pln: '' })];

  it('sums up each entry: who, what, how many bags and the invoice status', () => {
    const { rows } = saleRows(sales, lines, 'all', (id) => clients[id], (id) => products[id]);
    expect(rows.map((r) => [r.sale.id, r.kindLabel, r.who, r.items, r.bags, r.invoiceDate])).toEqual([
      ['S5', 'Na własny użytek', 'Tasting at home', '—', '', ''],
      ['S4', 'Próbka', 'Café X, Kazimierz (nie jest klientem)', 'GWATEMALA 1 kg × 3', '3 opakowania', ''],
      ['S2', 'Sprzedaż', 'Café Nowa', 'GWATEMALA 1 kg × 3, KENIA 250 g × 1 (gratis)', '4 torebki (1 gratis)', ''],
      ['S3', 'Sprzedaż', 'Café Nowa', '—', '', '20.11.2026'],
    ]);
  });

  it('filters, and counts each filter without deleted entries', () => {
    const { rows, counts } = saleRows(sales, lines, 'to_issue', (id) => clients[id], (id) => products[id]);
    expect(rows.map((r) => r.sale.id)).toEqual(['S2']);
    expect(counts).toEqual({ to_issue: 1, issued: 1, paid: 0, sample: 1, own_use: 1, all: 4 });
  });

  it('counts bags, one or many, and the free ones', () => {
    expect(bagsText([{ bags: 1, free: false }])).toBe('1 torebka');
    expect(bagsText([{ bags: 3, free: false }, { bags: 1, free: true }])).toBe('4 torebki (1 gratis)');
    expect(bagsText([{ bags: 5, free: false }])).toBe('5 torebek');
    expect(bagsText([{ bags: 22, free: false }])).toBe('22 torebki');
    expect(bagsText([{ bags: 8, free: false }], 'sample')).toBe('8 opakowań'); // a sample: any amount, so packs
    expect(bagsText([{ bags: 3, free: true }], 'own_use')).toBe('3 torebki'); // free counts only for a sale
    expect(bagsText([])).toBe('');
  });
});

describe('saleFacts', () => {
  it('shows the date of the sale, when it was added and by whom, and when the invoice was issued', () => {
    const s = sale(2, { date: '2026-11-10', created_at: '2026-11-11T10:00:00.000Z', invoice_status: 'paid', invoice_date: '2026-11-12' });
    expect(saleFacts(s)).toEqual([
      { label: 'Data sprzedaży', value: '10.11.2026' },
      { label: 'Dodano do Krakena', value: '11.11.2026 (partner@example.com)' },
      { label: 'Stan faktury', value: 'Opłacona' },
      { label: 'Data wystawienia faktury', value: '12.11.2026' },
    ]);
  });

  it('says "Not yet" before the invoice is issued, and samples have no invoice', () => {
    expect(saleFacts(sale(2, { created_at: '' }))).toEqual([
      { label: 'Data sprzedaży', value: '19.11.2026' },
      { label: 'Dodano do Krakena', value: '—' },
      { label: 'Stan faktury', value: 'Faktura do wystawienia' },
      { label: 'Data wystawienia faktury', value: 'Jeszcze nie' },
    ]);
    expect(saleFacts(sale(3, { kind: 'sample', invoice_status: '', created_at: '2026-11-11T10:00:00.000Z' })).map((f) => f.label)).toEqual(['Data próbki', 'Dodano do Krakena']);
  });
});

describe('clientFacts', () => {
  it("shows the client's name and name in CEIDG (no discount per client since 2026-11-27)", () => {
    expect(clientFacts('C1', { name: 'Café Nowa', registeredName: 'Nowa Kawa Sp. z o.o.', deleted: false })).toEqual([
      { label: 'Klient', value: 'Café Nowa' },
      { label: 'Nazwa w CEIDG', value: 'Nowa Kawa Sp. z o.o.' },
    ]);
  });

  it('a dash for what the client does not have, and a deleted client marked', () => {
    expect(clientFacts('C1', { name: 'Café Nowa', registeredName: '', deleted: true })).toEqual([
      { label: 'Klient', value: 'Café Nowa (usunięty)' },
      { label: 'Nazwa w CEIDG', value: '—' },
    ]);
  });

  it('says so when the client cannot be found, and shows nothing without a client', () => {
    expect(clientFacts('C9', undefined)).toEqual([{ label: 'Klient', value: '? (nie ma takiego klienta)' }]);
    expect(clientFacts('', undefined)).toEqual([]);
  });
});

describe('whoText and deletedEntryText', () => {
  const name = (id: string) => clients[id];

  it('names the client, a place typed in, or the reason an older own-use entry had', () => {
    expect(whoText(sale(1), name)).toBe('Café Nowa');
    expect(whoText(sale(1, { client_id: 'GONE' }), name)).toBe('? (nie ma takiego klienta)');
    expect(whoText(sale(1, { kind: 'sample', client_id: '', place: 'Café X' }), name)).toBe('Café X (nie jest klientem)');
    expect(whoText(sale(1, { kind: 'own_use', client_id: '', reason: 'Tasting at home' }), name)).toBe('Tasting at home');
    expect(whoText(sale(1, { kind: 'own_use', client_id: '' }), name)).toBe('');
  });

  it('writes a deleted entry without a dangling "·" when there is no who', () => {
    expect(deletedEntryText(sale(1), name)).toBe('19.11.2026 · Sprzedaż · Café Nowa');
    expect(deletedEntryText(sale(1, { kind: 'own_use', client_id: '' }), name)).toBe('19.11.2026 · Na własny użytek');
  });
});

describe('prices on the screen (owner, 2026-11-27)', () => {
  it('shows the saved net total of a fully priced sale, and nothing otherwise', () => {
    const priced = [line(2, 'S2', { unit_price_net_pln: '112', bags: '8', price_kind: 'special' }), line(3, 'S2', { unit_price_net_pln: '30', bags: '16', price_kind: 'discount' }), line(4, 'S2', { unit_price_net_pln: '', free: 'yes' })];
    expect(savedNet(sale(2), priced)).toBe(formatWholePln(137600)); // 8 × 112 + 16 × 30 = 1376 zł; the free bag is not counted
    expect(savedNet(sale(2), [line(2, 'S2', { unit_price_net_pln: '' })])).toBe(''); // saved before prices existed
    expect(savedNet(sale(3, { kind: 'sample', invoice_status: '' }), priced)).toBe('');
    expect(savedNet(sale(2), [])).toBe('');
  });

  it("explains each line's price, the weight and the discount, and the total", () => {
    const view = priceView(
      [
        { productId: 'P1', grams: 1000, bags: 8, free: false },
        { productId: 'P2', grams: 250, bags: 16, free: false },
        { productId: 'P2', grams: 250, bags: 1, free: true },
        { productId: 'P1', grams: 500, bags: 1, free: false },
      ],
      {
        weightGrams: 12_500,
        discountTenths: 250,
        discountKept: false,
        lines: [
          { kind: 'special', unitNet: 11200, totalNet: 89600, kept: false },
          { kind: 'discount', unitNet: 3000, totalNet: 48000, kept: true },
          { kind: 'free' },
          { kind: 'missing', reason: 'produkt nie ma ceny za tę wielkość (zakładka Produkty)' },
        ],
        totalNet: 137600,
        complete: false,
      },
      (id) => products[id],
      (tenths) => (tenths === 250 ? '10–20 kg' : ''),
      230,
    );
    expect(view.rows.map((r) => [r.item, r.bags, r.unit, r.why, r.total, r.missing])).toEqual([
      ['GWATEMALA 1 kg', '8', '112 zł', 'cena specjalna', '896 zł', false],
      ['KENIA 250 g', '16', '30 zł', '−25 %, jak na fakturze', '480 zł', false],
      ['KENIA 250 g', '1', '', 'gratis', '', false],
      ['GWATEMALA 500 g', '1', '', 'produkt nie ma ceny za tę wielkość (zakładka Produkty)', '', true],
    ]);
    // With VAT 23 %, to the grosz: 112 → 137,76 zł; 8 × 112 = 896 → 1102,08 zł; 30 → 36,90 zł; 480 → 590,40 zł.
    expect(view.rows.map((r) => [r.unitGross, r.totalGross])).toEqual([
      [formatPln(13776), formatPln(110208)],
      [formatPln(3690), formatPln(59040)],
      ['', ''],
      ['', ''],
    ]);
    // The gross total is the net total with VAT, rounded once: 1376 → 1692,48 zł.
    expect(view.totalGross).toBe(formatPln(169248));
    expect(view.summary).toBe('12,5 kg kawy na fakturze (bez gratisów) · rabat −25 % (10–20 kg)');
    expect(view.total).toBe(formatWholePln(137600));
  });

  it('says when the discount is the one on the issued invoice', () => {
    const view = priceView([], { weightGrams: 25_000, discountTenths: 150, discountKept: true, lines: [], totalNet: 0, complete: true }, () => 'X', () => 'Do 10 kg', 230);
    expect(view.summary).toBe('25\u00a0kg kawy na fakturze (bez gratisów) · rabat −15\u00a0% (jak na fakturze)');
  });
});
