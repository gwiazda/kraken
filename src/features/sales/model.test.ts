import { describe, expect, it } from 'vitest';
import {
  changedSaleFields,
  emptyLine,
  emptySaleForm,
  formFromSale,
  lineChanges,
  lineFromFields,
  linesOf,
  saleFromFields,
  bagCount,
  sortSales,
  startingInvoice,
  statusChange,
  validateSale,
  type SaleForm,
} from './model';

// Made-up sales only.
const sale = (row: number, o: Record<string, string> = {}) =>
  saleFromFields({ id: `S${row}`, date: '2026-11-19', kind: 'sale', client_id: 'C1', place: '', reason: '', invoice_status: 'to_issue', notes: '', ...o }, row);
const line = (row: number, o: Record<string, string> = {}) =>
  lineFromFields({ id: `L${row}`, sale_id: 'S2', position: '1', product_id: 'P1', bag_size_g: '1000', bags: '3', unit_price_net_pln: '97.02', free: '', ...o }, row);
const form = (o: Partial<SaleForm> = {}): SaleForm => ({
  ...emptySaleForm('2026-11-19'),
  clientId: 'C1',
  lines: [{ productId: 'P1', grams: '1000', bags: '3', free: false }],
  ...o,
});

describe('reading sales and lines', () => {
  it('reads a sale and its lines', () => {
    expect(sale(2)).toMatchObject({ kind: 'sale', clientId: 'C1', status: 'to_issue', problems: [] });
    expect(line(3)).toMatchObject({ grams: 1000, bags: 3, free: false });
    expect(line(4, { free: 'yes' })).toMatchObject({ free: true });
  });

  it('has no invoice status for a sample or own use', () => {
    expect(sale(2, { kind: 'sample', invoice_status: '' }).status).toBeNull();
    expect(sale(2, { kind: 'own_use', invoice_status: 'to_issue' }).status).toBeNull();
  });

  it('says which cells it cannot read', () => {
    expect(sale(5, { kind: 'gift', date: '19.11.2026' }).problems).toEqual([
      'Row 5 of the Sales tab has the kind "gift", which is not sale, sample or own_use.',
      'Row 5 of the Sales tab has the date "19.11.2026", which is not a date (YYYY-MM-DD).',
    ]);
    expect(sale(6, { invoice_status: 'done' }).problems).toEqual(['Row 6 of the Sales tab has the invoice status "done", which Kraken cannot read.']);
  });

  it("lists a sale's active lines in order, and sales newest first", () => {
    const lines = [line(3, { position: '2' }), line(4, { position: '1' }), line(5, { deleted_at: '2026-11-19T10:00:00.000Z' }), line(6, { sale_id: 'S9' })];
    expect(linesOf(lines, 'S2').map((l) => l.id)).toEqual(['L4', 'L3']);
    expect(sortSales([sale(2, { date: '2026-11-01' }), sale(3), sale(4)]).map((s) => s.id)).toEqual(['S4', 'S3', 'S2']);
  });
});

describe('bag counts', () => {
  it('counts the bags and the free ones (the owner example: 3 kg + 1 kg free)', () => {
    expect(bagCount([line(3), line(4, { bags: '1', free: 'yes' })])).toEqual({ bags: 4, free: 1 });
  });
});

