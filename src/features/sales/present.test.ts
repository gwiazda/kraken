import { describe, expect, it } from 'vitest';
import { lineFromFields, saleFromFields } from './model';
import { bagsText, saleFacts, saleRows } from './present';

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
      ['S5', 'Own use', 'Tasting at home', '—', '', ''],
      ['S4', 'Sample', 'Café X, Kazimierz (not a client)', 'GWATEMALA 1 kg × 3', '3 bags', ''],
      ['S2', 'Sale', 'Café Nowa', 'GWATEMALA 1 kg × 3, KENIA 250 g × 1 (free)', '4 bags (1 free)', ''],
      ['S3', 'Sale', 'Café Nowa', '—', '', '2026-11-20'],
    ]);
  });

  it('filters, and counts each filter without deleted entries', () => {
    const { rows, counts } = saleRows(sales, lines, 'to_issue', (id) => clients[id], (id) => products[id]);
    expect(rows.map((r) => r.sale.id)).toEqual(['S2']);
    expect(counts).toEqual({ to_issue: 1, issued: 1, paid: 0, sample: 1, own_use: 1, all: 4 });
  });

  it('counts bags, one or many, and the free ones', () => {
    expect(bagsText([{ bags: 1, free: false }])).toBe('1 bag');
    expect(bagsText([{ bags: 3, free: false }, { bags: 1, free: true }])).toBe('4 bags (1 free)');
    expect(bagsText([])).toBe('');
  });
});

describe('saleFacts', () => {
  it('shows the date of the sale, when it was added and by whom, and when the invoice was issued', () => {
    const s = sale(2, { date: '2026-11-10', created_at: '2026-11-11T10:00:00.000Z', invoice_status: 'paid', invoice_date: '2026-11-12' });
    expect(saleFacts(s)).toEqual([
      { label: 'Date of the sale', value: '2026-11-10' },
      { label: 'Added to Kraken', value: '2026-11-11 by partner@example.com' },
      { label: 'Invoice', value: 'Paid' },
      { label: 'Invoice issued on', value: '2026-11-12' },
    ]);
  });

  it('says "Not yet" before the invoice is issued, and samples have no invoice', () => {
    expect(saleFacts(sale(2, { created_at: '' }))).toEqual([
      { label: 'Date of the sale', value: '2026-11-19' },
      { label: 'Added to Kraken', value: '—' },
      { label: 'Invoice', value: 'Invoice to be issued' },
      { label: 'Invoice issued on', value: 'Not yet' },
    ]);
    expect(saleFacts(sale(3, { kind: 'sample', invoice_status: '', created_at: '2026-11-11T10:00:00.000Z' })).map((f) => f.label)).toEqual(['Date of the sample', 'Added to Kraken']);
  });
});