describe('validateSale', () => {
  it('stores a sale with its lines', () => {
    expect(validateSale(form(), ['C1'], ['P1'])).toEqual({
      ok: true,
      fields: { date: '2026-11-19', kind: 'sale', client_id: 'C1', place: '', reason: '', notes: '' },
      lines: [{ position: '1', product_id: 'P1', bag_size_g: '1000', bags: '3', unit_price_net_pln: '', free: '' }],
    });
  });

  it('stores free bags (no prices in Sales: the owner takes them from the offer)', () => {
    const result = validateSale(form({ lines: [{ productId: 'P1', grams: '1000', bags: '1', free: true }] }), ['C1'], ['P1']);
    expect(result).toMatchObject({ ok: true, lines: [{ free: 'yes', unit_price_net_pln: '' }] });
  });

  it('stores a sample at a place that is not a client, and own use with a reason, without prices', () => {
    const sample = validateSale(form({ kind: 'sample', clientId: '', place: '  Café  Nowa, Kazimierz ' }), ['C1'], ['P1']);
    expect(sample).toMatchObject({ ok: true, fields: { kind: 'sample', client_id: '', place: 'Café Nowa, Kazimierz' }, lines: [{ unit_price_net_pln: '', free: '' }] });
    const own = validateSale(form({ kind: 'own_use', reason: 'Tasting at home' }), ['C1'], ['P1']);
    expect(own).toMatchObject({ ok: true, fields: { kind: 'own_use', client_id: '', reason: 'Tasting at home' } });
  });

  it('explains what is missing', () => {
    const result = validateSale(
      form({ date: '', clientId: '', lines: [{ productId: '', grams: '300', bags: '0', free: false }, emptyLine()] }),
      ['C1'],
      ['P1'],
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        date: 'Enter the date, e.g. 2026-11-19.',
        client: 'Choose the client (add new ones on the Clients page).',
        line: [
          'Line 1: choose the product, choose the bag size, enter the number of bags (1 to 999).',
          'Line 2: choose the product.',
        ],
      },
    });
    expect(validateSale(form({ kind: 'sample', clientId: '' }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { place: 'Choose a client or type where the sample was left, e.g. Café Nowa, Kazimierz.' } });
    expect(validateSale(form({ kind: 'own_use' }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { reason: 'Say why, e.g. for a tasting at home.' } });
    expect(validateSale(form({ lines: [] }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { lines: 'Add at least one product.' } });
  });
});

describe('the invoice status', () => {
  it('starts as to be issued for a sale, and has none for samples and own use', () => {
    expect(startingInvoice('sale')).toEqual({ invoice_status: 'to_issue' });
    expect(startingInvoice('sample')).toEqual({ invoice_status: '', invoice_number: '', invoice_date: '', paid_date: '' });
  });

  const issued = sale(2, { invoice_status: 'issued', invoice_date: '2026-11-12' });
  const paid = sale(3, { invoice_status: 'paid', invoice_date: '2026-11-12', paid_date: '2026-11-15' });
  const toIssue = sale(4);

  it('issued or paid from "to be issued" takes today as the date', () => {
    expect(statusChange(toIssue, 'issued', '2026-11-19')).toEqual({ invoice_status: 'issued', invoice_date: '2026-11-19', paid_date: '' });
    expect(statusChange(toIssue, 'paid', '2026-11-19')).toEqual({ invoice_status: 'paid', invoice_date: '2026-11-19', paid_date: '2026-11-19' });
  });

  it('keeps a date already known: paid keeps the issue date, back to issued keeps it too', () => {
    expect(statusChange(issued, 'paid', '2026-11-19')).toEqual({ invoice_status: 'paid', invoice_date: '2026-11-12', paid_date: '2026-11-19' });
    expect(statusChange(paid, 'issued', '2026-11-19')).toEqual({ invoice_status: 'issued', invoice_date: '2026-11-12', paid_date: '' });
    expect(statusChange(paid, 'paid', '2026-11-19')).toEqual({ invoice_status: 'paid', invoice_date: '2026-11-12', paid_date: '2026-11-15' });
  });

  it('a stale date left in a "to be issued" sale, or a date that cannot be read, is replaced by today', () => {
    expect(statusChange(sale(5, { invoice_date: '2026-10-01' }), 'issued', '2026-11-19')).toMatchObject({ invoice_date: '2026-11-19' });
    expect(statusChange(sale(6, { invoice_status: 'issued', invoice_date: 'soon' }), 'paid', '2026-11-19')).toMatchObject({ invoice_date: '2026-11-19' });
  });

  it('going back to "to be issued" clears the dates (a mistake can be undone)', () => {
    expect(statusChange(paid, 'to_issue', '2026-11-19')).toEqual({ invoice_status: 'to_issue', invoice_date: '', paid_date: '' });
  });
});

describe('editing', () => {
  it('fills the form from a sale and its lines', () => {
    expect(formFromSale(sale(2), [line(3)])).toMatchObject({ kind: 'sale', clientId: 'C1', lines: [{ productId: 'P1', grams: '1000', bags: '3', free: false }] });
  });

  it('writes only what changed: sale cells, lines by position, new lines added, the rest soft-deleted', () => {
    const s = sale(2);
    expect(changedSaleFields(s, { date: '2026-11-19', kind: 'sale', client_id: 'C2', place: '', reason: '', notes: '' })).toEqual({ client_id: 'C2' });
    const first = line(3);
    const second = line(4, { position: '2' });
    const wanted = [{ position: '1', product_id: 'P1', bag_size_g: '1000', bags: '4', unit_price_net_pln: '97.02', free: '' }]; // an old price is left as it is
    expect(lineChanges([first, second], wanted)).toEqual({ updates: [{ line: first, changes: { bags: '4' } }], adds: [], removes: [second] });
  });
});
